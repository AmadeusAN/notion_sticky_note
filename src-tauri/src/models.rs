use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub notion_id: Option<String>,
    pub title: String,
    pub completed: bool,
    pub progress: Option<String>,
    pub remain: Option<String>,
    pub date: Option<String>,
    pub tags: Vec<String>,
    pub updated_time: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionConfig {
    pub token: String,
    pub database_id: String,
    pub done_property: String,
    pub title_property: String,
    #[serde(default = "default_date_property")]
    pub date_property: String,
    /// Notion Status (or Select) property to mirror when toggling done. Empty = skip.
    #[serde(default = "default_status_property")]
    pub status_property: String,
    #[serde(default = "default_status_done_value")]
    pub status_done_value: String,
    #[serde(default = "default_status_todo_value")]
    pub status_todo_value: String,
}

fn default_date_property() -> String {
    "Date".into()
}

fn default_status_property() -> String {
    "Status".into()
}

fn default_status_done_value() -> String {
    "Done".into()
}

fn default_status_todo_value() -> String {
    "Not started".into()
}

impl Default for NotionConfig {
    fn default() -> Self {
        Self {
            token: String::new(),
            database_id: String::new(),
            done_property: "done?".into(),
            title_property: "Name".into(),
            date_property: "Date".into(),
            status_property: default_status_property(),
            status_done_value: default_status_done_value(),
            status_todo_value: default_status_todo_value(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: String,
    #[serde(default = "default_light_theme")]
    pub light_theme: String,
    #[serde(default = "default_dark_theme")]
    pub dark_theme: String,
    #[serde(default = "default_font")]
    pub font: String,
    #[serde(default = "default_fx_theme")]
    pub fx_theme: String,
    #[serde(default = "default_fx_intensity")]
    pub fx_intensity: f64,
    #[serde(default = "default_fx_edge_boost")]
    pub fx_edge_boost: bool,
    #[serde(default = "default_note_bg")]
    pub note_bg: String,
    #[serde(default = "default_note_fg")]
    pub note_fg: String,
    #[serde(default = "default_note_accent")]
    pub note_accent: String,
    #[serde(default = "default_note_pop")]
    pub note_pop: String,
    #[serde(default = "default_dock_handle")]
    pub dock_handle: String,
    pub notion: NotionConfig,
}

fn default_font() -> String {
    "hand".into()
}

fn default_fx_theme() -> String {
    "leaf".into()
}

fn default_fx_intensity() -> f64 {
    1.0
}

fn default_fx_edge_boost() -> bool {
    true
}

fn default_note_bg() -> String {
    "#f6f0df".into()
}

fn default_note_fg() -> String {
    "#3a3226".into()
}

fn default_note_accent() -> String {
    "#c4a35a".into()
}

fn default_note_pop() -> String {
    "#e8a87c".into()
}

fn default_dock_handle() -> String {
    "grip".into()
}

fn default_light_theme() -> String {
    "paper".into()
}

fn default_dark_theme() -> String {
    "dark".into()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "paper".into(),
            light_theme: default_light_theme(),
            dark_theme: default_dark_theme(),
            font: "hand".into(),
            fx_theme: default_fx_theme(),
            fx_intensity: default_fx_intensity(),
            fx_edge_boost: default_fx_edge_boost(),
            note_bg: default_note_bg(),
            note_fg: default_note_fg(),
            note_accent: default_note_accent(),
            note_pop: default_note_pop(),
            dock_handle: default_dock_handle(),
            notion: NotionConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FxAppearancePayload {
    pub bg: String,
    pub fg: String,
    pub accent: String,
    pub pop: String,
    pub intensity: f64,
    pub edge_boost: bool,
}

pub fn mock_tasks() -> Vec<Task> {
    let now = chrono::Utc::now().timestamp_millis();
    vec![
        Task {
            id: "local-1".into(),
            notion_id: None,
            title: "调研左心耳模型升级方案".into(),
            completed: false,
            progress: Some("30%".into()),
            remain: Some("2d".into()),
            date: Some("2026-07-22".into()),
            tags: vec!["research".into()],
            updated_time: now,
        },
        Task {
            id: "local-2".into(),
            notion_id: None,
            title: "整理 Notion Database 字段映射".into(),
            completed: true,
            progress: Some("100%".into()),
            remain: Some("0d".into()),
            date: Some("2026-07-18".into()),
            tags: vec!["setup".into()],
            updated_time: now,
        },
        Task {
            id: "local-3".into(),
            notion_id: None,
            title: "完善便签纸张纹理与阴影".into(),
            completed: false,
            progress: Some("60%".into()),
            remain: Some("1d".into()),
            date: None,
            tags: vec!["ui".into()],
            updated_time: now,
        },
    ]
}
