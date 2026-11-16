use crate::edge_dock::DockSnapshot;
use crate::models::{FxAppearancePayload, FxPreferences};
use crate::window_state::{DockEdge, DockPhase};
use serde::Serialize;
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelInset {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FxSnapshot {
    pub revision: u64,
    pub event_id: u64,
    pub generation: u64,
    pub theme: String,
    pub appearance: FxAppearancePayload,
    pub dock: DockSnapshot,
    pub active: bool,
    pub edge: Option<DockEdge>,
    pub panel: Option<PanelInset>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FxEpoch {
    pub generation: u64,
    pub revision: u64,
    pub policy: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FxScatterPayload {
    pub kind: &'static str,
    pub edge: DockEdge,
    pub panel: PanelInset,
}

#[derive(Debug, Clone, Serialize)]
pub struct FxAmbientPayload {
    pub edge: DockEdge,
    pub phase: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "payload", rename_all = "camelCase")]
pub enum FxActionPayload {
    Scatter(FxScatterPayload),
    Ambient(FxAmbientPayload),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FxAction {
    pub event_id: u64,
    pub generation: u64,
    pub state_revision: u64,
    #[serde(flatten)]
    pub action: FxActionPayload,
}

#[derive(Clone, Copy)]
struct Presentation {
    edge: DockEdge,
    panel: PanelInset,
}

struct Inner {
    snapshot: FxSnapshot,
    enabled: bool,
    policy: u64,
    presentation: Option<Presentation>,
}

impl Inner {
    fn epoch(&self) -> FxEpoch {
        FxEpoch {
            generation: self.snapshot.generation,
            revision: self.snapshot.dock.revision,
            policy: self.policy,
        }
    }

    fn allowed(&self) -> bool { self.enabled && self.snapshot.theme != "none" }

    fn recompute(&mut self) -> bool {
        let presentation = self.presentation.filter(|_| self.allowed()
            && self.snapshot.dock.presented && self.snapshot.dock.phase != DockPhase::Free);
        let active = presentation.is_some();
        let edge = presentation.map(|p| p.edge);
        let panel = presentation.map(|p| p.panel);
        let changed = self.snapshot.active != active || self.snapshot.edge != edge || self.snapshot.panel != panel;
        self.snapshot.active = active;
        self.snapshot.edge = edge;
        self.snapshot.panel = panel;
        changed
    }

    fn changed(&mut self) -> FxSnapshot {
        self.snapshot.revision += 1;
        self.snapshot.clone()
    }
}

/// Cached, token-free presentation state; no window or database IO under this lock.
pub struct FxRuntime { inner: Mutex<Inner> }

impl FxRuntime {
    pub fn new(preferences: FxPreferences, dock: DockSnapshot, generation: u64) -> Self {
        Self { inner: Mutex::new(Inner {
            snapshot: FxSnapshot {
                revision: 0, event_id: 0, generation,
                theme: preferences.theme, appearance: preferences.appearance, dock,
                active: false, edge: None, panel: None,
            },
            enabled: false, policy: 0, presentation: None,
        }) }
    }

    pub fn snapshot(&self) -> FxSnapshot { self.inner.lock().unwrap().snapshot.clone() }
    pub fn epoch(&self) -> FxEpoch { self.inner.lock().unwrap().epoch() }
    pub fn allowed(&self) -> bool { self.inner.lock().unwrap().allowed() }

    pub fn update_dock(&self, dock: DockSnapshot, generation: u64) -> Option<FxSnapshot> {
        let mut inner = self.inner.lock().unwrap();
        if inner.snapshot.dock == dock && inner.snapshot.generation == generation { return None; }
        if !dock.presented || dock.phase == DockPhase::Free { inner.presentation = None; }
        inner.snapshot.dock = dock;
        inner.snapshot.generation = generation;
        inner.recompute();
        Some(inner.changed())
    }

    /// Palette changes don't invalidate motion or trigger native re-layout.
    pub fn update_preferences(&self, preferences: FxPreferences) -> (bool, Option<FxSnapshot>) {
        let mut inner = self.inner.lock().unwrap();
        if inner.snapshot.theme == preferences.theme && inner.snapshot.appearance == preferences.appearance {
            return (false, None);
        }
        let theme_changed = inner.snapshot.theme != preferences.theme;
        if theme_changed { inner.policy += 1; }
        inner.snapshot.theme = preferences.theme;
        inner.snapshot.appearance = preferences.appearance;
        inner.recompute();
        (theme_changed, Some(inner.changed()))
    }

    pub fn set_enabled(&self, enabled: bool) -> (bool, Option<FxSnapshot>) {
        let mut inner = self.inner.lock().unwrap();
        if inner.enabled == enabled { return (false, None); }
        inner.enabled = enabled;
        inner.policy += 1;
        let changed = inner.recompute();
        (true, changed.then(|| inner.changed()))
    }

    pub fn reset_window(&self) -> Option<FxSnapshot> {
        let mut inner = self.inner.lock().unwrap();
        inner.policy += 1;
        inner.enabled = false;
        inner.presentation = None;
        let changed = inner.recompute();
        changed.then(|| inner.changed())
    }

    pub fn apply_layout(&self, epoch: FxEpoch, edge: DockEdge, panel: PanelInset) -> Option<FxSnapshot> {
        let mut inner = self.inner.lock().unwrap();
        if inner.epoch() != epoch || !inner.allowed() || !inner.snapshot.dock.presented
            || inner.snapshot.dock.edge != Some(edge) || inner.snapshot.dock.phase == DockPhase::Free {
            return None;
        }
        inner.presentation = Some(Presentation { edge, panel });
        let changed = inner.recompute();
        changed.then(|| inner.changed())
    }

    pub fn apply_hidden(&self, epoch: FxEpoch) -> Option<FxSnapshot> {
        let mut inner = self.inner.lock().unwrap();
        if inner.epoch() != epoch { return None; }
        inner.presentation = None;
        let changed = inner.recompute();
        changed.then(|| inner.changed())
    }

    pub fn action(&self, epoch: FxEpoch, action: FxActionPayload) -> Option<(FxSnapshot, FxAction)> {
        let mut inner = self.inner.lock().unwrap();
        if inner.epoch() != epoch || !inner.snapshot.active { return None; }
        inner.snapshot.event_id += 1;
        let snapshot = inner.changed();
        let action = FxAction {
            event_id: snapshot.event_id, generation: snapshot.generation,
            state_revision: snapshot.revision, action,
        };
        Some((snapshot, action))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn preferences() -> FxPreferences {
        FxPreferences { theme: "leaf".into(), appearance: FxAppearancePayload {
            bg: "#fff".into(), fg: "#111".into(), accent: "#f80".into(), pop: "#80f".into(),
            intensity: 1.0, edge_boost: true,
        } }
    }
    fn dock(revision: u64, phase: DockPhase, presented: bool) -> DockSnapshot {
        DockSnapshot { revision, phase, edge: Some(DockEdge::Left), presented }
    }
    fn panel() -> PanelInset { PanelInset { x: 20.0, y: 20.0, w: 60.0, h: 60.0 } }
    fn runtime() -> FxRuntime { FxRuntime::new(preferences(), dock(1, DockPhase::Collapsed, true), 1) }
    fn activate(runtime: &FxRuntime) {
        runtime.set_enabled(true);
        runtime.apply_layout(runtime.epoch(), DockEdge::Left, panel());
    }

    #[test]
    fn presentation_waits_for_policy_and_a_real_layout() {
        let runtime = runtime();
        assert!(!runtime.snapshot().active);
        runtime.set_enabled(true);
        assert!(!runtime.snapshot().active);
        runtime.apply_layout(runtime.epoch(), DockEdge::Left, panel());
        assert!(runtime.snapshot().active);
    }

    #[test]
    fn dock_motion_keeps_existing_particles_but_suspension_invalidates_the_layout() {
        let runtime = runtime();
        activate(&runtime);
        runtime.update_dock(dock(2, DockPhase::Expanded, true), 2);
        assert!(runtime.snapshot().active);
        runtime.update_dock(dock(3, DockPhase::Expanded, false), 3);
        assert!(!runtime.snapshot().active);
        runtime.update_dock(dock(4, DockPhase::Expanded, true), 4);
        assert!(!runtime.snapshot().active);
        runtime.apply_layout(runtime.epoch(), DockEdge::Left, panel());
        assert!(runtime.snapshot().active);
    }

    #[test]
    fn old_hide_and_layout_cannot_override_a_new_policy_or_window() {
        let runtime = runtime();
        activate(&runtime);
        let old = runtime.epoch();
        runtime.set_enabled(false);
        runtime.set_enabled(true);
        assert!(runtime.apply_hidden(old).is_none());
        assert!(runtime.snapshot().active);
        runtime.reset_window();
        runtime.set_enabled(true);
        assert!(runtime.apply_layout(old, DockEdge::Left, panel()).is_none());
        assert!(!runtime.snapshot().active);
        runtime.apply_layout(runtime.epoch(), DockEdge::Left, panel());
        assert!(runtime.snapshot().active);
    }

    #[test]
    fn palette_updates_keep_motion_but_theme_switches_cancel_old_callbacks() {
        let runtime = runtime();
        activate(&runtime);
        let epoch = runtime.epoch();
        let mut next = preferences();
        next.appearance.bg = "#123456".into();
        assert!(!runtime.update_preferences(next.clone()).0);
        assert_eq!(runtime.epoch(), epoch);
        assert!(runtime.snapshot().active);
        next.theme = "none".into();
        assert!(runtime.update_preferences(next).0);
        assert!(!runtime.snapshot().active);
        assert!(runtime.apply_layout(epoch, DockEdge::Left, panel()).is_none());
    }

    #[test]
    fn action_ids_are_monotonic_and_snapshots_establish_a_reload_baseline() {
        let runtime = runtime();
        activate(&runtime);
        let action = || FxActionPayload::Ambient(FxAmbientPayload { edge: DockEdge::Left, phase: "collapsed".into() });
        let (first, first_action) = runtime.action(runtime.epoch(), action()).unwrap();
        let (second, second_action) = runtime.action(runtime.epoch(), action()).unwrap();
        assert_eq!(first_action.event_id + 1, second_action.event_id);
        assert_eq!(first.event_id, first_action.event_id);
        assert_eq!(second.event_id, runtime.snapshot().event_id);
        assert_eq!(second.revision, second_action.state_revision);
        runtime.update_dock(dock(2, DockPhase::Collapsed, false), 2);
        assert!(runtime.action(runtime.epoch(), action()).is_none());
    }
}
