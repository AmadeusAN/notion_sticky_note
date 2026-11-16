use crate::window_state::{WindowRestore, WindowStateV2};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MonitorLayout {
    pub id: String,
    pub work: WorkArea,
    pub scale: f64,
    pub is_primary: bool,
}

fn validate_monitors(monitors: &[MonitorLayout]) -> Result<(), String> {
    if monitors.is_empty() {
        return Err(crate::language::text("No usable monitor was found.", "未找到可用显示器").into());
    }
    for (index, monitor) in monitors.iter().enumerate() {
        let work = monitor.work;
        if monitor.id.is_empty() || !monitor.scale.is_finite() || monitor.scale <= 0.0
            || work.w <= 0 || work.h <= 0
            || i64::from(work.x) + i64::from(work.w) > i64::from(i32::MAX) + 1
            || i64::from(work.y) + i64::from(work.h) > i64::from(i32::MAX) + 1
            || monitors[..index].iter().any(|other| other.id == monitor.id)
        {
            return Err(crate::language::text("Invalid monitor work area or scale factor.", "显示器工作区或缩放比例无效").into());
        }
    }
    Ok(())
}

/// Uses the saved physical rectangle, not a collapsed strip or the new screen's DPI.
pub fn select<'a>(restore: &WindowRestore, monitors: &'a [MonitorLayout]) -> Result<&'a MonitorLayout, String> {
    restore.validate()?;
    validate_monitors(monitors)?;
    if let Some(monitor) = monitors.iter().find(|monitor| Some(&monitor.id) == restore.monitor_id.as_ref()) {
        return Ok(monitor);
    }
    let left = f64::from(restore.x);
    let top = f64::from(restore.y);
    let right = left + restore.width * restore.saved_scale;
    let bottom = top + restore.height * restore.saved_scale;
    let score = |monitor: &MonitorLayout| {
        let work = monitor.work;
        let x = f64::from(work.x);
        let y = f64::from(work.y);
        let r = x + f64::from(work.w);
        let b = y + f64::from(work.h);
        let overlap = (right.min(r) - left.max(x)).max(0.0)
            * (bottom.min(b) - top.max(y)).max(0.0);
        let dx = (x - right).max(left - r).max(0.0);
        let dy = (y - bottom).max(top - b).max(0.0);
        (overlap, dx.hypot(dy))
    };
    monitors.iter().min_by(|a, b| {
        let (a_overlap, a_distance) = score(a);
        let (b_overlap, b_distance) = score(b);
        b_overlap.total_cmp(&a_overlap)
            .then_with(|| a_distance.total_cmp(&b_distance))
            .then_with(|| b.is_primary.cmp(&a.is_primary))
            .then_with(|| a.id.cmp(&b.id))
    }).ok_or_else(|| crate::language::text("No usable monitor was found.", "未找到可用显示器").into())
}

pub fn normalize(state: &WindowStateV2, monitors: &[MonitorLayout]) -> Result<WindowStateV2, String> {
    state.validate()?;
    let monitor = select(&state.restore, monitors)?;
    let work = monitor.work;
    let width = state.restore.width.min(f64::from(work.w) / monitor.scale);
    let height = state.restore.height.min(f64::from(work.h) / monitor.scale);
    if width < 100.0 || height < 100.0 {
        return Err(crate::language::text("The monitor work area is smaller than the minimum note size.", "显示器工作区小于便签最小尺寸").into());
    }
    let physical_width = (width * monitor.scale).round().max(1.0).min(f64::from(work.w)) as i64;
    let physical_height = (height * monitor.scale).round().max(1.0).min(f64::from(work.h)) as i64;
    let max_x = i64::from(work.x) + i64::from(work.w) - physical_width;
    let max_y = i64::from(work.y) + i64::from(work.h) - physical_height;
    let normalized = WindowStateV2 {
        restore: WindowRestore {
            x: i64::from(state.restore.x).clamp(i64::from(work.x), max_x) as i32,
            y: i64::from(state.restore.y).clamp(i64::from(work.y), max_y) as i32,
            width,
            height,
            monitor_id: Some(monitor.id.clone()),
            saved_scale: monitor.scale,
        },
        version: state.version,
        phase: state.phase,
        edge: state.edge,
    };
    normalized.validate()?;
    Ok(normalized)
}

#[cfg(windows)]
pub fn enumerate(_window: &tauri::WebviewWindow) -> Result<Vec<MonitorLayout>, String> {
    use windows::Win32::Foundation::{BOOL, LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW};
    use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
    use windows::Win32::UI::WindowsAndMessaging::MONITORINFOF_PRIMARY;

    struct Enumeration {
        monitors: Vec<MonitorLayout>,
        error: Option<String>,
    }
    unsafe extern "system" fn collect(handle: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
        let enumeration = &mut *(data.0 as *mut Enumeration);
        let result = (|| {
            let mut info = MONITORINFOEXW::default();
            info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
            if !GetMonitorInfoW(handle, &mut info as *mut MONITORINFOEXW as *mut MONITORINFO).as_bool() {
                return Err(format!("{} (HRESULT {})", crate::language::text("Unable to read the monitor work area.", "无法读取显示器工作区。"), windows::core::Error::from_win32().code()));
            }
            let mut dpi_x = 0;
            let mut dpi_y = 0;
            GetDpiForMonitor(handle, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y)
                .map_err(|error| format!("{} (HRESULT {})", crate::language::text("Unable to read the monitor scale factor.", "无法读取显示器缩放。"), error.code()))?;
            if dpi_x == 0 || dpi_y == 0 {
                return Err(crate::language::text("Invalid monitor DPI.", "显示器 DPI 无效").into());
            }
            let device_end = info.szDevice.iter().position(|unit| *unit == 0).unwrap_or(info.szDevice.len());
            let id = String::from_utf16(&info.szDevice[..device_end])
                .map_err(|_| crate::language::text("Invalid monitor device name.", "显示器设备名无效").to_string())?;
            let work = info.monitorInfo.rcWork;
            Ok(MonitorLayout {
                id,
                work: WorkArea {
                    x: work.left,
                    y: work.top,
                    w: work.right.checked_sub(work.left).ok_or(crate::language::text("Invalid monitor work area width.", "显示器工作区宽度无效"))?,
                    h: work.bottom.checked_sub(work.top).ok_or(crate::language::text("Invalid monitor work area height.", "显示器工作区高度无效"))?,
                },
                scale: f64::from(dpi_x) / 96.0,
                is_primary: info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
            })
        })();
        match result {
            Ok(monitor) => { enumeration.monitors.push(monitor); BOOL(1) }
            Err(error) => { enumeration.error = Some(error); BOOL(0) }
        }
    }
    let mut enumeration = Enumeration { monitors: Vec::new(), error: None };
    let succeeded = unsafe {
        EnumDisplayMonitors(HDC::default(), None, Some(collect), LPARAM(&mut enumeration as *mut Enumeration as isize))
    };
    if let Some(error) = enumeration.error {
        return Err(error);
    }
    if !succeeded.as_bool() {
        return Err(format!("{} (HRESULT {})", crate::language::text("Unable to enumerate monitors.", "无法枚举显示器。"), windows::core::Error::from_win32().code()));
    }
    validate_monitors(&enumeration.monitors)?;
    Ok(enumeration.monitors)
}

#[cfg(not(windows))]
pub fn enumerate(_window: &tauri::WebviewWindow) -> Result<Vec<MonitorLayout>, String> {
    Err(crate::language::text("Reading monitor work areas is not supported on this platform.", "当前平台不支持读取真实显示器工作区").into())
}

pub fn restore_window(window: &tauri::WebviewWindow, state: &WindowStateV2) -> Result<(WindowStateV2, MonitorLayout), String> {
    let monitors = enumerate(window)?;
    let normalized = normalize(state, &monitors)?;
    let monitor = select(&normalized.restore, &monitors)?.clone();
    apply_restore(window, &normalized.restore)?;
    Ok((normalized, monitor))
}

pub(crate) fn apply_restore(window: &tauri::WebviewWindow, restore: &WindowRestore) -> Result<(), String> {
    let position = tauri::PhysicalPosition { x: restore.x, y: restore.y };
    // Move onto the selected monitor before applying logical size at its DPI.
    window.set_position(position).map_err(|error| error.to_string())?;
    window.set_size(tauri::LogicalSize { width: restore.width, height: restore.height })
        .map_err(|error| error.to_string())?;
    window.set_position(position).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::window_state::{DockEdge, DockPhase};

    fn monitor(id: &str, work: WorkArea, scale: f64, is_primary: bool) -> MonitorLayout {
        MonitorLayout { id: id.into(), work, scale, is_primary }
    }

    fn state(x: i32, y: i32, width: f64, height: f64) -> WindowStateV2 {
        WindowStateV2 {
            version: 2, phase: DockPhase::Collapsed, edge: Some(DockEdge::Right),
            restore: WindowRestore { x, y, width, height, monitor_id: None, saved_scale: 1.0 },
        }
    }

    #[test]
    fn taskbars_on_all_four_edges_keep_full_panel_inside_work_area() {
        for work in [
            WorkArea { x: 40, y: 0, w: 1880, h: 1080 },
            WorkArea { x: 0, y: 40, w: 1920, h: 1040 },
            WorkArea { x: 0, y: 0, w: 1880, h: 1080 },
            WorkArea { x: 0, y: 0, w: 1920, h: 1040 },
        ] {
            let monitors = [monitor("screen", work, 1.0, true)];
            let upper = normalize(&state(i32::MIN, i32::MIN, 320.0, 500.0), &monitors).unwrap();
            assert_eq!((upper.restore.x, upper.restore.y), (work.x, work.y));
            let lower = normalize(&state(i32::MAX, i32::MAX, 320.0, 500.0), &monitors).unwrap();
            assert_eq!(lower.restore.x, work.x + work.w - 320);
            assert_eq!(lower.restore.y, work.y + work.h - 500);
            assert_eq!(lower.phase, DockPhase::Collapsed);
            assert_eq!(lower.edge, Some(DockEdge::Right));
        }
    }

    #[test]
    fn monitor_identity_overlap_nearest_and_primary_ties_are_deterministic() {
        let monitors = [
            monitor("left", WorkArea { x: -2000, y: -100, w: 1800, h: 1200 }, 1.5, false),
            monitor("primary", WorkArea { x: 0, y: 0, w: 1920, h: 1080 }, 1.0, true),
            monitor("far", WorkArea { x: 3000, y: 0, w: 1920, h: 1080 }, 2.0, false),
        ];
        let mut saved = state(-1800, 0, 320.0, 500.0);
        assert_eq!(select(&saved.restore, &monitors).unwrap().id, "left");
        saved.restore.monitor_id = Some("far".into());
        assert_eq!(select(&saved.restore, &monitors).unwrap().id, "far");
        saved.restore.monitor_id = Some("disconnected".into());
        saved.restore.x = 2600;
        assert_eq!(select(&saved.restore, &monitors).unwrap().id, "far");
        saved.restore.x = -200;
        saved.restore.width = 200.0;
        // Touches both screens but overlaps neither: prefer the primary screen.
        assert_eq!(select(&saved.restore, &monitors[..2]).unwrap().id, "primary");
        let reverse = [monitors[1].clone(), monitors[0].clone()];
        assert_eq!(select(&saved.restore, &reverse).unwrap().id, "primary");
        saved.restore.x = -300;
        saved.restore.width = 400.0;
        saved.restore.saved_scale = 2.0;
        // Saved DPI makes most of this rectangle overlap the primary screen.
        assert_eq!(select(&saved.restore, &monitors).unwrap().id, "primary");
    }

    #[test]
    fn dpi_change_preserves_logical_size_and_oversize_shrinks_before_position_clamp() {
        for scale in [1.0, 1.5, 2.0] {
            let work = WorkArea { x: -1920, y: -1080, w: 1920, h: 1040 };
            let monitors = [monitor("screen", work, scale, true)];
            let mut saved = state(-100, 0, 320.0, 500.0);
            saved.restore.saved_scale = 2.0;
            let normal = normalize(&saved, &monitors).unwrap();
            assert_eq!((normal.restore.width, normal.restore.height), (320.0, 500.0));
            assert_eq!(normal.restore.saved_scale, scale);
            assert_eq!(normal.restore.monitor_id.as_deref(), Some("screen"));
            assert_eq!(normal.restore.x, -(320.0 * scale) as i32);
            assert_eq!(normal.restore.y, -40 - (500.0 * scale) as i32);
            let oversized = normalize(&state(i32::MAX, i32::MIN, 10000.0, 10000.0), &monitors).unwrap();
            assert_eq!((oversized.restore.x, oversized.restore.y), (work.x, work.y));
            assert_eq!(oversized.restore.width, 1920.0 / scale);
            assert_eq!(oversized.restore.height, 1040.0 / scale);
        }
    }

    #[test]
    fn extreme_coordinates_and_invalid_input_do_not_overflow_or_panic() {
        let monitors = [
            monitor("negative", WorkArea { x: i32::MIN, y: i32::MIN, w: 1000, h: 1000 }, 1.0, false),
            monitor("positive", WorkArea { x: i32::MAX - 999, y: i32::MAX - 999, w: 1000, h: 1000 }, 1.0, true),
        ];
        let normalized = normalize(&state(i32::MAX, i32::MAX, 320.0, 500.0), &monitors).unwrap();
        assert_eq!(normalized.restore.x, i32::MAX - 319);
        assert_eq!(normalized.restore.y, i32::MAX - 499);
        assert!(normalize(&state(0, 0, 320.0, 500.0), &[]).is_err());
        let mut invalid = monitors[0].clone();
        for scale in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            invalid.scale = scale;
            assert!(normalize(&state(0, 0, 320.0, 500.0), &[invalid.clone()]).is_err());
        }
        invalid = monitors[0].clone();
        invalid.work.w = 0;
        assert!(normalize(&state(0, 0, 320.0, 500.0), &[invalid]).is_err());
        let mut invalid_state = state(0, 0, 320.0, 500.0);
        invalid_state.restore.width = f64::NAN;
        assert!(normalize(&invalid_state, &monitors).is_err());
        assert!(normalize(&state(0, 0, 320.0, 500.0), &[
            monitor("tiny", WorkArea { x: 0, y: 0, w: 199, h: 199 }, 2.0, true),
        ]).is_err());
    }
}
