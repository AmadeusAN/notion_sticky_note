/** Rain theme particle helpers (scatter / bush / fall / fringe). */

import type { DockEdge, PanelInset } from "../../types";
import { clamp, rand } from "../../math";

export type { DockEdge, PanelInset };

export interface RainParticle {
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
  rim?: number;
}

export interface FringeDrop {
  id: number;
  along: number;
  offset: number;
  rot: number;
  scale: number;
  color: string;
  flip: boolean;
}

export type FringeMode = "strip" | "screen";

const RAIN_COLORS = [
  "#7eb8d4",
  "#5a9fc4",
  "#9ec9e0",
  "#4a8bb0",
  "#b8d9ea",
  "#6aa8c8",
  "#a8cfe0",
];

let rainSeq = 0;
export const nextRainId = () => ++rainSeq;

function pickRainColor() {
  return RAIN_COLORS[Math.floor(Math.random() * RAIN_COLORS.length)]!;
}

function rainBase(
  partial: Omit<
    RainParticle,
    "id" | "color" | "rot" | "scale" | "spin" | "durationMs" | "size"
  > &
    Partial<Pick<RainParticle, "durationMs" | "scale" | "size" | "spin" | "rot">>,
): RainParticle {
  return {
    id: nextRainId(),
    color: pickRainColor(),
    rot: partial.rot ?? rand(-12, 12),
    scale: partial.scale ?? rand(0.55, 1.1),
    spin: partial.spin ?? rand(-8, 8),
    durationMs: partial.durationMs ?? rand(380, 650),
    size: partial.size ?? 8,
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

function endRim(along: number, start: number, span: number): number {
  const u = clamp((along - start) / Math.max(span, 1), 0, 1);
  const fromEnd = Math.min(u, 1 - u);
  return clamp(1 - fromEnd / 0.32, 0, 1);
}

function softRim(
  drop: RainParticle,
  edge: DockEdge,
  panel: PanelInset,
): RainParticle {
  const along = edge === "top" || edge === "bottom" ? drop.x : drop.y;
  const start = edge === "top" || edge === "bottom" ? panel.x : panel.y;
  const span = edge === "top" || edge === "bottom" ? panel.w : panel.h;
  const rim = endRim(along, start, span);
  if (rim <= 0.05) return { ...drop, rim: 0 };

  const latMul = 1 - rim * 0.72;
  const outMul = 1 - rim * 0.28;
  let { dx, dy } = drop;
  if (edge === "top" || edge === "bottom") {
    dx *= latMul;
    dy *= outMul;
  } else {
    dy *= latMul;
    dx *= outMul;
  }

  return {
    ...drop,
    rim,
    dx,
    dy,
    scale: drop.scale * (1 - rim * 0.42),
    size: drop.size * (1 - rim * 0.38),
    durationMs: Math.round(drop.durationMs * (1 - rim * 0.3)),
  };
}

function finalizeScatter(
  drops: RainParticle[],
  edge: DockEdge,
  panel: PanelInset,
): RainParticle[] {
  return drops.map((d) => softRim(d, edge, panel));
}

/** Expand scatter: rain streaks burst along the docked edge. */
export function makeExpandScatter(
  edge: DockEdge,
  panel: PanelInset,
): RainParticle[] {
  const drops: RainParticle[] = [];
  const n = 28;
  const { x: px, y: py, w: pw, h: ph } = panel;

  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n + rand(-0.015, 0.015);
    const side = Math.random() < 0.5 ? -1 : 1;

    if (edge === "top") {
      drops.push(
        rainBase({
          kind: "burst",
          x: alongEdge(t, px, pw),
          y: py + rand(-1, 4),
          dx: side * rand(8, 36) + rand(-10, 10),
          dy: rand(70, 160),
          size: rand(5, 10),
          scale: rand(0.7, 1.35),
          durationMs: rand(420, 720),
          rot: rand(-8, 8),
        }),
      );
    } else if (edge === "bottom") {
      drops.push(
        rainBase({
          kind: "burst",
          x: alongEdge(t, px, pw),
          y: py + ph + rand(-4, 1),
          dx: side * rand(8, 36) + rand(-10, 10),
          dy: rand(-160, -70),
          size: rand(5, 10),
          scale: rand(0.7, 1.35),
          durationMs: rand(420, 720),
        }),
      );
    } else if (edge === "left") {
      drops.push(
        rainBase({
          kind: "burst",
          x: px + rand(-1, 4),
          y: alongEdge(t, py, ph),
          dx: rand(50, 130),
          dy: side * rand(20, 70) + rand(30, 90),
          size: rand(5, 10),
          scale: rand(0.7, 1.35),
          durationMs: rand(420, 720),
        }),
      );
    } else {
      drops.push(
        rainBase({
          kind: "burst",
          x: px + pw + rand(-4, 1),
          y: alongEdge(t, py, ph),
          dx: rand(-130, -50),
          dy: side * rand(20, 70) + rand(30, 90),
          size: rand(5, 10),
          scale: rand(0.7, 1.35),
          durationMs: rand(420, 720),
        }),
      );
    }
  }

  return finalizeScatter(drops, edge, panel);
}

/** Collapse bush: denser rain splash. */
export function makeBushPart(edge: DockEdge, panel: PanelInset): RainParticle[] {
  const drops: RainParticle[] = [];
  const count = 28;
  const { x: px, y: py, w: pw, h: ph } = panel;

  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count + rand(-0.012, 0.012);
    const side = Math.random() < 0.5 ? -1 : 1;

    if (edge === "top") {
      drops.push(
        rainBase({
          kind: "bush",
          x: alongEdge(t, px, pw),
          y: py + rand(-2, 5),
          dx: side * rand(12, 48) + rand(-12, 12),
          dy: rand(80, 180),
          scale: rand(0.85, 1.5),
          size: rand(6, 12),
          durationMs: rand(500, 850),
        }),
      );
    } else if (edge === "bottom") {
      drops.push(
        rainBase({
          kind: "bush",
          x: alongEdge(t, px, pw),
          y: py + ph + rand(-5, 2),
          dx: side * rand(12, 48) + rand(-12, 12),
          dy: rand(-180, -80),
          scale: rand(0.85, 1.5),
          size: rand(6, 12),
          durationMs: rand(500, 850),
        }),
      );
    } else if (edge === "left") {
      drops.push(
        rainBase({
          kind: "bush",
          x: px + rand(-2, 5),
          y: alongEdge(t, py, ph),
          dx: rand(60, 150),
          dy: side * rand(24, 80) + rand(40, 100),
          scale: rand(0.85, 1.5),
          size: rand(6, 12),
          durationMs: rand(500, 850),
        }),
      );
    } else {
      drops.push(
        rainBase({
          kind: "bush",
          x: px + pw + rand(-5, 2),
          y: alongEdge(t, py, ph),
          dx: rand(-150, -60),
          dy: side * rand(24, 80) + rand(40, 100),
          scale: rand(0.85, 1.5),
          size: rand(6, 12),
          durationMs: rand(500, 850),
        }),
      );
    }
  }

  return finalizeScatter(drops, edge, panel);
}

/** Ambient rain into the outer ring. */
export function makeFall(
  edge: DockEdge,
  _phase: "collapsed" | "expanded",
  panel: PanelInset,
): RainParticle {
  const { x: px, y: py, w: pw, h: ph } = panel;
  const roll = Math.random();

  if (edge === "top") {
    if (roll < 0.55) {
      return rainBase({
        kind: "fall",
        x: px + rand(0.08, 0.92) * pw,
        y: py + ph + rand(-3, 2),
        dx: rand(-18, 18),
        dy: rand(90, 180),
        scale: rand(0.4, 0.8),
        size: rand(4, 8),
        durationMs: rand(500, 900),
      });
    }
    if (roll < 0.78) {
      return rainBase({
        kind: "fall",
        x: px + rand(-2, 3),
        y: py + rand(0.12, 0.88) * ph,
        dx: rand(-100, -40),
        dy: rand(40, 120),
        scale: rand(0.4, 0.8),
        size: rand(4, 8),
        durationMs: rand(500, 900),
      });
    }
    return rainBase({
      kind: "fall",
      x: px + pw + rand(-3, 2),
      y: py + rand(0.12, 0.88) * ph,
      dx: rand(40, 100),
      dy: rand(40, 120),
      scale: rand(0.4, 0.8),
      size: rand(4, 8),
      durationMs: rand(500, 900),
    });
  }

  if (edge === "bottom") {
    if (roll < 0.55) {
      return rainBase({
        kind: "fall",
        x: px + rand(0.08, 0.92) * pw,
        y: py + rand(-2, 3),
        dx: rand(-18, 18),
        dy: rand(90, 180),
        scale: rand(0.4, 0.8),
        size: rand(4, 8),
        durationMs: rand(500, 900),
      });
    }
    if (roll < 0.78) {
      return rainBase({
        kind: "fall",
        x: px + rand(-2, 3),
        y: py + rand(0.12, 0.88) * ph,
        dx: rand(-100, -40),
        dy: rand(40, 120),
        scale: rand(0.4, 0.8),
        size: rand(4, 8),
        durationMs: rand(500, 900),
      });
    }
    return rainBase({
      kind: "fall",
      x: px + pw + rand(-3, 2),
      y: py + rand(0.12, 0.88) * ph,
      dx: rand(40, 100),
      dy: rand(40, 120),
      scale: rand(0.4, 0.8),
      size: rand(4, 8),
      durationMs: rand(500, 900),
    });
  }

  if (edge === "left") {
    if (roll < 0.55) {
      return rainBase({
        kind: "fall",
        x: px + pw + rand(-2, 3),
        y: py + rand(0.08, 0.92) * ph,
        dx: rand(20, 60),
        dy: rand(80, 170),
        scale: rand(0.4, 0.8),
        size: rand(4, 8),
        durationMs: rand(500, 900),
      });
    }
    if (roll < 0.78) {
      return rainBase({
        kind: "fall",
        x: px + rand(0.1, 0.9) * pw,
        y: py + rand(-2, 3),
        dx: rand(-12, 12),
        dy: rand(90, 180),
        scale: rand(0.4, 0.8),
        size: rand(4, 8),
        durationMs: rand(500, 900),
      });
    }
    return rainBase({
      kind: "fall",
      x: px + rand(0.1, 0.9) * pw,
      y: py + ph + rand(-3, 2),
      dx: rand(-12, 12),
      dy: rand(70, 150),
      scale: rand(0.4, 0.8),
      size: rand(4, 8),
      durationMs: rand(500, 900),
    });
  }

  if (roll < 0.55) {
    return rainBase({
      kind: "fall",
      x: px + rand(-2, 3),
      y: py + rand(0.08, 0.92) * ph,
      dx: rand(-60, -20),
      dy: rand(80, 170),
      scale: rand(0.4, 0.8),
      size: rand(4, 8),
      durationMs: rand(500, 900),
    });
  }
  if (roll < 0.78) {
    return rainBase({
      kind: "fall",
      x: px + rand(0.1, 0.9) * pw,
      y: py + rand(-2, 3),
      dx: rand(-12, 12),
      dy: rand(90, 180),
      scale: rand(0.4, 0.8),
      size: rand(4, 8),
      durationMs: rand(500, 900),
    });
  }
  return rainBase({
    kind: "fall",
    x: px + rand(0.1, 0.9) * pw,
    y: py + ph + rand(-3, 2),
    dx: rand(-12, 12),
    dy: rand(70, 150),
    scale: rand(0.4, 0.8),
    size: rand(4, 8),
    durationMs: rand(500, 900),
  });
}

export function makeFringe(
  _edge: DockEdge,
  mode: FringeMode,
  count: number,
): FringeDrop[] {
  const drops: FringeDrop[] = [];
  for (let i = 0; i < count; i++) {
    drops.push({
      id: nextRainId(),
      along: ((i + 0.5) / count) * 100 + rand(-2, 2),
      offset: mode === "screen" ? rand(-22, -6) : rand(2, 14),
      rot: rand(-18, 18),
      scale: rand(0.7, 1.25),
      color: pickRainColor(),
      flip: false,
    });
  }
  return drops;
}
