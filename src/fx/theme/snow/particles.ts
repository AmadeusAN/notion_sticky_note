/** Snow theme particle helpers (scatter / bush / fall / fringe). */

import type { DockEdge, PanelInset } from "../../types";
import { clamp, rand } from "../../math";

export type { DockEdge, PanelInset };

export interface SnowParticle {
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

export interface FringeFlake {
  id: number;
  along: number;
  offset: number;
  rot: number;
  scale: number;
  color: string;
  flip: boolean;
}

export type FringeMode = "strip" | "screen";

const SNOW_COLORS = [
  "#ffffff",
  "#f0f6ff",
  "#e4eef8",
  "#dce8f5",
  "#f7fbff",
  "#cfdceb",
  "#eef4fb",
];

let snowSeq = 0;
export const nextSnowId = () => ++snowSeq;

function pickSnowColor() {
  return SNOW_COLORS[Math.floor(Math.random() * SNOW_COLORS.length)]!;
}

function snowBase(
  partial: Omit<
    SnowParticle,
    "id" | "color" | "rot" | "scale" | "spin" | "durationMs" | "size"
  > &
    Partial<Pick<SnowParticle, "durationMs" | "scale" | "size" | "spin">>,
): SnowParticle {
  return {
    id: nextSnowId(),
    color: pickSnowColor(),
    rot: rand(0, 360),
    scale: partial.scale ?? rand(0.45, 1.05),
    spin: partial.spin ?? rand(-200, 200),
    durationMs: partial.durationMs ?? rand(900, 1600),
    size: partial.size ?? 14,
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
  flake: SnowParticle,
  edge: DockEdge,
  panel: PanelInset,
): SnowParticle {
  const along = edge === "top" || edge === "bottom" ? flake.x : flake.y;
  const start = edge === "top" || edge === "bottom" ? panel.x : panel.y;
  const span = edge === "top" || edge === "bottom" ? panel.w : panel.h;
  const rim = endRim(along, start, span);
  if (rim <= 0.05) return { ...flake, rim: 0 };

  const latMul = 1 - rim * 0.72;
  const outMul = 1 - rim * 0.28;
  let { dx, dy } = flake;
  if (edge === "top" || edge === "bottom") {
    dx *= latMul;
    dy *= outMul;
  } else {
    dy *= latMul;
    dx *= outMul;
  }

  return {
    ...flake,
    rim,
    dx,
    dy,
    scale: flake.scale * (1 - rim * 0.42),
    size: flake.size * (1 - rim * 0.38),
    durationMs: Math.round(flake.durationMs * (1 - rim * 0.3)),
  };
}

function finalizeScatter(
  flakes: SnowParticle[],
  edge: DockEdge,
  panel: PanelInset,
): SnowParticle[] {
  return flakes.map((f) => softRim(f, edge, panel));
}

export function makeExpandScatter(
  edge: DockEdge,
  panel: PanelInset,
): SnowParticle[] {
  const flakes: SnowParticle[] = [];
  const n = 22;
  const { x: px, y: py, w: pw, h: ph } = panel;

  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n + rand(-0.015, 0.015);
    const side = Math.random() < 0.5 ? -1 : 1;

    if (edge === "top") {
      flakes.push(
        snowBase({
          kind: "burst",
          x: alongEdge(t, px, pw),
          y: py + rand(-1, 4),
          dx: side * rand(28, 90) + rand(-20, 20),
          dy: rand(40, 120),
          size: rand(12, 22),
          scale: rand(0.7, 1.3),
          durationMs: rand(900, 1400),
          spin: rand(-260, 260),
        }),
      );
    } else if (edge === "bottom") {
      flakes.push(
        snowBase({
          kind: "burst",
          x: alongEdge(t, px, pw),
          y: py + ph + rand(-4, 1),
          dx: side * rand(28, 90) + rand(-20, 20),
          dy: rand(-120, -40),
          size: rand(12, 22),
          scale: rand(0.7, 1.3),
          durationMs: rand(900, 1400),
        }),
      );
    } else if (edge === "left") {
      flakes.push(
        snowBase({
          kind: "burst",
          x: px + rand(-1, 4),
          y: alongEdge(t, py, ph),
          dx: rand(40, 110),
          dy: side * rand(28, 90) + rand(20, 80),
          size: rand(12, 22),
          scale: rand(0.7, 1.3),
          durationMs: rand(900, 1400),
        }),
      );
    } else {
      flakes.push(
        snowBase({
          kind: "burst",
          x: px + pw + rand(-4, 1),
          y: alongEdge(t, py, ph),
          dx: rand(-110, -40),
          dy: side * rand(28, 90) + rand(20, 80),
          size: rand(12, 22),
          scale: rand(0.7, 1.3),
          durationMs: rand(900, 1400),
        }),
      );
    }
  }

  return finalizeScatter(flakes, edge, panel);
}

export function makeBushPart(edge: DockEdge, panel: PanelInset): SnowParticle[] {
  const flakes: SnowParticle[] = [];
  const count = 22;
  const { x: px, y: py, w: pw, h: ph } = panel;

  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count + rand(-0.012, 0.012);
    const side = Math.random() < 0.5 ? -1 : 1;

    if (edge === "top") {
      flakes.push(
        snowBase({
          kind: "bush",
          x: alongEdge(t, px, pw),
          y: py + rand(-2, 5),
          dx: side * rand(32, 100) + rand(-18, 18),
          dy: rand(50, 130),
          scale: rand(0.85, 1.45),
          size: rand(14, 26),
          durationMs: rand(1000, 1550),
          spin: rand(-280, 280),
        }),
      );
    } else if (edge === "bottom") {
      flakes.push(
        snowBase({
          kind: "bush",
          x: alongEdge(t, px, pw),
          y: py + ph + rand(-5, 2),
          dx: side * rand(32, 100) + rand(-18, 18),
          dy: rand(-130, -50),
          scale: rand(0.85, 1.45),
          size: rand(14, 26),
          durationMs: rand(1000, 1550),
        }),
      );
    } else if (edge === "left") {
      flakes.push(
        snowBase({
          kind: "bush",
          x: px + rand(-2, 5),
          y: alongEdge(t, py, ph),
          dx: rand(50, 120),
          dy: side * rand(32, 100) + rand(25, 90),
          scale: rand(0.85, 1.45),
          size: rand(14, 26),
          durationMs: rand(1000, 1550),
        }),
      );
    } else {
      flakes.push(
        snowBase({
          kind: "bush",
          x: px + pw + rand(-5, 2),
          y: alongEdge(t, py, ph),
          dx: rand(-120, -50),
          dy: side * rand(32, 100) + rand(25, 90),
          scale: rand(0.85, 1.45),
          size: rand(14, 26),
          durationMs: rand(1000, 1550),
        }),
      );
    }
  }

  return finalizeScatter(flakes, edge, panel);
}

export function makeFall(
  edge: DockEdge,
  _phase: "collapsed" | "expanded",
  panel: PanelInset,
): SnowParticle {
  const { x: px, y: py, w: pw, h: ph } = panel;
  const roll = Math.random();

  if (edge === "top") {
    if (roll < 0.55) {
      return snowBase({
        kind: "fall",
        x: px + rand(0.08, 0.92) * pw,
        y: py + ph + rand(-3, 2),
        dx: rand(-50, 50),
        dy: rand(45, 120),
        scale: rand(0.35, 0.75),
        size: rand(8, 14),
        durationMs: rand(1200, 2000),
      });
    }
    if (roll < 0.78) {
      return snowBase({
        kind: "fall",
        x: px + rand(-2, 3),
        y: py + rand(0.12, 0.88) * ph,
        dx: rand(-90, -30),
        dy: rand(20, 70),
        scale: rand(0.35, 0.75),
        size: rand(8, 14),
        durationMs: rand(1200, 2000),
      });
    }
    return snowBase({
      kind: "fall",
      x: px + pw + rand(-3, 2),
      y: py + rand(0.12, 0.88) * ph,
      dx: rand(30, 90),
      dy: rand(20, 70),
      scale: rand(0.35, 0.75),
      size: rand(8, 14),
      durationMs: rand(1200, 2000),
    });
  }

  if (edge === "bottom") {
    if (roll < 0.55) {
      return snowBase({
        kind: "fall",
        x: px + rand(0.08, 0.92) * pw,
        y: py + rand(-2, 3),
        dx: rand(-50, 50),
        dy: rand(45, 120),
        scale: rand(0.35, 0.75),
        size: rand(8, 14),
        durationMs: rand(1200, 2000),
      });
    }
    if (roll < 0.78) {
      return snowBase({
        kind: "fall",
        x: px + rand(-2, 3),
        y: py + rand(0.12, 0.88) * ph,
        dx: rand(-90, -30),
        dy: rand(20, 70),
        scale: rand(0.35, 0.75),
        size: rand(8, 14),
        durationMs: rand(1200, 2000),
      });
    }
    return snowBase({
      kind: "fall",
      x: px + pw + rand(-3, 2),
      y: py + rand(0.12, 0.88) * ph,
      dx: rand(30, 90),
      dy: rand(20, 70),
      scale: rand(0.35, 0.75),
      size: rand(8, 14),
      durationMs: rand(1200, 2000),
    });
  }

  if (edge === "left") {
    if (roll < 0.55) {
      return snowBase({
        kind: "fall",
        x: px + pw + rand(-2, 3),
        y: py + rand(0.08, 0.92) * ph,
        dx: rand(20, 70),
        dy: rand(40, 110),
        scale: rand(0.35, 0.75),
        size: rand(8, 14),
        durationMs: rand(1200, 2000),
      });
    }
    if (roll < 0.78) {
      return snowBase({
        kind: "fall",
        x: px + rand(0.1, 0.9) * pw,
        y: py + rand(-2, 3),
        dx: rand(-30, 40),
        dy: rand(50, 120),
        scale: rand(0.35, 0.75),
        size: rand(8, 14),
        durationMs: rand(1200, 2000),
      });
    }
    return snowBase({
      kind: "fall",
      x: px + rand(0.1, 0.9) * pw,
      y: py + ph + rand(-3, 2),
      dx: rand(-30, 40),
      dy: rand(40, 100),
      scale: rand(0.35, 0.75),
      size: rand(8, 14),
      durationMs: rand(1200, 2000),
    });
  }

  if (roll < 0.55) {
    return snowBase({
      kind: "fall",
      x: px + rand(-2, 3),
      y: py + rand(0.08, 0.92) * ph,
      dx: rand(-70, -20),
      dy: rand(40, 110),
      scale: rand(0.35, 0.75),
      size: rand(8, 14),
      durationMs: rand(1200, 2000),
    });
  }
  if (roll < 0.78) {
    return snowBase({
      kind: "fall",
      x: px + rand(0.1, 0.9) * pw,
      y: py + rand(-2, 3),
      dx: rand(-40, 30),
      dy: rand(50, 120),
      scale: rand(0.35, 0.75),
      size: rand(8, 14),
      durationMs: rand(1200, 2000),
    });
  }
  return snowBase({
    kind: "fall",
    x: px + rand(0.1, 0.9) * pw,
    y: py + ph + rand(-3, 2),
    dx: rand(-40, 30),
    dy: rand(40, 100),
    scale: rand(0.35, 0.75),
    size: rand(8, 14),
    durationMs: rand(1200, 2000),
  });
}

export function makeFringe(
  _edge: DockEdge,
  mode: FringeMode,
  count: number,
): FringeFlake[] {
  const flakes: FringeFlake[] = [];
  for (let i = 0; i < count; i++) {
    flakes.push({
      id: nextSnowId(),
      along: ((i + 0.5) / count) * 100 + rand(-2, 2),
      offset: mode === "screen" ? rand(-16, -3) : rand(1, 10),
      rot: rand(-40, 40),
      scale: rand(0.55, 1.15),
      color: pickSnowColor(),
      flip: Math.random() > 0.5,
    });
  }
  return flakes;
}
