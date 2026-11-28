use crate::database::Database;
use crate::language;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub const DEFAULT_APP_ICON_ID: &str = "c3";
const VALID_ICON_IDS: &[&str] = &["c3", "c2", "c4", "l3a", "l3b", "l3c", "l3d", "custom"];
const RGBA_128_BYTES: usize = 128 * 128 * 4;
const RGBA_32_BYTES: usize = 32 * 32 * 4;
const MAX_CUSTOM_DATA_URL_BYTES: usize = 512 * 1024;
const ICON_128_FILE: &str = "app-icon-128.rgba";
const ICON_32_FILE: &str = "app-icon-32.rgba";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIconState {
    pub icon_id: String,
    pub custom_data_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAppIconPayload {
    pub icon_id: String,
    pub custom_data_url: Option<String>,
    pub rgba_128: Vec<u8>,
    pub rgba_32: Vec<u8>,
}

pub fn normalize_icon_id(id: &str) -> &str {
    if VALID_ICON_IDS.contains(&id) {
        id
    } else {
        DEFAULT_APP_ICON_ID
    }
}

pub fn validate_payload(payload: &SetAppIconPayload) -> Result<(), String> {
    if !VALID_ICON_IDS.contains(&payload.icon_id.as_str()) {
        return Err(language::text("Unknown icon preset.", "未知的图标方案。").into());
    }
    if payload.rgba_128.len() != RGBA_128_BYTES {
        return Err(language::text("Invalid 128x128 icon pixel buffer.", "128x128 图标像素数据无效。").into());
    }
    if payload.rgba_32.len() != RGBA_32_BYTES {
        return Err(language::text("Invalid 32x32 tray icon pixel buffer.", "32x32 托盘图标像素数据无效。").into());
    }
    if let Some(url) = payload.custom_data_url.as_deref() {
        if url.len() > MAX_CUSTOM_DATA_URL_BYTES {
            return Err(language::text("Custom icon preview exceeds the 512 KB limit.", "自定义图标缩略图超过 512 KB 限制。").into());
        }
        if !url.starts_with("data:image/") {
            return Err(language::text("Custom icon must be an image data URL.", "自定义图标必须是有效的图片数据。").into());
        }
    }
    if payload.icon_id == "custom" && payload.custom_data_url.as_deref().is_none_or(str::is_empty) {
        return Err(language::text("Upload an icon image before selecting the custom slot.", "请先上传自定义图标图片。").into());
    }
    Ok(())
}

fn icon_paths(dir: &Path) -> (PathBuf, PathBuf) {
    (dir.join(ICON_128_FILE), dir.join(ICON_32_FILE))
}

pub fn write_cached_rgba_files(dir: &Path, rgba_128: &[u8], rgba_32: &[u8]) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let (p128, p32) = icon_paths(dir);
    std::fs::write(p128, rgba_128).map_err(|e| e.to_string())?;
    std::fs::write(p32, rgba_32).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn read_cached_rgba_files(dir: &Path) -> Option<(Vec<u8>, Vec<u8>)> {
    let (p128, p32) = icon_paths(dir);
    let b128 = std::fs::read(p128).ok()?;
    let b32 = std::fs::read(p32).ok()?;
    if b128.len() == RGBA_128_BYTES && b32.len() == RGBA_32_BYTES {
        Some((b128, b32))
    } else {
        None
    }
}

pub fn apply_rgba_icon(app: &AppHandle, rgba_128: Vec<u8>, rgba_32: Vec<u8>) -> Result<(), String> {
    if rgba_128.len() != RGBA_128_BYTES || rgba_32.len() != RGBA_32_BYTES {
        return Err(language::text("Invalid icon buffer size.", "图标像素尺寸无效。").into());
    }
    if let Some(win) = app.get_webview_window("main") {
        let win_icon = tauri::image::Image::new_owned(rgba_128, 128, 128);
        win.set_icon(win_icon).map_err(|e| e.to_string())?;
    }
    if let Some(tray) = app.tray_by_id("main-tray") {
        let tray_icon = tauri::image::Image::new_owned(rgba_32, 32, 32);
        tray.set_icon(Some(tray_icon)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn restore_saved_icon_on_startup(app: &AppHandle, db: &Database) {
    let Ok((icon_id, _)) = db.load_app_icon() else {
        return;
    };
    if icon_id == DEFAULT_APP_ICON_ID {
        return;
    }
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    if let Some((rgba_128, rgba_32)) = read_cached_rgba_files(&dir) {
        if let Err(err) = apply_rgba_icon(app, rgba_128, rgba_32) {
            eprintln!("Failed to restore saved app icon ({icon_id}): {err}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_icon_payload_and_buffers() {
        let ok = SetAppIconPayload {
            icon_id: "c3".into(),
            custom_data_url: None,
            rgba_128: vec![0; RGBA_128_BYTES],
            rgba_32: vec![0; RGBA_32_BYTES],
        };
        assert!(validate_payload(&ok).is_ok());

        let bad_id = SetAppIconPayload {
            icon_id: "unknown".into(),
            ..ok.clone()
        };
        assert!(validate_payload(&bad_id).is_err());

        let bad_buf = SetAppIconPayload {
            rgba_128: vec![0; 16],
            ..ok.clone()
        };
        assert!(validate_payload(&bad_buf).is_err());

        let custom_without_url = SetAppIconPayload {
            icon_id: "custom".into(),
            custom_data_url: None,
            ..ok.clone()
        };
        assert!(validate_payload(&custom_without_url).is_err());

        let custom_ok = SetAppIconPayload {
            icon_id: "custom".into(),
            custom_data_url: Some("data:image/png;base64,AAAA".into()),
            ..ok
        };
        assert!(validate_payload(&custom_ok).is_ok());
    }

    #[test]
    fn roundtrips_cached_rgba_files() {
        let dir = std::env::temp_dir().join(format!(
            "sticky_note_icon_test_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let b128 = vec![42u8; RGBA_128_BYTES];
        let b32 = vec![84u8; RGBA_32_BYTES];
        write_cached_rgba_files(&dir, &b128, &b32).unwrap();
        let loaded = read_cached_rgba_files(&dir).unwrap();
        assert_eq!(loaded.0, b128);
        assert_eq!(loaded.1, b32);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
