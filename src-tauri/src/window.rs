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
