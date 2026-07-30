//! QQ-style edge docking: tuck most of the window off-screen, peek a thin strip,
//! expand on cursor approach, undock when dragged away from the edge.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

/// Visible fraction of the window when docked (~1/10 area → 1/10 of width or height).
const STRIP_FRACTION: i32 = 10;
const STRIP_MIN_PX: i32 = 36;
const EDGE_SNAP_PX: i32 = 28;
const UNDOCK_PX: i32 = 72;
const MOVE_DEBOUNCE_MS: u64 = 220;
const POLL_MS: u64 = 16;
/// Fixed-duration jelly (ease-out-back), paced for ~120Hz displays.
const SLIDE_DURATION_MS: u64 = 300;
const SLIDE_FRAME_MS: u64 = 8;
const SLIDE_IGNORE_MS: u64 = 360;
/// Tiny leave debounce — just enough to avoid flicker when crossing the strip gap.
const LEAVE_COLLAPSE_MS: u64 = 40;
/// After expand starts, ignore leave until slide finishes (+settle) so mid-slide
/// geometry doesn't false-trigger collapse → re-expand loops.
const EXPAND_HOLD_MS: u64 = SLIDE_DURATION_MS + 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DockEdge {
    Left,
    Right,
    Top,
    Bottom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DockPhase {
    /// Fully free-floating
    Free,
    /// Mostly off-screen; only a thin strip remains
    Collapsed,
    /// Slid out along the docked edge; will re-collapse on mouse leave
    Expanded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockSnapshot {
    pub phase: DockPhase,
    pub edge: Option<DockEdge>,
    pub restored_width: u32,
    pub restored_height: u32,
    pub restored_x: i32,
    pub restored_y: i32,
}

impl Default for DockSnapshot {
    fn default() -> Self {
        Self {
            phase: DockPhase::Free,
            edge: None,
            restored_width: 320,
            restored_height: 500,
            restored_x: 100,
            restored_y: 100,
        }
    }
}

struct MonitorWork {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

pub struct EdgeDock {
    inner: Mutex<DockInner>,
    applying: AtomicBool,
    /// Bumped to cancel an in-flight slide animation.
    anim_token: AtomicU64,
}

struct DockInner {
    snapshot: DockSnapshot,
    /// Suppress move-debounce while we programmatically move the window
    ignore_moves_until: std::time::Instant,
    /// While expanded, refuse leave-collapse until this instant (anti re-trigger).
    expand_hold_until: std::time::Instant,
}

impl EdgeDock {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(DockInner {
                snapshot: DockSnapshot::default(),
                ignore_moves_until: std::time::Instant::now(),
                expand_hold_until: std::time::Instant::now(),
            }),
            applying: AtomicBool::new(false),
            anim_token: AtomicU64::new(0),
        })
    }

    pub fn snapshot(&self) -> DockSnapshot {
        self.inner
            .lock()
            .map(|g| g.snapshot.clone())
            .unwrap_or_default()
    }

    pub fn load(&self, snap: DockSnapshot) {
        if let Ok(mut g) = self.inner.lock() {
            g.snapshot = snap;
        }
    }

    pub fn is_collapsed(&self) -> bool {
        matches!(self.snapshot().phase, DockPhase::Collapsed)
    }

    fn set_ignore(&self, ms: u64) {
        if let Ok(mut g) = self.inner.lock() {
            g.ignore_moves_until =
                std::time::Instant::now() + Duration::from_millis(ms);
        }
    }

    fn expand_hold_active(&self) -> bool {
        self.inner
            .lock()
            .map(|g| std::time::Instant::now() < g.expand_hold_until)
            .unwrap_or(false)
    }

    fn should_ignore_move(&self) -> bool {
        self.applying.load(Ordering::SeqCst)
            || self
                .inner
                .lock()
                .map(|g| std::time::Instant::now() < g.ignore_moves_until)
                .unwrap_or(false)
    }

    pub fn on_user_moved(self: &Arc<Self>, app: AppHandle) {
        if self.should_ignore_move() {
            return;
        }
        let dock = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(MOVE_DEBOUNCE_MS)).await;
            if dock.should_ignore_move() {
                return;
            }
            let Some(win) = app.get_webview_window("main") else {
                return;
            };
            dock.evaluate_after_move(&app, &win);
        });
    }

    fn evaluate_after_move(self: &Arc<Self>, app: &AppHandle, win: &WebviewWindow) {
        let Ok(pos) = win.outer_position() else {
            return;
        };
        let Ok(size) = win.outer_size() else {
            return;
        };
        let Some(work) = monitor_work(win) else {
            return;
        };

        let phase = self.snapshot().phase;
        let nearest = nearest_edge(pos, size, &work);

        match phase {
            DockPhase::Free => {
                if let Some((edge, dist)) = nearest {
                    if dist <= EDGE_SNAP_PX {
                        self.collapse_to_edge(app, win, edge, pos, size);
                    }
                }
            }
            DockPhase::Expanded => {
                // Dragged far from edge while expanded → fully undock
                if let Some((_, dist)) = nearest {
                    if dist > UNDOCK_PX {
                        self.undock(app, win);
                    }
                } else {
                    self.undock(app, win);
                }
            }
            DockPhase::Collapsed => {
                // Collapsed geometry is intentionally off-screen; ignore move undock.
            }
        }
    }

    /// Ease-out-back jelly slide on a dedicated thread; positions applied on the UI thread.
    fn slide_window_to(
        self: &Arc<Self>,
        app: AppHandle,
        win: WebviewWindow,
        to: PhysicalPosition<i32>,
    ) {
        let Ok(from) = win.outer_position() else {
            let _ = win.set_position(tauri::Position::Physical(to));
            self.applying.store(false, Ordering::SeqCst);
            self.sync_fx_after_move(&app, &win);
            return;
        };
        if (from.x - to.x).abs() <= 1 && (from.y - to.y).abs() <= 1 {
            let _ = win.set_position(tauri::Position::Physical(to));
            self.applying.store(false, Ordering::SeqCst);
            self.sync_fx_after_move(&app, &win);
            return;
        }

        let token = self.anim_token.fetch_add(1, Ordering::SeqCst) + 1;
        self.applying.store(true, Ordering::SeqCst);
        // Only suppress drag-edge evaluation — cursor poller still runs for leave/collapse.
        self.set_ignore(SLIDE_IGNORE_MS);
        let dock = Arc::clone(self);

        std::thread::spawn(move || {
            let start = std::time::Instant::now();
            let duration = Duration::from_millis(SLIDE_DURATION_MS);
            let dx = (to.x - from.x) as f64;
            let dy = (to.y - from.y) as f64;
            let mut frame: u64 = 0;

            loop {
                if dock.anim_token.load(Ordering::SeqCst) != token {
                    return;
                }

                let elapsed = start.elapsed();
                let t = (elapsed.as_secs_f64() / duration.as_secs_f64()).min(1.0);
                let p = ease_out_back(t);
                let pos = PhysicalPosition {
                    x: (from.x as f64 + dx * p).round() as i32,
                    y: (from.y as f64 + dy * p).round() as i32,
                };

                let win_for_pos = win.clone();
                let _ = win.run_on_main_thread(move || {
                    let _ = win_for_pos.set_position(tauri::Position::Physical(pos));
                });

                if t >= 1.0 {
                    break;
                }

                frame += 1;
                let target = start + Duration::from_millis(frame * SLIDE_FRAME_MS);
                let now = std::time::Instant::now();
                if target > now {
                    std::thread::sleep(target - now);
                }
            }

            if dock.anim_token.load(Ordering::SeqCst) != token {
                return;
            }
            let win_final = win.clone();
            let app_final = app.clone();
            let dock_final = Arc::clone(&dock);
            let _ = win.run_on_main_thread(move || {
                let _ = win_final.set_position(tauri::Position::Physical(to));
                dock_final.set_ignore(80);
                dock_final.applying.store(false, Ordering::SeqCst);
                dock_final.sync_fx_after_move(&app_final, &win_final);
            });
        });
    }

    fn sync_fx_after_move(&self, app: &AppHandle, win: &WebviewWindow) {
        let snap = self.snapshot();
        match (snap.phase, snap.edge) {
            (DockPhase::Collapsed | DockPhase::Expanded, Some(edge)) => {
                let Ok(pos) = win.outer_position() else {
                    return;
                };
                let Ok(size) = win.outer_size() else {
                    return;
                };
                crate::fx_window::keep_fx_overlay(app, pos, size, edge);
            }
            _ => crate::fx_window::hide_fx(app),
        }
    }

    fn collapse_to_edge(
        self: &Arc<Self>,
        app: &AppHandle,
        win: &WebviewWindow,
        edge: DockEdge,
        pos: PhysicalPosition<i32>,
        size: PhysicalSize<u32>,
    ) {
        {
            let mut g = self.inner.lock().unwrap();
            g.snapshot.restored_width = size.width.max(100);
            g.snapshot.restored_height = size.height.max(100);
            g.snapshot.restored_x = pos.x;
            g.snapshot.restored_y = pos.y;
            g.snapshot.edge = Some(edge);
            g.snapshot.phase = DockPhase::Collapsed;
        }

        let Some(work) = monitor_work(win) else {
            return;
        };
        let docked = collapsed_position(edge, pos, size, &work);
        persist(app, &self.snapshot());
        emit(app, &self.snapshot());
        crate::fx_window::play_fx_scatter(app, edge, "collapse", pos, size);
        self.slide_window_to(app.clone(), win.clone(), docked);
    }

    fn expand_along_edge(self: &Arc<Self>, app: &AppHandle, win: &WebviewWindow) {
        let snap = self.snapshot();
        let Some(edge) = snap.edge else {
            return;
        };
        if snap.phase == DockPhase::Expanded {
            return;
        }
        // Already sliding (expand or collapse) — don't restart
        if self.applying.load(Ordering::SeqCst) {
            return;
        }

        let Ok(pos) = win.outer_position() else {
            return;
        };
        let Ok(size) = win.outer_size() else {
            return;
        };
        let Some(work) = monitor_work(win) else {
            return;
        };

        let expanded = expanded_position(edge, pos, size, &work);

        if let Ok(mut g) = self.inner.lock() {
            g.snapshot.phase = DockPhase::Expanded;
            g.expand_hold_until =
                std::time::Instant::now() + Duration::from_millis(EXPAND_HOLD_MS);
        }
        persist(app, &self.snapshot());
        emit(app, &self.snapshot());
        // Size FX to where the panel will rest (expanded), not the tucked strip.
        crate::fx_window::play_fx_scatter(app, edge, "expand", expanded, size);
        self.slide_window_to(app.clone(), win.clone(), expanded);
    }

    fn collapse_again(self: &Arc<Self>, app: &AppHandle, win: &WebviewWindow) {
        let snap = self.snapshot();
        let Some(edge) = snap.edge else {
            return;
        };
        if snap.phase != DockPhase::Expanded {
            return;
        }
        if self.applying.load(Ordering::SeqCst) || self.expand_hold_active() {
            return;
        }

        let Ok(pos) = win.outer_position() else {
            return;
        };
        let Ok(size) = win.outer_size() else {
            return;
        };
        let Some(work) = monitor_work(win) else {
            return;
        };

        let docked = collapsed_position(edge, pos, size, &work);

        if let Ok(mut g) = self.inner.lock() {
            g.snapshot.phase = DockPhase::Collapsed;
        }
        persist(app, &self.snapshot());
        emit(app, &self.snapshot());
        crate::fx_window::play_fx_scatter(app, edge, "collapse", pos, size);
        self.slide_window_to(app.clone(), win.clone(), docked);
    }

    fn undock(&self, app: &AppHandle, win: &WebviewWindow) {
        // Cancel any in-flight jelly slide
        self.anim_token.fetch_add(1, Ordering::SeqCst);
        self.applying.store(true, Ordering::SeqCst);
        self.set_ignore(300);
        if let Ok(mut g) = self.inner.lock() {
            g.snapshot.phase = DockPhase::Free;
            g.snapshot.edge = None;
        }
        // Keep current on-screen position; user already dragged it out
        let _ = win;
        persist(app, &self.snapshot());
        emit(app, &self.snapshot());
        crate::fx_window::hide_fx(app);
        self.applying.store(false, Ordering::SeqCst);
    }

    pub fn restore_on_startup(&self, app: &AppHandle, win: &WebviewWindow) {
        let snap = self.snapshot();
        if snap.phase == DockPhase::Free {
            return;
        }
        let Some(edge) = snap.edge else {
            return;
        };
        let Ok(size) = win.outer_size() else {
            return;
        };
        let Some(work) = monitor_work(win) else {
            return;
        };
        let pos = PhysicalPosition {
            x: snap.restored_x,
            y: snap.restored_y,
        };
        let docked = collapsed_position(edge, pos, size, &work);
        self.applying.store(true, Ordering::SeqCst);
        self.set_ignore(500);
        let _ = win.set_position(tauri::Position::Physical(docked));
        if let Ok(mut g) = self.inner.lock() {
            g.snapshot.phase = DockPhase::Collapsed;
        }
        emit(app, &self.snapshot());
        self.applying.store(false, Ordering::SeqCst);
        self.sync_fx_after_move(app, win);
    }

    pub fn spawn_cursor_poller(self: &Arc<Self>, app: AppHandle) {
        let dock = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let mut leave_since: Option<std::time::Instant> = None;
            loop {
                tokio::time::sleep(Duration::from_millis(POLL_MS)).await;
                let Some(win) = app.get_webview_window("main") else {
                    continue;
                };
                if !win.is_visible().unwrap_or(false) {
                    continue;
                }

                let snap = dock.snapshot();
                if snap.phase == DockPhase::Free {
                    leave_since = None;
                    continue;
                }

                // Mid-slide positions are unreliable — never expand/collapse here
                // (avoids collapse→expand loops while the cursor stays put).
                if dock.applying.load(Ordering::SeqCst) {
                    leave_since = None;
                    continue;
                }

                let Some(edge) = snap.edge else {
                    continue;
                };
                let Ok(pos) = win.outer_position() else {
                    continue;
                };
                let Ok(size) = win.outer_size() else {
                    continue;
                };
                let Some(cursor) = screen_cursor() else {
                    continue;
                };

                let near = cursor_near_dock(cursor, edge, pos, size, snap.phase);
                let over_window = point_in_rect(
                    cursor,
                    pos.x,
                    pos.y,
                    size.width as i32,
                    size.height as i32,
                );

                match snap.phase {
                    DockPhase::Collapsed => {
                        leave_since = None;
                        if near || over_window {
                            dock.expand_along_edge(&app, &win);
                        }
                    }
                    DockPhase::Expanded => {
                        if over_window || near || dock.expand_hold_active() {
                            leave_since = None;
                        } else {
                            let since = leave_since
                                .get_or_insert_with(std::time::Instant::now);
                            if since.elapsed()
                                >= Duration::from_millis(LEAVE_COLLAPSE_MS)
                            {
                                leave_since = None;
                                dock.collapse_again(&app, &win);
                            }
                        }
                    }
                    DockPhase::Free => {}
                }
            }
        });
    }
}

fn emit(app: &AppHandle, snap: &DockSnapshot) {
    let _ = app.emit("edge-dock-changed", snap);
}

fn persist(app: &AppHandle, snap: &DockSnapshot) {
    if let Some(state) = app.try_state::<crate::AppState>() {
        if let Ok(raw) = serde_json::to_string(snap) {
            let _ = state.db.set_setting("edge_dock", &raw);
        }
    }
}

fn monitor_work(win: &WebviewWindow) -> Option<MonitorWork> {
    let monitor = win.current_monitor().ok()??;
    let pos = monitor.position();
    let size = monitor.size();
    // Prefer work area if available via Tauri; otherwise full monitor
    Some(MonitorWork {
        x: pos.x,
        y: pos.y,
        width: size.width as i32,
        height: size.height as i32,
    })
}

fn nearest_edge(
    pos: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    work: &MonitorWork,
) -> Option<(DockEdge, i32)> {
    let left = (pos.x - work.x).abs();
    let right = ((work.x + work.width) - (pos.x + size.width as i32)).abs();
    let top = (pos.y - work.y).abs();
    let bottom = ((work.y + work.height) - (pos.y + size.height as i32)).abs();

    let candidates = [
        (DockEdge::Left, left),
        (DockEdge::Right, right),
        (DockEdge::Top, top),
        (DockEdge::Bottom, bottom),
    ];
    candidates.into_iter().min_by_key(|(_, d)| *d)
}

fn strip_extent(edge: DockEdge, size: PhysicalSize<u32>) -> i32 {
    let basis = match edge {
        DockEdge::Left | DockEdge::Right => size.width as i32,
        DockEdge::Top | DockEdge::Bottom => size.height as i32,
    };
    (basis / STRIP_FRACTION).max(STRIP_MIN_PX).min(basis.saturating_sub(8))
}

fn approach_extent(edge: DockEdge, size: PhysicalSize<u32>) -> i32 {
    (strip_extent(edge, size) / 2).max(20)
}

fn collapsed_position(
    edge: DockEdge,
    pos: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    work: &MonitorWork,
) -> PhysicalPosition<i32> {
    let w = size.width as i32;
    let h = size.height as i32;
    let strip = strip_extent(edge, size);
    match edge {
        DockEdge::Left => PhysicalPosition {
            x: work.x - w + strip,
            y: clamp(pos.y, work.y, work.y + work.height - h),
        },
        DockEdge::Right => PhysicalPosition {
            x: work.x + work.width - strip,
            y: clamp(pos.y, work.y, work.y + work.height - h),
        },
        DockEdge::Top => PhysicalPosition {
            x: clamp(pos.x, work.x, work.x + work.width - w),
            y: work.y - h + strip,
        },
        DockEdge::Bottom => PhysicalPosition {
            x: clamp(pos.x, work.x, work.x + work.width - w),
            y: work.y + work.height - strip,
        },
    }
}

fn expanded_position(
    edge: DockEdge,
    pos: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    work: &MonitorWork,
) -> PhysicalPosition<i32> {
    let w = size.width as i32;
    let h = size.height as i32;
    match edge {
        DockEdge::Left => PhysicalPosition {
            x: work.x,
            y: clamp(pos.y, work.y, work.y + work.height - h),
        },
        DockEdge::Right => PhysicalPosition {
            x: work.x + work.width - w,
            y: clamp(pos.y, work.y, work.y + work.height - h),
        },
        DockEdge::Top => PhysicalPosition {
            x: clamp(pos.x, work.x, work.x + work.width - w),
            y: work.y,
        },
        DockEdge::Bottom => PhysicalPosition {
            x: clamp(pos.x, work.x, work.x + work.width - w),
            y: work.y + work.height - h,
        },
    }
}

fn cursor_near_dock(
    cursor: PhysicalPosition<i32>,
    edge: DockEdge,
    pos: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    phase: DockPhase,
) -> bool {
    let w = size.width as i32;
    let h = size.height as i32;
    let strip = strip_extent(edge, size);
    let approach = approach_extent(edge, size);
    match edge {
        DockEdge::Left => {
            let zone_x1 = if phase == DockPhase::Collapsed {
                pos.x + w - strip - approach
            } else {
                pos.x - approach
            };
            let zone_x2 = pos.x + w + approach;
            cursor.x >= zone_x1
                && cursor.x <= zone_x2
                && cursor.y >= pos.y - 8
                && cursor.y <= pos.y + h + 8
        }
        DockEdge::Right => {
            let zone_x1 = pos.x - approach;
            let zone_x2 = if phase == DockPhase::Collapsed {
                pos.x + strip + approach
            } else {
                pos.x + w + approach
            };
            cursor.x >= zone_x1
                && cursor.x <= zone_x2
                && cursor.y >= pos.y - 8
                && cursor.y <= pos.y + h + 8
        }
        DockEdge::Top => {
            let zone_y1 = if phase == DockPhase::Collapsed {
                pos.y + h - strip - approach
            } else {
                pos.y - approach
            };
            let zone_y2 = pos.y + h + approach;
            cursor.y >= zone_y1
                && cursor.y <= zone_y2
                && cursor.x >= pos.x - 8
                && cursor.x <= pos.x + w + 8
        }
        DockEdge::Bottom => {
            let zone_y1 = pos.y - approach;
            let zone_y2 = if phase == DockPhase::Collapsed {
                pos.y + strip + approach
            } else {
                pos.y + h + approach
            };
            cursor.y >= zone_y1
                && cursor.y <= zone_y2
                && cursor.x >= pos.x - 8
                && cursor.x <= pos.x + w + 8
        }
    }
}

fn point_in_rect(
    p: PhysicalPosition<i32>,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
) -> bool {
    p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h
}

fn clamp(v: i32, min: i32, max: i32) -> i32 {
    v.max(min).min(max.max(min))
}

/// Slight overshoot then settle — jelly pop without multi-bounce spring noise.
fn ease_out_back(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    let c1 = 1.70158 * 1.4;
    let c3 = c1 + 1.0;
    let u = t - 1.0;
    1.0 + c3 * u * u * u + c1 * u * u
}

#[cfg(windows)]
fn screen_cursor() -> Option<PhysicalPosition<i32>> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    unsafe {
        let mut pt = POINT::default();
        if GetCursorPos(&mut pt).is_ok() {
            Some(PhysicalPosition { x: pt.x, y: pt.y })
        } else {
            None
        }
    }
}

#[cfg(not(windows))]
fn screen_cursor() -> Option<PhysicalPosition<i32>> {
    None
}
