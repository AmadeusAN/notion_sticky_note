use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

static ENTROPY_COUNTER: AtomicU64 = AtomicU64::new(1);

fn next_entropy_u64() -> u64 {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9e37_79b9_7f4a_7c15);
    let seq = ENTROPY_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut x = nanos ^ seq.wrapping_mul(0x9e37_79b9_7f4a_7c15);
    x ^= x >> 30;
    x = x.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    x ^= x >> 27;
    x = x.wrapping_mul(0x94d0_49bb_1331_11eb);
    x ^ (x >> 31)
}

pub fn shuffle_with_seed<T>(items: &mut [T], seed: u64) {
    let len = items.len();
    if len <= 1 {
        return;
    }
    let mut state = if seed == 0 { 0x9e37_79b9_7f4a_7c15 } else { seed };
    for i in (1..len).rev() {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        let j = (state as usize) % (i + 1);
        items.swap(i, j);
    }
}

fn random_wallhaven_seed() -> String {
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut x = next_entropy_u64();
    let mut out = String::with_capacity(6);
    for _ in 0..6 {
        x = x.wrapping_mul(6364136223846793005).wrapping_add(1);
        let idx = ((x >> 32) as usize) % CHARS.len();
        out.push(CHARS[idx] as char);
    }
    out
}

pub fn open_external_url(raw_url: &str) -> Result<(), String> {
    let trimmed = raw_url.trim();
    let parsed = reqwest::Url::parse(trimmed).map_err(|_| "来源链接格式无效".to_string())?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err("仅支持打开 http/https 来源链接".into());
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        Command::new("rundll32.exe")
            .creation_flags(CREATE_NO_WINDOW)
            .args(["url.dll,FileProtocolHandler", parsed.as_str()])
            .spawn()
            .map_err(|e| format!("无法在浏览器中打开链接: {e}"))?;
        return Ok(());
    }

    #[cfg(not(windows))]
    {
        Err("当前平台暂不支持自动打开外部链接".into())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryFeedRequest {
    pub source: String,
    pub query: Option<String>,
    pub board_url: Option<String>,
    pub access_key: Option<String>,
    pub proxy_url: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteGalleryItem {
    pub id: String,
    pub title: String,
    pub image_url: String,
    pub source_url: Option<String>,
    pub author: Option<String>,
    pub provider: String,
}

fn normalize_proxy_scheme(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        Some(trimmed.to_string())
    } else if trimmed.starts_with("socks") {
        // Clash / V2Ray mixed ports usually speak HTTP on the same host:port, and reqwest
        // supports http:// CONNECT proxies without extra socks dependencies.
        trimmed
            .split_once("://")
            .map(|(_, rest)| format!("http://{rest}"))
    } else {
        Some(format!("http://{trimmed}"))
    }
}

pub fn parse_windows_proxy_server(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if !trimmed.contains('=') {
        return normalize_proxy_scheme(trimmed);
    }

    let mut https_entry = None;
    let mut http_entry = None;
    let mut fallback_entry = None;

    for part in trimmed.split(';') {
        let part = part.trim();
        let Some((proto, addr)) = part.split_once('=') else {
            continue;
        };
        let proto = proto.trim().to_ascii_lowercase();
        let addr = addr.trim();
        if addr.is_empty() {
            continue;
        }
        if proto == "https" {
            https_entry = Some(format!("http://{addr}"));
        } else if proto == "http" {
            http_entry = Some(format!("http://{addr}"));
        } else if fallback_entry.is_none() {
            fallback_entry = normalize_proxy_scheme(addr);
        }
    }

    https_entry.or(http_entry).or(fallback_entry)
}

#[cfg(windows)]
fn read_windows_registry_proxy() -> Option<String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let internet = hkcu
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
        .ok()?;
    let enabled: u32 = internet.get_value("ProxyEnable").unwrap_or(0);
    if enabled != 1 {
        return None;
    }
    let server: String = internet.get_value("ProxyServer").ok()?;
    parse_windows_proxy_server(&server)
}

#[cfg(not(windows))]
fn read_windows_registry_proxy() -> Option<String> {
    None
}

fn detect_system_proxy() -> Option<String> {
    for key in [
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
    ] {
        if let Ok(val) = std::env::var(key) {
            if let Some(url) = normalize_proxy_scheme(&val) {
                return Some(url);
            }
        }
    }
    read_windows_registry_proxy()
}

fn gallery_client(explicit_proxy: Option<&str>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(14))
        .user_agent("StickyNote/1.0 (+https://github.com/AmadeusAN/notion_sticky_note)");

    let resolved_proxy = explicit_proxy
        .and_then(normalize_proxy_scheme)
        .or_else(detect_system_proxy);

    if let Some(proxy_url) = resolved_proxy {
        if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
            builder = builder.proxy(proxy);
        }
    }

    builder
        .build()
        .map_err(|e| format!("无法初始化网络客户端: {e}"))
}

pub fn normalize_pinterest_rss_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("请先在设置中填写 Pinterest 公开画板链接".into());
    }

    let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else if trimmed.starts_with("pinterest.") || trimmed.starts_with("www.pinterest.") {
        format!("https://{trimmed}")
    } else {
        let slug = trimmed.trim_start_matches('/');
        format!("https://www.pinterest.com/{slug}")
    };

    let parsed = reqwest::Url::parse(&with_scheme)
        .map_err(|_| "Pinterest 画板链接格式无效".to_string())?;

    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    if !host.contains("pinterest.") {
        return Err("仅支持 Pinterest 公开画板链接（例如 https://www.pinterest.com/用户名/画板名/）".into());
    }

    let path = parsed.path().trim_end_matches('/');
    if path.is_empty() || path == "/" {
        return Err("请填写完整的 Pinterest 公开画板链接（包含用户名与画板名）".into());
    }

    if path.ends_with(".rss") {
        Ok(format!("https://{host}{path}"))
    } else {
        Ok(format!("https://{host}{path}.rss"))
    }
}

fn unescape_xml(text: &str) -> String {
    text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
}

fn strip_cdata(text: &str) -> &str {
    let t = text.trim();
    if let Some(rest) = t.strip_prefix("<![CDATA[") {
        if let Some(inner) = rest.strip_suffix("]]>") {
            return inner.trim();
        }
    }
    t
}

fn extract_tag_inner<'a>(block: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = block.find(&open)? + open.len();
    let rest = &block[start..];
    let end = rest.find(&close)?;
    Some(strip_cdata(&rest[..end]))
}

fn extract_img_src(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let img_idx = lower.find("<img")?;
    let after_img = &html[img_idx..];
    let src_idx = after_img.to_ascii_lowercase().find("src=")?;
    let quote_start = src_idx + 4;
    let bytes = after_img.as_bytes();
    let quote = *bytes.get(quote_start)?;
    if quote != b'"' && quote != b'\'' {
        return None;
    }
    let content = &after_img[quote_start + 1..];
    let end = content.find(quote as char)?;
    let raw_url = unescape_xml(&content[..end]);
    // Upgrade small Pinterest thumbnails (236x / 474x) to crisp 736x when available.
    if raw_url.contains("pinimg.com/236x/") {
        Some(raw_url.replacen("pinimg.com/236x/", "pinimg.com/736x/", 1))
    } else {
        Some(raw_url)
    }
}

pub fn parse_pinterest_rss(xml: &str, limit: usize) -> Vec<RemoteGalleryItem> {
    let mut items = Vec::new();
    let mut seen_images = std::collections::HashSet::new();
    let mut cursor = xml;
    while items.len() < limit {
        let Some(start) = cursor.find("<item>") else {
            break;
        };
        let after_start = &cursor[start + 6..];
        let Some(end) = after_start.find("</item>") else {
            break;
        };
        let block = &after_start[..end];
        cursor = &after_start[end + 7..];

        let desc = extract_tag_inner(block, "description").unwrap_or_default();
        let unescaped_desc = unescape_xml(desc);
        let Some(image_url) = extract_img_src(&unescaped_desc) else {
            continue;
        };
        if !image_url.starts_with("http://") && !image_url.starts_with("https://") {
            continue;
        }
        if !seen_images.insert(image_url.clone()) {
            continue;
        }
        let title_raw = extract_tag_inner(block, "title").unwrap_or("Pinterest Pin");
        let title = {
            let clean = unescape_xml(title_raw).trim().to_string();
            if clean.is_empty() {
                "Pinterest Pin".to_string()
            } else {
                clean
            }
        };
        let raw_link = extract_tag_inner(block, "link").map(|s| unescape_xml(s));
        // Pinterest RSS feeds often emit obfuscated `/pin/e1_.../` links that redirect to the
        // homepage with "Pin not found"; fall back to the direct crisp CDN image URL in that case.
        let source_url = match raw_link {
            Some(ref link) if !link.contains("/pin/e1_") => raw_link,
            _ => Some(image_url.clone()),
        };
        let id = extract_tag_inner(block, "guid")
            .map(|s| unescape_xml(s))
            .unwrap_or_else(|| format!("pin-{}", items.len() + 1));

        items.push(RemoteGalleryItem {
            id,
            title,
            image_url,
            source_url,
            author: None,
            provider: "pinterest".into(),
        });
    }
    items
}

#[derive(Debug, Deserialize)]
struct WallhavenResponse {
    data: Vec<WallhavenEntry>,
}

#[derive(Debug, Deserialize)]
struct WallhavenEntry {
    id: String,
    url: Option<String>,
    path: String,
    category: Option<String>,
}

pub fn parse_wallhaven_json(body: &str, limit: usize) -> Result<Vec<RemoteGalleryItem>, String> {
    let parsed: WallhavenResponse =
        serde_json::from_str(body).map_err(|e| format!("解析 Wallhaven 返回失败: {e}"))?;
    Ok(parsed
        .data
        .into_iter()
        .take(limit)
        .map(|entry| RemoteGalleryItem {
            id: entry.id.clone(),
            title: entry
                .category
                .filter(|c| !c.is_empty())
                .map(|c| format!("Wallhaven · {c}"))
                .unwrap_or_else(|| format!("Wallhaven #{}", entry.id)),
            image_url: entry.path,
            source_url: entry.url,
            author: None,
            provider: "wallhaven".into(),
        })
        .collect())
}

#[derive(Debug, Deserialize)]
struct UnsplashSearchResponse {
    results: Vec<UnsplashPhoto>,
}

#[derive(Debug, Deserialize)]
struct UnsplashPhoto {
    id: String,
    alt_description: Option<String>,
    description: Option<String>,
    urls: UnsplashUrls,
    links: Option<UnsplashLinks>,
    user: Option<UnsplashUser>,
}

#[derive(Debug, Deserialize)]
struct UnsplashUrls {
    regular: String,
}

#[derive(Debug, Deserialize)]
struct UnsplashLinks {
    html: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UnsplashUser {
    name: Option<String>,
}

pub fn parse_unsplash_json(
    body: &str,
    search_mode: bool,
    limit: usize,
) -> Result<Vec<RemoteGalleryItem>, String> {
    let photos: Vec<UnsplashPhoto> = if search_mode {
        let resp: UnsplashSearchResponse =
            serde_json::from_str(body).map_err(|e| format!("解析 Unsplash 搜索结果失败: {e}"))?;
        resp.results
    } else {
        serde_json::from_str(body).map_err(|e| format!("解析 Unsplash 图片列表失败: {e}"))?
    };

    Ok(photos
        .into_iter()
        .take(limit)
        .map(|photo| {
            let title = photo
                .alt_description
                .or(photo.description)
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| format!("Unsplash #{}", photo.id));
            RemoteGalleryItem {
                id: photo.id,
                title,
                image_url: photo.urls.regular,
                source_url: photo.links.and_then(|l| l.html),
                author: photo.user.and_then(|u| u.name),
                provider: "unsplash".into(),
            }
        })
        .collect())
}

pub async fn fetch_gallery_feed(request: GalleryFeedRequest) -> Result<Vec<RemoteGalleryItem>, String> {
    let limit = request.limit.unwrap_or(10).clamp(1, 20);
    let source = request.source.trim().to_ascii_lowercase();
    let client = gallery_client(request.proxy_url.as_deref())?;

    match source.as_str() {
        "wallhaven" => {
            let query = request.query.as_deref().unwrap_or("").trim();
            let seed = random_wallhaven_seed();
            let mut params = vec![
                ("purity", "100".to_string()),
                ("sorting", "random".to_string()),
                ("seed", seed),
            ];
            if !query.is_empty() {
                params.push(("q", query.to_string()));
            }
            let resp = client
                .get("https://wallhaven.cc/api/v1/search")
                .query(&params)
                .send()
                .await
                .map_err(|e| format!("无法连接 Wallhaven: {e}"))?;
            if !resp.status().is_success() {
                return Err(format!("Wallhaven 请求失败（HTTP {}）", resp.status().as_u16()));
            }
            let text = resp
                .text()
                .await
                .map_err(|e| format!("读取 Wallhaven 响应失败: {e}"))?;
            let mut items = parse_wallhaven_json(&text, 24)?;
            shuffle_with_seed(&mut items, next_entropy_u64());
            items.truncate(limit);
            Ok(items)
        }
        "pinterest" => {
            let rss_url = normalize_pinterest_rss_url(request.board_url.as_deref().unwrap_or(""))?;
            let resp = client
                .get(&rss_url)
                .send()
                .await
                .map_err(|e| format!("无法连接 Pinterest 画板: {e}"))?;
            if !resp.status().is_success() {
                return Err(format!(
                    "无法读取该 Pinterest 公开画板（HTTP {}），请确认画板链接正确且设为公开",
                    resp.status().as_u16()
                ));
            }
            let xml = resp
                .text()
                .await
                .map_err(|e| format!("读取 Pinterest RSS 失败: {e}"))?;
            let mut items = parse_pinterest_rss(&xml, usize::MAX);
            if items.is_empty() {
                return Err("该 Pinterest 画板 RSS 中暂未找到可用图片".into());
            }
            shuffle_with_seed(&mut items, next_entropy_u64());
            items.truncate(limit);
            Ok(items)
        }
        "unsplash" => {
            let key = request.access_key.as_deref().unwrap_or("").trim();
            if key.is_empty() {
                return Err("请先在设置中填写 Unsplash Access Key".into());
            }
            let query = request.query.as_deref().unwrap_or("").trim();
            let count_str = limit.to_string();
            let mut req = client
                .get("https://api.unsplash.com/photos/random")
                .header("Authorization", format!("Client-ID {key}"))
                .header("Accept-Version", "v1")
                .query(&[("count", count_str.as_str())]);
            if !query.is_empty() {
                req = req.query(&[("query", query)]);
            }
            let resp = req
                .send()
                .await
                .map_err(|e| format!("无法连接 Unsplash: {e}"))?;
            if !resp.status().is_success() {
                let status = resp.status().as_u16();
                if status == 401 || status == 403 {
                    return Err("Unsplash Access Key 无效或已达到请求配额上限".into());
                }
                return Err(format!("Unsplash 请求失败（HTTP {status}）"));
            }
            let text = resp
                .text()
                .await
                .map_err(|e| format!("读取 Unsplash 响应失败: {e}"))?;
            let mut items = parse_unsplash_json(&text, false, limit)?;
            shuffle_with_seed(&mut items, next_entropy_u64());
            Ok(items)
        }
        _ => Err(format!("不支持的图源: {source}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_pinterest_board_urls_to_rss() {
        assert_eq!(
            normalize_pinterest_rss_url("https://www.pinterest.com/eda/minimal-desk/").unwrap(),
            "https://www.pinterest.com/eda/minimal-desk.rss"
        );
        assert_eq!(
            normalize_pinterest_rss_url("eda/anime-room").unwrap(),
            "https://www.pinterest.com/eda/anime-room.rss"
        );
        assert_eq!(
            normalize_pinterest_rss_url("https://pinterest.com/user/board.rss").unwrap(),
            "https://pinterest.com/user/board.rss"
        );
        assert!(normalize_pinterest_rss_url("https://example.com/a/b").is_err());
        assert!(normalize_pinterest_rss_url("").is_err());
    }

    #[test]
    fn parses_pinterest_rss_items_and_upgrades_thumbnails() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <rss version="2.0"><channel>
          <item>
            <title><![CDATA[Cozy Desk Setup]]></title>
            <link>https://www.pinterest.com/pin/123/</link>
            <guid>pin-123</guid>
            <description><![CDATA[<a href="https://www.pinterest.com/pin/123/"><img src="https://i.pinimg.com/236x/ab/cd/ef.jpg"/></a>]]></description>
          </item>
          <item>
            <title>Duplicate Image</title>
            <link>https://www.pinterest.com/pin/999/</link>
            <guid>pin-999</guid>
            <description><![CDATA[<img src="https://i.pinimg.com/236x/ab/cd/ef.jpg"/>]]></description>
          </item>
          <item>
            <title>Obfuscated Link</title>
            <link>https://www.pinterest.com/pin/e1_AfqPShwii4QvLhC/</link>
            <guid>pin-e1</guid>
            <description><![CDATA[<img src="https://i.pinimg.com/236x/11/22/33.jpg"/>]]></description>
          </item>
          <item>
            <title>No image item</title>
            <description>Just text</description>
          </item>
        </channel></rss>"#;

        let parsed = parse_pinterest_rss(xml, 10);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].title, "Cozy Desk Setup");
        assert_eq!(parsed[0].image_url, "https://i.pinimg.com/736x/ab/cd/ef.jpg");
        assert_eq!(parsed[0].source_url.as_deref(), Some("https://www.pinterest.com/pin/123/"));
        assert_eq!(parsed[1].title, "Obfuscated Link");
        assert_eq!(parsed[1].source_url.as_deref(), Some("https://i.pinimg.com/736x/11/22/33.jpg"));
        assert_eq!(parsed[0].provider, "pinterest");
    }

    #[test]
    fn parses_wallhaven_and_unsplash_payloads() {
        let wh = r#"{"data":[{"id":"q69w7r","url":"https://wallhaven.cc/w/q69w7r","path":"https://w.wallhaven.cc/full/q6/wallhaven-q69w7r.jpg","category":"anime"}]}"#;
        let wh_items = parse_wallhaven_json(wh, 5).unwrap();
        assert_eq!(wh_items.len(), 1);
        assert_eq!(wh_items[0].provider, "wallhaven");
        assert_eq!(wh_items[0].title, "Wallhaven · anime");

        let us = r#"{"results":[{"id":"abc","alt_description":"Minimal studio desk","urls":{"regular":"https://images.unsplash.com/photo-1"},"links":{"html":"https://unsplash.com/photos/abc"},"user":{"name":"Alex"}}]}"#;
        let us_items = parse_unsplash_json(us, true, 5).unwrap();
        assert_eq!(us_items.len(), 1);
        assert_eq!(us_items[0].title, "Minimal studio desk");
        assert_eq!(us_items[0].author.as_deref(), Some("Alex"));
    }

    #[test]
    fn parses_windows_registry_proxy_formats() {
        assert_eq!(
            parse_windows_proxy_server("127.0.0.1:7897").as_deref(),
            Some("http://127.0.0.1:7897")
        );
        assert_eq!(
            parse_windows_proxy_server("http=127.0.0.1:7890;https=127.0.0.1:7891").as_deref(),
            Some("http://127.0.0.1:7891")
        );
        assert_eq!(
            parse_windows_proxy_server("http://127.0.0.1:7897").as_deref(),
            Some("http://127.0.0.1:7897")
        );
        assert_eq!(parse_windows_proxy_server("   "), None);
    }

    #[test]
    fn shuffles_deterministically_and_validates_external_urls() {
        let mut items = vec![1, 2, 3, 4, 5, 6, 7, 8];
        shuffle_with_seed(&mut items, 42);
        assert_ne!(items, vec![1, 2, 3, 4, 5, 6, 7, 8]);
        let mut sorted = items.clone();
        sorted.sort();
        assert_eq!(sorted, vec![1, 2, 3, 4, 5, 6, 7, 8]);

        assert!(open_external_url("javascript:alert(1)").is_err());
        assert!(open_external_url("file:///C:/Windows/win.ini").is_err());
        assert!(open_external_url("").is_err());
    }
}
