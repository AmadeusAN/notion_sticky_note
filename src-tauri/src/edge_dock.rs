//! Position-only edge docking with a single canonical full-panel restore rectangle.

use crate::monitors::{self, MonitorLayout, WorkArea};
use crate::window_state::{DockEdge, DockPhase, WindowRestore, WindowStateV2};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use tokio::sync::Notify;

const STRIP_LOGICAL_PX: f64 = 38.0;
const EDGE_SNAP_PX: i64 = 28;
const UNDOCK_PX: i64 = 72;
const MOVE_DEBOUNCE_MS: u64 = 220;
const POLL_MS: u64 = 16;
const SLIDE_DURATION_MS: u64 = 180;
const SLIDE_FRAME_MS: u64 = 8;
const POST_SLIDE_IGNORE_MS: u64 = 450;
const LEAVE_COLLAPSE_MS: u64 = 40;
const EXPAND_HOLD_MS: u64 = SLIDE_DURATION_MS + 100;
const COLLAPSE_HOLD_MS: u64 = SLIDE_DURATION_MS + POST_SLIDE_IGNORE_MS;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockSnapshot {
    pub revision: u64,
    pub phase: DockPhase,
    pub edge: Option<DockEdge>,
    pub presented: bool,
}

#[derive(Clone, Copy)]
struct MoveDecision {
    deadline: Instant,
    generation: u64,
    serial: u64,
}

struct Slide {
    id: u64,
    generation: u64,
    start: Instant,
    duration: Duration,
    from: PhysicalPosition<i32>,
    to: PhysicalPosition<i32>,
    pending: bool,
}

impl Slide {
    fn queue(&mut self) -> bool {
        if self.pending { return false; }
        self.pending = true;
        true
    }

    // Called by the UI callback, never by its producer: delayed frames catch up.
    fn position(&self, now: Instant) -> (PhysicalPosition<i32>, bool) {
        let elapsed = now.saturating_duration_since(self.start);
        let terminal = self.duration.is_zero() || elapsed >= self.duration;
        if terminal { return (self.to, true); }
        let p = ease_out_cubic(elapsed.as_secs_f64() / self.duration.as_secs_f64());
        (PhysicalPosition {
            x: (self.from.x as f64 + (self.to.x as f64 - self.from.x as f64) * p).round() as i32,
            y: (self.from.y as f64 + (self.to.y as f64 - self.from.y as f64) * p).round() as i32,
        }, false)
    }
}

struct DockInner {
    state: Option<WindowStateV2>,
    monitor: Option<Arc<MonitorLayout>>,
    restoring: bool,
    revision: u64,
    generation: u64,
    presented: bool,
    suspended: bool,
    slide: Option<Slide>,
    next_id: u64,
    movement: Option<MoveDecision>,
    decision_pending: bool,
    ignore_moves_until: Instant,
    expand_hold_until: Instant,
    collapse_hold_until: Instant,
    leave_since: Option<Instant>,
}

impl DockInner {
    fn snapshot(&self) -> DockSnapshot {
        DockSnapshot {
            revision: self.revision,
            phase: self.state.as_ref().map(|s| s.phase).unwrap_or(DockPhase::Free),
            edge: self.state.as_ref().and_then(|s| s.edge),
            presented: self.presented,
        }
    }

    fn invalidate(&mut self) {
        self.generation += 1;
        self.slide = None;
        self.restoring = false;
        self.movement = None;
        self.decision_pending = false;
        self.leave_since = None;
    }

    fn cursor_active(&self) -> bool {
        self.presented && !self.suspended
            && self.state.as_ref().map(|s| s.phase != DockPhase::Free).unwrap_or(false)
    }

    fn next_deadline(&self, now: Instant) -> Option<Instant> {
        if self.decision_pending { return None; }
        let cursor = self.cursor_active().then_some(now + Duration::from_millis(POLL_MS));
        match (cursor, self.movement.map(|m| m.deadline)) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        }
    }

    fn frame(&self, id: u64, generation: u64, now: Instant) -> Option<(PhysicalPosition<i32>, bool)> {
        if self.generation != generation || !self.presented || self.suspended { return None; }
        self.slide.as_ref().filter(|s| s.id == id && s.generation == generation && s.pending)
            .map(|slide| slide.position(now))
    }

    fn finish_frame(&mut self, id: u64, generation: u64, terminal: bool, moved: bool, now: Instant) {
        if self.generation != generation || !self.slide.as_ref().map(|s| s.id == id).unwrap_or(false) {
            return;
        }
        if terminal || !moved {
            self.slide = None;
            self.ignore_moves_until = now + Duration::from_millis(POST_SLIDE_IGNORE_MS);
        } else if let Some(slide) = self.slide.as_mut() { slide.pending = false; }
    }

    fn complete_restore(&mut self, generation: u64, presented: bool, now: Instant) -> bool {
        if self.generation != generation { return false; }
        self.restoring = false;
        self.presented = presented;
        self.suspended = !presented;
        self.revision += 1;
        self.ignore_moves_until = now + Duration::from_millis(POST_SLIDE_IGNORE_MS);
        self.expand_hold_until = now + Duration::from_secs(2);
        self.collapse_hold_until = now + Duration::from_millis(COLLAPSE_HOLD_MS);
        true
    }

    fn move_ignored(&self, now: Instant) -> bool {
        self.suspended || !self.presented || self.slide.is_some() || now < self.ignore_moves_until
    }

    fn moved(&mut self, now: Instant) {
        if self.move_ignored(now) { return; }
        self.next_id += 1;
        self.movement = Some(MoveDecision {
            deadline: now + Duration::from_millis(MOVE_DEBOUNCE_MS),
            generation: self.generation,
            serial: self.next_id,
        });
    }

    fn take_due_move(&mut self, now: Instant) -> Option<MoveDecision> {
        let decision = self.movement?;
        if decision.deadline > now { return None; }
        self.movement = None;
        (decision.generation == self.generation && !self.move_ignored(now)).then_some(decision)
    }

    fn take_queued_move(&mut self, generation: u64, serial: Option<u64>, now: Instant) -> Option<MoveDecision> {
        if self.generation != generation || self.movement.map(|m| m.serial) != serial { return None; }
        self.take_due_move(now)
    }
}

pub struct EdgeDock {
    inner: Mutex<DockInner>,
    wake: Notify,
    poller_started: AtomicBool,
}

impl EdgeDock {
    pub fn new() -> Arc<Self> {
        let now = Instant::now();
        Arc::new(Self {
            inner: Mutex::new(DockInner {
                state: None, revision: 0, generation: 0, presented: false, suspended: true,
                monitor: None, restoring: false,
                slide: None, next_id: 0, movement: None, decision_pending: false,
                ignore_moves_until: now, expand_hold_until: now, collapse_hold_until: now,
                leave_since: None,
            }),
            wake: Notify::new(),
            poller_started: AtomicBool::new(false),
        })
    }

    pub fn load(&self, state: WindowStateV2) -> Result<(), String> {
        state.validate()?;
        let mut inner = self.inner.lock().unwrap();
        inner.invalidate();
        inner.state = Some(state);
        inner.monitor = None;
        inner.revision += 1;
        drop(inner);
        self.wake.notify_one();
        Ok(())
    }

    pub fn snapshot(&self) -> DockSnapshot { self.inner.lock().unwrap().snapshot() }
    pub fn generation(&self) -> u64 { self.inner.lock().unwrap().generation }
    pub fn is_current_generation(&self, generation: u64) -> bool { self.generation() == generation }
    pub fn is_suspended(&self) -> bool { self.inner.lock().unwrap().suspended }
    pub fn is_applying(&self) -> bool {
        let inner = self.inner.lock().unwrap();
        inner.restoring || inner.slide.is_some()
    }
    pub fn is_collapsed(&self) -> bool { self.snapshot().phase == DockPhase::Collapsed }

    pub fn suspend(&self, app: &AppHandle) {
        {
            let mut inner = self.inner.lock().unwrap();
            inner.invalidate();
            inner.suspended = true;
            inner.presented = false;
            inner.revision += 1;
        }
        self.publish(app);
    }

    fn publish(&self, app: &AppHandle) {
        let snapshot = self.snapshot();
        crate::fx_window::dock_changed(app);
        let _ = app.emit_to("main", "edge-dock-changed", &snapshot);
        self.wake.notify_one();
    }

    fn canonical(&self) -> Result<WindowStateV2, String> {
        self.inner.lock().unwrap().state.clone().ok_or_else(|| crate::language::text("The window restore state has not loaded.", "窗口恢复状态尚未加载").into())
    }

    fn persist(&self, app: &AppHandle) -> Result<(), String> {
        let state = self.canonical()?;
        app.state::<crate::AppState>().preferences.update_window_state(state)
    }

    /// UI-thread entry point. Native/tray/command callers marshal before calling.
    pub fn reveal(self: &Arc<Self>, app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
        self.restore(app, window, false)
    }

    pub fn restore_on_startup(self: &Arc<Self>, app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
        self.restore(app, window, true)
    }

    fn restore(self: &Arc<Self>, app: &AppHandle, window: &WebviewWindow, startup: bool) -> Result<(), String> {
        if self.inner.lock().unwrap().restoring { return Ok(()); }
        self.suspend(app);
        let generation = self.generation();
        let state = self.canonical()?;
        self.inner.lock().unwrap().restoring = true;
        let dock = self;
        let app_ui = app;
        let win = window;
        (move || {
            if !dock.is_current_generation(generation) { return Ok(()); }
            let result: Result<(WindowStateV2, Arc<MonitorLayout>), String> = (|| {
                let (mut state, monitor) = monitors::restore_window(&win, &state)?;
                let monitor = Arc::new(monitor);
                if let Some(edge) = state.edge {
                    let size = win.outer_size().map_err(|e| e.to_string())?;
                    let full = PhysicalPosition::new(state.restore.x, state.restore.y);
                    state.phase = if startup { DockPhase::Collapsed } else { DockPhase::Expanded };
                    let target = if startup {
                        collapsed_position(edge, full, size, &monitor)
                    } else {
                        expanded_position(edge, full, size, &monitor.work)
                    };
                    if !startup { state.restore.x = target.x; state.restore.y = target.y; }
                    win.set_position(tauri::Position::Physical(target)).map_err(|e| e.to_string())?;
                }
                win.unminimize().map_err(|e| e.to_string())?;
                win.show().map_err(|e| e.to_string())?;
                Ok((state, monitor))
            })();
            // Failure must reflect actual visibility, not leave a visible window suspended.
            let presented = win.is_visible().unwrap_or(false) && !win.is_minimized().unwrap_or(true);
            {
                let mut inner = dock.inner.lock().unwrap();
                if !inner.complete_restore(generation, presented, Instant::now()) { return Ok(()); }
                if let Ok((state, monitor)) = &result {
                    inner.state = Some(state.clone());
                    inner.monitor = Some(monitor.clone());
                }
            }
            dock.publish(&app_ui);
            dock.sync_current_fx(&app_ui, &win);
            result?;
            dock.persist(&app_ui)
        })()
    }

    /// UI-thread entry point, also used immediately by user move/resize events.
    pub fn capture_valid_geometry(&self, app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
        // Never sample the tucked strip, minimized dimensions or an intermediate frame.
        let generation = {
            let inner = self.inner.lock().unwrap();
            if inner.suspended || !inner.presented || inner.restoring || inner.slide.is_some()
                || inner.snapshot().phase == DockPhase::Collapsed {
                return self.persist_after_unlock(app, inner);
            }
            inner.generation
        };
        if !window.is_visible().map_err(|e| e.to_string())?
            || window.is_minimized().map_err(|e| e.to_string())? {
            return self.persist(app);
        }
        let pos = window.outer_position().map_err(|e| e.to_string())?;
        let size = window.outer_size().map_err(|e| e.to_string())?;
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        let mut state = self.canonical()?;
        state.restore = WindowRestore {
            x: pos.x, y: pos.y, width: size.width as f64 / scale,
            height: size.height as f64 / scale, monitor_id: None, saved_scale: scale,
        };
        state.validate()?;
        let layouts = monitors::enumerate(window)?;
        let monitor = monitors::select(&state.restore, &layouts)?;
        state.restore.monitor_id = Some(monitor.id.clone());
        state = monitors::normalize(&state, &layouts)?;
        {
            let mut inner = self.inner.lock().unwrap();
            if inner.generation != generation || inner.slide.is_some() || inner.suspended { return Ok(()); }
            inner.state = Some(state);
            inner.monitor = Some(Arc::new(monitor.clone()));
        }
        self.persist(app)
    }

    fn persist_after_unlock(&self, app: &AppHandle, guard: std::sync::MutexGuard<'_, DockInner>) -> Result<(), String> {
        drop(guard);
        self.persist(app)
    }

    pub fn on_user_moved(self: &Arc<Self>, app: &AppHandle) { self.schedule_move(app); }
    pub fn on_user_resized(self: &Arc<Self>, app: &AppHandle) { self.schedule_move(app); }

    pub fn on_scale_changed(self: &Arc<Self>, app: &AppHandle) {
        let now = Instant::now();
        {
            let mut inner = self.inner.lock().unwrap();
            inner.invalidate();
            // A real DPI change must not disappear inside a slide's ignore interval.
            inner.ignore_moves_until = now;
            inner.moved(now);
        }
        self.wake.notify_one();
        self.spawn_cursor_poller(app.clone());
    }

    fn schedule_move(self: &Arc<Self>, app: &AppHandle) {
        if let Some(window) = app.get_webview_window("main") {
            if let Err(error) = self.capture_valid_geometry(app, &window) {
                eprintln!("Capture moved window geometry failed: {error}");
            }
        }
        self.inner.lock().unwrap().moved(Instant::now());
        self.wake.notify_one();
        self.spawn_cursor_poller(app.clone());
    }

    /// One worker owns both the active cursor cadence and the trailing deadline.
    /// Register before examining state so free/suspended transitions cannot lose a wake.
    pub fn spawn_cursor_poller(self: &Arc<Self>, app: AppHandle) {
        if self.poller_started.swap(true, Ordering::SeqCst) { return; }
        let dock = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let notified = dock.wake.notified();
                tokio::pin!(notified);
                notified.as_mut().enable();
                if app.get_webview_window("main").is_none() { break; }
                let deadline = dock.inner.lock().unwrap().next_deadline(Instant::now());
                if let Some(deadline) = deadline {
                    tokio::select! {
                        _ = &mut notified => { continue; }
                        _ = tokio::time::sleep_until(tokio::time::Instant::from_std(deadline)) => {}
                    }
                } else {
                    notified.await;
                    continue;
                }
                let (generation, movement) = {
                    let mut inner = dock.inner.lock().unwrap();
                    if inner.decision_pending { continue; }
                    inner.decision_pending = true;
                    (inner.generation, inner.movement)
                };
                let dock_ui = dock.clone();
                let app_ui = app.clone();
                if app.run_on_main_thread(move || {
                    let valid = {
                        let mut inner = dock_ui.inner.lock().unwrap();
                        if inner.generation != generation { false } else {
                            inner.decision_pending = false;
                            true
                        }
                    };
                    if valid {
                        if let Some(win) = app_ui.get_webview_window("main") {
                            let due = {
                                let mut inner = dock_ui.inner.lock().unwrap();
                                // A newer move received while this callback waited wins.
                                inner.take_queued_move(generation, movement.map(|m| m.serial), Instant::now())
                            };
                            if due.is_some() { dock_ui.evaluate_after_move(&app_ui, &win); }
                            dock_ui.check_cursor(&app_ui, &win, generation);
                        }
                    }
                    dock_ui.wake.notify_one();
                }).is_err() {
                    let mut inner = dock.inner.lock().unwrap();
                    if inner.generation == generation { inner.decision_pending = false; }
                    break;
                }
            }
            dock.poller_started.store(false, Ordering::SeqCst);
        });
    }

    fn evaluate_after_move(self: &Arc<Self>, app: &AppHandle, win: &WebviewWindow) {
        if self.inner.lock().unwrap().move_ignored(Instant::now()) { return; }
        if !crate::fx_window::main_is_presentable(app, win) { return; }
        let Ok(state) = self.canonical() else { return; };
        let Some(monitor) = self.inner.lock().unwrap().monitor.clone() else { return; };
        if state.phase == DockPhase::Collapsed {
            let refresh = monitors::enumerate(win)
                .and_then(|layouts| collapsed_layout_update(&state, &monitor, &layouts));
            match refresh {
                Ok(Some((state, monitor))) => {
                    if let Err(error) = self.apply_collapsed_layout(app, win, state, monitor) {
                        eprintln!("Refresh collapsed window layout failed: {error}");
                    }
                    return;
                }
                Err(error) => eprintln!("Read collapsed window layout failed: {error}"),
                Ok(None) => {}
            }
        }
        let Ok(pos) = win.outer_position() else { return; };
        let Ok(size) = win.outer_size() else { return; };
        let (edge, distance) = nearest_edge(pos, size, &monitor.work);
        match state.phase {
            DockPhase::Free if distance <= EDGE_SNAP_PX => {
                self.transition(app, win, DockPhase::Collapsed, edge, &monitor, pos, size);
            }
            DockPhase::Expanded if state.edge.map(|edge| edge_distance(edge, pos, size, &monitor.work) > UNDOCK_PX).unwrap_or(true) => {
                {
                    let mut inner = self.inner.lock().unwrap();
                    inner.invalidate();
                    let state = inner.state.as_mut().unwrap();
                    state.phase = DockPhase::Free;
                    state.edge = None;
                    inner.revision += 1;
                }
                self.publish(app);
                self.queue_persistence(app);
                crate::fx_window::hide_fx(app);
            }
            _ => self.sync_current_fx(app, win),
        }
    }

    fn apply_collapsed_layout(
        self: &Arc<Self>, app: &AppHandle, win: &WebviewWindow,
        state: WindowStateV2, monitor: MonitorLayout,
    ) -> Result<(), String> {
        let generation = {
            let mut inner = self.inner.lock().unwrap();
            inner.invalidate();
            inner.restoring = true;
            inner.ignore_moves_until = Instant::now() + Duration::from_millis(POST_SLIDE_IGNORE_MS);
            inner.generation
        };
        let result = (|| {
            monitors::apply_restore(win, &state.restore)?;
            let size = win.outer_size().map_err(|e| e.to_string())?;
            let full = PhysicalPosition::new(state.restore.x, state.restore.y);
            let target = collapsed_position(state.edge.unwrap(), full, size, &monitor);
            win.set_position(target).map_err(|e| e.to_string())
        })();
        {
            let mut inner = self.inner.lock().unwrap();
            if !inner.complete_restore(generation, true, Instant::now()) { return Ok(()); }
            if result.is_ok() {
                inner.state = Some(state);
                inner.monitor = Some(Arc::new(monitor));
            }
        }
        self.publish(app);
        result?;
        self.persist(app)
    }

    fn check_cursor(self: &Arc<Self>, app: &AppHandle, win: &WebviewWindow, generation: u64) {
        if !self.is_current_generation(generation) { return; }
        if !win.is_visible().unwrap_or(false) || win.is_minimized().unwrap_or(true) {
            self.suspend(app);
            crate::fx_window::hide_fx(app);
            return;
        }
        let now = Instant::now();
        let (snap, monitor) = {
            let inner = self.inner.lock().unwrap();
            if !inner.cursor_active() || inner.move_ignored(now) || inner.movement.is_some() { return; }
            (inner.snapshot(), inner.monitor.clone())
        };
        let Some(edge) = snap.edge else { return; };
        let Some(monitor) = monitor else { return; };
        let Ok(pos) = win.outer_position() else { return; };
        let Ok(size) = win.outer_size() else { return; };
        let Some(cursor) = screen_cursor() else { return; };
        let next = {
            let mut inner = self.inner.lock().unwrap();
            if inner.generation != generation { return; }
            match snap.phase {
                DockPhase::Collapsed => {
                    inner.leave_since = None;
                    (now >= inner.collapse_hold_until
                        && cursor_in_collapsed_strip(cursor, edge, pos, size, &monitor))
                        .then_some(DockPhase::Expanded)
                }
                DockPhase::Expanded => {
                    if now < inner.expand_hold_until
                        || cursor_in_expanded_margin(cursor, edge, pos, size, monitor.scale) {
                        inner.leave_since = None;
                        None
                    } else {
                        let since = *inner.leave_since.get_or_insert(now);
                        (now.saturating_duration_since(since) >= Duration::from_millis(LEAVE_COLLAPSE_MS))
                            .then_some(DockPhase::Collapsed)
                    }
                }
                DockPhase::Free => None,
            }
        };
        if let Some(phase) = next {
            self.transition(app, win, phase, edge, &monitor, pos, size);
        }
    }

    fn transition(
        self: &Arc<Self>, app: &AppHandle, win: &WebviewWindow, phase: DockPhase,
        edge: DockEdge, monitor: &MonitorLayout, pos: PhysicalPosition<i32>, size: PhysicalSize<u32>,
    ) {
        if self.is_suspended() { return; }
        let target = if phase == DockPhase::Collapsed {
            collapsed_position(edge, pos, size, monitor)
        } else { expanded_position(edge, pos, size, &monitor.work) };
        {
            let mut inner = self.inner.lock().unwrap();
            inner.invalidate();
            let state = inner.state.as_mut().unwrap();
            state.phase = phase;
            state.edge = Some(edge);
            // Restore is always the complete aligned panel, never the tucked position.
            let full = expanded_position(edge, pos, size, &monitor.work);
            state.restore.x = full.x;
            state.restore.y = full.y;
            state.restore.monitor_id = Some(monitor.id.clone());
            state.restore.saved_scale = monitor.scale;
            state.restore.width = size.width as f64 / monitor.scale;
            state.restore.height = size.height as f64 / monitor.scale;
            let now = Instant::now();
            inner.expand_hold_until = now + Duration::from_millis(EXPAND_HOLD_MS);
            inner.collapse_hold_until = now + Duration::from_millis(COLLAPSE_HOLD_MS);
            inner.revision += 1;
        }
        self.publish(app);
        self.queue_persistence(app);
        let kind = if phase == DockPhase::Collapsed { "collapse" } else { "expand" };
        let fx_pos = if phase == DockPhase::Expanded { target } else { pos };
        crate::fx_window::play_fx_scatter(app, edge, kind, fx_pos, size);
        self.slide_window_to(app, win, pos, target);
    }

    fn queue_persistence(&self, app: &AppHandle) {
        if let Err(error) = self.persist(app) { eprintln!("Queue window state failed: {error}"); }
    }

    fn slide_window_to(self: &Arc<Self>, app: &AppHandle, win: &WebviewWindow,
        from: PhysicalPosition<i32>, to: PhysicalPosition<i32>) {
        let animate = client_area_animations_enabled() && from != to;
        let (id, generation) = {
            let mut inner = self.inner.lock().unwrap();
            if inner.suspended || !inner.presented { return; }
            inner.next_id += 1;
            let id = inner.next_id;
            let generation = inner.generation;
            inner.movement = None;
            inner.slide = Some(Slide {
                id, generation, start: Instant::now(),
                duration: if animate { Duration::from_millis(SLIDE_DURATION_MS) } else { Duration::ZERO },
                from, to, pending: false,
            });
            (id, generation)
        };
        let dock = self.clone();
        let app = app.clone();
        let win = win.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let queued = {
                    let mut inner = dock.inner.lock().unwrap();
                    match inner.slide.as_mut() {
                        Some(slide) if slide.id == id && slide.generation == generation => slide.queue(),
                        _ => false,
                    }
                };
                if !queued { break; }
                let (send, receive) = tokio::sync::oneshot::channel();
                let dock_ui = dock.clone();
                let app_ui = app.clone();
                let win_ui = win.clone();
                if win.run_on_main_thread(move || {
                    let current = {
                        let inner = dock_ui.inner.lock().unwrap();
                        inner.generation == generation && inner.presented && !inner.suspended
                            && inner.slide.as_ref().map(|s| s.id == id).unwrap_or(false)
                    };
                    if !current { let _ = send.send(false); return; }
                    if !win_ui.is_visible().unwrap_or(false) || win_ui.is_minimized().unwrap_or(true) {
                        dock_ui.suspend(&app_ui);
                        crate::fx_window::hide_fx(&app_ui);
                        let _ = send.send(false);
                        return;
                    }
                    let frame = dock_ui.inner.lock().unwrap().frame(id, generation, Instant::now());
                    let Some((position, terminal)) = frame else { let _ = send.send(false); return; };
                    // No API call occurs with the state lock held.
                    let moved = win_ui.set_position(tauri::Position::Physical(position)).is_ok();
                    dock_ui.inner.lock().unwrap().finish_frame(id, generation, terminal, moved, Instant::now());
                    if terminal && moved && dock_ui.is_current_generation(generation) {
                        dock_ui.sync_current_fx(&app_ui, &win_ui);
                        // The canonical full-panel target was captured before the slide.
                        dock_ui.queue_persistence(&app_ui);
                    }
                    dock_ui.wake.notify_one();
                    let _ = send.send(moved && !terminal);
                }).is_err() {
                    let mut inner = dock.inner.lock().unwrap();
                    inner.finish_frame(id, generation, false, false, Instant::now());
                    dock.wake.notify_one();
                    break;
                }
                if !receive.await.unwrap_or(false) { break; }
                tokio::time::sleep(Duration::from_millis(SLIDE_FRAME_MS)).await;
            }
        });
    }

    pub fn sync_current_fx(&self, app: &AppHandle, win: &WebviewWindow) {
        let snapshot = self.snapshot();
        if !snapshot.presented || self.is_suspended() { crate::fx_window::hide_fx(app); return; }
        match (snapshot.phase, snapshot.edge) {
            (DockPhase::Collapsed | DockPhase::Expanded, Some(edge)) => {
                if let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) {
                    crate::fx_window::keep_fx_overlay(app, pos, size, edge);
                }
            }
            _ => crate::fx_window::hide_fx(app),
        }
    }
}

fn edge_distance(edge: DockEdge, pos: PhysicalPosition<i32>, size: PhysicalSize<u32>, work: &WorkArea) -> i64 {
    match edge {
        DockEdge::Left => (pos.x as i64 - work.x as i64).abs(),
        DockEdge::Right => (work.x as i64 + work.w as i64 - pos.x as i64 - size.width as i64).abs(),
        DockEdge::Top => (pos.y as i64 - work.y as i64).abs(),
        DockEdge::Bottom => (work.y as i64 + work.h as i64 - pos.y as i64 - size.height as i64).abs(),
    }
}

fn nearest_edge(pos: PhysicalPosition<i32>, size: PhysicalSize<u32>, work: &WorkArea) -> (DockEdge, i64) {
    [DockEdge::Left, DockEdge::Right, DockEdge::Top, DockEdge::Bottom]
        .into_iter().map(|edge| (edge, edge_distance(edge, pos, size, work)))
        .min_by_key(|(_, distance)| *distance).unwrap()
}

fn collapsed_layout_update(
    state: &WindowStateV2, previous: &MonitorLayout, layouts: &[MonitorLayout],
) -> Result<Option<(WindowStateV2, MonitorLayout)>, String> {
    let monitor = monitors::select(&state.restore, layouts)?;
    if state.phase != DockPhase::Collapsed || monitor == previous { return Ok(None); }
    Ok(Some((monitors::normalize(state, layouts)?, monitor.clone())))
}

fn physical_strip(scale: f64) -> i64 { (STRIP_LOGICAL_PX * scale).round().max(1.0) as i64 }
fn coord(value: i64) -> i32 { value.clamp(i32::MIN as i64, i32::MAX as i64) as i32 }
fn clamp_axis(value: i32, start: i32, extent: i32, size: u32) -> i32 {
    coord((value as i64).clamp(start as i64, (start as i64 + extent as i64 - size as i64).max(start as i64)))
}

fn collapsed_position(edge: DockEdge, pos: PhysicalPosition<i32>, size: PhysicalSize<u32>,
    monitor: &MonitorLayout) -> PhysicalPosition<i32> {
    let work = &monitor.work;
    let strip = physical_strip(monitor.scale);
    let mut target = expanded_position(edge, pos, size, work);
    match edge {
        DockEdge::Left => target.x = coord(work.x as i64 - size.width as i64 + strip.min(size.width as i64)),
        DockEdge::Right => target.x = coord(work.x as i64 + work.w as i64 - strip.min(size.width as i64)),
        DockEdge::Top => target.y = coord(work.y as i64 - size.height as i64 + strip.min(size.height as i64)),
        DockEdge::Bottom => target.y = coord(work.y as i64 + work.h as i64 - strip.min(size.height as i64)),
    }
    target
}

fn expanded_position(edge: DockEdge, pos: PhysicalPosition<i32>, size: PhysicalSize<u32>,
    work: &WorkArea) -> PhysicalPosition<i32> {
    let mut target = PhysicalPosition::new(
        clamp_axis(pos.x, work.x, work.w, size.width),
        clamp_axis(pos.y, work.y, work.h, size.height),
    );
    match edge {
        DockEdge::Left => target.x = work.x,
        DockEdge::Right => target.x = coord(work.x as i64 + work.w as i64 - size.width as i64),
        DockEdge::Top => target.y = work.y,
        DockEdge::Bottom => target.y = coord(work.y as i64 + work.h as i64 - size.height as i64),
    }
    target
}

fn point_in_rect(p: PhysicalPosition<i32>, x: i64, y: i64, w: i64, h: i64) -> bool {
    p.x as i64 >= x && (p.x as i64) < x + w && p.y as i64 >= y && (p.y as i64) < y + h
}

/// Intersect the physical exposed bar with its own work area. The hidden body
/// on an adjacent monitor is never an activation area.
fn cursor_in_collapsed_strip(cursor: PhysicalPosition<i32>, edge: DockEdge,
    pos: PhysicalPosition<i32>, size: PhysicalSize<u32>, monitor: &MonitorLayout) -> bool {
    let w = size.width as i64;
    let h = size.height as i64;
    let strip = physical_strip(monitor.scale);
    let (x, y, width, height) = match edge {
        DockEdge::Left => (pos.x as i64 + w - strip.min(w), pos.y as i64, strip.min(w), h),
        DockEdge::Right => (pos.x as i64, pos.y as i64, strip.min(w), h),
        DockEdge::Top => (pos.x as i64, pos.y as i64 + h - strip.min(h), w, strip.min(h)),
        DockEdge::Bottom => (pos.x as i64, pos.y as i64, w, strip.min(h)),
    };
    point_in_rect(cursor, x, y, width, height)
        && point_in_rect(cursor, monitor.work.x as i64, monitor.work.y as i64,
            monitor.work.w as i64, monitor.work.h as i64)
}

fn cursor_in_expanded_margin(cursor: PhysicalPosition<i32>, edge: DockEdge,
    pos: PhysicalPosition<i32>, size: PhysicalSize<u32>, scale: f64) -> bool {
    let margin = (physical_strip(scale) * 2).max(28);
    let (mx, my) = match edge {
        DockEdge::Left | DockEdge::Right => (margin, 8),
        DockEdge::Top | DockEdge::Bottom => (8, margin),
    };
    point_in_rect(cursor, pos.x as i64 - mx, pos.y as i64 - my,
        size.width as i64 + mx * 2 + 1, size.height as i64 + my * 2 + 1)
}

fn ease_out_cubic(t: f64) -> f64 {
    let u = 1.0 - t.clamp(0.0, 1.0);
    1.0 - u * u * u
}

#[cfg(windows)]
fn client_area_animations_enabled() -> bool {
    use windows::Win32::Foundation::BOOL;
    use windows::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPI_GETCLIENTAREAANIMATION, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
    };
    let mut enabled = BOOL(1);
    unsafe {
        SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0,
            Some((&mut enabled as *mut BOOL).cast()), SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0))
            .map(|_| enabled.as_bool()).unwrap_or(true)
    }
}

#[cfg(not(windows))]
fn client_area_animations_enabled() -> bool { true }

#[cfg(windows)]
fn screen_cursor() -> Option<PhysicalPosition<i32>> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    unsafe {
        let mut pt = POINT::default();
        GetCursorPos(&mut pt).ok().map(|_| PhysicalPosition::new(pt.x, pt.y))
    }
}

#[cfg(not(windows))]
fn screen_cursor() -> Option<PhysicalPosition<i32>> { None }

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> WindowStateV2 {
        WindowStateV2 { version: 2, phase: DockPhase::Free, edge: None,
            restore: WindowRestore { x: 100, y: 100, width: 320.0, height: 500.0,
                monitor_id: Some("fixture".into()), saved_scale: 1.0 } }
    }

    fn active() -> Arc<EdgeDock> {
        let dock = EdgeDock::new();
        dock.load(state()).unwrap();
        {
            let mut inner = dock.inner.lock().unwrap();
            inner.suspended = false;
            inner.presented = true;
        }
        dock
    }

    fn monitor(x: i32, y: i32, scale: f64) -> MonitorLayout {
        MonitorLayout { id: "fixture".into(), work: WorkArea { x, y, w: 1920, h: 1080 },
            scale, is_primary: true }
    }

    #[test]
    fn collapsed_layout_refresh_preserves_full_restore_and_scaled_strip() {
        for (old_scale, scale) in [(2.0, 1.0), (1.0, 1.5), (1.5, 2.0)] {
            for edge in [DockEdge::Left, DockEdge::Right, DockEdge::Top, DockEdge::Bottom] {
                let previous = monitor(0, 0, old_scale);
                let layout = monitor(0, 0, scale);
                let mut saved = state();
                saved.phase = DockPhase::Collapsed;
                saved.edge = Some(edge);
                saved.restore.saved_scale = old_scale;
                let (updated, current) = collapsed_layout_update(&saved, &previous, &[layout]).unwrap().unwrap();
                assert_eq!((updated.restore.width, updated.restore.height), (320.0, 500.0));
                assert_eq!(updated.restore.saved_scale, scale);
                let size = PhysicalSize::new((320.0 * scale) as u32, (500.0 * scale) as u32);
                let full = PhysicalPosition::new(updated.restore.x, updated.restore.y);
                let tucked = collapsed_position(edge, full, size, &current);
                let exposed = match edge {
                    DockEdge::Left => tucked.x + size.width as i32 - current.work.x,
                    DockEdge::Right => current.work.x + current.work.w - tucked.x,
                    DockEdge::Top => tucked.y + size.height as i32 - current.work.y,
                    DockEdge::Bottom => current.work.y + current.work.h - tucked.y,
                };
                assert_eq!(exposed as f64 / scale, 38.0);
                assert!(collapsed_layout_update(&updated, &current, &[current.clone()]).unwrap().is_none());
            }
        }
    }

    #[test]
    fn collapsed_hover_hits_only_exposed_strip_all_edges_and_dpi() {
        for (mx, my) in [(0, 0), (-1920, -1080)] {
            for scale in [1.0, 1.5, 2.0] {
                let monitor = monitor(mx, my, scale);
                let size = PhysicalSize::new(320, 500);
                let source = PhysicalPosition::new(mx + 500, my + 200);
                let strip = physical_strip(scale) as i32;
                for edge in [DockEdge::Left, DockEdge::Right, DockEdge::Top, DockEdge::Bottom] {
                    let pos = collapsed_position(edge, source, size, &monitor);
                    let (x, y, w, h) = match edge {
                        DockEdge::Left => (mx, source.y, strip, size.height as i32),
                        DockEdge::Right => (mx + 1920 - strip, source.y, strip, size.height as i32),
                        DockEdge::Top => (source.x, my, size.width as i32, strip),
                        DockEdge::Bottom => (source.x, my + 1080 - strip, size.width as i32, strip),
                    };
                    for (px, py) in [(x, y), (x + w - 1, y + h - 1), (x + w / 2, y + h / 2)] {
                        assert!(cursor_in_collapsed_strip(PhysicalPosition::new(px, py), edge, pos, size, &monitor));
                    }
                    for (px, py) in [(x - 1, y + h / 2), (x + w, y + h / 2),
                        (x + w / 2, y - 1), (x + w / 2, y + h),
                        (x - 20, y + h / 2), (x + w + 20, y + h / 2)] {
                        assert!(!cursor_in_collapsed_strip(PhysicalPosition::new(px, py), edge, pos, size, &monitor));
                    }
                }
            }
        }
    }

    #[test]
    fn expanded_leave_tolerance_does_not_widen_strip() {
        let monitor = monitor(0, 0, 1.0);
        let size = PhysicalSize::new(320, 500);
        assert!(cursor_in_expanded_margin(PhysicalPosition::new(600, -1),
            DockEdge::Top, PhysicalPosition::new(500, 0), size, 1.0));
        assert!(!cursor_in_expanded_margin(PhysicalPosition::new(600, -200),
            DockEdge::Top, PhysicalPosition::new(500, 0), size, 1.0));
        assert!(!cursor_in_collapsed_strip(PhysicalPosition::new(600, 38),
            DockEdge::Top, PhysicalPosition::new(500, -462), size, &monitor));
    }

    #[test]
    fn trailing_moves_coalesce_and_suspension_cancels_decisions() {
        let dock = active();
        let now = Instant::now();
        let mut inner = dock.inner.lock().unwrap();
        for ms in [0, 10, 100, 200] { inner.moved(now + Duration::from_millis(ms)); }
        assert!(inner.take_due_move(now + Duration::from_millis(419)).is_none());
        assert!(inner.take_due_move(now + Duration::from_millis(420)).is_some());
        assert!(inner.take_due_move(now + Duration::from_secs(1)).is_none());
        inner.moved(now + Duration::from_secs(2));
        let generation = inner.generation;
        inner.invalidate();
        inner.suspended = true;
        inner.presented = false;
        assert_ne!(generation, inner.generation);
        assert!(inner.take_due_move(now + Duration::from_secs(3)).is_none());
        inner.moved(now + Duration::from_secs(4));
        assert!(inner.movement.is_none());
    }

    #[test]
    fn cursor_sleeps_in_free_and_suspended_states() {
        let dock = active();
        let mut inner = dock.inner.lock().unwrap();
        assert!(!inner.cursor_active());
        let now = Instant::now();
        assert!(inner.next_deadline(now).is_none());
        inner.state.as_mut().unwrap().phase = DockPhase::Collapsed;
        inner.state.as_mut().unwrap().edge = Some(DockEdge::Left);
        assert!(inner.cursor_active());
        assert_eq!(inner.next_deadline(now), Some(now + Duration::from_millis(POLL_MS)));
        inner.invalidate();
        inner.suspended = true;
        inner.presented = false;
        assert!(!inner.cursor_active());
        assert!(inner.next_deadline(now).is_none());
        // A normal reveal/minimize cycle does not replace canonical geometry.
        let restore = inner.state.as_ref().unwrap().restore.clone();
        inner.invalidate();
        inner.suspended = false;
        inner.presented = true;
        inner.state.as_mut().unwrap().phase = DockPhase::Expanded;
        assert!(inner.cursor_active());
        assert_eq!(inner.state.as_ref().unwrap().restore, restore);
    }

    #[test]
    fn delayed_dispatch_has_one_frame_and_one_terminal_target() {
        let dock = active();
        let now = Instant::now();
        let mut inner = dock.inner.lock().unwrap();
        let generation = inner.generation;
        inner.slide = Some(Slide { id: 1, generation, start: now,
            duration: Duration::from_millis(180), from: PhysicalPosition::new(-500, 200),
            to: PhysicalPosition::new(0, 200), pending: false });
        // A tiny delayed dispatcher drives the same claim/execute/finish protocol
        // as run_on_main_thread, with an explicit deterministic callback clock.
        let mut dispatch = TestDispatch::default();
        assert!(dispatch.queue(&mut inner));
        for _ in 0..50 { assert!(!dispatch.queue(&mut inner)); }
        dispatch.run(&mut inner, now + Duration::from_millis(90), true);
        assert_eq!(dispatch.positions, vec![PhysicalPosition::new(-63, 200)]);
        assert!(dispatch.queue(&mut inner));
        dispatch.run(&mut inner, now + Duration::from_millis(500), true);
        assert_eq!(dispatch.positions, vec![PhysicalPosition::new(-63, 200), PhysicalPosition::new(0, 200)]);
        assert!(inner.slide.is_none());
        assert!(!dispatch.queue(&mut inner));
        dispatch.run(&mut inner, now + Duration::from_secs(1), true);
        assert_eq!(dispatch.positions.len(), 2);
    }

    #[derive(Default)]
    struct TestDispatch {
        queued: Option<(u64, u64)>,
        positions: Vec<PhysicalPosition<i32>>,
    }

    impl TestDispatch {
        fn queue(&mut self, inner: &mut DockInner) -> bool {
            let Some(slide) = inner.slide.as_mut() else { return false; };
            if !slide.queue() { return false; }
            self.queued = Some((slide.id, slide.generation));
            true
        }

        fn run(&mut self, inner: &mut DockInner, now: Instant, succeeds: bool) {
            let Some((id, generation)) = self.queued.take() else { return; };
            let Some((position, terminal)) = inner.frame(id, generation, now) else { return; };
            if succeeds { self.positions.push(position); }
            inner.finish_frame(id, generation, terminal, succeeds, now);
        }
    }

    #[test]
    fn invalidated_frame_cannot_move_a_new_lifecycle() {
        let dock = active();
        let now = Instant::now();
        let mut inner = dock.inner.lock().unwrap();
        let old = inner.generation;
        inner.slide = Some(Slide { id: 1, generation: old, start: now,
            duration: Duration::ZERO, from: PhysicalPosition::new(1, 1),
            to: PhysicalPosition::new(9, 9), pending: false });
        let mut dispatch = TestDispatch::default();
        assert!(dispatch.queue(&mut inner));
        inner.invalidate();
        inner.suspended = true;
        inner.presented = false;
        inner.invalidate();
        inner.suspended = false;
        inner.presented = true;
        assert_ne!(old, inner.generation);
        assert!(inner.slide.is_none());
        assert!(!inner.decision_pending);
        dispatch.run(&mut inner, now + Duration::from_secs(1), true);
        assert!(dispatch.positions.is_empty());
    }

    #[test]
    fn restore_failure_tracks_actual_visibility_and_is_retryable() {
        let dock = active();
        let now = Instant::now();
        let mut inner = dock.inner.lock().unwrap();
        inner.invalidate();
        inner.restoring = true;
        let generation = inner.generation;
        // A failed show leaves a hidden panel suspended, but clears reentrancy.
        assert!(inner.complete_restore(generation, false, now));
        assert!(inner.suspended);
        assert!(!inner.restoring);
        inner.invalidate();
        inner.restoring = true;
        let generation = inner.generation;
        // A partial native failure with an actually visible window must not strand it.
        assert!(inner.complete_restore(generation, true, now));
        assert!(!inner.suspended);
        assert!(inner.presented);
        assert!(!inner.restoring);
        assert!(!inner.complete_restore(generation - 1, false, now));
        assert!(inner.presented);
    }

    #[test]
    fn failed_frame_releases_only_its_own_animation() {
        let dock = active();
        let now = Instant::now();
        let mut inner = dock.inner.lock().unwrap();
        let generation = inner.generation;
        inner.slide = Some(Slide { id: 2, generation, start: now,
            duration: Duration::ZERO, from: PhysicalPosition::new(0, 0),
            to: PhysicalPosition::new(10, 10), pending: false });
        inner.finish_frame(1, generation, false, false, now);
        assert_eq!(inner.slide.as_ref().unwrap().id, 2);
        let mut dispatch = TestDispatch::default();
        assert!(dispatch.queue(&mut inner));
        dispatch.run(&mut inner, now, false);
        assert!(inner.slide.is_none());
        assert!(dispatch.positions.is_empty());
    }

    #[test]
    fn delayed_move_callback_cannot_commit_a_newer_or_cancelled_move() {
        let dock = active();
        let now = Instant::now();
        let mut inner = dock.inner.lock().unwrap();
        inner.moved(now);
        let queued = inner.movement.unwrap();
        inner.moved(now + Duration::from_millis(210));
        assert!(inner.take_queued_move(queued.generation, Some(queued.serial),
            now + Duration::from_millis(250)).is_none());
        let latest = inner.movement.unwrap();
        assert_eq!(inner.next_deadline(now), Some(now + Duration::from_millis(430)));
        assert!(inner.take_queued_move(latest.generation, Some(latest.serial),
            now + Duration::from_millis(430)).is_some());
        inner.moved(now + Duration::from_secs(1));
        let stale = inner.movement.unwrap();
        inner.invalidate();
        let generation = inner.generation;
        inner.complete_restore(generation, true, now + Duration::from_secs(2));
        assert!(inner.take_queued_move(stale.generation, Some(stale.serial),
            now + Duration::from_secs(3)).is_none());
    }

    #[test]
    fn zero_duration_slide_sets_terminal_target_once() {
        let dock = active();
        let now = Instant::now();
        let mut inner = dock.inner.lock().unwrap();
        let generation = inner.generation;
        inner.slide = Some(Slide { id: 1, generation, start: now,
            duration: Duration::ZERO, from: PhysicalPosition::new(1, 2),
            to: PhysicalPosition::new(3, 4), pending: false });
        let mut dispatch = TestDispatch::default();
        assert!(dispatch.queue(&mut inner));
        dispatch.run(&mut inner, now, true);
        assert_eq!(dispatch.positions, vec![PhysicalPosition::new(3, 4)]);
        assert!(!dispatch.queue(&mut inner));
        assert!(inner.slide.is_none());
    }

    #[test]
    fn slide_easing_is_bounded_and_monotone() {
        assert_eq!(ease_out_cubic(-1.0), 0.0);
        assert_eq!(ease_out_cubic(2.0), 1.0);
        let mut previous = 0.0;
        for frame in 0..=1000 {
            let progress = ease_out_cubic(frame as f64 / 1000.0);
            assert!((previous..=1.0).contains(&progress));
            previous = progress;
        }
    }
}
