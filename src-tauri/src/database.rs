use crate::models::{
    format_task_date_summary, normalize_notion_id, AppearanceSettings, AppSettings, Group, NotionConfig,
    NotionWriteMapping, PendingOp, SaveNotionConfigResult, Task, TaskImportResult, TaskScheduleInput,
    TaskUpdateInput, TaskView, ARCHIVE_GROUP_ID, NOTION_GROUP_ID,
};
use crate::monitors::{self, MonitorLayout};
use crate::window_state::{DockEdge, DockPhase, WindowMode, WindowRestore, WindowStateV2, WorkspaceGeometry};
use std::collections::{HashMap, HashSet};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyWindowGeometry {
    x: i32,
    y: i32,
    width: f64,
    height: f64,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyEdgeDock {
    phase: DockPhase,
    edge: Option<DockEdge>,
    restored_x: i32,
    restored_y: i32,
    restored_width: u32,
    restored_height: u32,
}

struct NormalizedSchedule {
    start_date: Option<String>,
    end_date: Option<String>,
    start_time: Option<String>,
    end_time: Option<String>,
    reminder_at: Option<i64>,
    date: Option<String>,
}

pub struct Database {
    conn: Mutex<Connection>,
}
pub async fn database_work<T, F>(db: Arc<Database>, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&Database) -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || operation(&db)).await
        .map_err(|_| crate::language::text("The database worker could not complete the operation.", "数据库工作线程未能完成操作").to_string())?
}

impl Database {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let version: u32 = tx.query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        if version == 3 {
            return Ok(());
        }
        if version > 3 {
            return Err(crate::language::text("This database was created by a newer version of Sticky Note.", "数据库版本高于当前应用支持的版本").into());
        }
        if version == 0 {
            tx.execute_batch(
                "CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    notion_id TEXT,
                    title TEXT NOT NULL,
                    completed INTEGER NOT NULL DEFAULT 0,
                    progress TEXT,
                    remain TEXT,
                    date TEXT,
                    tags TEXT NOT NULL DEFAULT '[]',
                    updated_time INTEGER NOT NULL,
                    group_id TEXT NOT NULL DEFAULT 'notion',
                    archive_source_group_id TEXT,
                    position INTEGER NOT NULL DEFAULT 0,
                    start_date TEXT,
                    end_date TEXT,
                    start_time TEXT,
                    end_time TEXT,
                    reminder_at INTEGER,
                    reminded_at INTEGER
                 );
                 CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS groups (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    kind TEXT NOT NULL DEFAULT 'local',
                    position INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS pending_ops (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    completed INTEGER NOT NULL,
                    created_at INTEGER NOT NULL
                 );",
            ).map_err(|e| e.to_string())?;
            for (column, definition) in [
                ("group_id", "group_id TEXT NOT NULL DEFAULT 'notion'"),
                ("archive_source_group_id", "archive_source_group_id TEXT"),
                ("position", "position INTEGER NOT NULL DEFAULT 0"),
            ] {
                let exists: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM pragma_table_info('tasks') WHERE name = ?1)",
                    params![column], |row| row.get(0),
                ).map_err(|e| e.to_string())?;
                if !exists {
                    tx.execute_batch(&format!("ALTER TABLE tasks ADD COLUMN {definition}"))
                        .map_err(|e| e.to_string())?;
                }
            }
            let now = chrono::Utc::now().timestamp_millis();
            tx.execute(
                "INSERT OR IGNORE INTO groups(id, name, kind, position, created_at)
                 VALUES(?1, '来自 Notion', 'notion', 0, ?2)",
                params![NOTION_GROUP_ID, now],
            ).map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT OR IGNORE INTO groups(id, name, kind, position, created_at)
                 VALUES(?1, 'Archive', 'archive', 0, ?2)",
                params![ARCHIVE_GROUP_ID, now],
            ).map_err(|e| e.to_string())?;
            let interrupted_local: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM tasks WHERE notion_id IS NULL AND group_id = ?1)",
                params![NOTION_GROUP_ID], |row| row.get(0),
            ).map_err(|e| e.to_string())?;
            if interrupted_local {
                tx.execute(
                    "INSERT OR IGNORE INTO groups(id, name, kind, position, created_at)
                     VALUES('demo-migrated', '示例计划', 'local', 1, ?1)",
                    params![now],
                ).map_err(|e| e.to_string())?;
                tx.execute(
                    "UPDATE tasks SET group_id = 'demo-migrated'
                     WHERE notion_id IS NULL AND group_id = ?1",
                    params![NOTION_GROUP_ID],
                ).map_err(|e| e.to_string())?;
            }
            Self::migrate_pending(&tx)?;
            Self::archive_completed_local_tasks(&tx)?;
            tx.execute_batch("DROP TABLE IF EXISTS sync_log;")
                .map_err(|e| e.to_string())?;
        }

        if version < 2 {
            let has_position: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM pragma_table_info('tasks') WHERE name = 'position')",
                [], |row| row.get(0),
            ).map_err(|e| e.to_string())?;
            if !has_position {
                tx.execute_batch("ALTER TABLE tasks ADD COLUMN position INTEGER NOT NULL DEFAULT 0")
                    .map_err(|e| e.to_string())?;
            }
            tx.execute_batch("PRAGMA user_version = 2;")
                .map_err(|e| e.to_string())?;
        }
        if version < 3 {
            for (column, definition) in [
                ("start_date", "start_date TEXT"),
                ("end_date", "end_date TEXT"),
                ("start_time", "start_time TEXT"),
                ("end_time", "end_time TEXT"),
                ("reminder_at", "reminder_at INTEGER"),
                ("reminded_at", "reminded_at INTEGER"),
            ] {
                let exists: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM pragma_table_info('tasks') WHERE name = ?1)",
                    params![column], |row| row.get(0),
                ).map_err(|e| e.to_string())?;
                if !exists {
                    tx.execute_batch(&format!("ALTER TABLE tasks ADD COLUMN {definition}"))
                        .map_err(|e| e.to_string())?;
                }
            }
            Self::backfill_task_dates_on(&tx)?;
            tx.execute_batch("PRAGMA user_version = 3;")
                .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }

    fn parse_date_prefix(raw: &str) -> Option<String> {
        let prefix = raw.trim().get(..10)?;
        chrono::NaiveDate::parse_from_str(prefix, "%Y-%m-%d").ok().map(|_| prefix.to_string())
    }

    fn backfill_task_dates_on(conn: &Connection) -> Result<(), String> {
        let rows = {
            let mut stmt = conn
                .prepare("SELECT id, date FROM tasks WHERE date IS NOT NULL AND start_date IS NULL")
                .map_err(|e| e.to_string())?;
            let mapped = stmt
                .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
                .map_err(|e| e.to_string())?;
            mapped.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };
        for (id, raw) in rows {
            let (start_date, end_date) = match raw.split_once('→') {
                Some((left, right)) => {
                    let s = Self::parse_date_prefix(left);
                    let e = Self::parse_date_prefix(right).filter(|end| s.as_deref() != Some(end.as_str()));
                    (s, e)
                }
                None => (Self::parse_date_prefix(&raw), None),
            };
            if start_date.is_some() {
                conn.execute(
                    "UPDATE tasks SET start_date = ?1, end_date = ?2 WHERE id = ?3",
                    params![start_date, end_date, id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    fn migrate_pending(conn: &Connection) -> Result<(), String> {
        // Original ids, not timestamps, define the last legacy intent.
        let mut latest = HashMap::new();
        let mut page_tasks: HashMap<String, Vec<String>> = HashMap::new();
        {
            let mut stmt = conn.prepare("SELECT id, notion_id FROM tasks WHERE notion_id IS NOT NULL")
                .map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
                .map_err(|e| e.to_string())?;
            for row in rows {
                let (id, page) = row.map_err(|e| e.to_string())?;
                page_tasks.entry(normalize_notion_id(&page)).or_default().push(id);
            }
        }
        {
            let mut stmt = conn.prepare(
                "SELECT p.id, p.task_id, p.completed, p.created_at, t.notion_id
                 FROM pending_ops p LEFT JOIN tasks t ON t.id = p.task_id ORDER BY p.id ASC",
            ).map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |row| Ok(PendingOp {
                id: row.get(0)?,
                revision: 1,
                task_id: row.get(1)?,
                completed: row.get::<_, i64>(2)? != 0,
                created_at: row.get(3)?,
                database_id: None,
                page_id: row.get::<_, Option<String>>(4)?
                    .filter(|id| !id.trim().is_empty()).map(|id| normalize_notion_id(&id)),
                mapping: None,
                source_verified: false,
            })).map_err(|e| e.to_string())?;
            for row in rows {
                let op = row.map_err(|e| e.to_string())?;
                let key = match &op.page_id {
                    Some(page) => (true, page.clone()),
                    None => (false, op.task_id.clone()),
                };
                latest.insert(key, op);
            }
        }
        conn.execute_batch(
            "ALTER TABLE pending_ops RENAME TO pending_ops_legacy;
             CREATE TABLE pending_ops (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                revision INTEGER NOT NULL,
                task_id TEXT NOT NULL,
                completed INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                database_id TEXT,
                page_id TEXT,
                mapping TEXT,
                source_verified INTEGER NOT NULL DEFAULT 0,
                UNIQUE(database_id, page_id)
             );",
        ).map_err(|e| e.to_string())?;
        for op in latest.values() {
            conn.execute(
                "INSERT INTO pending_ops(id, revision, task_id, completed, created_at, page_id)
                 VALUES(?1, 1, ?2, ?3, ?4, ?5)",
                params![op.id, op.task_id, op.completed, op.created_at, op.page_id],
            ).map_err(|e| e.to_string())?;
            if let Some(ids) = op.page_id.as_ref().and_then(|page| page_tasks.get(page)) {
                for id in ids {
                    conn.execute("UPDATE tasks SET completed = ?1 WHERE id = ?2",
                        params![op.completed, id]).map_err(|e| e.to_string())?;
                }
            } else {
                conn.execute("UPDATE tasks SET completed = ?1 WHERE id = ?2",
                    params![op.completed, op.task_id]).map_err(|e| e.to_string())?;
            }
        }
        conn.execute_batch("DROP TABLE pending_ops_legacy;").map_err(|e| e.to_string())?;
        if !latest.is_empty() {
            Self::bump_version(conn, "pending_version")?;
        }
        Ok(())
    }

    fn archive_completed_local_tasks(conn: &Connection) -> Result<(), String> {
        conn.execute(
            "UPDATE tasks SET archive_source_group_id = group_id, group_id = ?1
             WHERE completed <> 0 AND notion_id IS NULL
             AND group_id IN (SELECT id FROM groups WHERE kind = 'local')",
            params![ARCHIVE_GROUP_ID],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn nanos() -> u128 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        Self::setting_on(&conn, key)
    }

    fn setting_on(conn: &Connection, key: &str) -> Result<Option<String>, String> {
        conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |row| row.get(0))
            .optional().map_err(|e| e.to_string())
    }

    fn put_setting_on(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
        conn.execute(
            "INSERT INTO settings(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value
             WHERE settings.value IS NOT excluded.value",
            params![key, value],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn version_on(conn: &Connection, key: &str) -> Result<u64, String> {
        Self::setting_on(conn, key)?.map(|value| value.parse::<u64>()
            .map_err(|_| crate::language::text("The database version record is damaged.", "数据库版本记录损坏").to_string())).unwrap_or(Ok(0))
    }

    fn bump_version(conn: &Connection, key: &str) -> Result<u64, String> {
        let version = Self::version_on(conn, key)?.checked_add(1)
            .ok_or_else(|| crate::language::text("The database version counter is exhausted.", "数据库版本计数已满").to_string())?;
        Self::put_setting_on(conn, key, &version.to_string())?;
        Ok(version)
    }

    fn notion_config_on(conn: &Connection) -> Result<NotionConfig, String> {
        Self::setting_on(conn, "notion")?
            .map(|raw| serde_json::from_str(&raw).map_err(|_| crate::language::text("The saved Notion configuration is damaged.", "Notion 配置损坏").to_string()))
            .unwrap_or_else(|| Ok(NotionConfig::default()))
    }

    pub fn notion_context(&self) -> Result<(NotionConfig, u64), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        Ok((Self::notion_config_on(&conn)?, Self::version_on(&conn, "notion_config_version")?))
    }

    pub fn notion_version(&self) -> Result<u64, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        Self::version_on(&conn, "notion_config_version")
    }

    pub fn pending_for_send(&self, id: i64, revision: i64, config_version: u64) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        if Self::version_on(&conn, "notion_config_version")? != config_version { return Ok(false); }
        conn.query_row("SELECT EXISTS(SELECT 1 FROM pending_ops WHERE id = ?1 AND revision = ?2)",
            params![id, revision], |row| row.get(0)).map_err(|e| e.to_string())
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        Self::put_setting_on(&conn, key, value)
    }

    /// Only the independent language preference participates in this transaction.
    /// The native menu must accept the candidate before SQLite commits it.
    pub fn set_language_transaction(
        &self,
        preference: &str,
        apply: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        Self::put_setting_on(&tx, "language", preference)?;
        apply()?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn load_settings(&self) -> Result<AppSettings, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        Self::settings_on(&conn)
    }

    fn settings_on(conn: &Connection) -> Result<AppSettings, String> {
        let mut stmt = conn.prepare("SELECT key, value FROM settings").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        let mut values = rows.collect::<Result<HashMap<_, _>, _>>().map_err(|e| e.to_string())?;
        let mut settings = AppSettings::default();
        if let Some(theme) = values.remove("theme") {
            settings.theme = theme;
        }
        settings.light_theme = values.remove("light_theme").unwrap_or_else(|| match settings.theme.as_str() {
            "dark" | "notionDark" | "cardInk" | "inkMotion" => "paper".into(),
            other => other.to_string(),
        });
        settings.dark_theme = values.remove("dark_theme").unwrap_or_else(|| match settings.theme.as_str() {
            "dark" | "notionDark" | "cardInk" | "inkMotion" => settings.theme.clone(),
            _ => "dark".into(),
        });
        if let Some(value) = values.remove("font") { settings.font = value; }
        if let Some(value) = values.remove("fx_theme") { settings.fx_theme = value; }
        if let Some(raw) = values.remove("fx_intensity") {
            if let Ok(value) = raw.parse::<f64>() { settings.fx_intensity = value.clamp(0.4, 1.6); }
        }
        if let Some(raw) = values.remove("fx_edge_boost") {
            settings.fx_edge_boost = raw == "1" || raw.eq_ignore_ascii_case("true");
        }
        if let Some(value) = values.remove("note_bg") { settings.note_bg = value; }
        if let Some(value) = values.remove("note_fg") { settings.note_fg = value; }
        if let Some(value) = values.remove("note_accent") { settings.note_accent = value; }
        if let Some(value) = values.remove("note_pop") { settings.note_pop = value; }
        if let Some(value) = values.remove("dock_handle") { settings.dock_handle = value; }
        if let Some(raw) = values.remove("notion") {
            settings.notion = serde_json::from_str(&raw).map_err(|_| crate::language::text("The saved Notion configuration is damaged.", "Notion 配置损坏").to_string())?;
        }
        Ok(settings)
    }

    pub fn save_notion_config(
        &self,
        config: &NotionConfig,
        discard_pending: bool,
        expected_pending_version: Option<u64>,
    ) -> Result<SaveNotionConfigResult, String> {
        let raw = serde_json::to_string(config).map_err(|e| e.to_string())?;
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let old = Self::notion_config_on(&tx)?;
        let database_changed = normalize_notion_id(&old.database_id) != normalize_notion_id(&config.database_id);
        let write_context_changed = database_changed
            || NotionWriteMapping::from_config(&old) != NotionWriteMapping::from_config(config);
        let pending_count: usize = tx.query_row("SELECT COUNT(*) FROM pending_ops", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        if write_context_changed && pending_count > 0 {
            let pending_version = Self::version_on(&tx, "pending_version")?;
            if !discard_pending || expected_pending_version != Some(pending_version) {
                return Ok(SaveNotionConfigResult::ConfirmationRequired { pending_count, pending_version });
            }
            tx.execute("DELETE FROM pending_ops", []).map_err(|e| e.to_string())?;
            Self::bump_version(&tx, "pending_version")?;
        }
        if database_changed {
            tx.execute("DELETE FROM tasks WHERE group_id = ?1", params![NOTION_GROUP_ID])
                .map_err(|e| e.to_string())?;
        }
        if old != *config {
            Self::put_setting_on(&tx, "notion", &raw)?;
            Self::bump_version(&tx, "notion_config_version")?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(SaveNotionConfigResult::Saved)
    }

    pub fn save_appearance(&self, appearance: &AppearanceSettings) -> Result<bool, String> {
        if !appearance.fx_intensity.is_finite() {
            return Err(crate::language::text("Invalid effect intensity.", "动效强度无效").into());
        }
        let intensity = appearance.fx_intensity.clamp(0.4, 1.6).to_string();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let current = Self::settings_on(&tx)?;
        if appearance.theme == current.theme
            && appearance.light_theme == current.light_theme
            && appearance.dark_theme == current.dark_theme
            && appearance.font == current.font
            && appearance.fx_theme == current.fx_theme
            && appearance.fx_intensity.clamp(0.4, 1.6) == current.fx_intensity
            && appearance.fx_edge_boost == current.fx_edge_boost
            && appearance.dock_handle == current.dock_handle
            && appearance.note_bg == current.note_bg
            && appearance.note_fg == current.note_fg
            && appearance.note_accent == current.note_accent
            && appearance.note_pop == current.note_pop
        {
            return Ok(false);
        }
        let mut changed = false;
        for (key, value) in [
            ("theme", appearance.theme.as_str()),
            ("light_theme", appearance.light_theme.as_str()),
            ("dark_theme", appearance.dark_theme.as_str()),
            ("font", appearance.font.as_str()),
            ("fx_theme", appearance.fx_theme.as_str()),
            ("fx_intensity", intensity.as_str()),
            ("fx_edge_boost", if appearance.fx_edge_boost { "1" } else { "0" }),
            ("dock_handle", appearance.dock_handle.as_str()),
            ("note_bg", appearance.note_bg.as_str()),
            ("note_fg", appearance.note_fg.as_str()),
            ("note_accent", appearance.note_accent.as_str()),
            ("note_pop", appearance.note_pop.as_str()),
        ] {
            if Self::setting_on(&tx, key)?.as_deref() != Some(value) {
                Self::put_setting_on(&tx, key, value)?;
                changed = true;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(changed)
    }

    pub fn save_window_state(&self, state: &WindowStateV2) -> Result<bool, String> {
        state.validate()?;
        let raw = serde_json::to_string(state).map_err(|e| e.to_string())?;
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        if Self::setting_on(&conn, "window_state_v2")?.as_deref() == Some(raw.as_str()) {
            return Ok(false);
        }
        Self::put_setting_on(&conn, "window_state_v2", &raw)?;
        Ok(true)
    }

    pub fn load_window_mode(&self) -> Result<WindowMode, String> {
        match self.get_setting("window_mode")?.as_deref() {
            Some("sticky") => Ok(WindowMode::Sticky),
            Some("workspace") | None => Ok(WindowMode::Workspace),
            Some(_) => Ok(WindowMode::Workspace),
        }
    }

    pub fn save_window_mode(&self, mode: WindowMode) -> Result<(), String> {
        let value = match mode {
            WindowMode::Workspace => "workspace",
            WindowMode::Sticky => "sticky",
        };
        self.set_setting("window_mode", value)
    }

    pub fn load_always_on_top(&self) -> Result<bool, String> {
        Ok(matches!(
            self.get_setting("always_on_top")?.as_deref(),
            Some("true")
        ))
    }

    pub fn save_always_on_top(&self, pinned: bool) -> Result<(), String> {
        self.set_setting("always_on_top", if pinned { "true" } else { "false" })
    }

    pub fn load_workspace_geometry(&self) -> Result<Option<WorkspaceGeometry>, String> {
        self.get_setting("workspace_geometry")?
            .map(|raw| {
                let geom: WorkspaceGeometry = serde_json::from_str(&raw).map_err(|_| {
                    crate::language::text(
                        "The saved workspace geometry is damaged.",
                        "已保存的主面板窗口几何损坏",
                    )
                    .to_string()
                })?;
                geom.validate()?;
                Ok(geom)
            })
            .transpose()
    }

    pub fn save_workspace_geometry(&self, geom: &WorkspaceGeometry) -> Result<bool, String> {
        geom.validate()?;
        let raw = serde_json::to_string(geom).map_err(|e| e.to_string())?;
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        if Self::setting_on(&conn, "workspace_geometry")?.as_deref() == Some(raw.as_str()) {
            return Ok(false);
        }
        Self::put_setting_on(&conn, "workspace_geometry", &raw)?;
        Ok(true)
    }

    pub fn load_window_state(&self) -> Result<Option<WindowStateV2>, String> {
        self.get_setting("window_state_v2")?.map(|raw| {
            let state: WindowStateV2 = serde_json::from_str(&raw)
                .map_err(|_| crate::language::text("The saved window state is damaged.", "已保存的窗口状态损坏").to_string())?;
            state.validate()?;
            Ok(state)
        }).transpose()
    }

    pub fn load_or_migrate_window_state(
        &self,
        monitors: &[MonitorLayout],
        fallback: &WindowStateV2,
    ) -> Result<WindowStateV2, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let existing = Self::setting_on(&tx, "window_state_v2")?;
        let state = if let Some(raw) = existing.as_deref() {
            let state: WindowStateV2 = serde_json::from_str(raw)
                .map_err(|_| crate::language::text("The saved window state is damaged.", "已保存的窗口状态损坏").to_string())?;
            state.validate()?;
            state
        } else {
            let geometry: Option<LegacyWindowGeometry> = Self::setting_on(&tx, "window_geometry")?
                .map(|raw| serde_json::from_str(&raw)
                    .map_err(|_| crate::language::text("The legacy window geometry is damaged.", "旧窗口几何数据损坏").to_string())).transpose()?;
            let dock: Option<LegacyEdgeDock> = Self::setting_on(&tx, "edge_dock")?
                .map(|raw| serde_json::from_str(&raw)
                    .map_err(|_| crate::language::text("The legacy edge docking state is damaged.", "旧贴边数据损坏").to_string())).transpose()?;
            // Validate every present source, even if another source has precedence.
            if let Some(geometry) = &geometry {
                WindowRestore {
                    x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height,
                    monitor_id: None, saved_scale: 1.0,
                }.validate()?;
            }
            if let Some(dock) = &dock {
                WindowStateV2 {
                    version: 2, phase: dock.phase, edge: dock.edge,
                    restore: WindowRestore {
                        x: dock.restored_x, y: dock.restored_y,
                        width: f64::from(dock.restored_width), height: f64::from(dock.restored_height),
                        monitor_id: None, saved_scale: 1.0,
                    },
                }.validate()?;
            }
            if geometry.is_none() && dock.is_none() {
                fallback.clone()
            } else {
                let full_panel_dock = dock.as_ref()
                    .filter(|dock| dock.phase != DockPhase::Free || geometry.is_none());
                let (x, y) = if let Some(dock) = full_panel_dock {
                    (dock.restored_x, dock.restored_y)
                } else {
                    let geometry = geometry.as_ref().ok_or(crate::language::text("The legacy window geometry is missing.", "旧窗口几何缺失"))?;
                    (geometry.x, geometry.y)
                };
                // Legacy window_geometry stores logical dimensions; DockSnapshot
                // stores physical outer_size. Only use its dimensions when necessary.
                let (width, height) = if let Some(geometry) = &geometry {
                    (geometry.width, geometry.height)
                } else {
                    let dock = dock.as_ref().ok_or(crate::language::text("The legacy edge docking geometry is missing.", "旧贴边几何缺失"))?;
                    (f64::from(dock.restored_width), f64::from(dock.restored_height))
                };
                let mut restore = WindowRestore {
                    x, y, width, height, monitor_id: None, saved_scale: 1.0,
                };
                let selection = if let Some(dock) = full_panel_dock {
                    WindowRestore {
                        width: f64::from(dock.restored_width),
                        height: f64::from(dock.restored_height),
                        ..restore.clone()
                    }
                } else {
                    restore.clone()
                };
                let monitor = monitors::select(&selection, monitors)?;
                restore.saved_scale = monitor.scale;
                restore.monitor_id = Some(monitor.id.clone());
                if geometry.is_none() {
                    restore.width /= monitor.scale;
                    restore.height /= monitor.scale;
                }
                WindowStateV2 {
                    version: 2,
                    phase: dock.as_ref().map_or(DockPhase::Free, |dock| dock.phase),
                    edge: dock.as_ref().and_then(|dock| dock.edge),
                    restore,
                }
            }
        };
        let normalized = monitors::normalize(&state, monitors)?;
        let raw = serde_json::to_string(&normalized).map_err(|e| e.to_string())?;
        if existing.as_deref() != Some(raw.as_str()) {
            Self::put_setting_on(&tx, "window_state_v2", &raw)?;
        }
        tx.execute("DELETE FROM settings WHERE key IN ('window_geometry', 'edge_dock')", [])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(normalized)
    }

    pub fn list_tasks(&self) -> Result<Vec<Task>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        Self::tasks_on(&conn, false)
    }

    fn tasks_on(conn: &Connection, notion_only: bool) -> Result<Vec<Task>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT id, notion_id, title, completed, progress, remain, date, tags, updated_time, group_id, position,
                        start_date, end_date, start_time, end_time, reminder_at, reminded_at
                 FROM tasks WHERE (?1 = 0 OR group_id = 'notion')
                 ORDER BY completed ASC, CASE WHEN position > 0 THEN 0 ELSE 1 END ASC, position ASC, updated_time DESC, rowid ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![notion_only], Self::task_from_row)
            .map_err(|e| e.to_string())?;

        let mut tasks = Vec::new();
        for row in rows {
            tasks.push(row.map_err(|e| e.to_string())?);
        }
        Ok(tasks)
    }

    fn upsert_task_on(
        conn: &Connection,
        task: &Task,
        id: &str,
        notion_id: Option<&str>,
        completed: bool,
    ) -> Result<(), String> {
        let tags = serde_json::to_string(&task.tags).map_err(|e| e.to_string())?;
        let changed = conn.execute(
            "INSERT INTO tasks(id, notion_id, title, completed, progress, remain, date, tags, updated_time, group_id,
                               start_date, end_date, start_time, end_time, reminder_at, reminded_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
             ON CONFLICT(id) DO UPDATE SET
               notion_id=excluded.notion_id,
               title=excluded.title,
               completed=excluded.completed,
               progress=excluded.progress,
               remain=excluded.remain,
               date=excluded.date,
               tags=excluded.tags,
               updated_time=excluded.updated_time,
               group_id=excluded.group_id,
               start_date=excluded.start_date,
               end_date=excluded.end_date,
               start_time=excluded.start_time,
               end_time=excluded.end_time
             WHERE tasks.group_id = excluded.group_id",
            params![
                id,
                notion_id,
                task.title,
                completed,
                task.progress,
                task.remain,
                task.date,
                tags,
                task.updated_time,
                task.group_id,
                task.start_date,
                task.end_date,
                task.start_time,
                task.end_time,
                task.reminder_at,
                task.reminded_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err(crate::language::text("The task identity conflicts with an existing group.", "任务身份与现有分组冲突").into());
        }
        Ok(())
    }

    /// Commit a complete Notion snapshot, overlaying only durable checkbox intents.
    pub fn merge_notion_snapshot(
        &self,
        tasks: &[Task],
        expected_config_version: u64,
    ) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        if Self::version_on(&tx, "notion_config_version")? != expected_config_version {
            return Ok(false);
        }
        let config = Self::notion_config_on(&tx)?;
        let database_id = normalize_notion_id(&config.database_id);
        let existing: HashMap<_, _> = Self::tasks_on(&tx, true)?.into_iter()
            .map(|task| (task.id.clone(), task)).collect();
        let page_ids: HashMap<_, _> = existing.values().filter_map(|task|
            task.notion_id.as_ref().map(|page| (normalize_notion_id(page), task.id.as_str()))
        ).collect();
        // Read after acquiring the committing transaction, never before HTTP.
        let pending = Self::pending_on(&tx)?;
        let mut pending_pages = HashMap::new();
        let mut pending_tasks = HashMap::new();
        for op in &pending {
            if op.database_id.as_ref().is_some_and(|id| normalize_notion_id(id) != database_id) {
                continue;
            }
            pending_tasks.insert(op.task_id.as_str(), op.completed);
            if let Some(page) = &op.page_id {
                pending_pages.insert(normalize_notion_id(page), op.completed);
            }
        }
        let mut seen_pages = HashSet::with_capacity(tasks.len());
        let mut seen_ids = HashSet::with_capacity(tasks.len());
        let mut changed = false;
        for remote in tasks {
            if remote.group_id != NOTION_GROUP_ID {
                return Err(crate::language::text("A Notion snapshot cannot contain local or archived tasks.", "Notion 快照不能包含本地或归档任务").into());
            }
            let page = remote.notion_id.as_ref().filter(|id| !id.trim().is_empty())
                .map(|id| normalize_notion_id(id)).ok_or_else(|| crate::language::text("The Notion snapshot is missing a page identity.", "Notion 快照缺少页面身份").to_string())?;
            if seen_pages.contains(&page) {
                return Err(crate::language::text("The Notion snapshot contains duplicate pages.", "Notion 快照包含重复页面").into());
            }
            let id = page_ids.get(&page).copied().unwrap_or(remote.id.as_str());
            if !seen_ids.insert(id) {
                return Err(crate::language::text("The Notion snapshot contains duplicate task identities.", "Notion 快照包含重复任务身份").into());
            }
            let completed = pending_pages.get(&page).or_else(|| pending_tasks.get(id))
                .copied().unwrap_or(remote.completed);
            let unchanged = existing.get(id).is_some_and(|saved|
                saved.notion_id.as_deref() == Some(page.as_str())
                    && saved.completed == completed
                    && saved.title == remote.title
                    && saved.progress == remote.progress
                    && saved.remain == remote.remain
                    && saved.date == remote.date
                    && saved.start_date == remote.start_date
                    && saved.end_date == remote.end_date
                    && saved.start_time == remote.start_time
                    && saved.end_time == remote.end_time
                    && saved.tags == remote.tags
                    && saved.updated_time == remote.updated_time
            );
            if !unchanged {
                Self::upsert_task_on(&tx, remote, id, Some(&page), completed)?;
                changed = true;
            }
            seen_pages.insert(page);
        }
        for task in existing.values() {
            let protected = pending_tasks.contains_key(task.id.as_str())
                || task.notion_id.as_ref().is_some_and(|page| pending_pages.contains_key(&normalize_notion_id(page)));
            if !seen_ids.contains(task.id.as_str()) && !protected {
                tx.execute("DELETE FROM tasks WHERE id = ?1 AND group_id = ?2",
                    params![task.id, NOTION_GROUP_ID]).map_err(|e| e.to_string())?;
                changed = true;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(changed)
    }

    pub fn get_task(&self, id: &str) -> Result<Option<Task>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        Self::task_on(&conn, id)
    }

    fn task_on(conn: &Connection, id: &str) -> Result<Option<Task>, String> {
        conn.query_row(
            "SELECT id, notion_id, title, completed, progress, remain, date, tags, updated_time, group_id, position,
                    start_date, end_date, start_time, end_time, reminder_at, reminded_at
             FROM tasks WHERE id = ?1",
            params![id],
            Self::task_from_row,
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    fn task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
        let tags_raw: String = row.get(7)?;
        Ok(Task {
            id: row.get(0)?,
            notion_id: row.get(1)?,
            title: row.get(2)?,
            completed: row.get::<_, i64>(3)? != 0,
            progress: row.get(4)?,
            remain: row.get(5)?,
            date: row.get(6)?,
            tags: serde_json::from_str(&tags_raw).unwrap_or_default(),
            updated_time: row.get(8)?,
            group_id: row.get(9)?,
            position: row.get(10)?,
            start_date: row.get(11)?,
            end_date: row.get(12)?,
            start_time: row.get(13)?,
            end_time: row.get(14)?,
            reminder_at: row.get(15)?,
            reminded_at: row.get(16)?,
        })
    }

    /// Toggle completion and local archive ownership in one transaction.
    pub fn toggle_task(&self, id: &str) -> Result<Task, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut task = Self::task_on(&tx, id)?.ok_or_else(|| crate::language::text("The task no longer exists.", "任务不存在").to_string())?;
        task.updated_time = chrono::Utc::now().timestamp_millis();
        if task.notion_id.is_some() || task.group_id == NOTION_GROUP_ID {
            let config = Self::notion_config_on(&tx)?;
            if !config.is_configured() {
                return Err(crate::language::text("Configure Notion before changing synced tasks.", "请先配置 Notion，再修改同步任务").into());
            }
            let page_id = task.notion_id.as_ref().filter(|id| !id.trim().is_empty())
                .map(|id| normalize_notion_id(id)).ok_or_else(|| crate::language::text("The task has no Notion page identity.", "任务缺少 Notion 页面身份").to_string())?;
            let database_id = normalize_notion_id(&config.database_id);
            let mapping = serde_json::to_string(&NotionWriteMapping::from_config(&config))
                .map_err(|e| e.to_string())?;
            task.completed = !task.completed;
            tx.execute(
                "UPDATE tasks SET completed = ?1, updated_time = ?2 WHERE id = ?3",
                params![task.completed, task.updated_time, id],
            ).map_err(|e| e.to_string())?;
            let pending_id: Option<i64> = tx.query_row(
                "SELECT id FROM pending_ops WHERE page_id = ?1
                 AND (database_id = ?2 OR database_id IS NULL)
                 ORDER BY database_id IS NOT NULL DESC, id DESC LIMIT 1",
                params![page_id, database_id], |row| row.get(0),
            ).optional().map_err(|e| e.to_string())?;
            if let Some(pending_id) = pending_id {
                tx.execute(
                    "UPDATE pending_ops SET revision = revision + 1, task_id = ?1, completed = ?2,
                     created_at = ?3, database_id = ?4, mapping = ?5 WHERE id = ?6",
                    params![task.id, task.completed, task.updated_time, database_id, mapping, pending_id],
                ).map_err(|e| e.to_string())?;
            } else {
                tx.execute(
                    "INSERT INTO pending_ops(revision, task_id, completed, created_at,
                     database_id, page_id, mapping, source_verified) VALUES(1, ?1, ?2, ?3, ?4, ?5, ?6, 1)",
                    params![task.id, task.completed, task.updated_time, database_id, page_id, mapping],
                ).map_err(|e| e.to_string())?;
            }
            Self::bump_version(&tx, "pending_version")?;
        } else if task.group_id == ARCHIVE_GROUP_ID {
            let source: Option<String> = tx.query_row(
                "SELECT archive_source_group_id FROM tasks WHERE id = ?1",
                params![id], |row| row.get(0),
            ).map_err(|e| e.to_string())?;
            let source = source.ok_or_else(|| crate::language::text("The original task group could not be found.", "找不到任务的原分组").to_string())?;
            let exists: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM groups WHERE id = ?1 AND kind = 'local')",
                params![source], |row| row.get(0),
            ).map_err(|e| e.to_string())?;
            if !exists {
                return Err(crate::language::text("The original group was deleted. The task cannot be restored and remains in Archive.", "原分组已删除，无法取消完成；任务仍保留在 Archive 中").into());
            }
            tx.execute(
                "UPDATE tasks SET completed = 0, group_id = ?1, archive_source_group_id = NULL,
                 updated_time = ?2 WHERE id = ?3",
                params![source, task.updated_time, id],
            ).map_err(|e| e.to_string())?;
            task.completed = false;
            task.group_id = source;
        } else {
            let local: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM groups WHERE id = ?1 AND kind = 'local')",
                params![task.group_id], |row| row.get(0),
            ).map_err(|e| e.to_string())?;
            if !local { return Err(crate::language::text("The task group is missing or does not support archiving.", "任务分组不存在或不支持归档").into()); }
            tx.execute(
                "UPDATE tasks SET completed = 1, archive_source_group_id = group_id,
                 group_id = ?1, updated_time = ?2 WHERE id = ?3",
                params![ARCHIVE_GROUP_ID, task.updated_time, id],
            ).map_err(|e| e.to_string())?;
            task.completed = true;
            task.group_id = ARCHIVE_GROUP_ID.into();
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(task)
    }

    /// Return only deleted ids, so concurrent UI updates cannot remove newer tasks.
    pub fn clear_archive(&self) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let ids = {
            let mut stmt = tx.prepare(
                "SELECT id FROM tasks WHERE group_id = ?1 AND notion_id IS NULL",
            ).map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![ARCHIVE_GROUP_ID], |row| row.get(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<String>, _>>().map_err(|e| e.to_string())?
        };
        tx.execute("DELETE FROM tasks WHERE group_id = ?1 AND notion_id IS NULL",
            params![ARCHIVE_GROUP_ID]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(ids)
    }

    // ---- Groups ----

    pub fn task_view(&self) -> Result<TaskView, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        Ok(TaskView { tasks: Self::tasks_on(&conn, false)?, groups: Self::groups_on(&conn)? })
    }

    pub fn list_groups(&self) -> Result<Vec<Group>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        Self::groups_on(&conn)
    }

    fn groups_on(conn: &Connection) -> Result<Vec<Group>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT id, name, kind, position, created_at FROM groups
                 ORDER BY CASE kind WHEN 'notion' THEN 0 WHEN 'archive' THEN 2 ELSE 1 END, position ASC, created_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Group {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    kind: row.get(2)?,
                    position: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn create_group(&self, name: &str) -> Result<Group, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        Self::insert_group(&conn, name)
    }

    fn insert_group(conn: &Connection, name: &str) -> Result<Group, String> {
        let name = name.trim();
        if name.is_empty() {
            return Err(crate::language::text("Enter a group name.", "分组名称不能为空").into());
        }
        if name.chars().count() > 24 {
            return Err(crate::language::text("The group name is too long (24 characters maximum).", "分组名称过长（最多 24 字）").into());
        }
        let position: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(position), 0) + 1 FROM groups WHERE kind = 'local'",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().timestamp_millis();
        let id = format!("g-{}", Self::nanos());
        conn.execute(
            "INSERT INTO groups(id, name, kind, position, created_at) VALUES(?1, ?2, 'local', ?3, ?4)",
            params![id, name, position, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(Group {
            id,
            name: name.to_string(),
            kind: "local".into(),
            position,
            created_at: now,
        })
    }

    /// Delete a local group and every task in it. The notion group is pinned.
    pub fn delete_group(&self, id: &str) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let kind: Option<String> = conn
            .query_row("SELECT kind FROM groups WHERE id = ?1", params![id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?;
        match kind.as_deref() {
            Some("local") => {}
            Some("archive") => return Err(crate::language::text("Archive cannot be deleted. Use Clear archive instead.", "Archive 分组不可删除，请使用清空归档").into()),
            Some(_) => return Err(crate::language::text("The Notion group cannot be deleted.", "「来自 Notion」分组不可删除").into()),
            None => return Err(crate::language::text("The group no longer exists.", "分组不存在").into()),
        }
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let deleted = {
            let mut statement = tx.prepare("SELECT id FROM tasks WHERE group_id = ?1 ORDER BY rowid")
                .map_err(|e| e.to_string())?;
            let rows = statement.query_map(params![id], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };
        tx.execute("DELETE FROM tasks WHERE group_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM groups WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(deleted)
    }

    fn validate_permutation(existing: &[String], ordered: &[String], mismatch_msg: &str) -> Result<(), String> {
        if existing.len() != ordered.len() {
            return Err(mismatch_msg.into());
        }
        let expected: HashSet<&str> = existing.iter().map(String::as_str).collect();
        let mut seen = HashSet::with_capacity(ordered.len());
        for id in ordered {
            if !expected.contains(id.as_str()) || !seen.insert(id.as_str()) {
                return Err(mismatch_msg.into());
            }
        }
        Ok(())
    }

    /// Persist user-defined ordering of custom local groups (Notion stays top, Archive stays bottom).
    pub fn reorder_groups(&self, ordered_ids: Vec<String>) -> Result<Vec<Group>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let existing = {
            let mut stmt = tx
                .prepare("SELECT id FROM groups WHERE kind = 'local' ORDER BY position ASC, created_at ASC")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };
        Self::validate_permutation(
            &existing,
            &ordered_ids,
            crate::language::text(
                "Group order must contain every custom group exactly once.",
                "分组顺序必须包含且仅包含所有自定义分组。",
            ),
        )?;
        for (index, id) in ordered_ids.iter().enumerate() {
            tx.execute(
                "UPDATE groups SET position = ?1 WHERE id = ?2 AND kind = 'local'",
                params![index as i64 + 1, id],
            )
            .map_err(|e| e.to_string())?;
        }
        let groups = Self::groups_on(&tx)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(groups)
    }

    /// Persist user-defined task ordering inside a custom local group.
    pub fn reorder_tasks(&self, group_id: &str, ordered_ids: Vec<String>) -> Result<Vec<Task>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let kind: Option<String> = tx
            .query_row("SELECT kind FROM groups WHERE id = ?1", params![group_id], |row| row.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        match kind.as_deref() {
            Some("local") => {}
            Some("archive") => {
                return Err(crate::language::text("Archive tasks cannot be reordered.", "归档中的任务不支持调整顺序。").into());
            }
            Some(_) => {
                return Err(crate::language::text("Notion tasks cannot be reordered.", "Notion 分组任务不支持调整顺序。").into());
            }
            None => {
                return Err(crate::language::text("The group no longer exists.", "分组不存在").into());
            }
        }
        let existing = {
            let mut stmt = tx
                .prepare("SELECT id FROM tasks WHERE group_id = ?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![group_id], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };
        Self::validate_permutation(
            &existing,
            &ordered_ids,
            crate::language::text(
                "Task order must contain every task in the group exactly once.",
                "任务顺序必须包含且仅包含该分组中的所有任务。",
            ),
        )?;
        for (index, id) in ordered_ids.iter().enumerate() {
            tx.execute(
                "UPDATE tasks SET position = ?1 WHERE id = ?2 AND group_id = ?3",
                params![index as i64 + 1, id, group_id],
            )
            .map_err(|e| e.to_string())?;
        }
        let tasks = Self::tasks_on(&tx, false)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(tasks)
    }

    // ---- Local (user) tasks ----


    /// Commit a batch and an optional new local group together, never partially.
    pub fn import_local_tasks(
        &self,
        titles: Vec<String>,
        group_id: Option<&str>,
        new_group_name: Option<&str>,
    ) -> Result<TaskImportResult, String> {
        self.import_local_tasks_with_schedule(titles, group_id, new_group_name, None)
    }

    pub fn import_local_tasks_with_schedule(
        &self,
        titles: Vec<String>,
        group_id: Option<&str>,
        new_group_name: Option<&str>,
        schedule: Option<TaskScheduleInput>,
    ) -> Result<TaskImportResult, String> {
        if titles.is_empty() || titles.iter().any(|title| title.trim().is_empty()) {
            return Err(crate::language::text("Provide at least one task. Task titles cannot be empty.", "请至少提供一条非空任务，任务内容不能为空").into());
        }
        let schedule = Self::normalize_schedule(schedule.unwrap_or_default())?;
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let group = match (group_id, new_group_name) {
            (Some(id), None) => {
                let group = tx.query_row(
                    "SELECT id, name, kind, position, created_at FROM groups WHERE id = ?1",
                    params![id],
                    |row| Ok(Group {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        kind: row.get(2)?,
                        position: row.get(3)?,
                        created_at: row.get(4)?,
                    }),
                ).optional().map_err(|e| e.to_string())?
                    .ok_or_else(|| crate::language::text("The group no longer exists.", "分组不存在").to_string())?;
                if group.kind == "archive" {
                    return Err(crate::language::text("Tasks cannot be imported directly into Archive.", "不能直接向 Archive 导入任务").into());
                }
                if group.kind != "local" {
                    return Err(crate::language::text("The Notion group is managed by sync. Import into a local group instead.", "Notion 分组内容由同步管理，请在本地分组中导入").into());
                }
                group
            }
            (None, Some(name)) => Self::insert_group(&tx, name)?,
            _ => return Err(crate::language::text("Choose an existing group or enter a new group name.", "请选择一个已有分组，或填写新分组名称").into()),
        };
        let max_pos: i64 = tx
            .query_row(
                "SELECT COALESCE(MAX(position), 0) FROM tasks WHERE group_id = ?1",
                params![group.id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().timestamp_millis();
        let batch = Self::nanos();
        let mut tasks = Vec::with_capacity(titles.len());
        {
            let mut insert = tx.prepare(
                "INSERT INTO tasks(id, notion_id, title, completed, progress, remain, date, tags, updated_time, group_id, position,
                                   start_date, end_date, start_time, end_time, reminder_at, reminded_at)
                 VALUES(?1, NULL, ?2, 0, NULL, NULL, ?3, '[]', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL)",
            ).map_err(|e| e.to_string())?;
            for (index, mut title) in titles.into_iter().enumerate() {
                // Reuse the title buffers received over IPC instead of copying the batch.
                let end = title.trim_end().len();
                title.truncate(end);
                let start = title.len() - title.trim_start().len();
                title.drain(..start);
                let id = format!("t-{batch}-{index}");
                let position = if max_pos > 0 { max_pos + index as i64 + 1 } else { 0 };
                insert.execute(params![
                    id,
                    title,
                    schedule.date,
                    now,
                    group.id,
                    position,
                    schedule.start_date,
                    schedule.end_date,
                    schedule.start_time,
                    schedule.end_time,
                    schedule.reminder_at,
                ]).map_err(|e| e.to_string())?;
                tasks.push(Task {
                    id,
                    notion_id: None,
                    title,
                    completed: false,
                    progress: None,
                    remain: None,
                    date: schedule.date.clone(),
                    start_date: schedule.start_date.clone(),
                    end_date: schedule.end_date.clone(),
                    start_time: schedule.start_time.clone(),
                    end_time: schedule.end_time.clone(),
                    reminder_at: schedule.reminder_at,
                    reminded_at: None,
                    tags: Vec::new(),
                    updated_time: now,
                    group_id: group.id.clone(),
                    position,
                });
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(TaskImportResult { group, tasks })
    }

    fn validate_iso_date(raw: Option<String>) -> Result<Option<String>, String> {
        let Some(trimmed) = raw.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()) else {
            return Ok(None);
        };
        chrono::NaiveDate::parse_from_str(&trimmed, "%Y-%m-%d")
            .map(|d| Some(d.format("%Y-%m-%d").to_string()))
            .map_err(|_| crate::language::text("Invalid date format (expected YYYY-MM-DD).", "日期格式无效，应为 YYYY-MM-DD").into())
    }

    fn validate_hh_mm(raw: Option<String>) -> Result<Option<String>, String> {
        let Some(trimmed) = raw.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()) else {
            return Ok(None);
        };
        chrono::NaiveTime::parse_from_str(&trimmed, "%H:%M")
            .map(|t| Some(t.format("%H:%M").to_string()))
            .map_err(|_| crate::language::text("Invalid time format (expected HH:MM).", "时间格式无效，应为 HH:MM").into())
    }

    fn normalize_schedule(input: TaskScheduleInput) -> Result<NormalizedSchedule, String> {
        let start_date = Self::validate_iso_date(input.start_date)?;
        let mut end_date = Self::validate_iso_date(input.end_date)?;
        let start_time = Self::validate_hh_mm(input.start_time)?;
        let mut end_time = Self::validate_hh_mm(input.end_time)?;

        if start_date.is_none() {
            if end_date.is_some() {
                return Err(crate::language::text("Please select a start date first.", "请先选择开始日期").into());
            }
            if start_time.is_some() || end_time.is_some() {
                return Err(crate::language::text("Please set a date before setting a time.", "请先设置日期再设置具体时间").into());
            }
        }
        if let (Some(start), Some(end)) = (&start_date, &end_date) {
            if end < start {
                return Err(crate::language::text("End date cannot be earlier than start date.", "结束日期不能早于开始日期").into());
            }
            if end == start {
                end_date = None;
            }
        }
        if start_time.is_none() {
            end_time = None;
        } else if end_date.is_none() {
            if let (Some(st), Some(et)) = (&start_time, &end_time) {
                if et <= st {
                    return Err(crate::language::text("End time must be later than start time.", "结束时间必须晚于开始时间").into());
                }
            }
        }
        let date = format_task_date_summary(
            start_date.as_deref(),
            end_date.as_deref(),
            start_time.as_deref(),
            end_time.as_deref(),
        );
        Ok(NormalizedSchedule {
            start_date,
            end_date,
            start_time,
            end_time,
            reminder_at: input.reminder_at,
            date,
        })
    }

    /// Update a local task's title and/or schedule/reminder fields.
    pub fn update_local_task(&self, id: &str, update: TaskUpdateInput) -> Result<Task, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let existing = Self::task_on(&tx, id)?
            .ok_or_else(|| crate::language::text("The task no longer exists.", "任务不存在").to_string())?;
        if existing.notion_id.is_some() || existing.group_id == NOTION_GROUP_ID {
            return Err(crate::language::text("Synced Notion tasks are edited in Notion.", "来自 Notion 的同步任务请在 Notion 中编辑").into());
        }
        if existing.group_id == ARCHIVE_GROUP_ID {
            return Err(crate::language::text("Restore the archived task before editing it.", "请先取消归档再编辑任务").into());
        }

        let next_title = match update.title {
            Some(title) => {
                let trimmed = title.trim();
                if trimmed.is_empty() {
                    return Err(crate::language::text("Task title cannot be empty.", "任务标题不能为空").into());
                }
                trimmed.to_string()
            }
            None => existing.title.clone(),
        };

        let (start_date, end_date, start_time, end_time, date, reminder_at, reminded_at) = if update.update_schedule {
            let normalized = Self::normalize_schedule(TaskScheduleInput {
                start_date: update.start_date,
                end_date: update.end_date,
                start_time: update.start_time,
                end_time: update.end_time,
                reminder_at: update.reminder_at,
            })?;
            let reminded = if normalized.reminder_at == existing.reminder_at {
                existing.reminded_at
            } else {
                None
            };
            (
                normalized.start_date,
                normalized.end_date,
                normalized.start_time,
                normalized.end_time,
                normalized.date,
                normalized.reminder_at,
                reminded,
            )
        } else {
            (
                existing.start_date.clone(),
                existing.end_date.clone(),
                existing.start_time.clone(),
                existing.end_time.clone(),
                existing.date.clone(),
                existing.reminder_at,
                existing.reminded_at,
            )
        };

        let next_group_id = match update.group_id {
            Some(ref target_id) if target_id != &existing.group_id => {
                let kind: Option<String> = tx
                    .query_row(
                        "SELECT kind FROM groups WHERE id = ?1",
                        params![target_id],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?;
                match kind.as_deref() {
                    Some("local") => target_id.clone(),
                    Some(_) => {
                        return Err(crate::language::text(
                            "Tasks can only be moved to a custom local group.",
                            "仅支持将任务移动到自定义本地分组",
                        )
                        .into())
                    }
                    None => {
                        return Err(crate::language::text(
                            "The target group no longer exists.",
                            "目标分组不存在",
                        )
                        .into())
                    }
                }
            }
            _ => existing.group_id.clone(),
        };
        let next_position = if next_group_id != existing.group_id {
            let max_pos: i64 = tx
                .query_row(
                    "SELECT COALESCE(MAX(position), 0) FROM tasks WHERE group_id = ?1",
                    params![&next_group_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if max_pos > 0 { max_pos + 1 } else { 0 }
        } else {
            existing.position
        };

        let now = chrono::Utc::now().timestamp_millis();
        tx.execute(
            "UPDATE tasks
             SET title = ?1, group_id = ?2, position = ?3, date = ?4, start_date = ?5, end_date = ?6,
                 start_time = ?7, end_time = ?8, reminder_at = ?9, reminded_at = ?10, updated_time = ?11
             WHERE id = ?12",
            params![
                next_title,
                next_group_id,
                next_position,
                date,
                start_date,
                end_date,
                start_time,
                end_time,
                reminder_at,
                reminded_at,
                now,
                id
            ],
        ).map_err(|e| e.to_string())?;
        let updated = Self::task_on(&tx, id)?
            .ok_or_else(|| crate::language::text("The task no longer exists.", "任务不存在").to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(updated)
    }

    pub fn due_reminders(&self, now_ms: i64) -> Result<Vec<Task>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, notion_id, title, completed, progress, remain, date, tags, updated_time, group_id, position,
                    start_date, end_date, start_time, end_time, reminder_at, reminded_at
             FROM tasks
             WHERE completed = 0
               AND group_id != ?1
               AND reminder_at IS NOT NULL
               AND reminder_at <= ?2
               AND reminded_at IS NULL
             ORDER BY reminder_at ASC, rowid ASC",
        ).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![ARCHIVE_GROUP_ID, now_ms], Self::task_from_row)
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn mark_reminded(&self, id: &str, fired_at: i64) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let changed = conn.execute(
            "UPDATE tasks SET reminded_at = ?1 WHERE id = ?2 AND reminded_at IS NULL",
            params![fired_at, id],
        ).map_err(|e| e.to_string())?;
        Ok(changed != 0)
    }

    /// Delete a local task. Notion-owned rows must be removed in Notion itself.
    pub fn delete_local_task(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let row: Option<(Option<String>, String)> = conn
            .query_row(
                "SELECT notion_id, group_id FROM tasks WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let Some((notion_id, group_id)) = row else {
            return Err(crate::language::text("The task no longer exists.", "任务不存在").into());
        };
        if notion_id.is_some() || group_id == NOTION_GROUP_ID {
            return Err(crate::language::text("Delete Notion tasks in Notion. They disappear here after syncing.", "来自 Notion 的任务请在 Notion 中删除（同步后自动消失）").into());
        }
        conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Seed demo content once (flagged), into a deletable local group.
    pub fn seed_mocks_if_empty(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        if Self::setting_on(&tx, "mocks_seeded")?.is_some() {
            return Ok(());
        }
        let has_tasks: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM tasks)", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        if !has_tasks {
            let group = Self::insert_group(&tx, crate::language::text("Example plan", "示例计划"))?;
            for mut task in crate::models::mock_tasks() {
                task.group_id = group.id.clone();
                Self::upsert_task_on(&tx, &task, &task.id, task.notion_id.as_deref(), task.completed)?;
            }
            Self::archive_completed_local_tasks(&tx)?;
        }
        Self::put_setting_on(&tx, "mocks_seeded", "1")?;
        tx.commit().map_err(|e| e.to_string())
    }


    pub fn list_pending(&self) -> Result<Vec<PendingOp>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        Self::pending_on(&conn)
    }

    fn pending_on(conn: &Connection) -> Result<Vec<PendingOp>, String> {
        let mut stmt = conn.prepare(
            "SELECT id, revision, task_id, completed, created_at, database_id, page_id, mapping,
             source_verified FROM pending_ops ORDER BY id ASC",
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| Ok((PendingOp {
            id: row.get(0)?,
            revision: row.get(1)?,
            task_id: row.get(2)?,
            completed: row.get::<_, i64>(3)? != 0,
            created_at: row.get(4)?,
            database_id: row.get(5)?,
            page_id: row.get(6)?,
            mapping: None,
            source_verified: row.get::<_, i64>(8)? != 0,
        }, row.get::<_, Option<String>>(7)?))).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            let (mut op, mapping) = row.map_err(|e| e.to_string())?;
            op.mapping = mapping.map(|raw| serde_json::from_str(&raw)
                .map_err(|_| crate::language::text("The pending write property mapping is damaged.", "待回写属性映射损坏").to_string())).transpose()?;
            out.push(op);
        }
        Ok(out)
    }

    pub fn pending_summary(&self) -> Result<(usize, usize, u64), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let database_id = normalize_notion_id(&Self::notion_config_on(&conn)?.database_id);
        let pending = Self::pending_on(&conn)?;
        let unresolved = pending.iter().filter(|op| !op.source_verified
            || op.mapping.is_none()
            || op.page_id.as_ref().map_or(true, |id| id.trim().is_empty())
            || op.database_id.as_ref().map_or(true, |id| normalize_notion_id(id) != database_id || id.trim().is_empty())
        ).count();
        Ok((pending.len(), unresolved, Self::version_on(&conn, "pending_version")?))
    }

    pub fn clear_pending(&self, id: i64, revision: i64) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let changed = tx.execute("DELETE FROM pending_ops WHERE id = ?1 AND revision = ?2",
            params![id, revision]).map_err(|e| e.to_string())? != 0;
        if changed { Self::bump_version(&tx, "pending_version")?; }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(changed)
    }

    /// Caller must first verify the page's actual parent database with Notion.
    pub fn bind_pending(
        &self,
        id: i64,
        revision: i64,
        database_id: &str,
        page_id: &str,
        mapping: &NotionWriteMapping,
    ) -> Result<bool, String> {
        let database_id = normalize_notion_id(database_id);
        let page_id = normalize_notion_id(page_id);
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let config = Self::notion_config_on(&tx)?;
        if !config.is_configured() || page_id.is_empty()
            || normalize_notion_id(&config.database_id) != database_id
            || NotionWriteMapping::from_config(&config) != *mapping {
            return Ok(false);
        }
        let Some(op) = Self::pending_on(&tx)?.into_iter().find(|op| op.id == id) else {
            return Ok(false);
        };
        if op.revision != revision || op.source_verified
            || op.database_id.as_ref().is_some_and(|value| normalize_notion_id(value) != database_id)
            || op.page_id.as_ref().map_or(true, |value| normalize_notion_id(value) != page_id) {
            return Ok(false);
        }
        let occupied: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM pending_ops WHERE database_id = ?1 AND page_id = ?2 AND id <> ?3)",
            params![database_id, page_id, id], |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if occupied { return Ok(false); }
        let mapping = serde_json::to_string(mapping).map_err(|e| e.to_string())?;
        let changed = tx.execute(
            "UPDATE pending_ops SET database_id = ?1, page_id = ?2, mapping = ?3, source_verified = 1
             WHERE id = ?4 AND revision = ?5 AND source_verified = 0",
            params![database_id, page_id, mapping, id, revision],
        ).map_err(|e| e.to_string())? != 0;
        if changed { Self::bump_version(&tx, "pending_version")?; }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(changed)
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    fn test_path(label: &str) -> PathBuf {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        std::env::temp_dir().join(format!("sticky-{label}-{}-{}-{}.db",
            std::process::id(), Database::nanos(), NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)))
    }

    fn test_db() -> Database {
        let dir = test_path("database");
        Database::open(dir).unwrap()
    }

    fn fake_config() -> NotionConfig {
        NotionConfig {
            token: "test-integration-token".into(),
            database_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa".into(),
            ..NotionConfig::default()
        }
    }

    fn configure(db: &Database) -> NotionConfig {
        let config = fake_config();
        assert_eq!(db.save_notion_config(&config, false, None).unwrap(), SaveNotionConfigResult::Saved);
        config
    }

    fn remote_task(page: &str) -> Task {
        Task {
            id: page.into(),
            notion_id: Some(page.into()),
            title: "远端任务".into(),
            completed: false,
            progress: None,
            remain: None,
            date: None,
            start_date: None,
            end_date: None,
            start_time: None,
            end_time: None,
            reminder_at: None,
            reminded_at: None,
            tags: vec![],
            updated_time: 1,
            group_id: NOTION_GROUP_ID.into(),
            position: 0,
        }
    }

    fn merge(db: &Database, tasks: &[Task]) -> bool {
        db.merge_notion_snapshot(tasks, db.notion_context().unwrap().1).unwrap()
    }

    fn legacy_db() -> Database {
        let path = test_path("legacy");
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE tasks (
                id TEXT PRIMARY KEY, notion_id TEXT, title TEXT NOT NULL,
                completed INTEGER NOT NULL DEFAULT 0, progress TEXT, remain TEXT, date TEXT,
                tags TEXT NOT NULL DEFAULT '[]', updated_time INTEGER NOT NULL,
                group_id TEXT NOT NULL DEFAULT 'notion'
             );
             CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE groups(
                id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
                position INTEGER NOT NULL, created_at INTEGER NOT NULL
             );
             INSERT INTO groups VALUES('user-group', '用户分组', 'local', 1, 1);
             CREATE TABLE pending_ops(
                id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
                completed INTEGER NOT NULL, created_at INTEGER NOT NULL
             );
             CREATE TABLE sync_log(id INTEGER PRIMARY KEY, at INTEGER, message TEXT);
             INSERT INTO sync_log VALUES(1, 1, 'old diagnostic');",
        ).unwrap();
        Database::put_setting_on(&conn, "notion", &serde_json::to_string(&fake_config()).unwrap()).unwrap();
        Database { conn: Mutex::new(conn) }
    }

    #[test]
    fn local_completion_archives_and_undo_restores_the_original_group() {
        let db = test_db();
        let group = db.create_group("工作").unwrap();
        let task = db.import_local_tasks(vec!["完成报告".into()], Some(&group.id), None).unwrap().tasks.remove(0);
        let archived = db.toggle_task(&task.id).unwrap();
        assert!(archived.completed);
        assert_eq!(archived.group_id, ARCHIVE_GROUP_ID);
        merge(&db, &[]);
        assert_eq!(db.get_task(&task.id).unwrap().unwrap().group_id, ARCHIVE_GROUP_ID);
        let restored = db.toggle_task(&task.id).unwrap();
        assert!(!restored.completed);
        assert_eq!(restored.group_id, group.id);
    }

    #[test]
    fn clearing_archive_preserves_active_tasks_notion_tasks_and_fixed_groups() {
        let db = test_db();
        configure(&db);
        let group = db.create_group("计划").unwrap();
        let active = db.import_local_tasks(vec!["未完成".into()], Some(&group.id), None).unwrap().tasks.remove(0);
        let archived = db.import_local_tasks(vec!["已完成".into()], Some(&group.id), None).unwrap().tasks.remove(0);
        db.toggle_task(&archived.id).unwrap();
        let mut remote = crate::models::mock_tasks().remove(0);
        remote.notion_id = Some("notion-page".into());
        merge(&db, &[remote.clone()]);
        let completed_remote = db.toggle_task(&remote.id).unwrap();
        assert!(completed_remote.completed);
        assert_eq!(completed_remote.group_id, NOTION_GROUP_ID);
        assert_eq!(db.clear_archive().unwrap(), vec![archived.id.clone()]);
        assert!(db.get_task(&archived.id).unwrap().is_none());
        assert_eq!(db.get_task(&active.id).unwrap().unwrap().group_id, group.id);
        assert!(db.get_task(&remote.id).unwrap().unwrap().completed);
        assert!(db.list_groups().unwrap().iter().any(|g| g.id == ARCHIVE_GROUP_ID && g.kind == "archive"));
        assert!(db.clear_archive().unwrap().is_empty());
    }

    #[test]
    fn deleting_source_group_keeps_archived_tasks_and_failed_undo_changes_nothing() {
        let db = test_db();
        let group = db.create_group("可删除的原分组").unwrap();
        let task = db.import_local_tasks(vec!["保留归档".into()], Some(&group.id), None).unwrap().tasks.remove(0);
        db.toggle_task(&task.id).unwrap();
        db.delete_group(&group.id).unwrap();
        assert!(db.toggle_task(&task.id).is_err());
        let saved = db.get_task(&task.id).unwrap().unwrap();
        assert!(saved.completed);
        assert_eq!(saved.group_id, ARCHIVE_GROUP_ID);
        db.delete_local_task(&task.id).unwrap();
        assert!(db.get_task(&task.id).unwrap().is_none());
    }

    #[test]
    fn archive_is_pinned_and_cannot_receive_new_or_imported_tasks() {
        let db = test_db();
        assert!(db.delete_group(ARCHIVE_GROUP_ID).is_err());
        assert!(db.import_local_tasks(vec!["不能导入".into()], Some(ARCHIVE_GROUP_ID), None).is_err());
        assert!(db.list_tasks().unwrap().is_empty());
        assert!(db.list_groups().unwrap().iter().any(|group| group.id == ARCHIVE_GROUP_ID));
    }

    #[test]
    fn batch_import_preserves_order_duplicates_and_local_ownership() {
        let db = test_db();
        let original_groups = db.list_groups().unwrap().len();
        let imported = db.import_local_tasks(
            vec!["  阅读资料 ".into(), "完成初稿".into(), "阅读资料".into()],
            None, Some("批量计划"),
        ).unwrap();
        merge(&db, &[]);
        let saved = db.list_tasks().unwrap();
        assert_eq!(saved.iter().map(|task| task.title.as_str()).collect::<Vec<_>>(),
            vec!["阅读资料", "完成初稿", "阅读资料"]);
        assert!(saved.iter().all(|task| task.group_id == imported.group.id && task.notion_id.is_none()));
        assert_ne!(saved[0].id, saved[2].id);

        let more = db.import_local_tasks(
            vec!["提交成果".into()], Some(&imported.group.id), None,
        ).unwrap();
        assert_eq!(more.group.id, imported.group.id);
        assert_eq!(db.list_groups().unwrap().len(), original_groups + 1);
        assert_eq!(db.get_task(&more.tasks[0].id).unwrap().unwrap().title, "提交成果");
    }

    #[test]
    fn batch_import_rejects_invalid_targets_and_empty_tasks_without_writes() {
        let db = test_db();
        let original_groups = db.list_groups().unwrap().len();
        for (group, new_name) in [
            (Some(NOTION_GROUP_ID), None),
            (Some("missing"), None),
            (None, None),
            (None, Some("  ")),
            (Some(NOTION_GROUP_ID), Some("不能创建")),
        ] {
            assert!(db.import_local_tasks(vec!["任务".into()], group, new_name).is_err());
        }
        assert!(db.import_local_tasks(Vec::new(), None, Some("空批次")).is_err());
        assert!(db.import_local_tasks(vec!["有效".into(), "  ".into()], None, Some("不能残留")).is_err());
        assert_eq!(db.list_groups().unwrap().len(), original_groups);
        assert!(db.list_tasks().unwrap().is_empty());
    }

    #[test]
    fn batch_import_rolls_back_group_and_earlier_tasks_on_insert_failure() {
        let db = test_db();
        let original_groups = db.list_groups().unwrap().len();
        db.conn.lock().unwrap().execute_batch(
            "CREATE TEMP TRIGGER reject_import BEFORE INSERT ON tasks
             WHEN NEW.title = '拒绝任务'
             BEGIN SELECT RAISE(ABORT, 'simulated insert failure'); END;",
        ).unwrap();
        assert!(db.import_local_tasks(
            vec!["第一条".into(), "拒绝任务".into()], None, Some("不应留下的组"),
        ).is_err());
        assert_eq!(db.list_groups().unwrap().len(), original_groups);
        assert!(db.list_tasks().unwrap().is_empty());
    }

    #[test]
    fn notion_group_is_pinned_and_undeletable() {
        let db = test_db();
        let groups = db.list_groups().unwrap();
        assert_eq!(groups[0].id, NOTION_GROUP_ID);
        assert_eq!(groups[0].kind, "notion");
        assert!(db.delete_group(NOTION_GROUP_ID).is_err());
    }

    #[test]
    fn local_group_lifecycle_cascades() {
        let db = test_db();
        let g = db.create_group("工作").unwrap();
        let t = db.import_local_tasks(vec!["写周报".into()], Some(&g.id), None).unwrap().tasks.remove(0);
        assert_eq!(t.group_id, g.id);
        assert_eq!(t.notion_id, None);
        // Sync-managed group rejects manual task creation
        assert!(db.import_local_tasks(vec!["x".into()], Some(NOTION_GROUP_ID), None).is_err());
        // Deleting the group removes its tasks too
        db.delete_group(&g.id).unwrap();
        assert!(db.get_task(&t.id).unwrap().is_none());
        assert!(db.list_tasks().unwrap().is_empty());
    }

    #[test]
    fn notion_snapshot_spares_local_rows() {
        let db = test_db();
        let g = db.create_group("我的计划").unwrap();
        let local = db.import_local_tasks(vec!["本地任务".into()], Some(&g.id), None).unwrap().tasks.remove(0);

        let remote = Task {
            id: "page-1".into(),
            notion_id: Some("page-1".into()),
            title: "Notion 任务".into(),
            completed: false,
            progress: None,
            remain: None,
            date: None,
            start_date: None,
            end_date: None,
            start_time: None,
            end_time: None,
            reminder_at: None,
            reminded_at: None,
            tags: vec![],
            updated_time: 1,
            group_id: NOTION_GROUP_ID.into(),
            position: 0,
        };
        merge(&db, &[remote]);

        let tasks = db.list_tasks().unwrap();
        assert_eq!(tasks.len(), 2);
        assert!(tasks.iter().any(|t| t.id == local.id && t.group_id == g.id));
        assert!(tasks
            .iter()
            .any(|t| t.id == "page-1" && t.group_id == NOTION_GROUP_ID));

        assert!(db.delete_local_task("page-1").is_err());

        // An empty Notion response clears only remote rows, never local plans.
        merge(&db, &[]);
        assert!(db.get_task("page-1").unwrap().is_none());
        assert_eq!(db.get_task(&local.id).unwrap().unwrap().title, "本地任务");

        db.delete_local_task(&local.id).unwrap();
        assert!(db.get_task(&local.id).unwrap().is_none());
    }

    #[test]
    fn migration_moves_legacy_tasks_to_local_group() {
        let dir = test_path("migration");
        {
            // Old schema: no groups table, no group_id column, seeded mock rows.
            let c = Connection::open(&dir).unwrap();
            c.execute_batch(
                "CREATE TABLE tasks (
                    id TEXT PRIMARY KEY,
                    notion_id TEXT,
                    title TEXT NOT NULL,
                    completed INTEGER NOT NULL DEFAULT 0,
                    progress TEXT,
                    remain TEXT,
                    date TEXT,
                    tags TEXT NOT NULL DEFAULT '[]',
                    updated_time INTEGER NOT NULL
                 );
                 CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
            )
            .unwrap();
            c.execute(
                "INSERT INTO tasks(id, notion_id, title, completed, updated_time) VALUES('local-1', NULL, 'legacy demo', 0, 1)",
                [],
            )
            .unwrap();
            c.execute_batch(
                "INSERT INTO tasks(id, notion_id, title, completed, updated_time) VALUES
                 ('legacy-done', NULL, '旧本地已完成任务', 1, 2),
                 ('remote-done', 'notion-page', '旧 Notion 已完成任务', 1, 3);",
            ).unwrap();
        }
        let db = Database::open(dir).unwrap();
        let groups = db.list_groups().unwrap();
        let demo = groups.iter().find(|g| g.kind == "local").unwrap();
        assert_eq!(db.get_task("local-1").unwrap().unwrap().group_id, demo.id);
        assert_eq!(db.get_task("legacy-done").unwrap().unwrap().group_id, ARCHIVE_GROUP_ID);
        assert_eq!(db.get_task("remote-done").unwrap().unwrap().group_id, NOTION_GROUP_ID);
        let restored = db.toggle_task("legacy-done").unwrap();
        assert_eq!(restored.group_id, demo.id);
        assert!(!restored.completed);
        db.migrate().unwrap();
        assert_eq!(db.get_task("legacy-done").unwrap().unwrap().group_id, demo.id);
        db.delete_local_task("local-1").unwrap();
        assert!(db.get_task("local-1").unwrap().is_none());
    }

    #[test]
    fn seed_mocks_creates_demo_group_once() {
        let db = test_db();
        db.seed_mocks_if_empty().unwrap();
        let groups = db.list_groups().unwrap();
        let demo = groups.iter().find(|g| g.kind == "local").unwrap();
        let tasks = db.list_tasks().unwrap();
        assert!(tasks.iter().any(|task| task.completed && task.group_id == ARCHIVE_GROUP_ID));
        assert!(tasks.iter().any(|task| !task.completed && task.group_id == demo.id));
        assert!(tasks.iter().all(|task| task.group_id == if task.completed { ARCHIVE_GROUP_ID } else { &demo.id }));

        // Flagged: a second run must not duplicate demo content
        db.seed_mocks_if_empty().unwrap();
        assert_eq!(db.list_tasks().unwrap().len(), tasks.len());
        assert_eq!(db.list_groups().unwrap().iter().map(|group| &group.id).collect::<Vec<_>>(),
            groups.iter().map(|group| &group.id).collect::<Vec<_>>());
    }

    #[test]
    fn notion_toggle_and_outbox_survive_reopen_without_a_task_row() {
        let path = test_path("outbox");
        let op = {
            let db = Database::open(path.clone()).unwrap();
            let config = configure(&db);
            let remote = remote_task("durable-page");
            merge(&db, &[remote.clone()]);
            let toggled = db.toggle_task(&remote.id).unwrap();
            assert!(toggled.completed);
            let pending = db.list_pending().unwrap();
            assert_eq!(pending.len(), 1);
            assert_eq!(pending[0].mapping, Some(NotionWriteMapping::from_config(&config)));
            assert_eq!(pending[0].database_id.as_deref(), Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
            assert_eq!(pending[0].page_id.as_deref(), Some("durable-page"));
            assert!(pending[0].source_verified);
            let raw: String = db.conn.lock().unwrap().query_row(
                "SELECT mapping FROM pending_ops", [], |row| row.get(0),
            ).unwrap();
            let value: serde_json::Value = serde_json::from_str(&raw).unwrap();
            assert_eq!(value.as_object().unwrap().len(), 4);
            assert!(value.get("token").is_none());
            pending[0].clone()
        };
        let db = Database::open(path.clone()).unwrap();
        assert!(db.get_task("durable-page").unwrap().unwrap().completed);
        assert_eq!(db.list_pending().unwrap()[0].id, op.id);
        db.conn.lock().unwrap().execute("DELETE FROM tasks WHERE id = 'durable-page'", []).unwrap();
        drop(db);
        let db = Database::open(path).unwrap();
        let persisted = db.list_pending().unwrap();
        assert_eq!(persisted.len(), 1);
        assert_eq!(persisted[0].revision, op.revision);
        assert_eq!(persisted[0].completed, op.completed);
        assert!(db.clear_pending(op.id, op.revision).unwrap());
        assert!(db.list_pending().unwrap().is_empty());
    }

    #[test]
    fn newer_revision_survives_an_inflight_ack_and_collapses_true_false() {
        let db = std::sync::Arc::new(test_db());
        configure(&db);
        let task = remote_task("revision-page");
        merge(&db, &[task.clone()]);
        db.toggle_task(&task.id).unwrap();
        let sent = db.list_pending().unwrap().remove(0);
        let before = db.pending_summary().unwrap().2;
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let ack_db = db.clone();
        let ack_barrier = barrier.clone();
        let id = sent.id;
        let revision = sent.revision;
        let ack = std::thread::spawn(move || {
            ack_barrier.wait();
            ack_db.clear_pending(id, revision).unwrap()
        });
        assert!(!db.toggle_task(&task.id).unwrap().completed);
        let version_after_toggle = db.pending_summary().unwrap().2;
        assert!(version_after_toggle > before);
        barrier.wait();
        assert!(!ack.join().unwrap());
        assert_eq!(db.pending_summary().unwrap().2, version_after_toggle);
        let latest = db.list_pending().unwrap();
        assert_eq!(latest.len(), 1);
        assert_eq!(latest[0].id, sent.id);
        assert_eq!(latest[0].revision, sent.revision + 1);
        assert!(!latest[0].completed);
        assert!(db.clear_pending(latest[0].id, latest[0].revision).unwrap());
        assert!(db.pending_summary().unwrap().2 > version_after_toggle);
        let after_ack = db.pending_summary().unwrap().2;
        assert!(!db.clear_pending(latest[0].id, latest[0].revision).unwrap());
        assert_eq!(db.pending_summary().unwrap().2, after_ack);
    }

    #[test]
    fn notion_toggle_rolls_back_checkbox_when_outbox_insert_or_update_fails() {
        let db = test_db();
        configure(&db);
        let task = remote_task("atomic-page");
        merge(&db, &[task.clone()]);
        let original = db.get_task(&task.id).unwrap().unwrap();
        db.conn.lock().unwrap().execute_batch(
            "CREATE TEMP TRIGGER reject_outbox_insert BEFORE INSERT ON pending_ops
             BEGIN SELECT RAISE(ABORT, 'outbox insert failure'); END;",
        ).unwrap();
        assert!(db.toggle_task(&task.id).is_err());
        assert_eq!(db.get_task(&task.id).unwrap().unwrap(), original);
        assert_eq!(db.pending_summary().unwrap(), (0, 0, 0));
        db.conn.lock().unwrap().execute_batch("DROP TRIGGER reject_outbox_insert;").unwrap();
        db.toggle_task(&task.id).unwrap();
        let original = db.get_task(&task.id).unwrap().unwrap();
        let pending = db.list_pending().unwrap().remove(0);
        let version = db.pending_summary().unwrap().2;
        db.conn.lock().unwrap().execute_batch(
            "CREATE TEMP TRIGGER reject_outbox_update BEFORE UPDATE ON pending_ops
             BEGIN SELECT RAISE(ABORT, 'outbox update failure'); END;",
        ).unwrap();
        assert!(db.toggle_task(&task.id).is_err());
        assert_eq!(db.get_task(&task.id).unwrap().unwrap(), original);
        assert_eq!(db.list_pending().unwrap()[0].revision, pending.revision);
        assert_eq!(db.pending_summary().unwrap().2, version);
    }

    #[test]
    fn incomplete_notion_config_preserves_cache_and_rejects_toggle_but_not_local_tasks() {
        let db = test_db();
        let remote = remote_task("unconfigured-page");
        merge(&db, &[remote.clone()]);
        assert!(db.toggle_task(&remote.id).is_err());
        let mut config = NotionConfig::default();
        config.token = "test-token-without-database".into();
        db.save_notion_config(&config, false, None).unwrap();
        assert!(db.toggle_task(&remote.id).is_err());
        assert_eq!(db.get_task(&remote.id).unwrap().unwrap(), remote);
        assert!(db.list_pending().unwrap().is_empty());
        let group = db.create_group("本地").unwrap();
        let task = db.import_local_tasks(vec!["本地照常归档".into()], Some(&group.id), None).unwrap().tasks.remove(0);
        assert_eq!(db.toggle_task(&task.id).unwrap().group_id, ARCHIVE_GROUP_ID);
        config.database_id = fake_config().database_id;
        config.done_property.clear();
        config.title_property.clear();
        config.date_property.clear();
        assert!(config.is_configured());
        assert_eq!(NotionWriteMapping::from_config(&config).done_property, "done?");
    }

    #[test]
    fn snapshot_rereads_pending_after_query_and_keeps_remote_fields_and_missing_pending_rows() {
        let db = std::sync::Arc::new(test_db());
        configure(&db);
        let remote = remote_task("query-race-page");
        merge(&db, &[remote.clone()]);
        let version = db.notion_context().unwrap().1;
        let ready = std::sync::Arc::new(std::sync::Barrier::new(2));
        let commit = std::sync::Arc::new(std::sync::Barrier::new(2));
        let query_db = db.clone();
        let query_ready = ready.clone();
        let query_commit = commit.clone();
        let mut snapshot = remote.clone();
        snapshot.title = "远端最新标题".into();
        snapshot.progress = Some("80%".into());
        snapshot.tags = vec!["远端标签".into()];
        let query = std::thread::spawn(move || {
            query_ready.wait();
            query_commit.wait();
            query_db.merge_notion_snapshot(&[snapshot], version).unwrap()
        });
        ready.wait();
        db.toggle_task(&remote.id).unwrap();
        commit.wait();
        assert!(query.join().unwrap());
        let task = db.get_task(&remote.id).unwrap().unwrap();
        assert!(task.completed);
        assert_eq!(task.title, "远端最新标题");
        assert_eq!(task.progress.as_deref(), Some("80%"));
        assert_eq!(task.tags, vec!["远端标签"]);
        assert_eq!(task.updated_time, remote.updated_time);
        assert!(!merge(&db, &[]));
        assert_eq!(db.get_task(&remote.id).unwrap().unwrap(), task);
        let op = db.list_pending().unwrap().remove(0);
        db.clear_pending(op.id, op.revision).unwrap();
        assert!(merge(&db, &[]));
        assert!(db.get_task(&remote.id).unwrap().is_none());
    }

    #[test]
    fn snapshot_delta_is_idempotent_preserves_identity_order_and_never_writes_local_or_archive_rows() {
        let db = test_db();
        let group = db.create_group("保留分组").unwrap();
        let imported = db.import_local_tasks(vec!["第一项".into(), "第二项".into()], Some(&group.id), None).unwrap();
        db.toggle_task(&imported.tasks[1].id).unwrap();
        let local_before: Vec<_> = db.list_tasks().unwrap();
        let page = "11111111-1111-1111-1111-111111111111";
        let mut remote = remote_task(page);
        remote.id = "stable-task-id".into();
        assert!(merge(&db, &[remote.clone()]));
        let (changes, rowid): (i64, i64) = {
            let conn = db.conn.lock().unwrap();
            (conn.query_row("SELECT total_changes()", [], |row| row.get(0)).unwrap(),
             conn.query_row("SELECT rowid FROM tasks WHERE id = 'stable-task-id'", [], |row| row.get(0)).unwrap())
        };
        remote.id = "different-query-id".into();
        remote.notion_id = Some(normalize_notion_id(page));
        assert!(!merge(&db, &[remote.clone()]));
        {
            let conn = db.conn.lock().unwrap();
            assert_eq!(conn.query_row("SELECT total_changes()", [], |row| row.get::<_, i64>(0)).unwrap(), changes);
            assert_eq!(conn.query_row("SELECT rowid FROM tasks WHERE id = 'stable-task-id'", [], |row| row.get::<_, i64>(0)).unwrap(), rowid);
        }
        remote.title = "确有变化".into();
        assert!(merge(&db, &[remote]));
        assert_eq!(db.get_task("stable-task-id").unwrap().unwrap().title, "确有变化");
        assert!(db.get_task("different-query-id").unwrap().is_none());
        assert!(merge(&db, &[]));
        assert_eq!(db.list_tasks().unwrap(), local_before);
    }

    #[test]
    fn invalid_snapshot_rolls_back_earlier_deltas_and_cannot_overwrite_a_local_identity() {
        let db = test_db();
        let first = remote_task("first-page");
        merge(&db, &[first.clone()]);
        let group = db.create_group("本地身份").unwrap();
        let local = db.import_local_tasks(vec!["不能覆盖".into()], Some(&group.id), None).unwrap().tasks.remove(0);
        let mut changed = first.clone();
        changed.title = "不应提交".into();
        let mut collision = remote_task("other-page");
        collision.id = local.id.clone();
        let version = db.notion_context().unwrap().1;
        assert!(db.merge_notion_snapshot(&[changed, collision], version).is_err());
        assert_eq!(db.get_task(&first.id).unwrap().unwrap(), first);
        assert_eq!(db.get_task(&local.id).unwrap().unwrap(), local);
    }

    #[test]
    fn config_confirmation_is_version_safe_allows_token_updates_and_clears_only_old_notion_cache() {
        let db = test_db();
        let mut config = configure(&db);
        let group = db.create_group("本地分组").unwrap();
        let active = db.import_local_tasks(vec!["本地保留".into()], Some(&group.id), None).unwrap().tasks.remove(0);
        let archived = db.import_local_tasks(vec!["归档保留".into()], Some(&group.id), None).unwrap().tasks.remove(0);
        db.toggle_task(&archived.id).unwrap();
        let remote = remote_task("old-database-page");
        merge(&db, &[remote.clone()]);
        db.toggle_task(&remote.id).unwrap();
        let version = db.pending_summary().unwrap().2;
        let original_mapping = db.list_pending().unwrap()[0].mapping.clone();
        config.token = "replacement-test-token".into();
        config.database_id = normalize_notion_id(&config.database_id).to_ascii_uppercase();
        assert_eq!(db.save_notion_config(&config, false, None).unwrap(), SaveNotionConfigResult::Saved);
        assert_eq!(db.pending_summary().unwrap().2, version);
        assert_eq!(db.list_pending().unwrap()[0].mapping, original_mapping);
        let stale_config_version = db.notion_context().unwrap().1;
        let mut next = config.clone();
        next.database_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".into();
        assert_eq!(db.save_notion_config(&next, false, None).unwrap(),
            SaveNotionConfigResult::ConfirmationRequired { pending_count: 1, pending_version: version });
        db.toggle_task(&remote.id).unwrap();
        let latest_version = db.pending_summary().unwrap().2;
        assert_eq!(db.save_notion_config(&next, true, Some(version)).unwrap(),
            SaveNotionConfigResult::ConfirmationRequired { pending_count: 1, pending_version: latest_version });
        assert_eq!(db.notion_context().unwrap().0, config);
        assert!(db.get_task(&remote.id).unwrap().is_some());
        assert_eq!(db.save_notion_config(&next, true, Some(latest_version)).unwrap(), SaveNotionConfigResult::Saved);
        assert!(db.list_pending().unwrap().is_empty());
        assert!(db.get_task(&remote.id).unwrap().is_none());
        assert_eq!(db.get_task(&active.id).unwrap().unwrap().group_id, group.id);
        assert_eq!(db.get_task(&archived.id).unwrap().unwrap().group_id, ARCHIVE_GROUP_ID);
        assert!(!db.merge_notion_snapshot(&[remote.clone()], stale_config_version).unwrap());
        assert!(db.get_task(&remote.id).unwrap().is_none());
    }

    #[test]
    fn mapping_change_or_identity_clear_requires_confirmation_and_mapping_change_keeps_cache() {
        let db = test_db();
        let config = configure(&db);
        let remote = remote_task("mapping-page");
        merge(&db, &[remote.clone()]);
        db.toggle_task(&remote.id).unwrap();
        let pending_version = db.pending_summary().unwrap().2;
        let mut changed = config.clone();
        changed.status_done_value = "已完成".into();
        assert!(matches!(db.save_notion_config(&changed, false, None).unwrap(),
            SaveNotionConfigResult::ConfirmationRequired { pending_count: 1, .. }));
        let mut cleared = config.clone();
        cleared.database_id.clear();
        assert!(matches!(db.save_notion_config(&cleared, false, None).unwrap(),
            SaveNotionConfigResult::ConfirmationRequired { pending_count: 1, .. }));
        assert_eq!(db.notion_context().unwrap().0, config);
        assert_eq!(db.save_notion_config(&changed, true, Some(pending_version)).unwrap(), SaveNotionConfigResult::Saved);
        assert!(db.list_pending().unwrap().is_empty());
        assert!(db.get_task(&remote.id).unwrap().is_some());
        db.toggle_task(&remote.id).unwrap();
        assert_eq!(db.list_pending().unwrap()[0].mapping, Some(NotionWriteMapping::from_config(&changed)));
    }

    #[test]
    fn config_discard_cache_clear_and_versions_roll_back_on_config_write_failure() {
        let db = test_db();
        let config = configure(&db);
        let remote = remote_task("rollback-config-page");
        merge(&db, &[remote.clone()]);
        db.toggle_task(&remote.id).unwrap();
        let original_task = db.get_task(&remote.id).unwrap().unwrap();
        let pending = db.list_pending().unwrap().remove(0);
        let pending_version = db.pending_summary().unwrap().2;
        let config_version = db.notion_context().unwrap().1;
        let mut next = config.clone();
        next.database_id = "new-database".into();
        db.conn.lock().unwrap().execute_batch(
            "CREATE TEMP TRIGGER reject_config BEFORE UPDATE ON settings WHEN NEW.key = 'notion'
             BEGIN SELECT RAISE(ABORT, 'config write failure'); END;",
        ).unwrap();
        assert!(db.save_notion_config(&next, true, Some(pending_version)).is_err());
        assert_eq!(db.notion_context().unwrap(), (config, config_version));
        assert_eq!(db.pending_summary().unwrap().2, pending_version);
        assert_eq!(db.list_pending().unwrap()[0].id, pending.id);
        assert_eq!(db.get_task(&remote.id).unwrap().unwrap(), original_task);
    }

    #[test]
    fn migration_folds_original_ids_restores_intents_and_retains_unassociated_operations() {
        let db = legacy_db();
        db.conn.lock().unwrap().execute_batch(
            "INSERT INTO tasks(id, notion_id, title, completed, updated_time) VALUES
             ('alias-a', '11111111-1111-1111-1111-111111111111', '旧页面 A', 0, 1),
             ('alias-b', '11111111111111111111111111111111', '旧页面 B', 0, 1);
             INSERT INTO pending_ops(id, task_id, completed, created_at) VALUES
             (1, 'alias-a', 1, 100), (2, 'alias-b', 0, 200), (3, 'alias-a', 1, 10),
             (4, 'ghost', 1, 20), (5, 'ghost', 0, 5), (6, 'unassociated', 1, 30);",
        ).unwrap();
        db.migrate().unwrap();
        let pending = db.list_pending().unwrap();
        assert_eq!(pending.iter().map(|op| op.id).collect::<Vec<_>>(), vec![3, 5, 6]);
        assert!(pending.iter().all(|op| op.revision == 1 && op.database_id.is_none()
            && op.mapping.is_none() && !op.source_verified));
        assert_eq!(pending[0].page_id.as_deref(), Some("11111111111111111111111111111111"));
        assert!(!pending[1].completed);
        assert!(pending[1].page_id.is_none());
        assert!(db.get_task("alias-a").unwrap().unwrap().completed);
        assert!(db.get_task("alias-b").unwrap().unwrap().completed);
        assert_eq!(db.pending_summary().unwrap(), (3, 3, 1));
        let config = db.notion_context().unwrap().0;
        let mapping = NotionWriteMapping::from_config(&config);
        assert!(!db.bind_pending(3, 1, "wrong-database", pending[0].page_id.as_deref().unwrap(), &mapping).unwrap());
        assert!(!db.bind_pending(5, 1, &config.database_id, "unrelated-verified-page", &mapping).unwrap());
        assert_eq!(db.pending_summary().unwrap(), (3, 3, 1));
        assert!(db.bind_pending(3, 1, &config.database_id, pending[0].page_id.as_deref().unwrap(), &mapping).unwrap());
        assert_eq!(db.pending_summary().unwrap(), (3, 2, 2));
        assert_eq!(db.list_pending().unwrap()[1].id, 5);
        assert_eq!(db.list_pending().unwrap()[2].id, 6);
        db.migrate().unwrap();
        assert_eq!(db.pending_summary().unwrap(), (3, 2, 2));
        let mut changed = config.clone();
        changed.database_id = "new-database".into();
        assert_eq!(db.save_notion_config(&changed, false, None).unwrap(),
            SaveNotionConfigResult::ConfirmationRequired { pending_count: 3, pending_version: 2 });
    }

    #[test]
    fn legacy_toggle_coalesces_revision_without_bypassing_parent_verification() {
        let db = legacy_db();
        db.conn.lock().unwrap().execute_batch(
            "INSERT INTO tasks(id, notion_id, title, updated_time) VALUES('legacy-page', 'legacy-page', '旧页面', 1);
             INSERT INTO pending_ops(task_id, completed, created_at) VALUES('legacy-page', 1, 1);",
        ).unwrap();
        db.migrate().unwrap();
        let old = db.list_pending().unwrap().remove(0);
        assert!(!db.toggle_task("legacy-page").unwrap().completed);
        let latest = db.list_pending().unwrap().remove(0);
        assert_eq!(latest.id, old.id);
        assert_eq!(latest.revision, old.revision + 1);
        assert!(!latest.source_verified);
        let config = db.notion_context().unwrap().0;
        let mapping = NotionWriteMapping::from_config(&config);
        assert!(!db.bind_pending(old.id, old.revision, &config.database_id, "legacy-page", &mapping).unwrap());
        let mut wrong_mapping = mapping.clone();
        wrong_mapping.done_property = "different".into();
        assert!(!db.bind_pending(latest.id, latest.revision, &config.database_id, "legacy-page", &wrong_mapping).unwrap());
        assert!(db.bind_pending(latest.id, latest.revision, &config.database_id, "legacy-page", &mapping).unwrap());
        let bound = db.list_pending().unwrap().remove(0);
        assert!(bound.source_verified);
        assert!(!bound.completed);
        assert_eq!(db.pending_summary().unwrap().1, 0);
    }

    #[test]
    fn migration_repairs_interrupted_notion_local_rows_without_moving_legitimate_local_groups() {
        let db = legacy_db();
        db.conn.lock().unwrap().execute_batch(
            "INSERT INTO tasks(id, notion_id, title, completed, updated_time, group_id) VALUES
             ('interrupted', NULL, '中断迁移', 0, 1, 'notion'),
             ('interrupted-done', NULL, '中断已完成', 1, 1, 'notion'),
             ('legitimate', NULL, '正常本地任务', 0, 1, 'user-group'),
             ('legitimate-done', NULL, '正常本地完成', 1, 1, 'user-group'),
             ('remote', 'real-page', '远端完成', 1, 1, 'notion');",
        ).unwrap();
        db.migrate().unwrap();
        assert_eq!(db.get_task("interrupted").unwrap().unwrap().group_id, "demo-migrated");
        assert_eq!(db.get_task("legitimate").unwrap().unwrap().group_id, "user-group");
        assert_eq!(db.toggle_task("interrupted-done").unwrap().group_id, "demo-migrated");
        assert_eq!(db.toggle_task("legitimate-done").unwrap().group_id, "user-group");
        assert_eq!(db.get_task("remote").unwrap().unwrap().group_id, NOTION_GROUP_ID);
        let conn = db.conn.lock().unwrap();
        assert_eq!(conn.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0)).unwrap(), 3);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE name = 'sync_log'", [],
            |row| row.get::<_, i64>(0)).unwrap(), 0);
    }

    #[test]
    fn migration_rolls_back_schema_outbox_repair_and_versions_on_conversion_failure() {
        let db = legacy_db();
        db.conn.lock().unwrap().execute_batch(
            "INSERT INTO tasks(id, notion_id, title, completed, updated_time, group_id)
             VALUES('unfinished-migration', NULL, '应保持原状', 1, 1, 'notion');
             INSERT INTO pending_ops(task_id, completed, created_at) VALUES('missing', 1, 1);
             CREATE TEMP TRIGGER reject_archive_migration BEFORE UPDATE OF group_id ON tasks
             WHEN NEW.group_id = 'archive'
             BEGIN SELECT RAISE(ABORT, 'migration conversion failure'); END;",
        ).unwrap();
        assert!(db.migrate().is_err());
        {
            let conn = db.conn.lock().unwrap();
            assert_eq!(conn.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0)).unwrap(), 0);
            assert_eq!(conn.query_row("SELECT group_id FROM tasks WHERE id = 'unfinished-migration'", [],
                |row| row.get::<_, String>(0)).unwrap(), NOTION_GROUP_ID);
            for (table, column) in [("tasks", "archive_source_group_id"), ("pending_ops", "revision")] {
                let count: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
                    params![table, column], |row| row.get(0),
                ).unwrap();
                assert_eq!(count, 0);
            }
            assert_eq!(conn.query_row("SELECT COUNT(*) FROM pending_ops", [], |row| row.get::<_, i64>(0)).unwrap(), 1);
            assert_eq!(conn.query_row("SELECT COUNT(*) FROM sync_log", [], |row| row.get::<_, i64>(0)).unwrap(), 1);
            assert_eq!(conn.query_row("SELECT COUNT(*) FROM groups", [], |row| row.get::<_, i64>(0)).unwrap(), 1);
            assert!(Database::setting_on(&conn, "pending_version").unwrap().is_none());
            conn.execute_batch("DROP TRIGGER reject_archive_migration;").unwrap();
        }
        db.migrate().unwrap();
        assert_eq!(db.get_task("unfinished-migration").unwrap().unwrap().group_id, ARCHIVE_GROUP_ID);
        assert_eq!(db.pending_summary().unwrap(), (1, 1, 1));
    }

    #[test]
    fn seed_rolls_back_group_tasks_archive_and_flag_then_never_reseeds_after_user_clear() {
        let db = test_db();
        db.conn.lock().unwrap().execute_batch(
            "CREATE TEMP TRIGGER reject_seed BEFORE INSERT ON tasks WHEN NEW.id = 'local-2'
             BEGIN SELECT RAISE(ABORT, 'seed failure'); END;",
        ).unwrap();
        assert!(db.seed_mocks_if_empty().is_err());
        assert!(db.list_tasks().unwrap().is_empty());
        assert!(db.list_groups().unwrap().iter().all(|group| group.kind != "local"));
        assert!(db.get_setting("mocks_seeded").unwrap().is_none());
        db.conn.lock().unwrap().execute_batch("DROP TRIGGER reject_seed;").unwrap();
        db.seed_mocks_if_empty().unwrap();
        assert_eq!(db.get_setting("mocks_seeded").unwrap().as_deref(), Some("1"));
        db.clear_archive().unwrap();
        for group in db.list_groups().unwrap().into_iter().filter(|group| group.kind == "local") {
            db.delete_group(&group.id).unwrap();
        }
        assert!(db.list_tasks().unwrap().is_empty());
        db.seed_mocks_if_empty().unwrap();
        assert!(db.list_tasks().unwrap().is_empty());
        assert!(db.list_groups().unwrap().iter().all(|group| group.kind != "local"));
    }

    #[test]
    fn settings_snapshot_is_consistent_during_atomic_appearance_writes() {
        let db = std::sync::Arc::new(test_db());
        let palette = |value: &str| {
            let mut appearance = AppearanceSettings::from_settings(&AppSettings::default());
            appearance.theme = value.into();
            appearance.light_theme = value.into();
            appearance.dark_theme = value.into();
            appearance.note_bg = value.into();
            appearance.note_fg = value.into();
            appearance.note_accent = value.into();
            appearance.note_pop = value.into();
            appearance
        };
        db.save_appearance(&palette("initial")).unwrap();
        let writer_db = db.clone();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let writer_barrier = barrier.clone();
        let writer = std::thread::spawn(move || {
            writer_barrier.wait();
            for index in 0..100 {
                let value = if index % 2 == 0 { "light" } else { "dark" };
                writer_db.save_appearance(&palette(value)).unwrap();
            }
        });
        barrier.wait();
        for _ in 0..100 {
            let settings = db.load_settings().unwrap();
            assert_eq!(settings.note_bg, settings.note_fg);
            assert_eq!(settings.note_bg, settings.note_accent);
            assert_eq!(settings.note_bg, settings.note_pop);
            assert_eq!(settings.theme, settings.note_bg);
            assert_eq!(settings.light_theme, settings.note_bg);
            assert_eq!(settings.dark_theme, settings.note_bg);
        }
        writer.join().unwrap();
    }

    #[test]
    fn bound_outbox_target_is_unique_without_depending_on_task_foreign_keys() {
        let db = test_db();
        configure(&db);
        let remote = remote_task("unique-page");
        merge(&db, &[remote.clone()]);
        db.toggle_task(&remote.id).unwrap();
        let version = db.pending_summary().unwrap().2;
        let conn = db.conn.lock().unwrap();
        assert!(conn.execute(
            "INSERT INTO pending_ops(revision, task_id, completed, created_at, database_id, page_id, mapping, source_verified)
             SELECT 1, 'another-task', 0, 1, database_id, page_id, mapping, 1 FROM pending_ops",
            [],
        ).is_err());
        drop(conn);
        assert_eq!(db.pending_summary().unwrap(), (1, 0, version));
    }

    #[test]
    fn local_delete_group_delete_and_archive_clear_never_discard_unassociated_history() {
        let db = legacy_db();
        db.conn.lock().unwrap().execute_batch(
            "INSERT INTO tasks(id, notion_id, title, completed, updated_time, group_id) VALUES
             ('delete-local', NULL, '删除本地', 0, 1, 'user-group'),
             ('delete-group', NULL, '删除分组', 0, 1, 'user-group'),
             ('clear-archive', NULL, '清空归档', 1, 1, 'user-group');
             INSERT INTO pending_ops(task_id, completed, created_at) VALUES
             ('delete-local', 0, 1), ('delete-group', 0, 1), ('clear-archive', 1, 1);",
        ).unwrap();
        db.migrate().unwrap();
        let summary = db.pending_summary().unwrap();
        assert_eq!(summary, (3, 3, 1));
        db.delete_local_task("delete-local").unwrap();
        db.delete_group("user-group").unwrap();
        assert_eq!(db.clear_archive().unwrap(), vec!["clear-archive"]);
        assert!(db.list_tasks().unwrap().is_empty());
        assert_eq!(db.pending_summary().unwrap(), summary);
        assert!(db.list_pending().unwrap().iter().all(|op| op.page_id.is_none()));
    }

    #[test]
    fn appearance_snapshot_is_atomic_preserves_notion_and_skips_unchanged_writes() {
        let db = test_db();
        let config = configure(&db);
        let mut appearance = AppearanceSettings::from_settings(&db.load_settings().unwrap());
        assert!(!db.save_appearance(&appearance).unwrap());
        let changes = db.conn.lock().unwrap().total_changes();
        assert!(!db.save_appearance(&appearance).unwrap());
        assert_eq!(db.conn.lock().unwrap().total_changes(), changes);
        db.conn.lock().unwrap().execute_batch(
            "CREATE TEMP TRIGGER reject_palette BEFORE INSERT ON settings WHEN NEW.key = 'note_fg'
             BEGIN SELECT RAISE(ABORT, 'appearance failure'); END;",
        ).unwrap();
        appearance.theme = "glass".into();
        appearance.light_theme = "glass".into();
        appearance.note_bg = "#ffffff".into();
        appearance.note_fg = "#000000".into();
        assert!(db.save_appearance(&appearance).is_err());
        let settings = db.load_settings().unwrap();
        assert_eq!(settings.theme, "paper");
        assert_eq!(settings.light_theme, "paper");
        assert_eq!(settings.note_bg, AppSettings::default().note_bg);
        assert_eq!(settings.notion, config);
        db.conn.lock().unwrap().execute_batch("DROP TRIGGER reject_palette;").unwrap();
        assert!(db.save_appearance(&appearance).unwrap());
        assert_eq!(AppearanceSettings::from_settings(&db.load_settings().unwrap()), appearance);
        assert_eq!(db.load_settings().unwrap().notion, config);
    }

    #[test]
    fn window_state_v2_validates_roundtrips_and_reports_corruption() {
        use crate::window_state::{DockPhase, WindowRestore};
        let db = test_db();
        assert_eq!(db.load_window_state().unwrap(), None);
        let window = WindowStateV2 {
            version: 2, phase: DockPhase::Free, edge: None,
            restore: WindowRestore {
                x: -400, y: 30, width: 320.0, height: 500.0,
                monitor_id: Some("test-monitor".into()), saved_scale: 1.5,
            },
        };
        assert!(db.save_window_state(&window).unwrap());
        let changes = db.conn.lock().unwrap().total_changes();
        assert!(!db.save_window_state(&window).unwrap());
        assert_eq!(db.conn.lock().unwrap().total_changes(), changes);
        let mut invalid = window.clone();
        invalid.restore.width = 99.0;
        assert!(db.save_window_state(&invalid).is_err());
        assert_eq!(db.load_window_state().unwrap(), Some(window));
        db.set_setting("window_state_v2", "broken").unwrap();
        assert!(db.load_window_state().is_err());
        db.set_setting("window_state_v2", &serde_json::to_string(&invalid).unwrap()).unwrap();
        assert!(db.load_window_state().is_err());
    }

    fn window_fixture() -> (Vec<MonitorLayout>, WindowStateV2) {
        let monitors = vec![
            MonitorLayout {
                id: "primary".into(), work: monitors::WorkArea { x: 0, y: 40, w: 1920, h: 1040 },
                scale: 1.0, is_primary: true,
            },
            MonitorLayout {
                id: "left".into(), work: monitors::WorkArea { x: -2400, y: -200, w: 2400, h: 1600 },
                scale: 2.0, is_primary: false,
            },
        ];
        let fallback = WindowStateV2 {
            version: 2, phase: DockPhase::Free, edge: None,
            restore: WindowRestore {
                x: 100, y: 100, width: 320.0, height: 500.0,
                monitor_id: Some("primary".into()), saved_scale: 1.0,
            },
        };
        (monitors, fallback)
    }

    fn legacy_dock() -> &'static str {
        r#"{"phase":"collapsed","edge":"left","restoredX":-2000,"restoredY":0,"restoredWidth":640,"restoredHeight":1000}"#
    }

    #[test]
    fn window_migration_prefers_full_panel_position_and_existing_logical_size() {
        let db = test_db();
        let (monitors, fallback) = window_fixture();
        db.set_setting("edge_dock", legacy_dock()).unwrap();
        db.set_setting("window_geometry",
            r#"{"x":-3002,"y":0,"width":350.0,"height":550.0}"#).unwrap();
        let migrated = db.load_or_migrate_window_state(&monitors, &fallback).unwrap();
        assert_eq!((migrated.restore.x, migrated.restore.y), (-2000, 0));
        assert_eq!((migrated.restore.width, migrated.restore.height), (350.0, 550.0));
        assert_eq!(migrated.restore.monitor_id.as_deref(), Some("left"));
        assert_eq!(migrated.restore.saved_scale, 2.0);
        assert_eq!(migrated.phase, DockPhase::Collapsed);
        assert_eq!(migrated.edge, Some(DockEdge::Left));
        assert_eq!(db.load_window_state().unwrap(), Some(migrated));
        assert_eq!(db.get_setting("edge_dock").unwrap(), None);
        assert_eq!(db.get_setting("window_geometry").unwrap(), None);
    }

    #[test]
    fn window_migration_converts_dock_only_physical_size_at_target_dpi() {
        let (mut monitors, fallback) = window_fixture();
        for scale in [1.0, 1.5, 2.0] {
            let db = test_db();
            monitors[1].scale = scale;
            db.set_setting("edge_dock", legacy_dock()).unwrap();
            let migrated = db.load_or_migrate_window_state(&monitors, &fallback).unwrap();
            assert_eq!(migrated.restore.width, 640.0 / scale);
            assert_eq!(migrated.restore.height, 1000.0 / scale);
            assert_eq!(migrated.restore.saved_scale, scale);
        }
    }

    #[test]
    fn window_migration_free_geometry_and_fresh_fallback_are_normalized() {
        let db = test_db();
        let (monitors, mut fallback) = window_fixture();
        fallback.restore.x = i32::MAX;
        let fresh = db.load_or_migrate_window_state(&monitors, &fallback).unwrap();
        assert_eq!(fresh.restore.x, 1600);
        assert_eq!(db.load_window_state().unwrap(), Some(fresh.clone()));
        let changes = db.conn.lock().unwrap().total_changes();
        assert_eq!(db.load_or_migrate_window_state(&monitors, &fallback).unwrap(), fresh);
        assert_eq!(db.conn.lock().unwrap().total_changes(), changes);

        let db = test_db();
        db.set_setting("window_geometry",
            r#"{"x":-2200,"y":-100,"width":320.0,"height":500.0}"#).unwrap();
        db.set_setting("edge_dock",
            r#"{"phase":"free","edge":null,"restoredX":100,"restoredY":100,"restoredWidth":320,"restoredHeight":500}"#).unwrap();
        let migrated = db.load_or_migrate_window_state(&monitors, &fallback).unwrap();
        assert_eq!((migrated.restore.x, migrated.restore.y), (-2200, -100));
        assert_eq!((migrated.restore.width, migrated.restore.height), (320.0, 500.0));
        assert_eq!(migrated.phase, DockPhase::Free);
        assert_eq!(migrated.restore.saved_scale, 2.0);
    }

    #[test]
    fn window_migration_valid_v2_wins_over_legacy_and_invalid_fallback() {
        let db = test_db();
        let (monitors, mut fallback) = window_fixture();
        let mut saved = fallback.clone();
        saved.restore.x = -1000;
        saved.restore.monitor_id = Some("disconnected".into());
        saved.restore.saved_scale = 1.5;
        db.save_window_state(&saved).unwrap();
        db.set_setting("edge_dock", "corrupt obsolete data").unwrap();
        db.set_setting("window_geometry", "also obsolete").unwrap();
        fallback.version = 0;
        let migrated = db.load_or_migrate_window_state(&monitors, &fallback).unwrap();
        assert_eq!(migrated.restore.x, -1000);
        assert_eq!(migrated.restore.width, saved.restore.width);
        assert_eq!(migrated.restore.monitor_id.as_deref(), Some("left"));
        assert_eq!(migrated.restore.saved_scale, 2.0);
        assert_eq!(db.get_setting("edge_dock").unwrap(), None);
        assert_eq!(db.get_setting("window_geometry").unwrap(), None);
    }

    #[test]
    fn window_migration_write_and_delete_failures_roll_back_all_keys() {
        let (monitors, fallback) = window_fixture();
        for trigger in [
            "CREATE TRIGGER reject_window_insert BEFORE INSERT ON settings
             WHEN NEW.key = 'window_state_v2' BEGIN SELECT RAISE(ABORT, 'blocked insert'); END;",
            "CREATE TRIGGER reject_window_delete BEFORE DELETE ON settings
             WHEN OLD.key = 'edge_dock' BEGIN SELECT RAISE(ABORT, 'blocked delete'); END;",
        ] {
            let db = test_db();
            let geometry = r#"{"x":-3002,"y":0,"width":320.0,"height":500.0}"#;
            db.set_setting("edge_dock", legacy_dock()).unwrap();
            db.set_setting("window_geometry", geometry).unwrap();
            db.conn.lock().unwrap().execute_batch(trigger).unwrap();
            assert!(db.load_or_migrate_window_state(&monitors, &fallback).is_err());
            assert_eq!(db.get_setting("window_state_v2").unwrap(), None);
            assert_eq!(db.get_setting("edge_dock").unwrap().as_deref(), Some(legacy_dock()));
            assert_eq!(db.get_setting("window_geometry").unwrap().as_deref(), Some(geometry));
            db.conn.lock().unwrap().execute_batch(
                "DROP TRIGGER IF EXISTS reject_window_insert; DROP TRIGGER IF EXISTS reject_window_delete;").unwrap();
            assert!(db.load_or_migrate_window_state(&monitors, &fallback).is_ok());
        }
    }

    #[test]
    fn window_migration_reports_corruption_without_destroying_sources() {
        let (monitors, fallback) = window_fixture();
        for (key, raw) in [
            ("window_state_v2", "broken"),
            ("window_state_v2", r#"{"version":3,"phase":"free","edge":null,"restore":{"x":0,"y":0,"width":320,"height":500,"monitorId":null,"savedScale":1}}"#),
            ("window_geometry", r#"{"x":2147483648,"y":0,"width":320,"height":500}"#),
            ("window_geometry", r#"{"x":0,"y":0,"width":0,"height":500}"#),
            ("window_geometry", r#"{"x":0,"y":0,"width":320}"#),
            ("edge_dock", r#"{"phase":"collapsed","edge":null,"restoredX":0,"restoredY":0,"restoredWidth":640,"restoredHeight":1000}"#),
            ("edge_dock", r#"{"phase":"collapsed","edge":"left","restoredX":0,"restoredY":0,"restoredWidth":-1,"restoredHeight":1000}"#),
        ] {
            let db = test_db();
            db.set_setting("edge_dock", legacy_dock()).unwrap();
            db.set_setting(key, raw).unwrap();
            assert!(db.load_or_migrate_window_state(&monitors, &fallback).is_err(), "{key}: {raw}");
            assert_eq!(db.get_setting(key).unwrap().as_deref(), Some(raw));
            assert!(db.get_setting("edge_dock").unwrap().is_some());
            if key != "window_state_v2" {
                assert_eq!(db.get_setting("window_state_v2").unwrap(), None);
            }
        }
        let db = test_db();
        db.set_setting("edge_dock", legacy_dock()).unwrap();
        assert!(db.load_or_migrate_window_state(&[], &fallback).is_err());
        assert_eq!(db.get_setting("edge_dock").unwrap().as_deref(), Some(legacy_dock()));
        assert_eq!(db.load_window_state().unwrap(), None);
    }

    #[test]
    fn reorder_groups_persists_local_order_and_rejects_fixed_or_mismatched_ids() {
        let db = test_db();
        let a = db.create_group("A").unwrap();
        let b = db.create_group("B").unwrap();
        let c = db.create_group("C").unwrap();

        assert!(db.reorder_groups(vec![NOTION_GROUP_ID.into(), a.id.clone(), b.id.clone(), c.id.clone()]).is_err());
        assert!(db.reorder_groups(vec![a.id.clone(), b.id.clone()]).is_err());
        assert!(db.reorder_groups(vec![a.id.clone(), a.id.clone(), c.id.clone()]).is_err());

        let reordered = db.reorder_groups(vec![c.id.clone(), a.id.clone(), b.id.clone()]).unwrap();
        let ids: Vec<_> = reordered.iter().map(|g| g.id.as_str()).collect();
        assert_eq!(ids, vec![NOTION_GROUP_ID, c.id.as_str(), a.id.as_str(), b.id.as_str(), ARCHIVE_GROUP_ID]);
        let reloaded: Vec<_> = db.list_groups().unwrap().into_iter().map(|g| g.id).collect();
        assert_eq!(reloaded, vec![NOTION_GROUP_ID, &c.id, &a.id, &b.id, ARCHIVE_GROUP_ID]);
    }

    #[test]
    fn reorder_tasks_persists_order_appends_new_imports_and_rejects_fixed_groups() {
        let db = test_db();
        let g = db.create_group("Work").unwrap();
        let imported = db
            .import_local_tasks(vec!["One".into(), "Two".into(), "Three".into()], Some(&g.id), None)
            .unwrap()
            .tasks;
        let ids: Vec<_> = imported.iter().map(|t| t.id.clone()).collect();

        assert!(db.reorder_tasks(NOTION_GROUP_ID, vec![]).is_err());
        assert!(db.reorder_tasks(ARCHIVE_GROUP_ID, vec![]).is_err());
        assert!(db.reorder_tasks(&g.id, vec![ids[0].clone(), ids[1].clone()]).is_err());
        assert!(db.reorder_tasks(&g.id, vec![ids[0].clone(), ids[0].clone(), ids[2].clone()]).is_err());

        let tasks = db
            .reorder_tasks(&g.id, vec![ids[2].clone(), ids[0].clone(), ids[1].clone()])
            .unwrap();
        let ordered_titles: Vec<_> = tasks.iter().filter(|t| t.group_id == g.id).map(|t| t.title.as_str()).collect();
        assert_eq!(ordered_titles, vec!["Three", "One", "Two"]);

        let appended = db
            .import_local_tasks(vec!["Four".into()], Some(&g.id), None)
            .unwrap()
            .tasks;
        assert_eq!(appended[0].position, 4);
        let final_titles: Vec<_> = db
            .list_tasks()
            .unwrap()
            .into_iter()
            .filter(|t| t.group_id == g.id)
            .map(|t| t.title)
            .collect();
        assert_eq!(final_titles, vec!["Three", "One", "Two", "Four"]);
    }

    #[test]
    fn migrates_v1_database_without_position_column_preserving_tasks_and_groups() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE tasks (
                id TEXT PRIMARY KEY,
                notion_id TEXT,
                title TEXT NOT NULL,
                completed INTEGER NOT NULL DEFAULT 0,
                progress TEXT,
                remain TEXT,
                date TEXT,
                tags TEXT NOT NULL DEFAULT '[]',
                updated_time INTEGER NOT NULL,
                group_id TEXT NOT NULL DEFAULT 'notion',
                archive_source_group_id TEXT
             );
             CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
             );
             CREATE TABLE groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'local',
                position INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
             );
             CREATE TABLE pending_ops (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                revision INTEGER NOT NULL,
                task_id TEXT NOT NULL,
                completed INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                database_id TEXT,
                page_id TEXT,
                mapping TEXT,
                source_verified INTEGER NOT NULL DEFAULT 0,
                UNIQUE(database_id, page_id)
             );
             INSERT INTO groups(id, name, kind, position, created_at) VALUES
                ('notion', '来自 Notion', 'notion', 0, 100),
                ('g1', '待办', 'local', 1, 101),
                ('g2', 'MISC', 'local', 2, 102),
                ('archive', 'Archive', 'archive', 0, 103);
             INSERT INTO tasks(id, notion_id, title, completed, updated_time, group_id) VALUES
                ('n1', 'page-1', 'Notion task', 0, 200, 'notion'),
                ('t1', NULL, 'First', 0, 201, 'g1'),
                ('t2', NULL, 'Second', 0, 202, 'g1'),
                ('t3', NULL, 'Misc item', 0, 203, 'g2');
             PRAGMA user_version = 1;",
        ).unwrap();
        let db = Database { conn: Mutex::new(conn) };
        db.migrate().unwrap();

        assert_eq!(
            db.conn.lock().unwrap().query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0)).unwrap(),
            3
        );
        let view = db.task_view().unwrap();
        let group_ids: Vec<_> = view.groups.iter().map(|g| g.id.as_str()).collect();
        assert_eq!(group_ids, vec![NOTION_GROUP_ID, "g1", "g2", ARCHIVE_GROUP_ID]);
        let g1_tasks: Vec<_> = view.tasks.iter().filter(|t| t.group_id == "g1").collect();
        assert_eq!(g1_tasks.len(), 2);
        assert!(g1_tasks.iter().all(|t| t.position == 0));

        let reordered_tasks = db.reorder_tasks("g1", vec!["t1".into(), "t2".into()]).unwrap();
        let g1_titles: Vec<_> = reordered_tasks
            .iter()
            .filter(|t| t.group_id == "g1")
            .map(|t| t.title.as_str())
            .collect();
        assert_eq!(g1_titles, vec!["First", "Second"]);

        let reordered_groups = db.reorder_groups(vec!["g2".into(), "g1".into()]).unwrap();
        let reordered_group_ids: Vec<_> = reordered_groups.iter().map(|g| g.id.as_str()).collect();
        assert_eq!(reordered_group_ids, vec![NOTION_GROUP_ID, "g2", "g1", ARCHIVE_GROUP_ID]);

        // Newer schema versions (e.g. v4) must be rejected cleanly.
        db.conn.lock().unwrap().execute_batch("PRAGMA user_version = 4;").unwrap();
        assert!(db.migrate().is_err());
    }

    #[test]
    fn migrates_v2_database_backfilling_task_dates_and_supports_updates_and_reminders() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE tasks (
                id TEXT PRIMARY KEY,
                notion_id TEXT,
                title TEXT NOT NULL,
                completed INTEGER NOT NULL DEFAULT 0,
                progress TEXT,
                remain TEXT,
                date TEXT,
                tags TEXT NOT NULL DEFAULT '[]',
                updated_time INTEGER NOT NULL,
                group_id TEXT NOT NULL DEFAULT 'notion',
                archive_source_group_id TEXT,
                position INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'local',
                position INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
             );
             CREATE TABLE pending_ops (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                revision INTEGER NOT NULL,
                task_id TEXT NOT NULL,
                completed INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                database_id TEXT,
                page_id TEXT,
                mapping TEXT,
                source_verified INTEGER NOT NULL DEFAULT 0,
                UNIQUE(database_id, page_id)
             );
             INSERT INTO groups(id, name, kind, position, created_at) VALUES
                ('notion', '来自 Notion', 'notion', 0, 100),
                ('local', 'Plan', 'local', 1, 101),
                ('archive', 'Archive', 'archive', 0, 102);
             INSERT INTO tasks(id, notion_id, title, completed, date, updated_time, group_id, position) VALUES
                ('single', NULL, 'Single day', 0, '2026-11-24', 200, 'local', 1),
                ('span', NULL, 'Multi day', 0, '2026-11-24 → 2026-11-27', 201, 'local', 2);
             PRAGMA user_version = 2;",
        ).unwrap();
        let db = Database { conn: Mutex::new(conn) };
        db.migrate().unwrap();

        assert_eq!(
            db.conn.lock().unwrap().query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0)).unwrap(),
            3
        );
        let single = db.get_task("single").unwrap().unwrap();
        assert_eq!(single.start_date.as_deref(), Some("2026-11-24"));
        assert_eq!(single.end_date, None);
        let span = db.get_task("span").unwrap().unwrap();
        assert_eq!(span.start_date.as_deref(), Some("2026-11-24"));
        assert_eq!(span.end_date.as_deref(), Some("2026-11-27"));

        // Invalid range is rejected cleanly.
        assert!(db.update_local_task("single", TaskUpdateInput {
            update_schedule: true,
            start_date: Some("2026-11-26".into()),
            end_date: Some("2026-11-24".into()),
            ..Default::default()
        }).is_err());

        // Set timed schedule + due reminder, then mark reminded and re-arm.
        let updated = db.update_local_task("single", TaskUpdateInput {
            title: Some("Single day updated".into()),
            group_id: None,
            update_schedule: true,
            start_date: Some("2026-11-24".into()),
            end_date: None,
            start_time: Some("11:00".into()),
            end_time: Some("15:00".into()),
            reminder_at: Some(1_000),
        }).unwrap();
        assert_eq!(updated.date.as_deref(), Some("2026-11-24 11:00–15:00"));
        assert_eq!(db.due_reminders(1_500).unwrap().len(), 1);
        assert!(db.mark_reminded("single", 1_500).unwrap());
        assert!(!db.mark_reminded("single", 1_600).unwrap());
        assert!(db.due_reminders(2_000).unwrap().is_empty());

        // Updating reminder timestamp clears reminded_at so it fires again at the new time.
        let rearmed = db.update_local_task("single", TaskUpdateInput {
            update_schedule: true,
            start_date: Some("2026-11-24".into()),
            start_time: Some("11:00".into()),
            end_time: Some("15:00".into()),
            reminder_at: Some(3_000),
            ..Default::default()
        }).unwrap();
        assert_eq!(rearmed.reminded_at, None);
        assert_eq!(db.due_reminders(3_000).unwrap().len(), 1);

        // Completed tasks must not fire reminders.
        db.toggle_task("single").unwrap();
        assert!(db.due_reminders(4_000).unwrap().is_empty());

        // Cross-group move succeeds between local groups and rejects fixed groups.
        let second_group = db.create_group("Second").unwrap();
        assert!(db.update_local_task("span", TaskUpdateInput {
            group_id: Some(NOTION_GROUP_ID.into()),
            ..Default::default()
        }).is_err());
        let moved = db.update_local_task("span", TaskUpdateInput {
            group_id: Some(second_group.id.clone()),
            ..Default::default()
        }).unwrap();
        assert_eq!(moved.group_id, second_group.id);
    }

    #[test]
    fn window_mode_defaults_to_workspace_and_workspace_geometry_roundtrips() {
        let db = test_db();
        assert_eq!(db.load_window_mode().unwrap(), WindowMode::Workspace);
        db.save_window_mode(WindowMode::Sticky).unwrap();
        assert_eq!(db.load_window_mode().unwrap(), WindowMode::Sticky);

        assert!(db.load_workspace_geometry().unwrap().is_none());
        let invalid = WorkspaceGeometry {
            x: 0,
            y: 0,
            width: 300.0,
            height: 200.0,
            maximized: false,
            monitor_id: None,
            saved_scale: 1.0,
        };
        assert!(db.save_workspace_geometry(&invalid).is_err());

        let valid = WorkspaceGeometry {
            x: 120,
            y: 80,
            width: 1160.0,
            height: 760.0,
            maximized: true,
            monitor_id: Some("DISPLAY1".into()),
            saved_scale: 1.25,
        };
        assert!(db.save_workspace_geometry(&valid).unwrap());
        assert!(!db.save_workspace_geometry(&valid).unwrap());
        assert_eq!(db.load_workspace_geometry().unwrap(), Some(valid));

        assert!(!db.load_always_on_top().unwrap());
        db.save_always_on_top(true).unwrap();
        assert!(db.load_always_on_top().unwrap());
        db.save_always_on_top(false).unwrap();
        assert!(!db.load_always_on_top().unwrap());
    }
}
