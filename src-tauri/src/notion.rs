use crate::models::{NotionConfig, NotionWriteMapping, Task};
use serde_json::{json, Value};
use serde::Serialize;
use std::{collections::HashSet, fmt, time::Duration};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionError {
    pub category: String,
    pub message: String,
    pub status: Option<u16>,
    pub code: Option<String>,
    pub retry_after_ms: Option<u64>,
}

impl NotionError {
    fn new(category: &str, message: &str) -> Self {
        Self { category: category.into(), message: message.into(), status: None, code: None, retry_after_ms: None }
    }

    fn transport(error: reqwest::Error) -> Self {
        if error.is_timeout() {
            Self::new("transport", crate::language::text("The Notion request timed out.", "Notion 请求超时"))
        } else {
            Self::new("transport", crate::language::text("Unable to reach Notion. Check your network connection.", "无法连接 Notion，请检查网络连接"))
        }
    }

    pub fn stops_pushes(&self) -> bool {
        self.category == "transport" || matches!(self.status, Some(401 | 403 | 429))
    }
}

impl fmt::Display for NotionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for NotionError {}

fn protocol_error() -> NotionError {
    NotionError::new("protocol", crate::language::text("Notion returned incomplete data. The local cache was not replaced.", "Notion 返回的数据结构不完整，本次未替换本地缓存"))
}

async fn response_error(response: reqwest::Response) -> (NotionError, Option<String>) {
    let status = response.status().as_u16();
    let retry_after_ms = response.headers().get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok().map(|seconds| seconds.saturating_mul(1000))
            .or_else(|| chrono::DateTime::parse_from_rfc2822(value).ok().map(|date|
                date.timestamp_millis().saturating_sub(chrono::Utc::now().timestamp_millis()).max(0) as u64)));
    let body = response.json::<Value>().await.ok();
    let code = body.as_ref().and_then(|body| body.get("code")).and_then(Value::as_str)
        .filter(|code| matches!(*code, "validation_error" | "unauthorized" | "restricted_resource"
            | "object_not_found" | "rate_limited" | "conflict_error" | "internal_server_error"
            | "service_unavailable" | "invalid_json" | "invalid_request_url" | "invalid_request"))
        .map(str::to_owned);
    let (category, explanation) = match status {
        401 => ("authentication", crate::language::text("Invalid Notion credentials. Update the Integration Token.", "Notion 凭据无效，请更新 Integration Token")),
        403 => ("permission", crate::language::text("Notion permission denied. Check database access and write permissions.", "Notion 权限不足，请检查数据库授权与回写权限")),
        404 => ("page", crate::language::text("The Notion database or page is inaccessible.", "Notion 数据库或页面不可访问")),
        429 => ("rateLimit", crate::language::text("Notion rate limit reached. Retrying is delayed as requested by the server.", "Notion 请求受限，将按服务端要求延后重试")),
        400 if code.as_deref() == Some("validation_error") =>
            ("validation", crate::language::text("Notion property types or options do not match. Check the property mapping.", "Notion 属性类型或选项不匹配，请检查属性映射")),
        500..=599 => ("server", crate::language::text("The Notion service is temporarily unavailable.", "Notion 服务暂时不可用")),
        _ => ("http", crate::language::text("The Notion request failed.", "Notion 请求失败")),
    };
    let message = match code.as_deref() {
        Some(code) => format!("{explanation} (HTTP {status} · {code})"),
        None => format!("{explanation} (HTTP {status})"),
    };
    let raw_message = body.as_ref().and_then(|body| body.get("message"))
        .and_then(Value::as_str).map(str::to_owned);
    (NotionError { category: category.into(), message, status: Some(status), code, retry_after_ms }, raw_message)
}

const NOTION_VERSION: &str = "2022-06-28";
/// How far back (by start date) to look for unfinished multi-day tasks.
/// Notion cannot filter by range end, so we bound start-date lookback instead of
/// pulling every historical row with start ≤ today.
const DATE_LOOKBACK_DAYS: i64 = 60;

#[derive(Clone)]
pub struct NotionClient {
    http: reqwest::Client,
    #[cfg(test)]
    base_url: String,
}

impl NotionClient {
    pub fn new() -> Result<Self, String> {
        let http = Self::http_builder().build()
            .map_err(|_| crate::language::text("Unable to initialize the Notion HTTP client.", "无法初始化 Notion HTTP 客户端").to_string())?;
        Ok(Self {
            http,
            #[cfg(test)]
            base_url: "https://api.notion.com/v1".into(),
        })
    }

    fn http_builder() -> reqwest::ClientBuilder {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(20))
    }

    fn base_url(&self) -> &str {
        #[cfg(test)]
        { &self.base_url }
        #[cfg(not(test))]
        { "https://api.notion.com/v1" }
    }

    #[cfg(test)]
    pub(crate) fn with_base_url(base_url: String) -> Self {
        // A localhost fixture must not send requests through the host's configured proxy.
        Self { base_url, http: Self::http_builder().no_proxy().build().expect("test HTTP client") }
    }

    fn headers(&self, token: &str) -> Result<reqwest::header::HeaderMap, NotionError> {
        let mut headers = reqwest::header::HeaderMap::new();
        let mut authorization: reqwest::header::HeaderValue = format!("Bearer {token}").parse()
            .map_err(|_| NotionError::new("configuration", crate::language::text("Invalid Notion Token format.", "Notion Token 格式无效")))?;
        authorization.set_sensitive(true);
        headers.insert(reqwest::header::AUTHORIZATION, authorization);
        headers.insert(reqwest::header::CONTENT_TYPE, reqwest::header::HeaderValue::from_static("application/json"));
        headers.insert("Notion-Version", reqwest::header::HeaderValue::from_static(NOTION_VERSION));
        Ok(headers)
    }

    pub async fn test_connection(&self, config: &NotionConfig) -> Result<String, NotionError> {
        Self::require_config(config)?;
        let response = self.http.get(format!("{}/databases/{}", self.base_url(), config.database_id.trim()))
            .headers(self.headers(&config.token)?).send().await.map_err(NotionError::transport)?;
        if !response.status().is_success() {
            return Err(response_error(response).await.0);
        }
        Ok(crate::language::text("The Notion database is accessible; not all properties or write settings have been validated.", "Notion 数据库可访问；尚未验证全部属性与回写配置").into())
    }

    fn require_config(config: &NotionConfig) -> Result<(), NotionError> {
        if config.token.trim().is_empty() || config.database_id.trim().is_empty() {
            Err(NotionError::new("configuration", crate::language::text("Configure the Notion Token and Database ID first.", "请先配置 Notion Token 与 Database ID")))
        } else {
            Ok(())
        }
    }

    pub async fn page_database_id(&self, config: &NotionConfig, page_id: &str) -> Result<String, NotionError> {
        Self::require_config(config)?;
        let response = self.http.get(format!("{}/pages/{page_id}", self.base_url()))
            .headers(self.headers(&config.token)?).send().await.map_err(NotionError::transport)?;
        if !response.status().is_success() {
            return Err(response_error(response).await.0);
        }
        let page: Value = response.json().await.map_err(|_| protocol_error())?;
        page.get("parent").and_then(|parent| parent.get("database_id")).and_then(Value::as_str)
            .filter(|id| !id.trim().is_empty()).map(str::to_owned).ok_or_else(protocol_error)
    }

    pub async fn query_tasks(&self, config: &NotionConfig) -> Result<Vec<Task>, NotionError> {
        Self::require_config(config)?;
        let today = chrono::Local::now().date_naive();
        let today_str = today.format("%Y-%m-%d").to_string();
        let lookback_str = (today - chrono::Duration::days(DATE_LOOKBACK_DAYS)).format("%Y-%m-%d").to_string();
        let date_prop = if config.date_property.trim().is_empty() { "Date" } else { config.date_property.trim() };
        let done_prop = if config.done_property.trim().is_empty() { "done?" } else { config.done_property.trim() };
        let url = format!("{}/databases/{}/query", self.base_url(), config.database_id.trim());
        let filter = json!({"or": [
            {"property": date_prop, "date": {"equals": today_str}},
            {"and": [
                {"property": done_prop, "checkbox": {"equals": false}},
                {"property": date_prop, "date": {"on_or_before": today_str}},
                {"property": date_prop, "date": {"on_or_after": lookback_str}}
            ]}
        ]});
        let mut results = Vec::new();
        let mut cursor: Option<String> = None;
        let mut cursors = HashSet::new();
        loop {
            let mut body = json!({"page_size": 100, "filter": filter});
            if let Some(cursor) = &cursor { body["start_cursor"] = json!(cursor); }
            let response = self.http.post(&url).headers(self.headers(&config.token)?)
                .json(&body).send().await.map_err(NotionError::transport)?;
            if !response.status().is_success() { return Err(response_error(response).await.0); }
            let payload: Value = response.json().await.map_err(|_| protocol_error())?;
            let pages = payload.get("results").and_then(Value::as_array).ok_or_else(protocol_error)?;
            let has_more = payload.get("has_more").and_then(Value::as_bool).ok_or_else(protocol_error)?;
            for page in pages {
                validate_page(page, config)?;
                if page_date_covers_today(page, config, &today_str) {
                    results.push(parse_page(page, config).ok_or_else(protocol_error)?);
                }
            }
            if !has_more { break; }
            let next = payload.get("next_cursor").and_then(Value::as_str)
                .filter(|cursor| !cursor.trim().is_empty()).ok_or_else(protocol_error)?;
            if !cursors.insert(next.to_owned()) { return Err(protocol_error()); }
            cursor = Some(next.to_owned());
        }
        Ok(results)
    }

    pub async fn set_done(&self, config: &NotionConfig, mapping: &NotionWriteMapping, page_id: &str, completed: bool) -> Result<(), NotionError> {
        let done_prop = if mapping.done_property.trim().is_empty() { "done?" } else { mapping.done_property.trim() };
        let status_prop = mapping.status_property.trim();
        let status_name = if completed { mapping.status_done_value.trim() } else { mapping.status_todo_value.trim() };
        let mut properties = json!({done_prop: {"checkbox": completed}});
        if !status_prop.is_empty() && !status_name.is_empty() {
            properties[status_prop] = json!({"status": {"name": status_name}});
        }
        let response = self.patch(config, page_id, &properties).await?;
        if response.status().is_success() { return Ok(()); }
        let (error, validation_message) = response_error(response).await;
        // Only this explicit property-type mismatch permits a second PATCH.
        if error.status == Some(400) && error.code.as_deref() == Some("validation_error")
            && !status_prop.is_empty() && !status_name.is_empty()
            && validation_message.as_deref() == Some(format!("{status_prop} is expected to be select.").as_str())
        {
            properties[status_prop] = json!({"select": {"name": status_name}});
            let response = self.patch(config, page_id, &properties).await?;
            if response.status().is_success() { return Ok(()); }
            return Err(response_error(response).await.0);
        }
        Err(error)
    }

    async fn patch(&self, config: &NotionConfig, page_id: &str, properties: &Value) -> Result<reqwest::Response, NotionError> {
        Self::require_config(config)?;
        self.http.patch(format!("{}/pages/{page_id}", self.base_url()))
            .headers(self.headers(&config.token)?).json(&json!({"properties": properties}))
            .send().await.map_err(NotionError::transport)
    }
}

fn valid_page_id(id: &str) -> bool {
    match id.len() {
        32 => id.bytes().all(|byte| byte.is_ascii_hexdigit()),
        36 => id.bytes().enumerate().all(|(index, byte)|
            if matches!(index, 8 | 13 | 18 | 23) { byte == b'-' } else { byte.is_ascii_hexdigit() }),
        _ => false,
    }
}

fn validate_page(page: &Value, config: &NotionConfig) -> Result<(), NotionError> {
    let valid = || -> Option<()> {
        page.get("id")?.as_str().filter(|id| valid_page_id(id))?;
        let props = page.get("properties")?.as_object()?;
        let title = props.get(&config.title_property).filter(|prop| prop.get("title").is_some())
            .or_else(|| {
                let mut titles = props.values().filter(|prop| prop.get("type").and_then(Value::as_str) == Some("title"));
                let title = titles.next()?;
                if titles.next().is_some() { None } else { Some(title) }
            })?;
        for item in title.get("title")?.as_array()? { item.get("plain_text")?.as_str()?; }
        let done = std::iter::once(config.done_property.as_str()).chain(["done?", "done", "Done", "完成", "Completed"])
            .find_map(|name| props.get(name).and_then(|prop| prop.get("checkbox")).and_then(Value::as_bool));
        done?;
        let date = date_property_names(config).into_iter().find_map(|name| props.get(name).and_then(|prop| prop.get("date")))?;
        if !date.is_null() {
            let start = date.get("start")?.as_str()?;
            chrono::NaiveDate::parse_from_str(start.get(..10)?, "%Y-%m-%d").ok()?;
            if let Some(end) = date.get("end").filter(|value| !value.is_null()) {
                chrono::NaiveDate::parse_from_str(end.as_str()?.get(..10)?, "%Y-%m-%d").ok()?;
            }
        }
        chrono::DateTime::parse_from_rfc3339(page.get("last_edited_time")?.as_str()?).ok()?;
        Some(())
    };
    valid().ok_or_else(protocol_error)
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
        group_id: crate::models::NOTION_GROUP_ID.into(),
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

fn date_property_names(config: &NotionConfig) -> [&str; 5] {
    [config.date_property.as_str(), "Date", "date", "日期", "Deadline"]
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

#[cfg(test)]
#[path = "notion_test_support.rs"]
pub(crate) mod test_support;

#[cfg(test)]
mod http_tests {
    use super::*;
    use super::test_support::{config, page, snapshot, Fixture, Reply};
    use std::collections::VecDeque;

    const PAGE: &str = "11111111-1111-1111-1111-111111111111";

    fn replies(replies: Vec<Reply>) -> Fixture {
        let mut replies = VecDeque::from(replies);
        Fixture::new(move |_| replies.pop_front().unwrap_or_else(|| Reply::error(500, "internal_server_error", "unexpected request")))
    }

    #[tokio::test]
    async fn paginated_query_uses_real_http_and_preserves_optional_metadata() {
        let mut first = page(PAGE, false);
        first["properties"]["tags"] = json!({"type":"multi_select","multi_select":[{"name":"alpha"},{"name":"beta"}]});
        first["properties"]["progress"] = json!({"type":"number","number":0.5});
        first["properties"]["remain"] = json!({"type":"formula","formula":{"type":"number","number":0.5}});
        let fixture = replies(vec![
            Reply::ok(json!({"results":[first],"has_more":true,"next_cursor":"next"})),
            Reply::ok(snapshot(vec![page("22222222-2222-2222-2222-222222222222", true)])),
        ]);
        let result = NotionClient::with_base_url(fixture.url()).query_tasks(&config()).await.unwrap();
        assert_eq!(result[0].tags, ["alpha", "beta"]);
        assert_eq!(result[0].progress.as_deref(), Some("50%"));
        assert_eq!(result[0].remain.as_deref(), Some("0.5"));
        assert!(result[1].completed);
        let requests = fixture.requests();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].body["page_size"], 100);
        assert_eq!(requests[1].body["start_cursor"], "next");
    }

    #[tokio::test]
    async fn custom_chinese_properties_and_empty_title_work_without_optional_properties() {
        let mut config = config();
        config.title_property = "任务".into();
        config.done_property = "完成".into();
        config.date_property = "日期".into();
        config.status_property.clear();
        let mut page = page(PAGE, false);
        let properties = page["properties"].as_object_mut().unwrap();
        properties.remove("Name");
        properties.insert("任务".into(), json!({"type":"title","title":[]}));
        let done = properties.remove("done?").unwrap();
        properties.insert("完成".into(), done);
        let date = properties.remove("Date").unwrap();
        properties.insert("日期".into(), date);
        let fixture = replies(vec![Reply::ok(snapshot(vec![page]))]);
        let result = NotionClient::with_base_url(fixture.url()).query_tasks(&config).await.unwrap();
        assert_eq!(result[0].title, "(untitled)");
        assert!(result[0].tags.is_empty());
        assert!(result[0].progress.is_none());
        assert!(result[0].remain.is_none());
        let query = &fixture.requests()[0].body;
        assert_eq!(query["filter"]["or"][0]["property"], "日期");
        assert_eq!(query["filter"]["or"][1]["and"][0]["property"], "完成");
    }

    #[tokio::test]
    async fn metadata_aliases_preserve_rich_text_select_number_and_formula_semantics() {
        let cases = [
            (json!({
                "进度":{"rich_text":[{"plain_text":"已完"},{"plain_text":"一半"}]},
                "剩余":{"select":{"name":"待估"}},
                "标签":{"multi_select":[{"name":"研究"}]}
            }), "已完一半", "待估", vec!["研究"]),
            (json!({
                "progress line":{"number":1.0}, "remain":{"number":0.5},
                "tags":{"multi_select":[{"name":"日常"}]}
            }), "100%", "50%", vec!["日常"]),
            (json!({
                "progress":{"formula":{"type":"string","string":"3/4"}},
                "Remain":{"formula":{"type":"number","number":0.5}},
                "Tags":{"multi_select":[{"name":"公式"}]}
            }), "3/4", "0.5", vec!["公式"]),
            (json!({
                "Progress":{"select":{"name":"Review"}},
                "Remaining":{"rich_text":[{"plain_text":"2 小时"}]}
            }), "Review", "2 小时", vec![]),
        ];
        let pages = cases.iter().enumerate().map(|(index, (metadata, ..))| {
            let mut task = page(&format!("{:08}-1111-1111-1111-111111111111", index + 1), false);
            task["properties"].as_object_mut().unwrap().extend(metadata.as_object().unwrap().clone());
            task
        }).collect();
        let fixture = replies(vec![Reply::ok(snapshot(pages))]);
        let tasks = NotionClient::with_base_url(fixture.url()).query_tasks(&config()).await.unwrap();
        assert_eq!(tasks.len(), cases.len());
        for (task, (_, progress, remain, tags)) in tasks.iter().zip(cases) {
            assert_eq!(task.progress.as_deref(), Some(progress));
            assert_eq!(task.remain.as_deref(), Some(remain));
            assert_eq!(task.tags, tags);
        }
    }

    #[tokio::test]
    async fn date_window_queries_sixty_days_and_filters_expired_ranges_after_http() {
        let fixture = Fixture::new(|request| {
            // Use the request's local day so crossing midnight cannot invalidate the fixture.
            let today = chrono::NaiveDate::parse_from_str(
                request.body["filter"]["or"][0]["date"]["equals"].as_str().unwrap(), "%Y-%m-%d",
            ).unwrap();
            let lookback = today - chrono::Duration::days(60);
            let yesterday = today - chrono::Duration::days(1);
            let mut current = page(PAGE, true);
            current["properties"]["Date"]["date"] = json!({"start":today.to_string(),"end":null});
            let mut spanning = page("22222222-2222-2222-2222-222222222222", false);
            spanning["properties"]["Date"]["date"] = json!({
                "start":format!("{lookback}T23:30:00.000-05:00"),
                "end":format!("{today}T23:59:00.000+08:00")
            });
            let mut expired = page("33333333-3333-3333-3333-333333333333", false);
            expired["properties"]["Date"]["date"] = json!({"start":yesterday.to_string(),"end":yesterday.to_string()});
            Reply::ok(snapshot(vec![current, spanning, expired]))
        });
        let tasks = NotionClient::with_base_url(fixture.url()).query_tasks(&config()).await.unwrap();
        assert_eq!(tasks.iter().map(|task| task.id.as_str()).collect::<Vec<_>>(), [
            PAGE, "22222222-2222-2222-2222-222222222222",
        ]);
        assert!(tasks[0].completed);
        let requests = fixture.requests();
        let filter = &requests[0].body["filter"]["or"];
        let today = chrono::NaiveDate::parse_from_str(filter[0]["date"]["equals"].as_str().unwrap(), "%Y-%m-%d").unwrap();
        assert_eq!(filter[1]["and"][0]["checkbox"]["equals"], false);
        assert_eq!(filter[1]["and"][1]["date"]["on_or_before"], today.to_string());
        assert_eq!(filter[1]["and"][2]["date"]["on_or_after"], (today - chrono::Duration::days(60)).to_string());
        assert_eq!(tasks[1].date.as_deref(), Some(format!("{} → {today}", today - chrono::Duration::days(60)).as_str()));
    }

    #[tokio::test]
    async fn second_page_failure_never_returns_a_partial_snapshot() {
        let fixture = replies(vec![
            Reply::ok(json!({"results":[page(PAGE,false)],"has_more":true,"next_cursor":"next"})),
            Reply::error(500, "internal_server_error", "private task body must not escape"),
        ]);
        let error = NotionClient::with_base_url(fixture.url()).query_tasks(&config()).await.unwrap_err();
        assert_eq!(error.status, Some(500));
        assert!(!error.message.contains("private task"));
        assert_eq!(fixture.requests().len(), 2);
    }

    #[tokio::test]
    async fn malformed_snapshot_and_cursor_are_errors_not_empty_successes() {
        for payload in [
            json!({"results":{},"has_more":false}),
            json!({"results":[]}),
            json!({"results":[],"has_more":"false"}),
            json!({"results":[],"has_more":true}),
            json!({"results":[],"has_more":true,"next_cursor":" "}),
            snapshot(vec![json!({"id":PAGE,"properties":{}})]),
            snapshot(vec![json!({"id":"","properties":{}})]),
        ] {
            let fixture = replies(vec![Reply::ok(payload)]);
            let error = NotionClient::with_base_url(fixture.url()).query_tasks(&config()).await.unwrap_err();
            assert_eq!(error.category, "protocol");
        }
    }

    #[tokio::test]
    async fn repeated_cursor_stops_without_an_unbounded_query_loop() {
        let payload = json!({"results":[],"has_more":true,"next_cursor":"same"});
        let fixture = replies(vec![Reply::ok(payload.clone()), Reply::ok(payload)]);
        let error = NotionClient::with_base_url(fixture.url()).query_tasks(&config()).await.unwrap_err();
        assert_eq!(error.category, "protocol");
        assert_eq!(fixture.requests().len(), 2);
    }

    #[tokio::test]
    async fn missing_date_is_filtered_but_corrupted_date_aborts_the_snapshot() {
        let mut absent = page(PAGE, false);
        absent["properties"]["Date"]["date"] = Value::Null;
        let fixture = replies(vec![Reply::ok(snapshot(vec![absent]))]);
        assert!(NotionClient::with_base_url(fixture.url()).query_tasks(&config()).await.unwrap().is_empty());
        let mut damaged = page(PAGE, false);
        damaged["properties"]["Date"]["date"]["start"] = json!("not a date");
        let fixture = replies(vec![Reply::ok(snapshot(vec![damaged]))]);
        assert_eq!(NotionClient::with_base_url(fixture.url()).query_tasks(&config()).await.unwrap_err().category, "protocol");
    }

    #[tokio::test]
    async fn disabled_status_writes_checkbox_only() {
        let mut config = config();
        config.status_property.clear();
        let fixture = replies(vec![Reply::ok(json!({}))]);
        NotionClient::with_base_url(fixture.url()).set_done(&config, &NotionWriteMapping::from_config(&config), PAGE, true).await.unwrap();
        let requests = fixture.requests();
        assert_eq!(requests[0].method, "PATCH");
        assert_eq!(requests[0].body, json!({"properties":{"done?":{"checkbox":true}}}));
    }

    #[tokio::test]
    async fn status_and_explicit_select_type_fallback_write_the_configured_value() {
        let fixture = replies(vec![
            Reply::error(400, "validation_error", "Status is expected to be select."),
            Reply::ok(json!({})),
        ]);
        NotionClient::with_base_url(fixture.url()).set_done(&config(), &NotionWriteMapping::from_config(&config()), PAGE, false).await.unwrap();
        let requests = fixture.requests();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].body["properties"]["Status"], json!({"status":{"name":"Not started"}}));
        assert_eq!(requests[1].body["properties"]["Status"], json!({"select":{"name":"Not started"}}));
        assert_eq!(requests[1].body["properties"]["done?"]["checkbox"], false);
    }

    #[tokio::test]
    async fn arbitrary_select_text_and_authentication_errors_never_trigger_an_extra_patch() {
        for (status, code, message) in [
            (400, "validation_error", "private task text containing select"),
            (401, "unauthorized", "Status is expected to be select."),
            (500, "internal_server_error", "Status is expected to be select."),
        ] {
            let fixture = replies(vec![Reply::error(status, code, message)]);
            let error = NotionClient::with_base_url(fixture.url()).set_done(&config(), &NotionWriteMapping::from_config(&config()), PAGE, true).await.unwrap_err();
            assert_eq!(fixture.requests().len(), 1);
            assert_eq!(error.status, Some(status));
            assert!(!error.message.contains(message));
            assert!(error.message.chars().count() <= 240);
        }
    }

    #[tokio::test]
    async fn rate_limit_preserves_retry_after_without_leaking_response_content() {
        let mut reply = Reply::error(429, "rate_limited", "fixture-token private title");
        reply.retry_after = Some("120".into());
        let fixture = replies(vec![reply]);
        let error = NotionClient::with_base_url(fixture.url()).set_done(&config(), &NotionWriteMapping::from_config(&config()), PAGE, true).await.unwrap_err();
        assert_eq!(error.retry_after_ms, Some(120_000));
        assert!(error.stops_pushes());
        let serialized = serde_json::to_string(&error).unwrap();
        assert!(!serialized.contains("fixture-token"));
        assert!(!serialized.contains("private title"));
    }

    #[tokio::test]
    async fn old_page_identity_check_reads_parent_without_writing() {
        let fixture = replies(vec![Reply::ok(json!({"parent":{"database_id":config().database_id}}))]);
        let parent = NotionClient::with_base_url(fixture.url()).page_database_id(&config(), PAGE).await.unwrap();
        assert_eq!(parent, config().database_id);
        let requests = fixture.requests();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].method, "GET");
        assert_eq!(requests[0].path, format!("/v1/pages/{PAGE}"));
    }

    #[tokio::test]
    async fn stalled_request_has_a_real_total_timeout_and_safe_transport_error() {
        let (sent, arrived) = tokio::sync::oneshot::channel();
        let mut sent = Some(sent);
        let (release, blocked) = std::sync::mpsc::channel();
        let fixture = Fixture::new(move |_| {
            if let Some(sent) = sent.take() { let _ = sent.send(()); }
            let _ = blocked.recv();
            Reply::ok(snapshot(vec![]))
        });
        let client = NotionClient::with_base_url(fixture.url());
        let query = tokio::spawn(async move { client.query_tasks(&config()).await });
        arrived.await.unwrap();
        tokio::time::pause();
        tokio::time::advance(Duration::from_secs(20)).await;
        tokio::time::resume();
        let joined = query.await;
        let _ = release.send(());
        let error = joined.unwrap().unwrap_err();
        assert_eq!(error.category, "transport");
        assert!(matches!(error.message.as_str(), "The Notion request timed out." | "Notion 请求超时"));
        assert_eq!(fixture.requests().len(), 1);
    }
}
