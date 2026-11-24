use serde::{Deserialize, Serialize};

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
    Free,
    Collapsed,
    Expanded,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowRestore {
    pub x: i32,
    pub y: i32,
    pub width: f64,
    pub height: f64,
    pub monitor_id: Option<String>,
    pub saved_scale: f64,
}

impl WindowRestore {
    pub fn validate(&self) -> Result<(), String> {
        if !self.width.is_finite() || !self.height.is_finite()
            || self.width < 100.0 || self.height < 100.0
            || !self.saved_scale.is_finite() || self.saved_scale <= 0.0
            || !(self.width * self.saved_scale).is_finite()
            || !(self.height * self.saved_scale).is_finite()
            || self.monitor_id.as_ref().is_some_and(|id| id.is_empty())
        {
            return Err(crate::language::text("Invalid window restore geometry. The saved position was not overwritten.", "窗口恢复几何无效，未覆盖已保存的窗口位置").into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowStateV2 {
    pub version: u8,
    pub phase: DockPhase,
    pub edge: Option<DockEdge>,
    pub restore: WindowRestore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowMode {
    #[default]
    Workspace,
    Sticky,
}

pub const DEFAULT_WORKSPACE_WIDTH: f64 = 1160.0;
pub const DEFAULT_WORKSPACE_HEIGHT: f64 = 760.0;
pub const MIN_WORKSPACE_WIDTH: f64 = 860.0;
pub const MIN_WORKSPACE_HEIGHT: f64 = 580.0;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGeometry {
    pub x: i32,
    pub y: i32,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub maximized: bool,
    pub monitor_id: Option<String>,
    pub saved_scale: f64,
}

impl WorkspaceGeometry {
    pub fn validate(&self) -> Result<(), String> {
        if !self.width.is_finite()
            || !self.height.is_finite()
            || self.width < 680.0
            || self.height < 480.0
            || !self.saved_scale.is_finite()
            || self.saved_scale <= 0.0
            || !(self.width * self.saved_scale).is_finite()
            || !(self.height * self.saved_scale).is_finite()
            || self.monitor_id.as_ref().is_some_and(|id| id.is_empty())
        {
            return Err(crate::language::text(
                "Invalid workspace window geometry. The saved geometry was not overwritten.",
                "主面板窗口几何无效，未覆盖已保存位置",
            )
            .into());
        }
        Ok(())
    }
}

impl WindowStateV2 {
    pub fn validate(&self) -> Result<(), String> {
        self.restore.validate()?;
        if self.version != 2
            || (self.phase == DockPhase::Free) != self.edge.is_none()
        {
            return Err(crate::language::text("Invalid window state. The saved position was not overwritten.", "窗口状态无效，未覆盖已保存的窗口位置").into());
        }
        Ok(())
    }
}
