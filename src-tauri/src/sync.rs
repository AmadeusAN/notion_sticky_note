use crate::database::{database_work, Database};
use crate::models::{normalize_notion_id, NotionConfig, NotionWriteMapping};
use crate::notion::{NotionClient, NotionError};
use serde::Serialize;
use std::collections::HashSet;
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::time::Duration;
use tokio::sync::{oneshot, watch, Notify};
use tokio::time::Instant;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub seq: u64,
    pub cycle_id: u64,
    pub status: String,
    pub last_successful_at: Option<i64>,
    pub pending_count: usize,
    pub unresolved_count: usize,
    pub error: Option<NotionError>,
    pub data_changed: bool,
    pub phase: String,
    pub progress_completed: usize,
    pub progress_total: usize,
    pub progress_message: Option<String>,
}

impl Default for SyncState {
    fn default() -> Self {
        Self {
            seq: 0,
            cycle_id: 0,
            status: "unconfigured".into(),
            last_successful_at: None,
            pending_count: 0,
            unresolved_count: 0,
            error: None,
            data_changed: false,
            phase: "idle".into(),
            progress_completed: 0,
            progress_total: 0,
            progress_message: None,
        }
    }
}


struct Round {
    id: u64,
    pull_requested: bool,
    pulling: bool,
    waiters: Vec<oneshot::Sender<SyncState>>,
}

#[derive(Default)]
struct Requests {
    next_id: u64,
    round: Option<Round>,
    push: bool,
    configuration: bool,
}

impl Requests {
    fn round(&mut self) -> &mut Round {
        self.round.get_or_insert_with(|| {
            self.next_id += 1;
            Round { id: self.next_id, pull_requested: false, pulling: false, waiters: Vec::new() }
        })
    }
}

type Observer = Arc<dyn Fn(&SyncState) + Send + Sync>;

pub struct SyncEngine {
    db: Arc<Database>,
    notion: NotionClient,
    requests: Mutex<Requests>,
    notify: Notify,
    state: watch::Sender<SyncState>,
    stop: watch::Sender<bool>,
    started: AtomicBool,
    observer: Mutex<Option<Observer>>,
}

impl SyncEngine {
    pub fn new(db: Arc<Database>, notion: NotionClient) -> Self {
        Self { db, notion, requests: Mutex::new(Requests::default()), notify: Notify::new(),
            state: watch::channel(SyncState::default()).0, stop: watch::channel(false).0,
            started: AtomicBool::new(false), observer: Mutex::new(None) }
    }

    pub fn client(&self) -> &NotionClient { &self.notion }

    pub fn get_state(&self) -> SyncState { self.state.borrow().clone() }

    fn publish(&self, update: impl FnOnce(&mut SyncState)) -> SyncState {
        self.state.send_modify(|state| {
            state.seq += 1;
            state.data_changed = false;
            update(state);
        });
        let state = self.get_state();
        if let Some(observer) = self.observer.lock().expect("sync observer lock").as_ref().cloned() {
            observer(&state);
        }
        state
    }

    pub fn configuration_changed(&self) {
        self.requests.lock().expect("sync request lock").configuration = true;
        self.notify.notify_one();
    }

    pub fn wake_pending(&self) {
        self.requests.lock().expect("sync request lock").push = true;
        self.notify.notify_one();
    }

    pub fn stop(&self) {
        self.stop.send_replace(true);
        self.notify.notify_one();
    }

    async fn cancelled(&self) {
        let mut stopped = self.stop.subscribe();
        let _ = stopped.wait_for(|stopped| *stopped).await;
    }

    pub fn start(self: Arc<Self>, observer: impl Fn(&SyncState) + Send + Sync + 'static) {
        if self.started.swap(true, Ordering::AcqRel) { return; }
        *self.observer.lock().expect("sync observer lock") = Some(Arc::new(observer));
        tauri::async_runtime::spawn(async move {
            self.run().await;
            let round = self.requests.lock().expect("sync request lock").round.take();
            if let Some(round) = round {
                let state = self.publish(|state| {
                    state.cycle_id = round.id;
                    state.status = "error".into();
                    state.error = Some(local_error("cancelled", crate::language::text("Sync has stopped.", "同步已停止")));
                });
                for waiter in round.waiters { let _ = waiter.send(state.clone()); }
            }
        });
    }

    pub async fn force_sync(&self) -> SyncState {
        if *self.stop.borrow() { return self.get_state(); }
        let (send, receive) = oneshot::channel();
        {
            let mut requests = self.requests.lock().expect("sync request lock");
            let round = requests.round();
            if !round.pulling { round.pull_requested = true; }
            round.waiters.push(send);
        }
        self.notify.notify_one();
        receive.await.unwrap_or_else(|_| self.get_state())
    }

    async fn context(&self) -> Result<(NotionConfig, u64), NotionError> {
        database_work(self.db.clone(), Database::notion_context).await
            .map_err(|_| local_error("storage", crate::language::text("Unable to read the Notion configuration.", "无法读取 Notion 配置")))
    }

    async fn summary(&self) -> Result<(usize, usize, u64), NotionError> {
        database_work(self.db.clone(), Database::pending_summary).await
            .map_err(|_| local_error("storage", crate::language::text("Unable to read the pending write queue.", "无法读取待回写队列")))
    }

    async fn dirty_count(&self) -> usize {
        database_work(self.db.clone(), Database::dirty_task_count)
            .await
            .unwrap_or(0)
    }

    async fn run(&self) {
        let started_at = Instant::now();
        let (mut configured, mut database_identity) = match self.context().await {
            Ok((config, _)) => (config.is_configured(), normalize_notion_id(&config.database_id)),
            Err(error) => {
                self.publish(|state| { state.status = "error".into(); state.error = Some(error); });
                (false, String::new())
            }
        };
        let initial_dirty = self.dirty_count().await;
        match self.summary().await {
            Ok((pending, unresolved, _)) => { self.publish(|state| {
                if state.error.is_none() { state.status = if configured { "idle" } else { "unconfigured" }.into(); }
                state.pending_count = pending + initial_dirty;
                state.unresolved_count = unresolved;
                state.phase = "idle".into();
            }); }
            Err(error) => { self.publish(|state| { state.status = "error".into(); state.error = Some(error); state.phase = "error".into(); }); }
        }
        // Single one-shot initial sync on startup; no periodic polling afterward.
        let mut deadline = configured.then(|| started_at + Duration::from_secs(2));
        let mut retry_until: Option<Instant> = None;
        let mut retry_forever = false;
        loop {
            // Register before checking requests/deadlines: no lost wake between the check and await.
            let notified = self.notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if *self.stop.borrow() { return; }
            let configuration = {
                let mut requests = self.requests.lock().expect("sync request lock");
                std::mem::take(&mut requests.configuration)
            };
            if configuration {
                match self.context().await {
                    Ok((config, _)) => {
                        let next_identity = normalize_notion_id(&config.database_id);
                        let switched = next_identity != database_identity;
                        database_identity = next_identity;
                        configured = config.is_configured();
                        deadline = configured.then(Instant::now);
                        let summary = self.summary().await;
                        let dirty = self.dirty_count().await;
                        self.publish(|state| {
                            state.status = if configured { "idle" } else { "unconfigured" }.into();
                            state.error = None;
                            state.phase = "idle".into();
                            if switched { state.last_successful_at = None; }
                            match summary {
                                Ok((pending, unresolved, _)) => {
                                    state.pending_count = pending + dirty;
                                    state.unresolved_count = unresolved;
                                }
                                Err(error) => { state.status = "error".into(); state.error = Some(error); state.phase = "error".into(); }
                            }
                        });
                    }
                    Err(error) => { self.publish(|state| { state.status = "error".into(); state.error = Some(error); state.phase = "error".into(); }); }
                }
            }
            let now = Instant::now();
            let due = deadline.is_some_and(|deadline| now >= deadline);
            let requested = {
                let requests = self.requests.lock().expect("sync request lock");
                requests.round.is_some() || requests.push
            };
            let cooling = retry_forever || retry_until.is_some_and(|retry| now < retry);
            if (due || requested) && (!cooling || !configured) {
                let id = {
                    let mut requests = self.requests.lock().expect("sync request lock");
                    requests.push = false;
                    let round = requests.round();
                    round.pull_requested |= due;
                    round.id
                };
                let work = self.run_round(id);
                tokio::pin!(work);
                let result = loop {
                    tokio::select! {
                        _ = self.cancelled() => return,
                        result = &mut work => break result,
                    }
                };
                if result.0 {
                    // Event-driven: stay quiet after pull completes unless explicitly woken.
                    deadline = None;
                }
                if let Some(milliseconds) = result.1 {
                    retry_until = result.2.checked_add(Duration::from_millis(milliseconds));
                    retry_forever = retry_until.is_none();
                } else if !cooling {
                    retry_until = None;
                    retry_forever = false;
                }
                continue;
            }
            let wake_at = if (!configured && !requested) || retry_forever { None }
                else if cooling { retry_until } else { deadline };
            if let Some(wake_at) = wake_at {
                tokio::select! {
                    _ = self.cancelled() => return,
                    _ = &mut notified => {},
                    _ = tokio::time::sleep_until(wake_at) => {},
                }
            } else {
                tokio::select! {
                    _ = self.cancelled() => return,
                    _ = &mut notified => {},
                }
            }
        }
    }

    async fn run_round(&self, id: u64) -> (bool, Option<u64>, Instant) {
        let mut error = None;
        let mut changed = false;
        let mut pulled = false;
        let context = self.context().await;
        let valid_config = context.as_ref().is_ok_and(|(config, _)| config.is_configured());
        if valid_config {
            let summary = self.summary().await.unwrap_or((0, 0, 0));
            let dirty = self.dirty_count().await;
            let initial_total = summary.0 + dirty;
            self.publish(|state| {
                state.cycle_id = id;
                state.status = "syncing".into();
                state.error = None;
                state.pending_count = initial_total;
                state.unresolved_count = summary.1;
                state.phase = if initial_total > 0 { "pushing" } else { "pulling" }.into();
                state.progress_completed = 0;
                state.progress_total = initial_total;
                state.progress_message = None;
            });
            let (config, version) = context.as_ref().expect("configured context");
            let (push_error, push_changed) = self.push_pending(config, *version, id).await;
            error = push_error;
            changed |= push_changed;
        } else if let Err(context_error) = &context {
            error = Some(context_error.clone());
        }
        let (round, pending_count, unresolved_count) = loop {
            let pull = {
                let mut requests = self.requests.lock().expect("sync request lock");
                let round = requests.round.as_mut().expect("active sync round");
                let pull = valid_config && !round.pulling && std::mem::take(&mut round.pull_requested);
                round.pulling |= pull;
                pull
            };
            if pull {
                pulled = true;
                let (config, version) = context.as_ref().expect("configured context");
                let current = database_work(self.db.clone(), Database::notion_version).await;
                let can_pull = match current {
                    Ok(current) if current == *version => true,
                    Ok(_) => { configuration_changed_error(&mut error); false }
                    Err(_) => { error = Some(local_error("storage", crate::language::text("Unable to verify the sync configuration version.", "无法核对同步配置版本"))); false }
                };
                if can_pull && !error.as_ref().is_some_and(NotionError::stops_pushes) {
                    self.publish(|state| {
                        state.cycle_id = id;
                        state.status = "syncing".into();
                        state.phase = "pulling".into();
                        state.progress_completed = 0;
                        state.progress_total = 0;
                        state.progress_message = None;
                    });
                    match self.notion.query_tasks_with_progress(config, |pulled_so_far| {
                        self.publish(|state| {
                            state.cycle_id = id;
                            state.status = "syncing".into();
                            state.phase = "pulling".into();
                            state.progress_completed = pulled_so_far;
                            state.progress_total = 0;
                            state.progress_message = Some(pulled_so_far.to_string());
                        });
                    }).await {
                        Ok(remote) => {
                            let version = *version;
                            match database_work(self.db.clone(), move |db| db.merge_notion_snapshot_with_groups(&remote, version)).await {
                                Ok(data_changed) => changed |= data_changed,
                                Err(_) => { error.get_or_insert_with(|| local_error("storage", crate::language::text("The Notion snapshot could not be saved. The previous cache is preserved.", "Notion 快照未能保存，旧缓存仍保留"))); }
                            }
                        }
                        Err(query_error) => {
                            if query_error.stops_pushes() { error = Some(query_error); }
                            else { error.get_or_insert(query_error); }
                        }
                    }
                }
                match database_work(self.db.clone(), Database::notion_version).await {
                    Ok(current_version) if current_version != *version => {
                        configuration_changed_error(&mut error);
                    }
                    Err(_) => { error.get_or_insert_with(|| local_error("storage", crate::language::text("Unable to verify the sync configuration version.", "无法核对同步配置版本"))); }
                    _ => {}
                }
            }
            let summary = self.summary().await;
            let dirty = self.dirty_count().await;
            let (pending, unresolved, _) = match summary {
                Ok(summary) => (summary.0 + dirty, summary.1, summary.2),
                Err(summary_error) => { error.get_or_insert(summary_error); (dirty, 0, 0) }
            };
            let mut requests = self.requests.lock().expect("sync request lock");
            let round = requests.round.as_ref().expect("active sync round");
            // Closing and checking a late manual join share the same lock.
            if valid_config && !round.pulling && round.pull_requested { continue; }
            break (requests.round.take().expect("active sync round"), pending, unresolved);
        };
        if unresolved_count > 0 {
            error.get_or_insert_with(|| local_error("configuration", crate::language::text("Some pending writes have an unverified source. Check the original database configuration.", "存在尚未验证来源的待回写记录，请检查原数据库配置")));
        }
        let retry = error.as_ref().and_then(|error| {
            if error.status == Some(429) { Some(error.retry_after_ms.unwrap_or(30_000).max(30_000)) } else { None }
        });
        let finished_at = Instant::now();
        let result = self.publish(|state| {
            state.cycle_id = id;
            state.status = if error.as_ref().is_some_and(|error| error.category == "storage") { "error" }
                else if !valid_config { "unconfigured" } else if error.is_some() { "error" }
                else if pulled || changed { "ok" } else { "idle" }.into();
            if valid_config && (pulled || changed) && error.is_none() {
                state.last_successful_at = Some(chrono::Utc::now().timestamp_millis());
            }
            state.pending_count = pending_count;
            state.unresolved_count = unresolved_count;
            state.error = error;
            state.data_changed = changed;
            state.phase = if state.status == "error" { "error" }
                else if state.status == "ok" { "done" }
                else { "idle" }.into();
            state.progress_completed = 0;
            state.progress_total = 0;
            state.progress_message = None;
        });
        for waiter in round.waiters { let _ = waiter.send(result.clone()); }
        (pulled, retry, finished_at)
    }

    async fn push_pending(&self, config: &NotionConfig, config_version: u64, cycle_id: u64) -> (Option<NotionError>, bool) {
        let database_identity = normalize_notion_id(&config.database_id);
        let mut attempted = HashSet::new();
        let mut attempted_dirty: HashSet<(String, i64)> = HashSet::new();
        let mut first_error = None;
        let mut data_changed = false;
        let mut completed_steps = 0usize;

        let initial_pending_len = database_work(self.db.clone(), Database::list_pending)
            .await
            .map_or(0, |v| v.len());
        let initial_dirty_len = self.dirty_count().await;
        let total_steps = initial_pending_len + initial_dirty_len;

        loop {
            let pending = match database_work(self.db.clone(), Database::list_pending).await {
                Ok(pending) => pending,
                Err(_) => return (Some(local_error("storage", crate::language::text("Unable to read the pending write queue.", "无法读取待回写队列"))), data_changed),
            };
            let mut sent = false;
            for operation in pending {
                if !attempted.insert((operation.id, operation.revision)) { continue; }
                sent = true;
                let Some(page_id) = operation.page_id else { continue; };
                if operation.database_id.as_deref().is_some_and(|database| normalize_notion_id(database) != database_identity) {
                    first_error.get_or_insert_with(|| local_error("configuration", crate::language::text("A pending write belongs to another database and was not sent to this database.", "待回写记录属于其他数据库，未发送到当前数据库")));
                    continue;
                }
                let (mapping, page_id) = if !operation.source_verified {
                    match self.notion.page_database_id(config, &page_id).await {
                        Ok(parent) if normalize_notion_id(&parent) == database_identity => {
                            let mapping = operation.mapping.unwrap_or_else(|| NotionWriteMapping::from_config(config));
                            let database_id = operation.database_id.unwrap_or_else(|| config.database_id.clone());
                            let op_id = operation.id; let revision = operation.revision;
                            match database_work(self.db.clone(), move |db| {
                                let bound = db.bind_pending(op_id, revision, &database_id, &page_id, &mapping)?;
                                Ok((bound, mapping, page_id))
                            }).await {
                                Ok((true, mapping, page_id)) => (mapping, page_id),
                                Ok((false, _, _)) => continue,
                                Err(_) => return (Some(local_error("storage", crate::language::text("Unable to save pending write source verification.", "无法保存待回写记录的来源验证"))), data_changed),
                            }
                        }
                        Ok(_) => continue,
                        Err(error) => {
                            if error.stops_pushes() { return (Some(error), data_changed); }
                            first_error.get_or_insert(error);
                            continue;
                        }
                    }
                } else {
                    let Some(mapping) = operation.mapping else { continue; };
                    (mapping, page_id)
                };
                let op_id = operation.id; let revision = operation.revision;
                match database_work(self.db.clone(), move |db| db.pending_for_send(op_id, revision, config_version)).await {
                    Ok(true) => {}
                    Ok(false) => continue,
                    Err(_) => return (Some(local_error("storage", crate::language::text("Unable to verify the pending write configuration version.", "无法核对待回写记录的配置版本"))), data_changed),
                }
                match self.notion.set_done(config, &mapping, &page_id, operation.completed).await {
                    Ok(()) => {
                        if database_work(self.db.clone(), move |db| db.clear_pending(op_id, revision)).await.is_err() {
                            return (Some(local_error("storage", crate::language::text("Notion accepted the update, but the local acknowledgment could not be saved. It will be retried idempotently.", "远端已接收，但待回写确认未能落库；稍后将幂等重试"))), data_changed);
                        }
                        data_changed = true;
                        completed_steps += 1;
                        self.publish(|state| {
                            state.cycle_id = cycle_id;
                            state.status = "syncing".into();
                            state.phase = "pushing".into();
                            state.progress_completed = completed_steps.min(total_steps.max(completed_steps));
                            state.progress_total = total_steps.max(completed_steps);
                        });
                    }
                    Err(error) => {
                        if error.stops_pushes() { return (Some(error), data_changed); }
                        first_error.get_or_insert(error);
                    }
                }
            }
            if !sent { break; }
        }

        // Now push dirty scheduled local/edited tasks (create_page or update_page).
        loop {
            let dirty = match database_work(self.db.clone(), Database::list_dirty_tasks).await {
                Ok(dirty) => dirty,
                Err(_) => return (Some(local_error("storage", crate::language::text("Unable to read pending local tasks.", "无法读取待同步本地任务"))), data_changed),
            };
            let mut sent = false;
            for (task, group_name) in dirty {
                if !attempted_dirty.insert((task.id.clone(), task.updated_time)) {
                    continue;
                }
                sent = true;
                match database_work(self.db.clone(), Database::notion_version).await {
                    Ok(v) if v == config_version => {}
                    Ok(_) => {
                        configuration_changed_error(&mut first_error);
                        return (first_error, data_changed);
                    }
                    Err(_) => {
                        return (Some(local_error("storage", crate::language::text("Unable to verify the sync configuration version.", "无法核对同步配置版本"))), data_changed);
                    }
                }
                let result_page_id = match task.notion_id.as_deref() {
                    Some(page_id) => {
                        self.notion
                            .update_page(config, page_id, &task, group_name.as_deref())
                            .await
                            .map(|_| page_id.to_string())
                    }
                    None => {
                        self.notion
                            .create_page(config, &task, group_name.as_deref())
                            .await
                    }
                };
                match result_page_id {
                    Ok(remote_page_id) => {
                        let task_id = task.id.clone();
                        let updated_time = task.updated_time;
                        if database_work(self.db.clone(), move |db| {
                            db.mark_task_synced(&task_id, &remote_page_id, updated_time)
                        }).await.is_err() {
                            return (Some(local_error("storage", crate::language::text("Notion accepted the update, but local sync state could not be saved.", "Notion 已接收，但本地同步状态未能保存"))), data_changed);
                        }
                        data_changed = true;
                        completed_steps += 1;
                        self.publish(|state| {
                            state.cycle_id = cycle_id;
                            state.status = "syncing".into();
                            state.phase = "pushing".into();
                            state.progress_completed = completed_steps.min(total_steps.max(completed_steps));
                            state.progress_total = total_steps.max(completed_steps);
                        });
                    }
                    Err(error) => {
                        if error.stops_pushes() { return (Some(error), data_changed); }
                        first_error.get_or_insert(error);
                    }
                }
            }
            if !sent { break; }
        }

        (first_error, data_changed)
    }
}

fn local_error(category: &str, message: &str) -> NotionError {
    NotionError { category: category.into(), message: message.into(), status: None, code: None, retry_after_ms: None }
}

fn configuration_changed_error(error: &mut Option<NotionError>) {
    if error.as_ref().is_some_and(|error| error.status == Some(429) || error.category == "configuration") { return; }
    *error = Some(local_error("configuration", crate::language::text("The Notion configuration changed. Syncing again with the new configuration.", "Notion 配置已变更，正在使用新配置重新同步")));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notion::test_support::{config, page, snapshot, Fixture, Reply};
    use crate::models::Task;
    use std::{future::Future, path::PathBuf, pin::Pin, task::Poll};

    const PAGE: &str = "11111111-1111-1111-1111-111111111111";
    static NEXT_DATABASE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    struct TestDb { path: PathBuf, db: Option<Arc<Database>> }

    impl TestDb {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("sticky-sync-{}-{}-{}.db",
                std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),
                NEXT_DATABASE.fetch_add(1, Ordering::Relaxed)));
            let db = Arc::new(Database::open(path.clone()).unwrap());
            db.save_notion_config(&config(), false, None).unwrap();
            Self { path, db: Some(db) }
        }
        fn db(&self) -> Arc<Database> { self.db.as_ref().unwrap().clone() }
        fn reopen(&mut self) {
            drop(self.db.take());
            self.db = Some(Arc::new(Database::open(self.path.clone()).unwrap()));
        }
    }

    impl Drop for TestDb {
        fn drop(&mut self) { drop(self.db.take()); let _ = std::fs::remove_file(&self.path); }
    }

    fn seed(db: &Database) -> Task {
        let task = Task { id: PAGE.into(), notion_id: Some(PAGE.into()), title: "Fixture task".into(),
            completed: false, progress: None, remain: None, date: None,
            start_date: None, end_date: None, start_time: None, end_time: None,
            reminder_at: None, reminded_at: None, tags: Vec::new(),
            updated_time: 1, group_id: crate::models::NOTION_GROUP_ID.into(), position: 0,
            sync_status: "synced".into() };
        db.merge_notion_snapshot(&[task.clone()], db.notion_context().unwrap().1).unwrap();
        task
    }

    fn run(db: Arc<Database>, fixture: &Fixture) -> (Arc<SyncEngine>, tokio::task::JoinHandle<()>) {
        let engine = Arc::new(SyncEngine::new(db, NotionClient::with_base_url(fixture.url())));
        let worker = engine.clone();
        let handle = tokio::spawn(async move { worker.run().await });
        (engine, handle)
    }

    async fn pending_once<F: Future>(mut future: Pin<&mut F>) {
        std::future::poll_fn(|context| {
            assert!(future.as_mut().poll(context).is_pending(), "request should be awaiting the joined round");
            Poll::Ready(())
        }).await;
    }

    #[tokio::test]
    async fn late_patch_ack_cannot_delete_a_newer_false_intent_and_manual_sync_joins_the_push() {
        let database = TestDb::new();
        let db = database.db();
        seed(&db);
        db.toggle_task(PAGE).unwrap();
        let (started, arrived) = oneshot::channel();
        let mut started = Some(started);
        let (release, blocked) = std::sync::mpsc::channel();
        let mut patches = 0;
        let fixture = Fixture::new(move |request| {
            if request.method == "PATCH" {
                patches += 1;
                if patches == 1 {
                    let _ = started.take().unwrap().send(());
                    let _ = blocked.recv();
                }
                Reply::ok(serde_json::json!({}))
            } else { Reply::ok(snapshot(vec![page(PAGE, false)])) }
        });
        let (engine, worker) = run(db.clone(), &fixture);
        engine.wake_pending();
        arrived.await.unwrap();
        let original_round = engine.get_state().cycle_id;
        db.toggle_task(PAGE).unwrap();
        engine.wake_pending();
        let force = engine.force_sync();
        tokio::pin!(force);
        pending_once(force.as_mut()).await;
        release.send(()).unwrap();
        let state = force.await;
        assert_eq!(state.cycle_id, original_round);
        assert_eq!(state.status, "ok");
        assert_eq!(state.pending_count, 0);
        assert!(!db.get_task(PAGE).unwrap().unwrap().completed);
        let requests = fixture.requests();
        let patches: Vec<_> = requests.iter().filter(|request| request.method == "PATCH").collect();
        assert_eq!(patches.len(), 2);
        assert_eq!(patches[0].body["properties"]["done?"]["checkbox"], true);
        assert_eq!(patches[1].body["properties"]["done?"]["checkbox"], false);
        assert_eq!(requests.iter().filter(|request| request.method == "POST").count(), 1);
        engine.stop(); worker.await.unwrap();
    }

    #[tokio::test]
    async fn a_toggle_while_query_is_in_flight_keeps_checkbox_but_accepts_remote_title() {
        let database = TestDb::new();
        let db = database.db();
        seed(&db);
        let (started, arrived) = oneshot::channel();
        let mut started = Some(started);
        let (release, blocked) = std::sync::mpsc::channel();
        let fixture = Fixture::new(move |request| {
            if request.method == "POST" {
                if let Some(started) = started.take() {
                    let _ = started.send(());
                    let _ = blocked.recv();
                }
                let mut remote = page(PAGE, false);
                remote["properties"]["Name"]["title"][0]["plain_text"] = serde_json::json!("Remote renamed title");
                Reply::ok(snapshot(vec![remote]))
            } else { Reply::ok(serde_json::json!({})) }
        });
        let (engine, worker) = run(db.clone(), &fixture);
        let sync = engine.clone();
        let force = tokio::spawn(async move { sync.force_sync().await });
        arrived.await.unwrap();
        db.toggle_task(PAGE).unwrap();
        engine.wake_pending();
        release.send(()).unwrap();
        let state = force.await.unwrap();
        assert!(state.data_changed);
        let task = db.get_task(PAGE).unwrap().unwrap();
        assert!(task.completed);
        assert_eq!(task.title, "Remote renamed title");
        engine.stop(); worker.await.unwrap();
    }

    #[tokio::test]
    async fn concurrent_full_sync_requests_share_the_actual_query_and_result() {
        let database = TestDb::new();
        let (started, arrived) = oneshot::channel();
        let mut started = Some(started);
        let (release, blocked) = std::sync::mpsc::channel();
        let fixture = Fixture::new(move |_| {
            if let Some(started) = started.take() {
                let _ = started.send(());
                let _ = blocked.recv();
            }
            Reply::ok(snapshot(vec![page(PAGE, false)]))
        });
        let (engine, worker) = run(database.db(), &fixture);
        let sync = engine.clone();
        let first = tokio::spawn(async move { sync.force_sync().await });
        arrived.await.unwrap();
        let second = engine.force_sync();
        tokio::pin!(second);
        pending_once(second.as_mut()).await;
        release.send(()).unwrap();
        let first = first.await.unwrap();
        let second = second.await;
        assert_eq!(first.cycle_id, second.cycle_id);
        assert_eq!(first.last_successful_at, second.last_successful_at);
        assert_eq!(second.status, "ok");
        assert!(second.last_successful_at.is_some());
        assert_eq!(fixture.requests().len(), 1);
        engine.stop(); worker.await.unwrap();
    }

    #[tokio::test]
    async fn page_write_failure_retains_intent_and_cannot_be_reported_as_full_success() {
        let database = TestDb::new();
        let db = database.db();
        seed(&db);
        db.toggle_task(PAGE).unwrap();
        let fixture = Fixture::new(|request| {
            if request.method == "PATCH" { Reply::error(500, "internal_server_error", "private title") }
            else { Reply::ok(snapshot(vec![])) }
        });
        let (engine, worker) = run(db.clone(), &fixture);
        let state = engine.force_sync().await;
        assert_eq!(state.status, "error");
        assert!(state.last_successful_at.is_none());
        assert_eq!(state.pending_count, 1);
        assert!(db.get_task(PAGE).unwrap().unwrap().completed);
        assert_eq!(db.list_pending().unwrap().len(), 1);
        assert_eq!(fixture.requests().iter().filter(|request| request.method == "POST").count(), 1);
        engine.stop(); worker.await.unwrap();
    }

    #[tokio::test]
    async fn durable_outbox_reopens_and_resends_after_an_offline_exit() {
        let mut database = TestDb::new();
        {
            let db = database.db();
            seed(&db);
            db.toggle_task(PAGE).unwrap();
            let fixture = Fixture::new(|_| Reply { status: 0, body: serde_json::Value::Null, retry_after: None });
            let (engine, worker) = run(db.clone(), &fixture);
            let state = engine.force_sync().await;
            assert_eq!(state.status, "error");
            assert_eq!(state.error.unwrap().category, "transport");
            assert_eq!(db.list_pending().unwrap().len(), 1);
            engine.stop(); worker.await.unwrap();
        }
        database.reopen();
        let db = database.db();
        let fixture = Fixture::new(|request| if request.method == "PATCH" {
            Reply::ok(serde_json::json!({}))
        } else { Reply::ok(snapshot(vec![page(PAGE, true)])) });
        let (engine, worker) = run(db.clone(), &fixture);
        let state = engine.force_sync().await;
        assert_eq!(state.status, "ok");
        assert_eq!(state.pending_count, 0);
        assert!(db.get_task(PAGE).unwrap().unwrap().completed);
        assert_eq!(fixture.requests().iter().filter(|request| request.method == "PATCH").count(), 1);
        engine.stop(); worker.await.unwrap();
    }

    #[tokio::test]
    async fn unconfigured_force_sync_is_truthful_and_has_no_periodic_http() {
        let database = TestDb::new();
        let db = database.db();
        db.save_notion_config(&NotionConfig::default(), false, None).unwrap();
        let fixture = Fixture::new(|_| Reply::ok(snapshot(vec![])));
        let (engine, worker) = run(db, &fixture);
        let state = engine.force_sync().await;
        assert_eq!(state.status, "unconfigured");
        assert!(state.last_successful_at.is_none());
        tokio::time::pause();
        tokio::time::advance(Duration::from_secs(300)).await;
        tokio::task::yield_now().await;
        assert!(fixture.requests().is_empty());
        engine.stop(); worker.await.unwrap();
    }

    #[tokio::test]
    async fn migrated_intent_requires_matching_page_parent_before_any_patch() {
        for parent_matches in [false, true] {
            let mut database = TestDb::new();
            { seed(&database.db()); }
            drop(database.db.take());
            {
                let connection = rusqlite::Connection::open(&database.path).unwrap();
                connection.execute_batch(
                    "PRAGMA user_version=0;
                     DROP TABLE pending_ops;
                     CREATE TABLE pending_ops (
                       id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
                       completed INTEGER NOT NULL, created_at INTEGER NOT NULL);"
                ).unwrap();
                connection.execute(
                    "INSERT INTO pending_ops(task_id,completed,created_at) VALUES(?1,1,1)",
                    rusqlite::params![PAGE],
                ).unwrap();
            }
            database.reopen();
            let fixture = Fixture::new(move |request| {
                if request.method == "GET" {
                    let parent = if parent_matches { config().database_id } else { "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".into() };
                    Reply::ok(serde_json::json!({"parent":{"database_id":parent}}))
                } else if request.method == "PATCH" {
                    Reply::ok(serde_json::json!({}))
                } else {
                    Reply::ok(snapshot(vec![page(PAGE, parent_matches)]))
                }
            });
            let db = database.db();
            let (engine, worker) = run(db.clone(), &fixture);
            let state = engine.force_sync().await;
            assert_eq!(state.status, if parent_matches { "ok" } else { "error" });
            assert_eq!(state.unresolved_count, usize::from(!parent_matches));
            assert_eq!(db.list_pending().unwrap().len(), usize::from(!parent_matches));
            assert!(db.get_task(PAGE).unwrap().unwrap().completed);
            let requests = fixture.requests();
            assert_eq!(requests[0].method, "GET");
            assert_eq!(requests.iter().filter(|request| request.method == "PATCH").count(), usize::from(parent_matches));
            if parent_matches {
                assert_eq!(requests[1].method, "PATCH");
                assert_eq!(requests[1].body["properties"]["done?"]["checkbox"], true);
            }
            engine.stop(); worker.await.unwrap();
        }
    }

    #[tokio::test]
    async fn configured_startup_queries_after_two_seconds_not_immediately() {
        let database = TestDb::new();
        let (sent, received) = oneshot::channel();
        let mut sent = Some(sent);
        let fixture = Fixture::new(move |_| {
            if let Some(sent) = sent.take() { let _ = sent.send(()); }
            Reply::ok(snapshot(vec![]))
        });
        let (engine, worker) = run(database.db(), &fixture);
        let mut states = engine.state.subscribe();
        while states.borrow().seq == 0 { states.changed().await.unwrap(); }
        tokio::time::pause();
        tokio::time::advance(Duration::from_secs(1)).await;
        tokio::task::yield_now().await;
        assert!(fixture.requests().is_empty());
        tokio::time::advance(Duration::from_secs(1)).await;
        tokio::time::resume();
        received.await.unwrap();
        engine.stop(); worker.await.unwrap();
    }

    #[tokio::test]
    async fn event_driven_sync_does_not_poll_when_idle() {
        let database = TestDb::new();
        let fixture = Fixture::new(|_| Reply::ok(snapshot(vec![])));
        let (engine, worker) = run(database.db(), &fixture);
        assert_eq!(engine.force_sync().await.status, "ok");
        tokio::time::pause();
        tokio::time::advance(Duration::from_secs(300)).await;
        tokio::task::yield_now().await;
        assert_eq!(fixture.requests().len(), 1);
        engine.stop(); worker.await.unwrap();
    }

    #[tokio::test]
    async fn checkbox_wakeup_pushes_without_an_extra_full_query() {
        let database = TestDb::new();
        let db = database.db();
        seed(&db);
        db.toggle_task(PAGE).unwrap();
        let fixture = Fixture::new(|_| Reply::ok(serde_json::json!({})));
        let (engine, worker) = run(db.clone(), &fixture);
        let mut states = engine.state.subscribe();
        engine.wake_pending();
        loop {
            let state = states.borrow().clone();
            if state.cycle_id > 0 && state.status == "ok" && state.pending_count == 0 { break; }
            states.changed().await.unwrap();
        }
        let requests = fixture.requests();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].method, "PATCH");
        assert!(engine.get_state().last_successful_at.is_some());
        engine.stop(); worker.await.unwrap();
    }

    #[tokio::test]
    async fn wake_pending_pushes_scheduled_local_task_and_skips_unscheduled() {
        let database = TestDb::new();
        let db = database.db();
        let group = db.create_group("Research").unwrap();
        let unscheduled = db.import_local_tasks_with_schedule(
            vec!["Unscheduled item".into()],
            Some(&group.id),
            None,
            None,
        ).unwrap().tasks.remove(0);
        assert_eq!(unscheduled.sync_status, "unscheduled");

        let scheduled = db.import_local_tasks_with_schedule(
            vec!["Scheduled item".into()],
            Some(&group.id),
            None,
            Some(crate::models::TaskScheduleInput {
                start_date: Some("2026-11-28".into()),
                end_date: None,
                start_time: None,
                end_time: None,
                reminder_at: None,
            }),
        ).unwrap().tasks.remove(0);
        assert_eq!(scheduled.sync_status, "pending");

        let fixture = Fixture::new(|request| {
            if request.method == "POST" && request.path == "/v1/pages" {
                Reply::ok(serde_json::json!({"id": PAGE}))
            } else {
                Reply::ok(snapshot(vec![]))
            }
        });
        let (engine, worker) = run(db.clone(), &fixture);
        let mut states = engine.state.subscribe();
        engine.wake_pending();
        loop {
            let state = states.borrow().clone();
            if state.cycle_id > 0 && state.status == "ok" && state.pending_count == 0 { break; }
            states.changed().await.unwrap();
        }
        let requests = fixture.requests();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].method, "POST");
        assert_eq!(requests[0].path, "/v1/pages");
        assert_eq!(requests[0].body["properties"]["Tags"]["select"]["name"], "event");
        assert_eq!(requests[0].body["properties"]["Tags 2"]["multi_select"][0]["name"], "Research");

        let reloaded_scheduled = db.get_task(&scheduled.id).unwrap().unwrap();
        assert_eq!(reloaded_scheduled.sync_status, "synced");
        assert!(reloaded_scheduled.notion_id.is_some());

        let reloaded_unscheduled = db.get_task(&unscheduled.id).unwrap().unwrap();
        assert_eq!(reloaded_unscheduled.sync_status, "unscheduled");
        assert!(reloaded_unscheduled.notion_id.is_none());
        engine.stop(); worker.await.unwrap();
    }

    #[tokio::test]
    async fn valid_retry_after_cannot_be_bypassed_by_manual_sync() {
        let database = TestDb::new();
        let db = database.db();
        seed(&db);
        db.toggle_task(PAGE).unwrap();
        let mut writes = 0;
        let fixture = Fixture::new(move |request| {
            if request.method == "PATCH" {
                writes += 1;
                if writes == 1 {
                    let mut reply = Reply::error(429, "rate_limited", "limited");
                    reply.retry_after = Some("120".into());
                    return reply;
                }
                Reply::ok(serde_json::json!({}))
            } else { Reply::ok(snapshot(vec![page(PAGE, true)])) }
        });
        let (engine, worker) = run(db.clone(), &fixture);
        let limited = engine.force_sync().await;
        assert_eq!(limited.error.unwrap().status, Some(429));
        assert_eq!(limited.pending_count, 1);
        let retry = engine.force_sync();
        tokio::pin!(retry);
        pending_once(retry.as_mut()).await;
        tokio::time::pause();
        tokio::time::advance(Duration::from_secs(119)).await;
        tokio::task::yield_now().await;
        assert_eq!(fixture.requests().len(), 1);
        tokio::time::advance(Duration::from_secs(1)).await;
        tokio::time::resume();
        let state = retry.await;
        assert_eq!(state.status, "ok");
        assert_eq!(state.pending_count, 0);
        engine.stop(); worker.await.unwrap();
    }

    #[tokio::test]
    async fn old_database_query_cannot_replace_new_database_cache_or_report_success() {
        let database = TestDb::new();
        let db = database.db();
        let (started, arrived) = oneshot::channel();
        let mut started = Some(started);
        let (release, blocked) = std::sync::mpsc::channel();
        let new_page = "22222222-2222-2222-2222-222222222222";
        let fixture = Fixture::new(move |request| {
            if request.path.contains("aaaaaaaa") {
                if let Some(started) = started.take() {
                    let _ = started.send(());
                    let _ = blocked.recv();
                }
                Reply::ok(snapshot(vec![page(PAGE, false)]))
            } else { Reply::ok(snapshot(vec![page(new_page, false)])) }
        });
        let (engine, worker) = run(db.clone(), &fixture);
        let sync = engine.clone();
        let old = tokio::spawn(async move { sync.force_sync().await });
        arrived.await.unwrap();
        let mut next = config();
        next.database_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".into();
        db.save_notion_config(&next, false, None).unwrap();
        engine.configuration_changed();
        release.send(()).unwrap();
        let old = old.await.unwrap();
        assert_ne!(old.status, "ok");
        assert!(old.last_successful_at.is_none());
        let current = engine.force_sync().await;
        assert_eq!(current.status, "ok");
        assert!(db.get_task(PAGE).unwrap().is_none());
        assert_eq!(db.list_tasks().unwrap().iter().map(|task| task.id.as_str()).collect::<Vec<_>>(), [new_page]);
        engine.stop(); worker.await.unwrap();
    }

    #[tokio::test]
    async fn clearing_configuration_immediately_reports_unconfigured_and_stops_periodic_http() {
        let database = TestDb::new();
        let db = database.db();
        let fixture = Fixture::new(|_| Reply::ok(snapshot(vec![])));
        let (engine, worker) = run(db.clone(), &fixture);
        assert_eq!(engine.force_sync().await.status, "ok");
        db.save_notion_config(&NotionConfig::default(), false, None).unwrap();
        engine.configuration_changed();
        let state = engine.force_sync().await;
        assert_eq!(state.status, "unconfigured");
        assert!(state.last_successful_at.is_none());
        tokio::time::pause();
        tokio::time::advance(Duration::from_secs(300)).await;
        tokio::task::yield_now().await;
        assert_eq!(fixture.requests().len(), 1);
        engine.stop(); worker.await.unwrap();
    }
}
