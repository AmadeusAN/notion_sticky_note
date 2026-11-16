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
  state: "fx-state",
  action: "fx-action",
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
  revision: number;
  phase: DockPhase;
  edge: DockEdge | null;
  presented: boolean;
}

export interface FxSnapshot extends FxSyncPayload {
  revision: number;
  eventId: number;
  generation: number;
  theme: string;
  appearance: FxAppearancePayload;
  dock: DockSnapshot;
}

export type FxAction = {
  eventId: number;
  generation: number;
  stateRevision: number;
} & (
  | { kind: "scatter"; payload: FxScatterPayload }
  | { kind: "ambient"; payload: FxAmbientPayload }
);
