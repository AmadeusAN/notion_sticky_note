use crate::models::{NotionConfig, Task};
use serde_json::{json, Value};

const NOTION_VERSION: &str = "2022-06-28";
/// How far back (by start date) to look for unfinished multi-day tasks.
/// Notion cannot filter by range end, so we bound start-date lookback instead of
/// pulling every historical row with start ≤ today.
const DATE_LOOKBACK_DAYS: i64 = 60;

#[derive(Clone)]
pub struct NotionClient {
    http: reqwest::Client,
}

impl NotionClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::new(),
        }
    }

    fn headers(&self, token: &str) -> Result<reqwest::header::HeaderMap, String> {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {token}")
                .parse()
                .map_err(|e: reqwest::header::InvalidHeaderValue| e.to_string())?,
        );
        headers.insert(
            reqwest::header::CONTENT_TYPE,
            "application/json"
                .parse()
                .map_err(|e: reqwest::header::InvalidHeaderValue| e.to_string())?,
        );
        headers.insert(
            "Notion-Version",
            NOTION_VERSION
                .parse()
                .map_err(|e: reqwest::header::InvalidHeaderValue| e.to_string())?,
        );
        Ok(headers)
    }

    pub async fn test_connection(&self, config: &NotionConfig) -> Result<String, String> {
        if config.token.trim().is_empty() || config.database_id.trim().is_empty() {
            return Err("Token 与 Database ID 不能为空".into());
        }
        let url = format!(
            "https://api.notion.com/v1/databases/{}",
            config.database_id.trim()
        );
        let res = self
            .http
            .get(&url)
            .headers(self.headers(&config.token)?)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(format!("Notion 连接失败 ({status}): {body}"));
        }
        Ok("Notion 连接成功".into())
    }

    pub async fn query_tasks(&self, config: &NotionConfig) -> Result<Vec<Task>, String> {
        if config.token.trim().is_empty() || config.database_id.trim().is_empty() {
            return Err("Notion 未配置".into());
        }

        let today = chrono::Local::now().date_naive();
        let today_str = today.format("%Y-%m-%d").to_string();
        let lookback_str = (today - chrono::Duration::days(DATE_LOOKBACK_DAYS))
            .format("%Y-%m-%d")
            .to_string();
        let date_prop = if config.date_property.trim().is_empty() {
            "Date".to_string()
        } else {
            config.date_property.trim().to_string()
        };
        let done_prop = if config.done_property.trim().is_empty() {
            "done?".to_string()
        } else {
            config.done_property.trim().to_string()
        };

        let url = format!(
            "https://api.notion.com/v1/databases/{}/query",
            config.database_id.trim()
        );
        let mut results = Vec::new();
        let mut cursor: Option<String> = None;

        // Notion date filters only see the *start* of a range, so we cannot ask
        // "range contains today" directly. Instead:
        // 1) date equals today — single-day / starting today (incl. completed)
        // 2) unfinished + start in [lookback, today] — multi-day spans still open
        // Then keep rows whose [start, end] actually covers today.
        let filter = json!({
            "or": [
                {
                    "property": date_prop,
                    "date": { "equals": today_str }
                },
                {
                    "and": [
                        {
                            "property": done_prop,
                            "checkbox": { "equals": false }
                        },
                        {
                            "property": date_prop,
                            "date": { "on_or_before": today_str }
                        },
                        {
                            "property": date_prop,
                            "date": { "on_or_after": lookback_str }
                        }
                    ]
                }
            ]
        });

        loop {
            let mut body = json!({
                "page_size": 100,
                "filter": filter
            });
            if let Some(c) = &cursor {
                body["start_cursor"] = json!(c);
            }

            let res = self
                .http
                .post(&url)
                .headers(self.headers(&config.token)?)
                .json(&body)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if !res.status().is_success() {
                let status = res.status();
                let text = res.text().await.unwrap_or_default();
                return Err(format!("Query failed ({status}): {text}"));
            }

            let payload: Value = res.json().await.map_err(|e| e.to_string())?;
            if let Some(arr) = payload.get("results").and_then(|v| v.as_array()) {
                for page in arr {
                    if !page_date_covers_today(page, config, &today_str) {
                        continue;
                    }
                    if let Some(task) = parse_page(page, config) {
                        results.push(task);
                    }
                }
            }

            let has_more = payload
                .get("has_more")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if !has_more {
                break;
            }
            cursor = payload
                .get("next_cursor")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            if cursor.is_none() {
                break;
            }
        }

        Ok(results)
    }

    pub async fn set_done(
        &self,
        config: &NotionConfig,
        page_id: &str,
        completed: bool,
    ) -> Result<(), String> {
        let url = format!("https://api.notion.com/v1/pages/{page_id}");
        let done_prop = if config.done_property.trim().is_empty() {
            "done?".to_string()
        } else {
            config.done_property.trim().to_string()
        };

        let mut properties = json!({
            done_prop.clone(): {
                "checkbox": completed
            }
        });

        // Mirror Notion Button automation: also set Status when configured.
        let status_prop = config.status_property.trim();
        if !status_prop.is_empty() {
            let status_name = if completed {
                config.status_done_value.trim()
            } else {
                config.status_todo_value.trim()
            };
            if !status_name.is_empty() {
                properties[status_prop] = json!({
                    "status": { "name": status_name }
                });
            }
        }

        let body = json!({ "properties": properties });
        let res = self
            .http
            .patch(&url)
            .headers(self.headers(&config.token)?)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            // Status property may actually be Select in some databases.
            if !status_prop.is_empty() && text.to_lowercase().contains("select") {
                return self
                    .set_done_with_select_status(config, page_id, completed, &done_prop)
                    .await;
            }
            return Err(format!("Update failed ({status}): {text}"));
        }
        Ok(())
    }

    async fn set_done_with_select_status(
        &self,
        config: &NotionConfig,
        page_id: &str,
        completed: bool,
        done_prop: &str,
    ) -> Result<(), String> {
        let url = format!("https://api.notion.com/v1/pages/{page_id}");
        let status_prop = config.status_property.trim();
        let status_name = if completed {
            config.status_done_value.trim()
        } else {
            config.status_todo_value.trim()
        };
        let body = json!({
            "properties": {
                done_prop: { "checkbox": completed },
                status_prop: { "select": { "name": status_name } }
            }
        });
        let res = self
            .http
            .patch(&url)
            .headers(self.headers(&config.token)?)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            return Err(format!("Update failed ({status}): {text}"));
        }
        Ok(())
    }
}

fn parse_page(page: &Value, config: &NotionConfig) -> Option<Task> {
    let id = page.get("id")?.as_str()?.to_string();
    let props = page.get("properties")?;
    let title = extract_title(props.get(&config.title_property))
        .or_else(|| extract_any_title(props))
        .unwrap_or_else(|| "(untitled)".into());
    let completed = props
        .get(&config.done_property)
        .and_then(|p| p.get("checkbox"))
        .and_then(|v| v.as_bool())
        .or_else(|| {
            ["done?", "done", "Done", "完成", "Completed"]
                .iter()
                .find_map(|name| {
                    props
                        .get(*name)
                        .and_then(|p| p.get("checkbox"))
                        .and_then(|v| v.as_bool())
                })
        })
        .unwrap_or(false);

    let progress = extract_rich_or_number(
        props,
        &[
            "progress line",
            "progress",
            "Progress",
            "进度",
        ],
    );
    let remain = extract_rich_or_number(props, &["remain", "Remain", "剩余", "Remaining"]);
    let date_names = date_property_names(config);
    let date = extract_date_range(props, &date_names).map(|(start, end)| match end {
        Some(end) if end != start => format!("{start} → {end}"),
        _ => start,
    });
    let tags = extract_multi_select(props, &["tags", "Tags", "标签"]);

    let updated = page
        .get("last_edited_time")
        .and_then(|v| v.as_str())
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.timestamp_millis())
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

    Some(Task {
        id: id.clone(),
        notion_id: Some(id),
        title,
        completed,
        progress,
        remain,
        date,
        tags,
        updated_time: updated,
    })
}

fn extract_title(prop: Option<&Value>) -> Option<String> {
    let arr = prop?.get("title")?.as_array()?;
    let mut out = String::new();
    for item in arr {
        if let Some(t) = item.get("plain_text").and_then(|v| v.as_str()) {
            out.push_str(t);
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn extract_any_title(props: &Value) -> Option<String> {
    let obj = props.as_object()?;
    for (_k, v) in obj {
        if v.get("type").and_then(|t| t.as_str()) == Some("title") {
            return extract_title(Some(v));
        }
    }
    None
}

fn extract_rich_or_number(props: &Value, names: &[&str]) -> Option<String> {
    for name in names {
        if let Some(prop) = props.get(*name) {
            if let Some(arr) = prop.get("rich_text").and_then(|v| v.as_array()) {
                let mut out = String::new();
                for item in arr {
                    if let Some(t) = item.get("plain_text").and_then(|v| v.as_str()) {
                        out.push_str(t);
                    }
                }
                if !out.is_empty() {
                    return Some(out);
                }
            }
            if let Some(n) = prop.get("number").and_then(|v| v.as_f64()) {
                if n <= 1.0 {
                    return Some(format!("{:.0}%", n * 100.0));
                }
                return Some(n.to_string());
            }
            if let Some(s) = prop.get("select").and_then(|v| v.get("name")).and_then(|v| v.as_str())
            {
                return Some(s.to_string());
            }
            if let Some(s) = prop.get("formula").and_then(|v| {
                v.get("string")
                    .and_then(|x| x.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| v.get("number").and_then(|x| x.as_f64()).map(|n| n.to_string()))
            }) {
                return Some(s);
            }
        }
    }
    None
}

/// Returns `(start, end)` truncated to `YYYY-MM-DD`. `end` is `None` for single-day dates.
fn extract_date_range(props: &Value, names: &[&str]) -> Option<(String, Option<String>)> {
    for name in names {
        if name.is_empty() {
            continue;
        }
        let Some(date) = props.get(*name).and_then(|p| p.get("date")) else {
            continue;
        };
        // Notion may return "2026-07-20" or "2026-07-20T00:00:00.000+08:00"
        let Some(start) = date.get("start").and_then(|v| v.as_str()) else {
            continue;
        };
        let start = start.chars().take(10).collect::<String>();
        let end = date
            .get("end")
            .and_then(|v| v.as_str())
            .map(|s| s.chars().take(10).collect::<String>());
        return Some((start, end));
    }
    None
}

fn date_property_names(config: &NotionConfig) -> Vec<&str> {
    let mut names = vec![config.date_property.as_str()];
    names.extend(["Date", "date", "日期", "Deadline"]);
    names
}

/// True when today is within `[start, end]` (inclusive). Missing end ⇒ single-day task.
fn date_covers_today(start: &str, end: Option<&str>, today: &str) -> bool {
    let end = end.unwrap_or(start);
    start <= today && today <= end
}

fn page_date_covers_today(page: &Value, config: &NotionConfig, today: &str) -> bool {
    let Some(props) = page.get("properties") else {
        return false;
    };
    let names = date_property_names(config);
    match extract_date_range(props, &names) {
        Some((start, end)) => date_covers_today(&start, end.as_deref(), today),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::{date_covers_today, extract_date_range};
    use serde_json::json;

    #[test]
    fn single_day_matches_only_that_day() {
        assert!(date_covers_today("2026-07-21", None, "2026-07-21"));
        assert!(!date_covers_today("2026-07-20", None, "2026-07-21"));
    }

    #[test]
    fn multi_day_range_includes_today_when_started_yesterday() {
        assert!(date_covers_today(
            "2026-07-20",
            Some("2026-07-21"),
            "2026-07-21"
        ));
        assert!(date_covers_today(
            "2026-07-20",
            Some("2026-07-22"),
            "2026-07-21"
        ));
        assert!(!date_covers_today(
            "2026-07-18",
            Some("2026-07-20"),
            "2026-07-21"
        ));
    }

    #[test]
    fn extract_date_range_reads_end() {
        let props = json!({
            "Date": {
                "type": "date",
                "date": {
                    "start": "2026-07-20",
                    "end": "2026-07-21",
                    "time_zone": null
                }
            }
        });
        let (start, end) = extract_date_range(&props, &["Date"]).unwrap();
        assert_eq!(start, "2026-07-20");
        assert_eq!(end.as_deref(), Some("2026-07-21"));
    }
}

fn extract_multi_select(props: &Value, names: &[&str]) -> Vec<String> {
    for name in names {
        if let Some(arr) = props
            .get(*name)
            .and_then(|p| p.get("multi_select"))
            .and_then(|v| v.as_array())
        {
            return arr
                .iter()
                .filter_map(|item| item.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()))
                .collect();
        }
    }
    Vec::new()
}
