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
}

fn default_date_property() -> String {
    "Date".into()
}

impl Default for NotionConfig {
    fn default() -> Self {
        Self {
            token: String::new(),
            database_id: String::new(),
            done_property: "done?".into(),
            title_property: "Name".into(),
            date_property: "Date".into(),
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
    pub notion: NotionConfig,
}

fn default_font() -> String {
    "hand".into()
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
            notion: NotionConfig::default(),
        }
    }
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
