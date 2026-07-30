/** Icicle scatter chips + melt drips (canvas accents). */

import type { DockEdge, PanelInset } from "../../types";
import { rand } from "../../math";
import { particleGain } from "../../appearance";
import { getFxAppearance } from "../../appearanceStore";
import {
  alongEdgePx,
  burstVelocity,
  createPool,
  getWeatherSprites,
  offscreen,
  panelPx,
  type ParticlePool,
  type PoolSlot,
} from "../../weather";

export type IceAccentKind = "chip" | "drip";

export interface IceAccentSlot extends PoolSlot {
  kind: IceAccentKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  alpha: number;
  rot: number;
  spin: number;
}

const CAPACITY = 80;

function blank(): IceAccentSlot {
  return {
    alive: false,
    kind: "chip",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 1,
    size: 8,
    alpha: 0.7,
    rot: 0,
    spin: 0,
  };
}

export interface IceAccentSim {
  pool: ParticlePool<IceAccentSlot>;
  active: boolean;
  panel: PanelInset;
  edge: DockEdge | null;
  fringeTips: Array<{ x: number; y: number }>;
  scatterChips: (
    edge: DockEdge,
    kind: "expand" | "collapse" | string,
    w: number,
    h: number,
  ) => void;
  spawnDrips: (count: number) => void;
  step: (dt: number, w: number, h: number) => void;
  draw: (ctx: CanvasRenderingContext2D) => void;
  clear: () => void;
}

export function createIceAccentSim(): IceAccentSim {
  const pool = createPool(CAPACITY, blank);
  const sprites = getWeatherSprites();

  const sim: IceAccentSim = {
    pool,
    active: true,
    panel: { x: 20, y: 20, w: 60, h: 60 },
    edge: null,
    fringeTips: [],

    clear() {
      pool.clear();
    },

    scatterChips(edge, kind, w, h) {
      const rect = panelPx(sim.panel, w, h);
      const count = kind === "collapse" ? 28 : 22;
      const strength = kind === "collapse" ? 1.2 : 1;

      for (let i = 0; i < count; i++) {
        const p = pool.acquire();
        if (!p) break;
        const t = (i + 0.5) / count;
        const pos = alongEdgePx(edge, rect, t, 5);
        const vel = burstVelocity(edge, strength * 0.7);
        p.kind = "chip";
        p.x = pos.x;
        p.y = pos.y;
        p.vx = vel.vx + rand(-50, 50);
        p.vy = vel.vy + rand(-40, 40);
        p.maxLife = rand(0.55, 1.15);
        p.life = p.maxLife;
        p.size = rand(5, 12);
        p.alpha = rand(0.45, 0.9);
        p.rot = rand(0, Math.PI * 2);
        p.spin = rand(-4, 4);
      }
    },

    spawnDrips(count) {
      if (sim.fringeTips.length === 0) return;
      for (let i = 0; i < count; i++) {
        const tip =
          sim.fringeTips[Math.floor(Math.random() * sim.fringeTips.length)];
        if (!tip) continue;
        const p = pool.acquire();
        if (!p) break;
        p.kind = "drip";
        p.x = tip.x + rand(-3, 3);
        p.y = tip.y + rand(0, 4);
        p.vx = rand(-8, 8);
        p.vy = rand(40, 90);
        p.maxLife = rand(0.7, 1.4);
        p.life = p.maxLife;
        p.size = rand(5, 9);
        p.alpha = rand(0.4, 0.75);
        p.rot = 0;
        p.spin = 0;
      }
    },

    step(dt, w, h) {
      if (!sim.active) return;
      pool.forEachAlive((p) => {
        p.life -= dt;
        if (p.life <= 0) {
          p.alive = false;
          return;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.kind === "chip") {
          p.vy += 180 * dt;
          p.rot += p.spin * dt;
        } else {
          p.vy += 220 * dt;
          p.vx *= 0.98;
        }
        if (offscreen(p.x, p.y, w, h, 40)) p.alive = false;
      });
    },

    draw(ctx) {
      const chip = sprites.iceChip;
      const drip = sprites.drip;
      pool.forEachAlive((p) => {
        const t = p.life / Math.max(0.001, p.maxLife);
        const fade = t < 0.15 ? t / 0.15 : t > 0.8 ? (1 - t) / 0.2 : 1;
        const { mul, profile } = particleGain(getFxAppearance(), 0.9);
        ctx.save();
        ctx.globalAlpha = Math.min(1, p.alpha * fade * mul);
        ctx.filter =
          profile.colorMode === "onLight"
            ? "brightness(0.65) contrast(1.2)"
            : "brightness(1.2)";
        ctx.translate(p.x, p.y);
        if (p.kind === "chip") {
          ctx.rotate(p.rot);
          const s = p.size * (getFxAppearance().edgeBoost ? 1.15 : 1);
          ctx.drawImage(chip, -s / 2, -s / 2, s, s);
        } else {
          const s = p.size;
          ctx.drawImage(drip, -s / 2, -s * 0.2, s * 0.7, s * 1.4);
        }
        ctx.restore();
      });
    },
  };

  return sim;
}

/** Approximate fringe tip positions from panel + edge + fringe items. */
export function computeFringeTips(
  edge: DockEdge,
  panel: PanelInset,
  fringe: Array<{ along: number; offset: number; scale: number }>,
  mode: "strip" | "screen",
  w: number,
  h: number,
): Array<{ x: number; y: number }> {
  const rect = panelPx(panel, w, h);
  const tips: Array<{ x: number; y: number }> = [];

  for (const f of fringe) {
    const along = f.along / 100;
    const len = 18 * f.scale + 10;
    if (edge === "top") {
      const x = rect.x + along * rect.w;
      if (mode === "screen") {
        tips.push({ x, y: rect.y + Math.abs(f.offset) + len * 0.85 });
      } else {
        tips.push({
          x,
          y: rect.y + rect.h - 8 + Math.abs(f.offset) * 0.2,
        });
      }
    } else if (edge === "bottom") {
      const x = rect.x + along * rect.w;
      if (mode === "screen") {
        tips.push({ x, y: rect.y + rect.h - Math.abs(f.offset) });
      } else {
        tips.push({ x, y: rect.y + 8 + len * 0.7 });
      }
    } else if (edge === "left") {
      const y = rect.y + along * rect.h;
      if (mode === "screen") {
        tips.push({ x: rect.x + Math.abs(f.offset) + len * 0.7, y });
      } else {
        tips.push({ x: rect.x + rect.w - 6, y });
      }
    } else {
      const y = rect.y + along * rect.h;
      if (mode === "screen") {
        tips.push({ x: rect.x + rect.w - Math.abs(f.offset), y });
      } else {
        tips.push({ x: rect.x + 6 + len * 0.5, y });
      }
    }
  }
  return tips;
}
