use crate::database::Database;
use serde::{Deserialize, Serialize};
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};

static CHINESE: AtomicBool = AtomicBool::new(false);

/// Explicit bilingual native messages; never applied to task content or property names.
pub fn text(english: &'static str, chinese: &'static str) -> &'static str {
    if CHINESE.load(Ordering::Relaxed) { chinese } else { english }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum LanguagePreference {
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "zh-CN")]
    Chinese,
    #[serde(rename = "en")]
    English,
}

impl LanguagePreference {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "auto" => Ok(Self::Auto),
            "zh-CN" => Ok(Self::Chinese),
            "en" => Ok(Self::English),
            _ => Err(text("Invalid language preference. Choose auto, zh-CN, or en.", "语言偏好无效，请选择 auto、zh-CN 或 en。").into()),
        }
    }

    fn as_str(self) -> &'static str {
        match self { Self::Auto => "auto", Self::Chinese => "zh-CN", Self::English => "en" }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum EffectiveLanguage {
    #[serde(rename = "zh-CN")]
    Chinese,
    #[serde(rename = "en")]
    English,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct LanguageState {
    pub preference: LanguagePreference,
    pub effective: EffectiveLanguage,
}

fn resolve(preference: LanguagePreference, windows_ui_language: u16) -> EffectiveLanguage {
    match preference {
        LanguagePreference::Chinese => EffectiveLanguage::Chinese,
        LanguagePreference::English => EffectiveLanguage::English,
        LanguagePreference::Auto if windows_ui_language & 0x03ff == 4 => EffectiveLanguage::Chinese,
        LanguagePreference::Auto => EffectiveLanguage::English,
    }
}

fn system_ui_language() -> u16 {
    #[cfg(windows)]
    { unsafe { windows::Win32::Globalization::GetUserDefaultUILanguage() } }
    // This is an explicit English fallback, not a claim to read another OS's UI locale.
    #[cfg(not(windows))]
    { 0 }
}

fn activate(state: LanguageState) {
    CHINESE.store(state.effective == EffectiveLanguage::Chinese, Ordering::Relaxed);
}

pub fn initialize_system_language() {
    activate(LanguageState { preference: LanguagePreference::Auto, effective: resolve(LanguagePreference::Auto, system_ui_language()) });
}

pub struct LanguageManager {
    state: Mutex<LanguageState>,
}

impl LanguageManager {
    pub fn load(db: &Database) -> Result<Self, String> {
        let preference = LanguagePreference::parse(db.get_setting("language")?.as_deref().unwrap_or("auto"))?;
        let state = LanguageState { preference, effective: resolve(preference, system_ui_language()) };
        activate(state);
        Ok(Self { state: Mutex::new(state) })
    }

    pub fn snapshot(&self) -> Result<LanguageState, String> {
        self.state.lock().map(|state| *state).map_err(|_| text("Unable to read language preference.", "无法读取语言偏好。").into())
    }

    /// Serialize the durable preference and native UI change. An unsuccessful write
    /// never activates the candidate language; SQLite rolls back on UI/commit failure.
    pub fn change(
        &self,
        db: &Database,
        preference: &str,
        apply: impl FnOnce(LanguageState) -> Result<(), String>,
        restore: impl FnOnce(LanguageState) -> Result<(), String>,
    ) -> Result<LanguageState, String> {
        let preference = LanguagePreference::parse(preference)?;
        let mut current = self.state.lock().map_err(|_| text("Unable to update language preference.", "无法更新语言偏好。").to_string())?;
        let next = LanguageState { preference, effective: resolve(preference, system_ui_language()) };
        let mut applied = false;
        let result = db.set_language_transaction(preference.as_str(), || {
            if next.effective != current.effective {
                applied = true;
                apply(next)?;
            }
            Ok(())
        });
        if result.is_err() {
            if applied { restore(*current)?; }
            return Err(text("Language was not saved. The previous preference is unchanged.", "语言设置未保存，已保留原偏好。").into());
        }
        *current = next;
        activate(next);
        Ok(next)
    }
}

pub fn labels(language: EffectiveLanguage) -> [&'static str; 3] {
    match language {
        EffectiveLanguage::Chinese => ["显示便签", "隐藏便签", "退出"],
        EffectiveLanguage::English => ["Show note", "Hide note", "Quit"],
    }
}

pub fn switch_mode_label(language: EffectiveLanguage) -> &'static str {
    match language {
        EffectiveLanguage::Chinese => "切换主面板 / 便签",
        EffectiveLanguage::English => "Switch Workspace / Sticky",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    #[test]
    fn auto_uses_windows_primary_language_not_region() {
        for langid in [0x0804, 0x0404, 0x0c04, 0x1004, 0x1404] {
            assert_eq!(resolve(LanguagePreference::Auto, langid), EffectiveLanguage::Chinese);
        }
        for langid in [0, 0x0409, 0x0809, 0x0411, 0x0407] {
            assert_eq!(resolve(LanguagePreference::Auto, langid), EffectiveLanguage::English);
        }
        assert_eq!(resolve(LanguagePreference::English, 0x0804), EffectiveLanguage::English);
        assert_eq!(resolve(LanguagePreference::Chinese, 0x0409), EffectiveLanguage::Chinese);
    }

    #[test]
    fn invalid_preferences_are_not_silently_auto() {
        for value in ["", "zh", "zh-TW", "EN", "fr", " auto "] {
            assert!(LanguagePreference::parse(value).is_err());
            assert!(serde_json::from_str::<LanguagePreference>(&format!("\"{value}\"")).is_err());
        }
        let state = LanguageState { preference: LanguagePreference::Auto, effective: EffectiveLanguage::English };
        assert_eq!(serde_json::to_value(state).unwrap(), serde_json::json!({"preference":"auto", "effective":"en"}));
    }

    #[test]
    fn preference_is_independent_durable_and_failures_do_not_activate() {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!("sticky-language-{}-{}.db", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        {
            let db = Database::open(path.clone()).unwrap();
            let initial = LanguageManager::load(&db).unwrap();
            initial.change(&db, "auto", |_| panic!("unchanged effective language must not rebuild the menu"), |_| Ok(())).unwrap();
            assert_eq!(db.get_setting("language").unwrap().as_deref(), Some("auto"));
            db.set_setting("language", "en").unwrap();
            db.set_setting("theme", "paper").unwrap();
            let manager = LanguageManager::load(&db).unwrap();
            assert!(manager.change(&db, "fr", |_| panic!("invalid language must not touch the UI"), |_| Ok(())).is_err());
            let restored = std::cell::Cell::new(false);
            assert!(manager.change(&db, "zh-CN", |_| Err("isolated menu failure".into()), |previous| {
                assert_eq!(previous.effective, EffectiveLanguage::English);
                restored.set(true);
                Ok(())
            }).is_err());
            assert!(restored.get());
            assert_eq!(db.get_setting("language").unwrap().as_deref(), Some("en"));
            assert_eq!(manager.snapshot().unwrap().effective, EffectiveLanguage::English);
            rusqlite::Connection::open(&path).unwrap().execute_batch("CREATE TRIGGER reject_language BEFORE UPDATE ON settings WHEN NEW.key='language' BEGIN SELECT RAISE(ABORT, 'isolated write failure'); END;").unwrap();
            assert!(manager.change(&db, "zh-CN", |_| panic!("failed write must not touch the UI"), |_| Ok(())).is_err());
            assert_eq!(manager.snapshot().unwrap().preference, LanguagePreference::English);
            rusqlite::Connection::open(&path).unwrap().execute_batch("DROP TRIGGER reject_language;").unwrap();
            let saved = manager.change(&db, "zh-CN", |state| { assert_eq!(labels(state.effective)[0], "显示便签"); Ok(()) }, |_| Ok(())).unwrap();
            assert_eq!(saved.preference, LanguagePreference::Chinese);
            assert_eq!(db.get_setting("language").unwrap().as_deref(), Some("zh-CN"));
            assert_eq!(db.get_setting("theme").unwrap().as_deref(), Some("paper"));
            manager.change(&db, "en", |_| Ok(()), |_| Ok(())).unwrap();
            db.set_setting("language", "invalid").unwrap();
            assert!(LanguageManager::load(&db).is_err());
            assert_eq!(db.get_setting("language").unwrap().as_deref(), Some("invalid"));
            db.set_setting("language", "en").unwrap();
        }
        {
            let db = Database::open(path.clone()).unwrap();
            assert_eq!(LanguageManager::load(&db).unwrap().snapshot().unwrap().preference, LanguagePreference::English);
        }
        std::fs::remove_file(path).unwrap();
    }
}
