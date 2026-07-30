/** Ink bleed accents on canvas. */

import type { DockEdge, PanelInset } from "../../types";
import { rand } from "../../math";
import { particleGain } from "../../appearance";
import { getFxAppearance } from "../../appearanceStore";
import {
  alongEdgePx,
  burstVelocity,
  createPool,
  offscreen,
  panelPx,
  type ParticlePool,
  type PoolSlot,
} from "../../weather";

export interface InkBleedSlot extends PoolSlot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  alpha: number;
}

const CAPACITY = 60;

function blank(): InkBleedSlot {
  return {
    alive: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 1,
    size: 8,
    alpha: 0.5,
  };
}

export interface InkBleedSim {
  pool: ParticlePool<InkBleedSlot>;
  active: boolean;
  panel: PanelInset;
  scatter: (edge: DockEdge, kind: string, w: number, h: number) => void;
  ambient: (edge: DockEdge, w: number, h: number, n: number) => void;
  step: (dt: number, w: number, h: number) => void;
  draw: (ctx: CanvasRenderingContext2D) => void;
  clear: () => void;
}

export function createInkBleedSim(): InkBleedSim {
  const pool = createPool(CAPACITY, blank);

  const sim: InkBleedSim = {
    pool,
    active: true,
    panel: { x: 20, y: 20, w: 60, h: 60 },

    clear() {
      pool.clear();
    },

    scatter(edge, kind, w, h) {
      const rect = panelPx(sim.panel, w, h);
      const count = kind === "collapse" ? 22 : 16;
      for (let i = 0; i < count; i++) {
        const p = pool.acquire();
        if (!p) break;
        const pos = alongEdgePx(edge, rect, (i + 0.5) / count, 8);
        const vel = burstVelocity(edge, 0.55);
        p.x = pos.x;
        p.y = pos.y;
        p.vx = vel.vx * 0.4 + rand(-40, 40);
        p.vy = vel.vy * 0.35 + rand(-30, 30);
        p.maxLife = rand(0.5, 1.1);
        p.life = p.maxLife;
        p.size = rand(6, 18);
        p.alpha = rand(0.25, 0.55);
      }
    },

    ambient(edge, w, h, n) {
      const rect = panelPx(sim.panel, w, h);
      for (let i = 0; i < n; i++) {
        const p = pool.acquire();
        if (!p) break;
        const pos = alongEdgePx(edge, rect, Math.random(), 10);
        p.x = pos.x + rand(-12, 12);
        p.y = pos.y + rand(-8, 8);
        p.vx = rand(-12, 12);
        p.vy = rand(-8, 16);
        p.maxLife = rand(0.8, 1.6);
        p.life = p.maxLife;
        p.size = rand(4, 12);
        p.alpha = rand(0.15, 0.4);
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
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.size += 6 * dt;
        if (offscreen(p.x, p.y, w, h, 30)) p.alive = false;
      });
    },

    draw(ctx) {
      const app = getFxAppearance();
      const { mul } = particleGain(app, 0.8);
      const color = app.luminance >= 0.55 ? app.fg : "#e8e2d6";
      pool.forEachAlive((p) => {
        const t = p.life / Math.max(0.001, p.maxLife);
        const fade = t < 0.2 ? t / 0.2 : t > 0.7 ? (1 - t) / 0.3 : 1;
        ctx.save();
        ctx.globalAlpha = Math.min(1, p.alpha * fade * mul);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        g.addColorStop(0, color);
        g.addColorStop(0.45, color);
        g.addColorStop(1, "transparent");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    },
  };

  return sim;
}
