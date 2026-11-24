use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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
    /// Owning group id. Synced Notion rows live in the pinned `notion` group.
    #[serde(default = "notion_group_id")]
    pub group_id: String,
    #[serde(default)]
    pub position: i64,
}

/// Pinned group id that receives every row synced from Notion.
pub const NOTION_GROUP_ID: &str = "notion";
pub const ARCHIVE_GROUP_ID: &str = "archive";

fn notion_group_id() -> String {
    NOTION_GROUP_ID.into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
    /// `"notion"` and `"archive"` are fixed groups; `"local"` groups are user-owned.
    pub kind: String,
    pub position: i64,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskImportResult {
    pub group: Group,
    pub tasks: Vec<Task>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskView {
    pub tasks: Vec<Task>,
    pub groups: Vec<Group>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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

impl NotionConfig {
    pub fn is_configured(&self) -> bool {
        !self.token.trim().is_empty() && !self.database_id.trim().is_empty()
    }
}

/// Durable write context. Authentication deliberately stays outside the outbox.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotionWriteMapping {
    pub done_property: String,
    pub status_property: String,
    pub status_done_value: String,
    pub status_todo_value: String,
}

impl NotionWriteMapping {
    pub fn from_config(config: &NotionConfig) -> Self {
        Self {
            done_property: if config.done_property.trim().is_empty() {
                "done?".into()
            } else {
                config.done_property.trim().into()
            },
            status_property: config.status_property.trim().into(),
            status_done_value: config.status_done_value.trim().into(),
            status_todo_value: config.status_todo_value.trim().into(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingOp {
    pub id: i64,
    pub revision: i64,
    pub task_id: String,
    pub completed: bool,
    pub created_at: i64,
    pub database_id: Option<String>,
    pub page_id: Option<String>,
    pub mapping: Option<NotionWriteMapping>,
    pub source_verified: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SaveNotionConfigResult {
    Saved,
    ConfirmationRequired {
        #[serde(rename = "pendingCount")]
        pending_count: usize,
        #[serde(rename = "pendingVersion")]
        pending_version: u64,
    },
}

/// UUID spelling is not part of a Notion database/page identity.
pub fn normalize_notion_id(value: &str) -> String {
    let value = value.trim();
    if value.bytes().filter(|byte| *byte != b'-').count() == 32
        && value.bytes().all(|byte| byte == b'-' || byte.is_ascii_hexdigit()) {
        let mut normalized = String::with_capacity(32);
        for byte in value.bytes().filter(|byte| *byte != b'-') {
            normalized.push(byte.to_ascii_lowercase() as char);
        }
        normalized
    } else {
        value.to_string()
    }
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    pub theme: String,
    pub light_theme: String,
    pub dark_theme: String,
    pub font: String,
    pub fx_theme: String,
    pub fx_intensity: f64,
    pub fx_edge_boost: bool,
    pub dock_handle: String,
    pub note_bg: String,
    pub note_fg: String,
    pub note_accent: String,
    pub note_pop: String,
}

impl AppearanceSettings {
    pub fn from_settings(settings: &AppSettings) -> Self {
        Self {
            theme: settings.theme.clone(),
            light_theme: settings.light_theme.clone(),
            dark_theme: settings.dark_theme.clone(),
            font: settings.font.clone(),
            fx_theme: settings.fx_theme.clone(),
            fx_intensity: settings.fx_intensity,
            fx_edge_boost: settings.fx_edge_boost,
            dock_handle: settings.dock_handle.clone(),
            note_bg: settings.note_bg.clone(),
            note_fg: settings.note_fg.clone(),
            note_accent: settings.note_accent.clone(),
            note_pop: settings.note_pop.clone(),
        }
    }

    pub fn apply_to(&self, settings: &mut AppSettings) {
        settings.theme.clone_from(&self.theme);
        settings.light_theme.clone_from(&self.light_theme);
        settings.dark_theme.clone_from(&self.dark_theme);
        settings.font.clone_from(&self.font);
        settings.fx_theme.clone_from(&self.fx_theme);
        settings.fx_intensity = self.fx_intensity;
        settings.fx_edge_boost = self.fx_edge_boost;
        settings.dock_handle.clone_from(&self.dock_handle);
        settings.note_bg.clone_from(&self.note_bg);
        settings.note_fg.clone_from(&self.note_fg);
        settings.note_accent.clone_from(&self.note_accent);
        settings.note_pop.clone_from(&self.note_pop);
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppearanceSaveStatus {
    Saving,
    Saved,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSaveState {
    pub revision: u64,
    pub status: AppearanceSaveStatus,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSnapshot {
    pub settings: AppSettings,
    pub appearance_save_state: AppearanceSaveState,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FxPreferences {
    pub theme: String,
    pub appearance: FxAppearancePayload,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ExitSaveStatus {
    #[default]
    Idle,
    Saving,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExitSaveState {
    pub revision: u64,
    pub status: ExitSaveStatus,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
            title: crate::language::text("Plan this week's tasks", "规划本周任务").into(),
            completed: false,
            progress: Some("30%".into()),
            remain: Some("2d".into()),
            date: Some("2026-07-22".into()),
            tags: vec!["research".into()],
            updated_time: now,
            group_id: NOTION_GROUP_ID.into(),
            position: 0,
        },
        Task {
            id: "local-2".into(),
            notion_id: None,
            title: crate::language::text("Review the sample checklist", "查看示例清单").into(),
            completed: true,
            progress: Some("100%".into()),
            remain: Some("0d".into()),
            date: Some("2026-07-18".into()),
            tags: vec!["setup".into()],
            updated_time: now,
            group_id: NOTION_GROUP_ID.into(),
            position: 0,
        },
        Task {
            id: "local-3".into(),
            notion_id: None,
            title: crate::language::text("Review project notes", "整理项目笔记").into(),
            completed: false,
            progress: Some("60%".into()),
            remain: Some("1d".into()),
            date: None,
            tags: vec!["ui".into()],
            updated_time: now,
            group_id: NOTION_GROUP_ID.into(),
            position: 0,
        },
    ]
}
