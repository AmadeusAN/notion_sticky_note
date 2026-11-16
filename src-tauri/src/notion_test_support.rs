use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::thread::JoinHandle;

#[derive(Clone, Debug)]
pub struct Request {
    pub method: String,
    pub path: String,
    pub body: Value,
}

pub struct Reply {
    pub status: u16,
    pub body: Value,
    pub retry_after: Option<String>,
}

impl Reply {
    pub fn ok(body: Value) -> Self { Self { status: 200, body, retry_after: None } }
    pub fn error(status: u16, code: &str, message: &str) -> Self {
        Self { status, body: json!({"code":code,"message":message}), retry_after: None }
    }
}

pub struct Fixture {
    address: SocketAddr,
    requests: Arc<Mutex<Vec<Request>>>,
    stopped: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Fixture {
    pub fn new(mut handler: impl FnMut(Request) -> Reply + Send + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("fixture listener");
        let address = listener.local_addr().unwrap();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = requests.clone();
        let stopped = Arc::new(AtomicBool::new(false));
        let stop = stopped.clone();
        let thread = std::thread::spawn(move || {
            for connection in listener.incoming() {
                let Ok(mut connection) = connection else { break; };
                if stop.load(Ordering::Acquire) { break; }
                let Some(request) = read_request(&mut connection) else { continue; };
                captured.lock().unwrap().push(request.clone());
                let reply = handler(request);
                if reply.status == 0 { continue; } // Deliberate transport disconnect, not an HTTP response.
                let body = reply.body.to_string();
                let retry = reply.retry_after.map(|value| format!("Retry-After: {value}\r\n")).unwrap_or_default();
                let header = format!("HTTP/1.1 {} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{}\r\n", reply.status, body.len(), retry);
                let _ = connection.write_all(header.as_bytes());
                let _ = connection.write_all(body.as_bytes());
            }
        });
        Self { address, requests, stopped, thread: Some(thread) }
    }

    pub fn url(&self) -> String { format!("http://{}/v1", self.address) }
    pub fn requests(&self) -> Vec<Request> { self.requests.lock().unwrap().clone() }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Release);
        let _ = TcpStream::connect(self.address);
        if let Some(thread) = self.thread.take() { let _ = thread.join(); }
    }
}

fn read_request(connection: &mut TcpStream) -> Option<Request> {
    connection.set_read_timeout(Some(std::time::Duration::from_secs(5))).ok()?;
    let mut bytes = Vec::with_capacity(4096);
    let mut buffer = [0u8; 4096];
    let header_end = loop {
        let read = connection.read(&mut buffer).ok()?;
        if read == 0 { return None; }
        bytes.extend_from_slice(&buffer[..read]);
        if let Some(end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") { break end + 4; }
        if bytes.len() > 65_536 { return None; }
    };
    let header = std::str::from_utf8(&bytes[..header_end]).ok()?;
    let mut first_line = header.lines().next()?.split_whitespace();
    let method = first_line.next()?.to_owned();
    let path = first_line.next()?.to_owned();
    let length = header.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case("content-length").then(|| value.trim().parse::<usize>().ok()).flatten()
    }).unwrap_or(0);
    if length > 1_048_576 { return None; }
    while bytes.len() - header_end < length {
        let read = connection.read(&mut buffer).ok()?;
        if read == 0 { return None; }
        bytes.extend_from_slice(&buffer[..read]);
    }
    let body = if length == 0 { Value::Null } else { serde_json::from_slice(&bytes[header_end..header_end + length]).ok()? };
    Some(Request { method, path, body })
}

pub fn config() -> crate::models::NotionConfig {
    crate::models::NotionConfig {
        token: "fixture-token".into(), database_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa".into(),
        ..Default::default()
    }
}

pub fn page(id: &str, completed: bool) -> Value {
    let today = chrono::Local::now().date_naive();
    let start = (today - chrono::Duration::days(1)).to_string();
    let end = (today + chrono::Duration::days(1)).to_string();
    json!({"id":id,"last_edited_time":"2026-01-01T00:00:00.000Z","properties":{
        "Name":{"type":"title","title":[{"plain_text":"Fixture task"}]},
        "done?":{"type":"checkbox","checkbox":completed},
        "Date":{"type":"date","date":{"start":start,"end":end}}
    }})
}

pub fn snapshot(pages: Vec<Value>) -> Value {
    json!({"results":pages,"has_more":false,"next_cursor":null})
}
