use std::sync::Mutex;
use tauri::{AppHandle, Manager, PhysicalSize, Runtime, WebviewWindow};
use window_vibrancy::{apply_acrylic, clear_acrylic};

/// Last user-intended outer size (physical px). Used to undo Win11 Aero Snap resizes.
static LAST_GOOD_SIZE: Mutex<Option<(u32, u32)>> = Mutex::new(None);

pub fn apply_always_on_top<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    window
        .set_always_on_top(true)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Reduce Win11 snap / maximize when dragging to screen edges.
pub fn disable_system_snap_assist<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    let _ = window.set_maximizable(false);
    remember_size(window);

    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, GWL_STYLE, WS_MAXIMIZEBOX,
        };

        if let Ok(hwnd) = window.hwnd() {
            let hwnd = HWND(hwnd.0);
            unsafe {
                let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
                let style = style & !(WS_MAXIMIZEBOX.0 as isize);
                SetWindowLongPtrW(hwnd, GWL_STYLE, style);
            }
        }
    }

    Ok(())
}

pub fn remember_size<R: Runtime>(window: &WebviewWindow<R>) {
    if let Ok(size) = window.outer_size() {
        if let Ok(mut g) = LAST_GOOD_SIZE.lock() {
            *g = Some((size.width, size.height));
        }
    }
}

/// If Windows Snap resized us to ~half / full monitor, restore the previous size.
pub fn undo_system_snap_resize_if_needed<R: Runtime>(window: &WebviewWindow<R>) {
    let Ok(size) = window.outer_size() else {
        return;
    };
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let mon = monitor.size();
    let mw = mon.width as i64;
    let mh = mon.height as i64;
    let w = size.width as i64;
    let h = size.height as i64;

    let looks_like_snap = {
        let half_w = (mw - w).abs() <= (mw / 20).max(24) || (mw / 2 - w).abs() <= (mw / 20).max(24);
        let half_h = (mh - h).abs() <= (mh / 20).max(24) || (mh / 2 - h).abs() <= (mh / 20).max(24);
        // Top maximize / full work-area height with large width, or left/right half snap
        (half_w && h >= mh * 85 / 100) || (half_h && w >= mw * 85 / 100) || (half_w && half_h)
    };

    if !looks_like_snap {
        remember_size(window);
        return;
    }

    let Some((gw, gh)) = LAST_GOOD_SIZE.lock().ok().and_then(|g| *g) else {
        return;
    };
    // Avoid fighting our own tiny intentional sizes
    if gw < 80 || gh < 80 {
        return;
    }
    if (gw as i64 - w).abs() < 8 && (gh as i64 - h).abs() < 8 {
        return;
    }

    let _ = window.set_size(tauri::Size::Physical(PhysicalSize {
        width: gw,
        height: gh,
    }));
}

pub fn apply_theme_effects<R: Runtime>(
    window: &WebviewWindow<R>,
    theme: &str,
) -> Result<(), String> {
    match theme {
        "glass" => {
            if apply_acrylic(window, Some((255, 255, 255, 48))).is_err() {
                let _ = apply_acrylic(window, None);
            }
        }
        _ => {
            let _ = clear_acrylic(window);
        }
    }
    Ok(())
}

pub fn main_window<R: Runtime>(app: &AppHandle<R>) -> Result<WebviewWindow<R>, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main window missing".into())
}
