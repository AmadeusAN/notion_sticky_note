/** Shared weather motion / geometry helpers. */

import type { DockEdge, PanelInset } from "../types";
import { clamp, rand } from "../math";

export function clampDpr(dpr: number, max = 1.75) {
  return Math.min(Math.max(dpr, 1), max);
}

export function windX(timeSec: number, phase: number, amp: number) {
  return (
    Math.sin(timeSec * 0.9 + phase) * amp +
    Math.sin(timeSec * 1.7 + phase * 1.3) * amp * 0.35
  );
}

/** Panel inset (%) → pixel rect in the fx window. */
export function panelPx(panel: PanelInset, w: number, h: number) {
  return {
    x: (panel.x / 100) * w,
    y: (panel.y / 100) * h,
    w: (panel.w / 100) * w,
    h: (panel.h / 100) * h,
  };
}

export type PxRect = ReturnType<typeof panelPx>;

/** Spawn position along the docked edge of the panel (px). */
export function alongEdgePx(
  edge: DockEdge,
  panel: PxRect,
  t: number,
  jitter = 4,
): { x: number; y: number } {
  const u = clamp(t + rand(-0.012, 0.012), 0.02, 0.98);
  if (edge === "top") {
    return { x: panel.x + u * panel.w + rand(-jitter, jitter), y: panel.y + rand(-2, 6) };
  }
  if (edge === "bottom") {
    return {
      x: panel.x + u * panel.w + rand(-jitter, jitter),
      y: panel.y + panel.h + rand(-6, 2),
    };
  }
  if (edge === "left") {
    return { x: panel.x + rand(-2, 6), y: panel.y + u * panel.h + rand(-jitter, jitter) };
  }
  return {
    x: panel.x + panel.w + rand(-6, 2),
    y: panel.y + u * panel.h + rand(-jitter, jitter),
  };
}

/** Outward / gravity-ish burst velocity from a dock edge. */
export function burstVelocity(edge: DockEdge, strength = 1) {
  const side = Math.random() < 0.5 ? -1 : 1;
  if (edge === "top") {
    return {
      vx: side * rand(20, 90) * strength + rand(-30, 30),
      vy: rand(120, 320) * strength,
    };
  }
  if (edge === "bottom") {
    return {
      vx: side * rand(20, 90) * strength + rand(-30, 30),
      vy: -rand(80, 220) * strength,
    };
  }
  if (edge === "left") {
    return {
      vx: rand(80, 240) * strength,
      vy: side * rand(30, 100) * strength + rand(40, 160) * strength,
    };
  }
  return {
    vx: -rand(80, 240) * strength,
    vy: side * rand(30, 100) * strength + rand(40, 160) * strength,
  };
}

/** Soft fall spawn just outside the panel into the outer ring. */
export function ambientSpawnPx(
  edge: DockEdge,
  panel: PxRect,
  _w: number,
  h: number,
): { x: number; y: number } {
  const roll = Math.random();
  const pad = 8;

  if (edge === "top" || edge === "bottom") {
    if (roll < 0.55) {
      return {
        x: panel.x + rand(0.05, 0.95) * panel.w,
        y: edge === "top" ? panel.y + panel.h + rand(0, pad) : panel.y - rand(0, pad),
      };
    }
    if (roll < 0.78) {
      return { x: panel.x - rand(0, pad * 2), y: panel.y + rand(0.1, 0.9) * panel.h };
    }
    return {
      x: panel.x + panel.w + rand(0, pad * 2),
      y: panel.y + rand(0.1, 0.9) * panel.h,
    };
  }

  if (roll < 0.55) {
    return {
      x: edge === "left" ? panel.x + panel.w + rand(0, pad) : panel.x - rand(0, pad),
      y: panel.y + rand(0.05, 0.95) * panel.h,
    };
  }
  if (roll < 0.78) {
    return { x: panel.x + rand(0.1, 0.9) * panel.w, y: Math.max(pad, rand(0, panel.y)) };
  }
  return {
    x: panel.x + rand(0.1, 0.9) * panel.w,
    y: Math.min(h - pad, panel.y + panel.h + rand(0, pad * 3)),
  };
}

export function offscreen(x: number, y: number, w: number, h: number, margin = 40) {
  return x < -margin || y < -margin || x > w + margin || y > h + margin;
}
