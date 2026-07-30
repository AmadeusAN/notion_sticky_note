/** Sakura theme particle helpers (scatter / bush / fall / fringe). */

import type { DockEdge, PanelInset } from "../../types";
import { clamp, rand } from "../../math";

export type { DockEdge, PanelInset };

export interface SakuraParticle {
  id: number;
  kind: "burst" | "fall" | "bush";
  x: number;
  y: number;
  rot: number;
  scale: number;
  color: string;
  durationMs: number;
  dx: number;
  dy: number;
  spin: number;
  size: number;
  /** 0 = center of edge, 1 = near corners — drives earlier fade / smaller size */
  rim?: number;
}

export interface FringePetal {
  id: number;
  along: number;
  offset: number;
  rot: number;
  scale: number;
  color: string;
  flip: boolean;
}

export type FringeMode = "strip" | "screen";

const SAKURA_COLORS = [
  "#f7b6c8",
  "#f49ab3",
  "#ffc1d4",
  "#e88aa8",
  "#ffd6e2",
  "#f5a3bc",
  "#ffe8ef",
];

let sakuraSeq = 0;
export const nextSakuraId = () => ++sakuraSeq;

export function pickSakuraColor() {
  return SAKURA_COLORS[Math.floor(Math.random() * SAKURA_COLORS.length)]!;
}

function sakuraBase(
  partial: Omit<
    SakuraParticle,
    "id" | "color" | "rot" | "scale" | "spin" | "durationMs" | "size"
  > &
    Partial<Pick<SakuraParticle, "durationMs" | "scale" | "size" | "spin">>,
): SakuraParticle {
  return {
    id: nextSakuraId(),
    color: pickSakuraColor(),
    rot: rand(0, 360),
    scale: partial.scale ?? rand(0.55, 1.15),
    spin: partial.spin ?? rand(-180, 180),
    durationMs: partial.durationMs ?? rand(520, 900),
    size: partial.size ?? 20,
    kind: partial.kind,
    x: partial.x,
    y: partial.y,
    dx: partial.dx,
    dy: partial.dy,
  };
}

function alongEdge(t: number, start: number, span: number) {
  return clamp(start + t * span + rand(-1.2, 1.2), start + 1, start + span - 1);
}

/** 0 at mid-edge, 1 at the panel corners. */
function endRim(along: number, start: number, span: number): number {
  const u = clamp((along - start) / Math.max(span, 1), 0, 1);
  const fromEnd = Math.min(u, 1 - u);
  return clamp(1 - fromEnd / 0.32, 0, 1);
}

/** Corner leaves: shorter flight, smaller, finish fade sooner. */
function softRim(
  leaf: SakuraParticle,
  edge: DockEdge,
  panel: PanelInset,
): SakuraParticle {
  const along = edge === "top" || edge === "bottom" ? leaf.x : leaf.y;
  const start = edge === "top" || edge === "bottom" ? panel.x : panel.y;
  const span = edge === "top" || edge === "bottom" ? panel.w : panel.h;
  const rim = endRim(along, start, span);
  if (rim <= 0.05) return { ...leaf, rim: 0 };

  const latMul = 1 - rim * 0.72;
  const outMul = 1 - rim * 0.28;
  let { dx, dy } = leaf;
  if (edge === "top" || edge === "bottom") {
    dx *= latMul;
    dy *= outMul;
  } else {
    dy *= latMul;
    dx *= outMul;
  }

  return {
    ...leaf,
    rim,
    dx,
    dy,
    scale: leaf.scale * (1 - rim * 0.42),
    size: leaf.size * (1 - rim * 0.38),
    durationMs: Math.round(leaf.durationMs * (1 - rim * 0.3)),
  };
}

function finalizeScatter(
  leaves: SakuraParticle[],
  edge: DockEdge,
  panel: PanelInset,
): SakuraParticle[] {
  return leaves.map((leaf) => softRim(leaf, edge, panel));
}

/**
 * Expand scatter: ~24 leaves along the docked edge into the outer ring.
 */
export function makeExpandScatter(
  edge: DockEdge,
  panel: PanelInset,
): SakuraParticle[] {
  const leaves: SakuraParticle[] = [];
  const n = 24;
  const { x: px, y: py, w: pw, h: ph } = panel;

  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n + rand(-0.015, 0.015);
    const side = Math.random() < 0.5 ? -1 : 1;

    if (edge === "top") {
      leaves.push(
        sakuraBase({
          kind: "burst",
          x: alongEdge(t, px, pw),
          y: py + rand(-1, 4),
          dx: side * rand(36, 110) + rand(-16, 16),
          dy: rand(-100, 60),
          size: rand(20, 34),
          scale: rand(0.85, 1.45),
          durationMs: rand(750, 1150),
        }),
      );
    } else if (edge === "bottom") {
      leaves.push(
        sakuraBase({
          kind: "burst",
          x: alongEdge(t, px, pw),
          y: py + ph + rand(-4, 1),
          dx: side * rand(36, 110) + rand(-16, 16),
          dy: rand(-60, 100),
          size: rand(20, 34),
          scale: rand(0.85, 1.45),
          durationMs: rand(750, 1150),
        }),
      );
    } else if (edge === "left") {
      leaves.push(
        sakuraBase({
          kind: "burst",
          x: px + rand(-1, 4),
          y: alongEdge(t, py, ph),
          dx: rand(-100, 60),
          dy: side * rand(36, 110) + rand(-16, 16),
          size: rand(20, 34),
          scale: rand(0.85, 1.45),
          durationMs: rand(750, 1150),
        }),
      );
    } else {
      leaves.push(
        sakuraBase({
          kind: "burst",
          x: px + pw + rand(-4, 1),
          y: alongEdge(t, py, ph),
          dx: rand(-60, 100),
          dy: side * rand(36, 110) + rand(-16, 16),
          size: rand(20, 34),
          scale: rand(0.85, 1.45),
          durationMs: rand(750, 1150),
        }),
      );
    }
  }

  return finalizeScatter(leaves, edge, panel);
}

/** Collapse bush: ~24 leaves. */
export function makeBushPart(edge: DockEdge, panel: PanelInset): SakuraParticle[] {
  const leaves: SakuraParticle[] = [];
  const count = 24;
  const { x: px, y: py, w: pw, h: ph } = panel;

  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count + rand(-0.012, 0.012);
    const side = Math.random() < 0.5 ? -1 : 1;

    if (edge === "top") {
      leaves.push(
        sakuraBase({
          kind: "bush",
          x: alongEdge(t, px, pw),
          y: py + rand(-2, 5),
          dx: side * rand(42, 120) + rand(-16, 16),
          dy: rand(-110, 70),
          scale: rand(0.95, 1.6),
          size: rand(22, 38),
          durationMs: rand(850, 1300),
          spin: rand(-240, 240),
        }),
      );
    } else if (edge === "bottom") {
      leaves.push(
        sakuraBase({
          kind: "bush",
          x: alongEdge(t, px, pw),
          y: py + ph + rand(-5, 2),
          dx: side * rand(42, 120) + rand(-16, 16),
          dy: rand(-70, 110),
          scale: rand(0.95, 1.6),
          size: rand(22, 38),
          durationMs: rand(850, 1300),
        }),
      );
    } else if (edge === "left") {
      leaves.push(
        sakuraBase({
          kind: "bush",
          x: px + rand(-2, 5),
          y: alongEdge(t, py, ph),
          dx: rand(-110, 70),
          dy: side * rand(42, 120) + rand(-16, 16),
          scale: rand(0.95, 1.6),
          size: rand(22, 38),
          durationMs: rand(850, 1300),
        }),
      );
    } else {
      leaves.push(
        sakuraBase({
          kind: "bush",
          x: px + pw + rand(-5, 2),
          y: alongEdge(t, py, ph),
          dx: rand(-70, 110),
          dy: side * rand(42, 120) + rand(-16, 16),
          scale: rand(0.95, 1.6),
          size: rand(22, 38),
          durationMs: rand(850, 1300),
        }),
      );
    }
  }

  return finalizeScatter(leaves, edge, panel);
}

/** Ambient fall into the outer ring — prefers on-screen pad (not off the monitor). */
export function makeFall(
  edge: DockEdge,
  _phase: "collapsed" | "expanded",
  panel: PanelInset,
): SakuraParticle {
  const { x: px, y: py, w: pw, h: ph } = panel;
  const roll = Math.random();

  // Drop off the "inner" side of the card (opposite the docked screen edge) + side pads.
  // Outward-toward-monitor-edge often lands off-screen (e.g. top dock → dy < 0).
  if (edge === "top") {
    if (roll < 0.55) {
      return sakuraBase({
        kind: "fall",
        x: px + rand(0.08, 0.92) * pw,
        y: py + ph + rand(-3, 2),
        dx: rand(-36, 36),
        dy: rand(55, 140),
        scale: rand(0.45, 0.85),
        size: rand(12, 17),
        durationMs: rand(900, 1400),
      });
    }
    if (roll < 0.78) {
      return sakuraBase({
        kind: "fall",
        x: px + rand(-2, 3),
        y: py + rand(0.12, 0.88) * ph,
        dx: rand(-120, -50),
        dy: rand(8, 55),
        scale: rand(0.45, 0.85),
        size: rand(12, 17),
        durationMs: rand(900, 1400),
      });
    }
    return sakuraBase({
      kind: "fall",
      x: px + pw + rand(-3, 2),
      y: py + rand(0.12, 0.88) * ph,
      dx: rand(50, 120),
      dy: rand(8, 55),
      scale: rand(0.45, 0.85),
      size: rand(12, 17),
      durationMs: rand(900, 1400),
    });
  }

  if (edge === "bottom") {
    if (roll < 0.55) {
      return sakuraBase({
        kind: "fall",
        x: px + rand(0.08, 0.92) * pw,
        y: py + rand(-2, 3),
        dx: rand(-36, 36),
        dy: rand(-140, -55),
        scale: rand(0.45, 0.85),
        size: rand(12, 17),
        durationMs: rand(900, 1400),
      });
    }
    if (roll < 0.78) {
      return sakuraBase({
        kind: "fall",
        x: px + rand(-2, 3),
        y: py + rand(0.12, 0.88) * ph,
        dx: rand(-120, -50),
        dy: rand(-55, -8),
        scale: rand(0.45, 0.85),
        size: rand(12, 17),
        durationMs: rand(900, 1400),
      });
    }
    return sakuraBase({
      kind: "fall",
      x: px + pw + rand(-3, 2),
      y: py + rand(0.12, 0.88) * ph,
      dx: rand(50, 120),
      dy: rand(-55, -8),
      scale: rand(0.45, 0.85),
      size: rand(12, 17),
      durationMs: rand(900, 1400),
    });
  }

  if (edge === "left") {
    if (roll < 0.55) {
      return sakuraBase({
        kind: "fall",
        x: px + pw + rand(-2, 3),
        y: py + rand(0.08, 0.92) * ph,
        dx: rand(55, 140),
        dy: rand(-36, 36),
        scale: rand(0.45, 0.85),
        size: rand(12, 17),
        durationMs: rand(900, 1400),
      });
    }
    if (roll < 0.78) {
      return sakuraBase({
        kind: "fall",
        x: px + rand(0.1, 0.9) * pw,
        y: py + rand(-2, 3),
        dx: rand(8, 55),
        dy: rand(-120, -50),
        scale: rand(0.45, 0.85),
        size: rand(12, 17),
        durationMs: rand(900, 1400),
      });
    }
    return sakuraBase({
      kind: "fall",
      x: px + rand(0.1, 0.9) * pw,
      y: py + ph + rand(-3, 2),
      dx: rand(8, 55),
      dy: rand(50, 120),
      scale: rand(0.45, 0.85),
      size: rand(12, 17),
      durationMs: rand(900, 1400),
    });
  }

  // right
  if (roll < 0.55) {
    return sakuraBase({
      kind: "fall",
      x: px + rand(-2, 3),
      y: py + rand(0.08, 0.92) * ph,
      dx: rand(-140, -55),
      dy: rand(-36, 36),
      scale: rand(0.45, 0.85),
      size: rand(12, 17),
      durationMs: rand(900, 1400),
    });
  }
  if (roll < 0.78) {
    return sakuraBase({
      kind: "fall",
      x: px + rand(0.1, 0.9) * pw,
      y: py + rand(-2, 3),
      dx: rand(-55, -8),
      dy: rand(-120, -50),
      scale: rand(0.45, 0.85),
      size: rand(12, 17),
      durationMs: rand(900, 1400),
    });
  }
  return sakuraBase({
    kind: "fall",
    x: px + rand(0.1, 0.9) * pw,
    y: py + ph + rand(-3, 2),
    dx: rand(-55, -8),
    dy: rand(50, 120),
    scale: rand(0.45, 0.85),
    size: rand(12, 17),
    durationMs: rand(900, 1400),
  });
}

export function makeFringe(
  _edge: DockEdge,
  mode: FringeMode,
  count: number,
): FringePetal[] {
  const leaves: FringePetal[] = [];
  for (let i = 0; i < count; i++) {
    leaves.push({
      id: nextSakuraId(),
      along: ((i + 0.5) / count) * 100 + rand(-2, 2),
      offset: mode === "screen" ? rand(-18, -4) : rand(2, 12),
      rot: rand(-55, 55),
      scale: rand(0.8, 1.35),
      color: pickSakuraColor(),
      flip: Math.random() > 0.5,
    });
  }
  return leaves;
}
