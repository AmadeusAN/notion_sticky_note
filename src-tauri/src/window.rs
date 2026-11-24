use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{window::Color, AppHandle, Manager, Runtime, WebviewWindow};

const TRANSPARENCY_REFRESH_THROTTLE: Duration = Duration::from_millis(250);

static LAST_TRANSPARENCY_REFRESH: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();

fn should_refresh(last: Option<Instant>, now: Instant, force: bool) -> bool {
    if force {
        return true;
    }
    match last {
        Some(prev) => now.saturating_duration_since(prev) >= TRANSPARENCY_REFRESH_THROTTLE,
        None => true,
    }
}

pub fn apply_always_on_top<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    window
        .set_always_on_top(true)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Enable normal desktop app window behavior for the Workspace main panel.
pub fn enable_workspace_window_style<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    use crate::window_state::{MIN_WORKSPACE_HEIGHT, MIN_WORKSPACE_WIDTH};
    let _ = window.set_always_on_top(false);
    let _ = window.set_skip_taskbar(false);
    let _ = window.set_min_size(Some(tauri::LogicalSize::new(MIN_WORKSPACE_WIDTH, MIN_WORKSPACE_HEIGHT)));
    let _ = window.set_maximizable(true);

    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_STYLE, SWP_FRAMECHANGED,
            SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_MAXIMIZEBOX,
        };

        if let Ok(hwnd) = window.hwnd() {
            let hwnd = HWND(hwnd.0);
            unsafe {
                let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
                let style = style | (WS_MAXIMIZEBOX.0 as isize);
                SetWindowLongPtrW(hwnd, GWL_STYLE, style);
                let _ = SetWindowPos(
                    hwnd,
                    HWND::default(),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                );
            }
        }
    }

    Ok(())
}

/// Enable pinned always-on-top compact Sticky Note window behavior.
pub fn enable_sticky_window_style<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    }
    let _ = window.set_min_size(Some(tauri::LogicalSize::new(100.0, 100.0)));
    let _ = apply_always_on_top(window);
    let _ = window.set_skip_taskbar(true);
    let _ = disable_system_snap_assist(window);
    Ok(())
}

pub fn apply_workspace_geometry(
    window: &WebviewWindow,
    saved: Option<&crate::window_state::WorkspaceGeometry>,
) -> Result<crate::window_state::WorkspaceGeometry, String> {
    use crate::monitors;
    use crate::window_state::{
        WindowRestore, WorkspaceGeometry, DEFAULT_WORKSPACE_HEIGHT, DEFAULT_WORKSPACE_WIDTH,
        MIN_WORKSPACE_HEIGHT, MIN_WORKSPACE_WIDTH,
    };

    let monitors = monitors::enumerate(window)?;
    let valid_saved = saved.filter(|g| g.validate().is_ok());

    let (restore, maximized) = if let Some(g) = valid_saved {
        let probe = WindowRestore {
            x: g.x,
            y: g.y,
            width: g.width,
            height: g.height,
            monitor_id: g.monitor_id.clone(),
            saved_scale: g.saved_scale,
        };
        let monitor = monitors::select(&probe, &monitors)?;
        let work = monitor.work;
        let max_w = f64::from(work.w) / monitor.scale;
        let max_h = f64::from(work.h) / monitor.scale;
        let width = g.width.clamp(MIN_WORKSPACE_WIDTH.min(max_w), max_w);
        let height = g.height.clamp(MIN_WORKSPACE_HEIGHT.min(max_h), max_h);
        let phys_w = (width * monitor.scale).round().max(1.0).min(f64::from(work.w)) as i64;
        let phys_h = (height * monitor.scale).round().max(1.0).min(f64::from(work.h)) as i64;
        let x = i64::from(g.x).clamp(i64::from(work.x), i64::from(work.x) + i64::from(work.w) - phys_w) as i32;
        let y = i64::from(g.y).clamp(i64::from(work.y), i64::from(work.y) + i64::from(work.h) - phys_h) as i32;
        (
            WindowRestore {
                x,
                y,
                width,
                height,
                monitor_id: Some(monitor.id.clone()),
                saved_scale: monitor.scale,
            },
            g.maximized,
        )
    } else {
        let current_name = window.current_monitor().ok().flatten().and_then(|m| m.name().cloned());
        let monitor = current_name
            .as_ref()
            .and_then(|name| monitors.iter().find(|m| &m.id == name))
            .or_else(|| monitors.iter().find(|m| m.is_primary))
            .unwrap_or(&monitors[0]);
        let work = monitor.work;
        let max_w = f64::from(work.w) / monitor.scale;
        let max_h = f64::from(work.h) / monitor.scale;
        let width = DEFAULT_WORKSPACE_WIDTH.min((max_w * 0.92).max(MIN_WORKSPACE_WIDTH.min(max_w)));
        let height = DEFAULT_WORKSPACE_HEIGHT.min((max_h * 0.9).max(MIN_WORKSPACE_HEIGHT.min(max_h)));
        let phys_w = (width * monitor.scale).round() as i32;
        let phys_h = (height * monitor.scale).round() as i32;
        let x = work.x + ((work.w - phys_w) / 2).max(0);
        let y = work.y + ((work.h - phys_h) / 2).max(0);
        (
            WindowRestore {
                x,
                y,
                width,
                height,
                monitor_id: Some(monitor.id.clone()),
                saved_scale: monitor.scale,
            },
            false,
        )
    };

    if window.is_maximized().unwrap_or(false) && !maximized {
        let _ = window.unmaximize();
    }
    monitors::apply_restore(window, &restore)?;
    if maximized {
        let _ = window.maximize();
    }
    Ok(WorkspaceGeometry {
        x: restore.x,
        y: restore.y,
        width: restore.width,
        height: restore.height,
        maximized,
        monitor_id: restore.monitor_id,
        saved_scale: restore.saved_scale,
    })
}

pub fn capture_workspace_geometry(
    window: &WebviewWindow,
    previous: Option<&crate::window_state::WorkspaceGeometry>,
) -> Option<crate::window_state::WorkspaceGeometry> {
    if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
        return None;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    if maximized {
        return previous.map(|prev| crate::window_state::WorkspaceGeometry {
            maximized: true,
            ..prev.clone()
        });
    }
    let pos = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    let scale = window.scale_factor().ok()?;
    if !scale.is_finite() || scale <= 0.0 {
        return None;
    }
    let candidate = crate::window_state::WorkspaceGeometry {
        x: pos.x,
        y: pos.y,
        width: f64::from(size.width) / scale,
        height: f64::from(size.height) / scale,
        maximized: false,
        monitor_id: window.current_monitor().ok().flatten().and_then(|m| m.name().cloned()),
        saved_scale: scale,
    };
    if candidate.validate().is_ok() {
        Some(candidate)
    } else {
        None
    }
}

/// Reduce Win11 snap / maximize when dragging to screen edges.
pub fn disable_system_snap_assist<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    let _ = window.set_maximizable(false);

    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_STYLE, SWP_FRAMECHANGED,
            SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_MAXIMIZEBOX,
        };

        if let Ok(hwnd) = window.hwnd() {
            let hwnd = HWND(hwnd.0);
            unsafe {
                let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
                let style = style & !(WS_MAXIMIZEBOX.0 as isize);
                SetWindowLongPtrW(hwnd, GWL_STYLE, style);
                let _ = SetWindowPos(
                    hwnd,
                    HWND::default(),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                );
            }
        }
    }

    Ok(())
}

/// Re-assert DWM & WebView2 transparent composition (throttled per window label).
pub fn refresh_transparent_surface<R: Runtime>(window: &WebviewWindow<R>) {
    refresh_transparent_surface_impl(window, false);
}

/// Force re-asserting DWM & WebView2 transparent composition without throttling.
pub fn refresh_transparent_surface_force<R: Runtime>(window: &WebviewWindow<R>) {
    refresh_transparent_surface_impl(window, true);
}

fn refresh_transparent_surface_impl<R: Runtime>(window: &WebviewWindow<R>, force: bool) {
    if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
        return;
    }

    let now = Instant::now();
    let label = window.label().to_string();
    let map = LAST_TRANSPARENCY_REFRESH.get_or_init(|| Mutex::new(HashMap::new()));
    {
        let mut guard = map.lock().unwrap();
        let last = guard.get(&label).copied();
        if !should_refresh(last, now, force) {
            return;
        }
        guard.insert(label, now);
    }

    let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));

    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::Graphics::Dwm::{
            DwmEnableBlurBehindWindow, DWM_BB_BLURREGION, DWM_BB_ENABLE, DWM_BLURBEHIND,
        };
        use windows::Win32::Graphics::Gdi::{
            CreateRectRgn, DeleteObject, RedrawWindow, RDW_ALLCHILDREN, RDW_FRAME, RDW_INVALIDATE,
            RDW_UPDATENOW,
        };
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
        };

        if let Ok(hwnd) = window.hwnd() {
            let hwnd = HWND(hwnd.0);
            unsafe {
                let region = CreateRectRgn(0, 0, -1, -1);
                if !region.is_invalid() {
                    let bb = DWM_BLURBEHIND {
                        dwFlags: DWM_BB_ENABLE | DWM_BB_BLURREGION,
                        fEnable: true.into(),
                        hRgnBlur: region,
                        fTransitionOnMaximized: false.into(),
                    };
                    let _ = DwmEnableBlurBehindWindow(hwnd, &bb);
                    let _ = DeleteObject(region);
                }
                let _ = SetWindowPos(
                    hwnd,
                    HWND::default(),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                );
                let _ = RedrawWindow(
                    hwnd,
                    None,
                    None,
                    RDW_INVALIDATE | RDW_UPDATENOW | RDW_ALLCHILDREN | RDW_FRAME,
                );
            }
        }
    }
}

pub fn main_window<R: Runtime>(app: &AppHandle<R>) -> Result<WebviewWindow<R>, String> {
    app.get_webview_window("main")
        .ok_or_else(|| crate::language::text("The main note window is unavailable.", "主便签窗口不可用。").into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_refresh_respects_throttle_and_force() {
        let t0 = Instant::now();
        assert!(should_refresh(None, t0, false));
        assert!(!should_refresh(
            Some(t0),
            t0 + Duration::from_millis(100),
            false
        ));
        assert!(!should_refresh(
            Some(t0),
            t0 + Duration::from_millis(249),
            false
        ));
        assert!(should_refresh(
            Some(t0),
            t0 + Duration::from_millis(250),
            false
        ));
        assert!(should_refresh(
            Some(t0),
            t0 + Duration::from_millis(10),
            true
        ));
    }
}
