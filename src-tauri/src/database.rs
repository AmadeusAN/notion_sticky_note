use crate::models::{AppSettings, NotionConfig, Task};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
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
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS tasks (
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

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sync_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                at INTEGER NOT NULL,
                message TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS pending_ops (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                completed INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );
            "#,
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO settings(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load_settings(&self) -> Result<AppSettings, String> {
        let mut settings = AppSettings::default();
        if let Some(theme) = self.get_setting("theme")? {
            settings.theme = theme;
        }
        if let Some(light_theme) = self.get_setting("light_theme")? {
            settings.light_theme = light_theme;
        } else {
            // Migrate older installs that only stored a single theme.
            settings.light_theme = match settings.theme.as_str() {
                "dark" | "notionDark" | "cardInk" | "inkMotion" => "paper".into(),
                other => other.to_string(),
            };
        }
        if let Some(dark_theme) = self.get_setting("dark_theme")? {
            settings.dark_theme = dark_theme;
        } else {
            settings.dark_theme = match settings.theme.as_str() {
                "dark" | "notionDark" | "cardInk" | "inkMotion" => settings.theme.clone(),
                _ => "dark".into(),
            };
        }
        if let Some(font) = self.get_setting("font")? {
            settings.font = font;
        }
        if let Some(fx_theme) = self.get_setting("fx_theme")? {
            settings.fx_theme = fx_theme;
        }
        if let Some(dock_handle) = self.get_setting("dock_handle")? {
            settings.dock_handle = dock_handle;
        }
        if let Some(raw) = self.get_setting("notion")? {
            if let Ok(cfg) = serde_json::from_str::<NotionConfig>(&raw) {
                settings.notion = cfg;
            }
        }
        Ok(settings)
    }

    pub fn save_notion_config(&self, config: &NotionConfig) -> Result<(), String> {
        let raw = serde_json::to_string(config).map_err(|e| e.to_string())?;
        self.set_setting("notion", &raw)
    }

    pub fn set_theme(&self, theme: &str) -> Result<(), String> {
        self.set_setting("theme", theme)
    }

    pub fn set_light_theme(&self, theme: &str) -> Result<(), String> {
        self.set_setting("light_theme", theme)
    }

    pub fn set_dark_theme(&self, theme: &str) -> Result<(), String> {
        self.set_setting("dark_theme", theme)
    }

    pub fn set_font(&self, font: &str) -> Result<(), String> {
        self.set_setting("font", font)
    }

    pub fn set_fx_theme(&self, theme: &str) -> Result<(), String> {
        self.set_setting("fx_theme", theme)
    }

    pub fn set_dock_handle(&self, handle: &str) -> Result<(), String> {
        self.set_setting("dock_handle", handle)
    }

    pub fn list_tasks(&self) -> Result<Vec<Task>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, notion_id, title, completed, progress, remain, date, tags, updated_time
                 FROM tasks ORDER BY completed ASC, updated_time DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let tags_raw: String = row.get(7)?;
                let tags: Vec<String> = serde_json::from_str(&tags_raw).unwrap_or_default();
                Ok(Task {
                    id: row.get(0)?,
                    notion_id: row.get(1)?,
                    title: row.get(2)?,
                    completed: row.get::<_, i64>(3)? != 0,
                    progress: row.get(4)?,
                    remain: row.get(5)?,
                    date: row.get(6)?,
                    tags,
                    updated_time: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut tasks = Vec::new();
        for row in rows {
            tasks.push(row.map_err(|e| e.to_string())?);
        }
        Ok(tasks)
    }

    pub fn upsert_task(&self, task: &Task) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tags = serde_json::to_string(&task.tags).unwrap_or_else(|_| "[]".into());
        conn.execute(
            "INSERT INTO tasks(id, notion_id, title, completed, progress, remain, date, tags, updated_time)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
               notion_id=excluded.notion_id,
               title=excluded.title,
               completed=excluded.completed,
               progress=excluded.progress,
               remain=excluded.remain,
               date=excluded.date,
               tags=excluded.tags,
               updated_time=excluded.updated_time",
            params![
                task.id,
                task.notion_id,
                task.title,
                if task.completed { 1 } else { 0 },
                task.progress,
                task.remain,
                task.date,
                tags,
                task.updated_time
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn replace_tasks(&self, tasks: &[Task]) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM tasks", []).map_err(|e| e.to_string())?;
        for task in tasks {
            let tags = serde_json::to_string(&task.tags).unwrap_or_else(|_| "[]".into());
            tx.execute(
                "INSERT INTO tasks(id, notion_id, title, completed, progress, remain, date, tags, updated_time)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    task.id,
                    task.notion_id,
                    task.title,
                    if task.completed { 1 } else { 0 },
                    task.progress,
                    task.remain,
                    task.date,
                    tags,
                    task.updated_time
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_task(&self, id: &str) -> Result<Option<Task>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id, notion_id, title, completed, progress, remain, date, tags, updated_time
             FROM tasks WHERE id = ?1",
            params![id],
            |row| {
                let tags_raw: String = row.get(7)?;
                let tags: Vec<String> = serde_json::from_str(&tags_raw).unwrap_or_default();
                Ok(Task {
                    id: row.get(0)?,
                    notion_id: row.get(1)?,
                    title: row.get(2)?,
                    completed: row.get::<_, i64>(3)? != 0,
                    progress: row.get(4)?,
                    remain: row.get(5)?,
                    date: row.get(6)?,
                    tags,
                    updated_time: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    pub fn seed_mocks_if_empty(&self) -> Result<(), String> {
        let tasks = self.list_tasks()?;
        if tasks.is_empty() {
            for task in crate::models::mock_tasks() {
                self.upsert_task(&task)?;
            }
        }
        Ok(())
    }

    pub fn enqueue_pending(&self, task_id: &str, completed: bool) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO pending_ops(task_id, completed, created_at) VALUES(?1, ?2, ?3)",
            params![
                task_id,
                if completed { 1 } else { 0 },
                chrono::Utc::now().timestamp_millis()
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_pending(&self) -> Result<Vec<(i64, String, bool)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, task_id, completed FROM pending_ops ORDER BY id ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)? != 0,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn clear_pending(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM pending_ops WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn log_sync(&self, message: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO sync_log(at, message) VALUES(?1, ?2)",
            params![chrono::Utc::now().timestamp_millis(), message],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}
