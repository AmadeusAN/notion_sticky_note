use crate::database::{database_work, Database};
use crate::models::{
    AppearanceSaveState, AppearanceSaveStatus, AppearanceSettings, FxAppearancePayload,
    FxPreferences, SettingsSnapshot,
};
use crate::window_state::WindowStateV2;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Notify;
use tokio::time::Instant;

type Observer = Arc<dyn Fn(AppearanceSaveState) + Send + Sync>;

struct Slot<T> {
    value: T,
    version: u64,
    dirty: bool,
    failed: Option<String>,
    deadline: Instant,
}

impl<T> Slot<T> {
    fn new(value: T) -> Self {
        Self { value, version: 0, dirty: false, failed: None, deadline: Instant::now() }
    }
}

struct FlushAttempt {
    result: Mutex<Option<Result<(), String>>>,
    done: Notify,
}

impl FlushAttempt {
    fn complete(&self, result: Result<(), String>) {
        *self.result.lock().unwrap() = Some(result);
        self.done.notify_waiters();
    }
}

struct State {
    appearance: Slot<AppearanceSettings>,
    window: Slot<Option<WindowStateV2>>,
    save_state: AppearanceSaveState,
    observer: Option<Observer>,
    started: bool,
    stopped: bool,
    flush: Option<Arc<FlushAttempt>>,
}

enum Write {
    Appearance(u64, AppearanceSettings),
    Window(u64, WindowStateV2),
}

/// One scheduler and two latest-value slots; no queue grows with pointer events.
pub struct PreferencesWriter {
    db: Arc<Database>,
    state: Mutex<State>,
    wake: Notify,
    #[cfg(test)]
    before_write: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
}

impl PreferencesWriter {
    pub fn new(
        db: Arc<Database>,
        initial: AppearanceSettings,
        window: Option<WindowStateV2>,
    ) -> Arc<Self> {
        Arc::new(Self {
            db,
            state: Mutex::new(State {
                appearance: Slot::new(initial),
                window: Slot::new(window),
                save_state: AppearanceSaveState {
                    revision: 0, status: AppearanceSaveStatus::Saved, error: None,
                },
                observer: None,
                started: false,
                stopped: false,
                flush: None,
            }),
            wake: Notify::new(),
            #[cfg(test)]
            before_write: Mutex::new(None),
        })
    }

    pub fn start(self: Arc<Self>, observer: impl Fn(AppearanceSaveState) + Send + Sync + 'static) {
        {
            let mut state = self.state.lock().unwrap();
            if state.started || state.stopped { return; }
            state.started = true;
            state.observer = Some(Arc::new(observer));
        }
        #[cfg(not(test))]
        tauri::async_runtime::spawn(self.run());
        #[cfg(test)]
        tokio::spawn(self.run());
    }

    pub fn update_appearance(
        &self,
        mut appearance: AppearanceSettings,
        client_revision: u64,
    ) -> Result<AppearanceSaveState, String> {
        if !appearance.fx_intensity.is_finite() { return Err(crate::language::text("Invalid effect intensity.", "动效强度无效").into()); }
        appearance.fx_intensity = appearance.fx_intensity.clamp(0.4, 1.6);
        let result = {
            let mut state = self.state.lock().unwrap();
            if state.stopped { return Err(crate::language::text("The settings writer has stopped.", "设置保存器已停止").into()); }
            if client_revision < state.appearance.version
                || (client_revision == state.appearance.version && appearance != state.appearance.value)
            {
                return Err(crate::language::text("This appearance preview is outdated. Reload settings.", "外观预览版本已过期，请重新读取设置").into());
            }
            if client_revision == state.appearance.version { return Ok(state.save_state.clone()); }
            state.appearance = Slot {
                value: appearance, version: client_revision, dirty: true, failed: None,
                deadline: Instant::now() + Duration::from_millis(200),
            };
            state.save_state = AppearanceSaveState {
                revision: client_revision, status: AppearanceSaveStatus::Saving, error: None,
            };
            state.save_state.clone()
        };
        self.publish(result.clone());
        self.wake.notify_one();
        Ok(result)
    }

    pub fn update_window_state(&self, window: WindowStateV2) -> Result<(), String> {
        window.validate()?;
        let mut state = self.state.lock().unwrap();
        if state.stopped { return Err(crate::language::text("The settings writer has stopped.", "设置保存器已停止").into()); }
        if state.window.value.as_ref() == Some(&window) && state.window.failed.is_none() {
            return Ok(());
        }
        let version = state.window.version.checked_add(1)
            .ok_or_else(|| crate::language::text("The window settings version counter is exhausted.", "窗口设置版本计数已满").to_string())?;
        state.window = Slot {
            value: Some(window), version, dirty: true, failed: None,
            deadline: Instant::now() + Duration::from_millis(220),
        };
        drop(state);
        self.wake.notify_one();
        Ok(())
    }

    pub fn latest_appearance(&self) -> AppearanceSettings {
        self.state.lock().unwrap().appearance.value.clone()
    }

    pub fn latest_window_state(&self) -> Option<WindowStateV2> {
        self.state.lock().unwrap().window.value.clone()
    }

    pub fn save_state(&self) -> AppearanceSaveState {
        self.state.lock().unwrap().save_state.clone()
    }

    pub fn fx_preferences(&self) -> FxPreferences {
        let state = self.state.lock().unwrap();
        let appearance = &state.appearance.value;
        FxPreferences {
            theme: appearance.fx_theme.clone(),
            appearance: FxAppearancePayload {
                bg: appearance.note_bg.clone(), fg: appearance.note_fg.clone(),
                accent: appearance.note_accent.clone(), pop: appearance.note_pop.clone(),
                intensity: appearance.fx_intensity, edge_boost: appearance.fx_edge_boost,
            },
        }
    }

    pub async fn settings_snapshot(&self) -> Result<SettingsSnapshot, String> {
        let mut settings = database_work(self.db.clone(), |db| db.load_settings()).await?;
        let state = self.state.lock().unwrap();
        state.appearance.value.apply_to(&mut settings);
        Ok(SettingsSnapshot { settings, appearance_save_state: state.save_state.clone() })
    }

    pub async fn flush(&self) -> Result<(), String> {
        let (attempt, saving) = {
            let mut state = self.state.lock().unwrap();
            if state.stopped { return Err(crate::language::text("The settings writer has stopped.", "设置保存器已停止").into()); }
            if !state.started { return Err(crate::language::text("The settings writer has not started.", "设置保存器尚未启动").into()); }
            if let Some(attempt) = &state.flush {
                (attempt.clone(), None)
            } else {
                let attempt = Arc::new(FlushAttempt { result: Mutex::new(None), done: Notify::new() });
                state.appearance.failed = None;
                state.window.failed = None;
                let saving = if state.appearance.dirty {
                    state.save_state.status = AppearanceSaveStatus::Saving;
                    state.save_state.error = None;
                    Some(state.save_state.clone())
                } else { None };
                state.flush = Some(attempt.clone());
                (attempt, saving)
            }
        };
        if let Some(saving) = saving { self.publish(saving); }
        self.wake.notify_one();
        loop {
            let notified = attempt.done.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if let Some(result) = attempt.result.lock().unwrap().clone() { return result; }
            notified.await;
        }
    }

    pub fn stop(&self) {
        let attempt = {
            let mut state = self.state.lock().unwrap();
            state.stopped = true;
            state.observer = None;
            state.flush.take()
        };
        if let Some(attempt) = attempt { attempt.complete(Err(crate::language::text("The settings writer has stopped.", "设置保存器已停止").into())); }
        self.wake.notify_one();
    }

    fn publish(&self, event: AppearanceSaveState) {
        let observer = self.state.lock().unwrap().observer.clone();
        if let Some(observer) = observer { observer(event); }
    }

    async fn run(self: Arc<Self>) {
        loop {
            // Register before checking state: updates cannot be lost between check and sleep.
            let notified = self.wake.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let (write, deadline, completed_flush) = {
                let mut state = self.state.lock().unwrap();
                if state.stopped { return; }
                let appearance_ready = state.appearance.dirty && state.appearance.failed.is_none();
                let window_ready = state.window.dirty && state.window.failed.is_none();
                let completed_flush = if !appearance_ready && !window_ready {
                    state.flush.take().map(|attempt| {
                        let error = state.appearance.failed.clone().or_else(|| state.window.failed.clone());
                        (attempt, error.map_or(Ok(()), Err))
                    })
                } else { None };
                let force = state.flush.is_some();
                let now = Instant::now();
                let deadline = match (appearance_ready, window_ready) {
                    (true, true) => Some(state.appearance.deadline.min(state.window.deadline)),
                    (true, false) => Some(state.appearance.deadline),
                    (false, true) => Some(state.window.deadline),
                    _ => None,
                };
                let write = if appearance_ready && (force || state.appearance.deadline <= now)
                    && (!window_ready || state.appearance.deadline <= state.window.deadline)
                {
                    Some(Write::Appearance(state.appearance.version, state.appearance.value.clone()))
                } else if window_ready && (force || state.window.deadline <= now) {
                    state.window.value.clone().map(|value| Write::Window(state.window.version, value))
                } else { None };
                (write, deadline, completed_flush)
            };
            if let Some((attempt, result)) = completed_flush { attempt.complete(result); }
            if let Some(write) = write {
                #[cfg(test)]
                let hook = self.before_write.lock().unwrap().clone();
                let version = match &write {
                    Write::Appearance(version, _) | Write::Window(version, _) => *version,
                };
                let is_appearance = matches!(&write, Write::Appearance(..));
                let result = database_work(self.db.clone(), move |db| {
                    #[cfg(test)]
                    if let Some(hook) = hook { hook(); }
                    match write {
                        Write::Appearance(_, value) => db.save_appearance(&value),
                        Write::Window(_, value) => db.save_window_state(&value),
                    }
                }).await;
                let event = {
                    let mut state = self.state.lock().unwrap();
                    if state.stopped { return; }
                    if is_appearance && state.appearance.version == version {
                        match result {
                            Ok(_) => {
                                state.appearance.dirty = false;
                                state.appearance.failed = None;
                                state.save_state.status = AppearanceSaveStatus::Saved;
                                state.save_state.error = None;
                            }
                            Err(error) => {
                                state.appearance.failed = Some(error.clone());
                                state.save_state.status = AppearanceSaveStatus::Error;
                                state.save_state.error = Some(error);
                            }
                        }
                        Some(state.save_state.clone())
                    } else if !is_appearance && state.window.version == version {
                        match result {
                            Ok(_) => { state.window.dirty = false; state.window.failed = None; }
                            Err(error) => state.window.failed = Some(error),
                        }
                        None
                    } else { None }
                };
                if let Some(event) = event { self.publish(event); }
                continue;
            }
            if let Some(deadline) = deadline {
                tokio::select! {
                    _ = tokio::time::sleep_until(deadline) => {},
                    _ = &mut notified => {},
                }
            } else {
                notified.await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::NotionConfig;
    use crate::window_state::{DockPhase, WindowRestore};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::Condvar;
    use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};

    struct Fixture {
        writer: Arc<PreferencesWriter>,
        db: Arc<Database>,
        path: PathBuf,
        events: UnboundedReceiver<AppearanceSaveState>,
    }

    impl Fixture {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "sticky-preferences-{}-{}.db", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed),
            ));
            let db = Arc::new(Database::open(path.clone()).unwrap());
            let initial = AppearanceSettings::from_settings(&db.load_settings().unwrap());
            db.set_setting("theme", &initial.theme).unwrap();
            let writer = PreferencesWriter::new(db.clone(), initial, None);
            let (sender, events) = unbounded_channel();
            writer.clone().start(move |event| { let _ = sender.send(event); });
            Self { writer, db, path, events }
        }

        fn appearance(&self, theme: &str) -> AppearanceSettings {
            let mut appearance = self.writer.latest_appearance();
            appearance.theme = theme.into();
            appearance
        }

        fn sql(&self, sql: &str) {
            rusqlite::Connection::open(&self.path).unwrap().execute_batch(sql).unwrap();
        }

        fn reject_appearance(&self) {
            self.sql(
                "CREATE TRIGGER reject_appearance BEFORE UPDATE ON settings WHEN NEW.key = 'theme'
                 BEGIN SELECT RAISE(ABORT, 'isolated save failure'); END;",
            );
        }

        async fn event(&mut self, revision: u64, status: AppearanceSaveStatus) -> AppearanceSaveState {
            loop {
                let event = self.events.recv().await.expect("writer observer closed");
                if event.revision == revision && event.status == status { return event; }
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) { self.writer.stop(); }
    }

    fn window(x: i32) -> WindowStateV2 {
        WindowStateV2 {
            version: 2, phase: DockPhase::Free, edge: None,
            restore: WindowRestore {
                x, y: 20, width: 320.0, height: 500.0, monitor_id: None, saved_scale: 1.0,
            },
        }
    }

    // Only tests hold a blocking save at a precise boundary; persistence remains real SQLite.
    struct WriteGate {
        inner: Arc<(Mutex<bool>, Condvar)>,
    }

    impl WriteGate {
        fn install(writer: &PreferencesWriter) -> (Self, UnboundedReceiver<()>) {
            let inner = Arc::new((Mutex::new(false), Condvar::new()));
            let gate = inner.clone();
            let first = AtomicBool::new(true);
            let (sender, receiver) = unbounded_channel();
            *writer.before_write.lock().unwrap() = Some(Arc::new(move || {
                if !first.swap(false, Ordering::SeqCst) { return; }
                sender.send(()).unwrap();
                let (lock, ready) = &*gate;
                let mut released = lock.lock().unwrap();
                while !*released { released = ready.wait(released).unwrap(); }
            }));
            (Self { inner }, receiver)
        }

        fn release(&self) {
            *self.inner.0.lock().unwrap() = true;
            self.inner.1.notify_all();
        }
    }

    impl Drop for WriteGate {
        fn drop(&mut self) { self.release(); }
    }

    #[tokio::test(start_paused = true)]
    async fn trailing_debounce_coalesces_and_preserves_latest_preview() {
        let mut fixture = Fixture::new();
        fixture.writer.update_appearance(fixture.appearance("first"), 1).unwrap();
        tokio::time::advance(Duration::from_millis(100)).await;
        fixture.writer.update_appearance(fixture.appearance("latest"), 2).unwrap();
        assert_eq!(fixture.writer.latest_appearance().theme, "latest");
        tokio::time::advance(Duration::from_millis(199)).await;
        assert_eq!(fixture.db.load_settings().unwrap().theme, "paper");
        tokio::time::advance(Duration::from_millis(1)).await;
        fixture.event(2, AppearanceSaveStatus::Saved).await;
        assert_eq!(fixture.db.load_settings().unwrap().theme, "latest");
        assert_eq!(fixture.writer.save_state().revision, 2);
        assert!(!fixture.writer.state.lock().unwrap().appearance.dirty);
    }

    #[tokio::test(start_paused = true)]
    async fn two_slots_keep_independent_trailing_deadlines_and_latest_geometry() {
        let mut fixture = Fixture::new();
        fixture.writer.update_appearance(fixture.appearance("glass"), 1).unwrap();
        fixture.writer.update_window_state(window(10)).unwrap();
        tokio::time::advance(Duration::from_millis(100)).await;
        fixture.writer.update_window_state(window(40)).unwrap();
        tokio::time::advance(Duration::from_millis(100)).await;
        fixture.event(1, AppearanceSaveStatus::Saved).await;
        assert_eq!(fixture.db.load_window_state().unwrap(), None);
        assert_eq!(fixture.writer.latest_window_state(), Some(window(40)));
        tokio::time::advance(Duration::from_millis(119)).await;
        assert_eq!(fixture.db.load_window_state().unwrap(), None);
        // Flush joins the real final geometry write, whether already dispatched or not.
        tokio::time::advance(Duration::from_millis(1)).await;
        fixture.writer.flush().await.unwrap();
        assert_eq!(fixture.db.load_window_state().unwrap(), Some(window(40)));
    }

    #[tokio::test(start_paused = true)]
    async fn old_inflight_completion_never_acknowledges_or_clears_new_revision() {
        let mut fixture = Fixture::new();
        let (gate, mut started) = WriteGate::install(&fixture.writer);
        fixture.writer.update_appearance(fixture.appearance("old"), 1).unwrap();
        tokio::time::advance(Duration::from_millis(200)).await;
        started.recv().await.unwrap();
        fixture.writer.update_appearance(fixture.appearance("new"), 2).unwrap();
        gate.release();
        // Keep revision 2 behind a fresh gate, so old completion can be inspected.
        let (new_gate, mut new_started) = WriteGate::install(&fixture.writer);
        tokio::time::advance(Duration::from_millis(200)).await;
        new_started.recv().await.unwrap();
        assert_eq!(fixture.writer.save_state().status, AppearanceSaveStatus::Saving);
        assert_eq!(fixture.writer.save_state().revision, 2);
        assert!(fixture.writer.state.lock().unwrap().appearance.dirty);
        assert_eq!(fixture.db.load_settings().unwrap().theme, "old");
        while let Ok(event) = fixture.events.try_recv() {
            assert!(!(event.revision == 1 && event.status == AppearanceSaveStatus::Saved));
        }
        new_gate.release();
        fixture.event(2, AppearanceSaveStatus::Saved).await;
        assert_eq!(fixture.db.load_settings().unwrap().theme, "new");
    }

    #[tokio::test(start_paused = true)]
    async fn failure_retains_dirty_preview_without_automatic_retry_and_new_input_retries() {
        let mut fixture = Fixture::new();
        fixture.reject_appearance();
        fixture.writer.update_appearance(fixture.appearance("unsaved"), 1).unwrap();
        tokio::time::advance(Duration::from_millis(200)).await;
        let error = fixture.event(1, AppearanceSaveStatus::Error).await;
        assert!(error.error.is_some());
        assert_eq!(fixture.writer.latest_appearance().theme, "unsaved");
        assert!(fixture.writer.state.lock().unwrap().appearance.dirty);
        fixture.sql("DROP TRIGGER reject_appearance;");
        tokio::time::advance(Duration::from_secs(60)).await;
        assert_eq!(fixture.db.load_settings().unwrap().theme, "paper");
        assert_eq!(fixture.writer.save_state().status, AppearanceSaveStatus::Error);
        fixture.writer.update_appearance(fixture.appearance("new-input"), 2).unwrap();
        tokio::time::advance(Duration::from_millis(200)).await;
        fixture.event(2, AppearanceSaveStatus::Saved).await;
        assert_eq!(fixture.db.load_settings().unwrap().theme, "new-input");
    }

    #[tokio::test(start_paused = true)]
    async fn flush_reports_failure_preserves_both_slots_and_explicit_retry_saves() {
        let fixture = Fixture::new();
        fixture.reject_appearance();
        fixture.writer.update_appearance(fixture.appearance("retry"), 1).unwrap();
        fixture.writer.update_window_state(window(-50)).unwrap();
        assert!(fixture.writer.flush().await.is_err());
        assert_eq!(fixture.writer.save_state().status, AppearanceSaveStatus::Error);
        assert_eq!(fixture.db.load_settings().unwrap().theme, "paper");
        assert_eq!(fixture.db.load_window_state().unwrap(), Some(window(-50)));
        fixture.sql("DROP TRIGGER reject_appearance;");
        fixture.writer.flush().await.unwrap();
        assert_eq!(fixture.db.load_settings().unwrap().theme, "retry");
        assert_eq!(fixture.writer.save_state().status, AppearanceSaveStatus::Saved);
        assert!(!fixture.writer.state.lock().unwrap().appearance.dirty);
    }

    #[tokio::test(start_paused = true)]
    async fn flush_includes_revisions_received_during_an_inflight_save() {
        let fixture = Fixture::new();
        let (gate, mut started) = WriteGate::install(&fixture.writer);
        fixture.writer.update_appearance(fixture.appearance("old"), 1).unwrap();
        let writer = fixture.writer.clone();
        let flush = tokio::spawn(async move { writer.flush().await });
        started.recv().await.unwrap();
        fixture.writer.update_appearance(fixture.appearance("final"), 2).unwrap();
        fixture.writer.update_window_state(window(90)).unwrap();
        gate.release();
        flush.await.unwrap().unwrap();
        assert_eq!(fixture.db.load_settings().unwrap().theme, "final");
        assert_eq!(fixture.db.load_window_state().unwrap(), Some(window(90)));
        assert_eq!(fixture.writer.save_state().revision, 2);
        assert_eq!(fixture.writer.save_state().status, AppearanceSaveStatus::Saved);
    }

    #[tokio::test(start_paused = true)]
    async fn stop_cancels_debounce_unblocks_flush_and_rejects_new_input() {
        let fixture = Fixture::new();
        fixture.writer.update_appearance(fixture.appearance("stopped"), 1).unwrap();
        fixture.writer.stop();
        tokio::time::advance(Duration::from_secs(10)).await;
        assert_eq!(fixture.db.load_settings().unwrap().theme, "paper");
        assert!(fixture.writer.update_appearance(fixture.appearance("rejected"), 2).is_err());
        assert!(fixture.writer.update_window_state(window(10)).is_err());
        assert!(fixture.writer.flush().await.is_err());

        let second = Fixture::new();
        let (gate, mut started) = WriteGate::install(&second.writer);
        second.writer.update_appearance(second.appearance("inflight"), 1).unwrap();
        let writer = second.writer.clone();
        let flush = tokio::spawn(async move { writer.flush().await });
        started.recv().await.unwrap();
        second.writer.stop();
        assert!(flush.await.unwrap().is_err());
        gate.release();
    }

    #[tokio::test(start_paused = true)]
    async fn settings_snapshot_overlays_coherent_preview_revision_and_filters_fx() {
        let fixture = Fixture::new();
        let config = NotionConfig { token: "isolated-token".into(), ..NotionConfig::default() };
        fixture.db.save_notion_config(&config, false, None).unwrap();
        let mut appearance = fixture.appearance("glass");
        appearance.fx_theme = "snow".into();
        appearance.fx_intensity = 4.0;
        appearance.note_bg = "#112233".into();
        fixture.writer.update_appearance(appearance, 5).unwrap();
        let snapshot = fixture.writer.settings_snapshot().await.unwrap();
        assert_eq!(snapshot.settings.theme, "glass");
        assert_eq!(snapshot.settings.fx_intensity, 1.6);
        assert_eq!(snapshot.settings.notion, config);
        assert_eq!(snapshot.appearance_save_state.revision, 5);
        let fx = fixture.writer.fx_preferences();
        assert_eq!(fx.theme, "snow");
        assert_eq!(fx.appearance.bg, "#112233");
        assert_eq!(fx.appearance.intensity, 1.6);
        let json = serde_json::to_value(fx).unwrap();
        assert!(json.get("notion").is_none());
        assert!(fixture.writer.update_appearance(fixture.appearance("stale"), 4).is_err());
        assert_eq!(fixture.writer.latest_appearance().theme, "glass");
        fixture.writer.flush().await.unwrap();
        assert_eq!(fixture.db.load_settings().unwrap().notion, config);
    }

    #[tokio::test(start_paused = true)]
    async fn identical_snapshot_with_new_revision_gets_truthful_saved_ack_without_writes() {
        let mut fixture = Fixture::new();
        // An unchanged full snapshot must not touch even the existing settings rows.
        fixture.sql(
            "CREATE TRIGGER reject_any_setting_update BEFORE UPDATE ON settings
             BEGIN SELECT RAISE(ABORT, 'unexpected write'); END;",
        );
        fixture.writer.update_appearance(fixture.writer.latest_appearance(), 7).unwrap();
        assert_eq!(fixture.writer.save_state().status, AppearanceSaveStatus::Saving);
        fixture.writer.flush().await.unwrap();
        fixture.event(7, AppearanceSaveStatus::Saved).await;
        assert_eq!(fixture.writer.save_state().revision, 7);
        assert!(fixture.writer.save_state().error.is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn window_failure_keeps_latest_geometry_and_does_not_retry_until_requested() {
        let fixture = Fixture::new();
        fixture.sql(
            "CREATE TRIGGER reject_window BEFORE INSERT ON settings WHEN NEW.key = 'window_state_v2'
             BEGIN SELECT RAISE(ABORT, 'isolated window failure'); END;",
        );
        fixture.writer.update_window_state(window(20)).unwrap();
        assert!(fixture.writer.flush().await.is_err());
        assert_eq!(fixture.writer.latest_window_state(), Some(window(20)));
        assert!(fixture.writer.state.lock().unwrap().window.dirty);
        fixture.sql("DROP TRIGGER reject_window;");
        tokio::time::advance(Duration::from_secs(60)).await;
        assert_eq!(fixture.db.load_window_state().unwrap(), None);
        fixture.writer.flush().await.unwrap();
        assert_eq!(fixture.db.load_window_state().unwrap(), Some(window(20)));
        assert!(!fixture.writer.state.lock().unwrap().window.dirty);
    }

    #[tokio::test(start_paused = true)]
    async fn concurrent_flush_waiters_share_failure_and_can_retry_without_losing_results() {
        let fixture = Fixture::new();
        fixture.reject_appearance();
        let (gate, mut started) = WriteGate::install(&fixture.writer);
        fixture.writer.update_appearance(fixture.appearance("shared"), 1).unwrap();
        let first_writer = fixture.writer.clone();
        let first = tokio::spawn(async move { first_writer.flush().await });
        started.recv().await.unwrap();
        let second_writer = fixture.writer.clone();
        let second = tokio::spawn(async move { second_writer.flush().await });
        tokio::task::yield_now().await;
        gate.release();
        assert!(first.await.unwrap().is_err());
        assert!(second.await.unwrap().is_err());
        fixture.sql("DROP TRIGGER reject_appearance;");
        fixture.writer.flush().await.unwrap();
        assert_eq!(fixture.db.load_settings().unwrap().theme, "shared");
    }

    #[tokio::test(start_paused = true)]
    async fn stop_releases_the_idle_scheduler_reference() {
        let fixture = Fixture::new();
        tokio::task::yield_now().await;
        assert_eq!(Arc::strong_count(&fixture.writer), 2);
        fixture.writer.stop();
        tokio::task::yield_now().await;
        assert_eq!(Arc::strong_count(&fixture.writer), 1);
    }
}
