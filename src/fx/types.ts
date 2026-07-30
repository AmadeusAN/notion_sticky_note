/** Shared FX event contract — Rust emits these; FxHost listens. */

export type DockEdge = "left" | "right" | "top" | "bottom";
export type DockPhase = "free" | "collapsed" | "expanded";

/** Panel rect inside the fx window, percentages 0–100. */
export interface PanelInset {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FX_EVENTS = {
  scatter: "fx-scatter",
  sync: "fx-sync",
  ambient: "fx-ambient",
  dock: "edge-dock-changed",
  theme: "fx-theme-changed",
  appearance: "fx-appearance-changed",
} as const;

export interface FxAppearancePayload {
  bg: string;
  fg: string;
  accent: string;
  pop: string;
  intensity: number;
  edgeBoost: boolean;
}

export interface FxScatterPayload {
  kind: "expand" | "collapse" | string;
  edge: DockEdge;
  panel: PanelInset;
}

export interface FxSyncPayload {
  active: boolean;
  edge: DockEdge | null;
  panel: PanelInset | null;
}

export interface FxAmbientPayload {
  edge: DockEdge;
  phase: "collapsed" | "expanded" | string;
}

export interface DockSnapshot {
  phase: DockPhase;
  edge: DockEdge | null;
}
