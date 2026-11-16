/** Firefly / amber dust canvas field. */

import type { DockEdge, PanelInset } from "../../types";
import { rand } from "../../math";
import { densityTarget, particleGain } from "../../appearance";
import { getFxAppearance } from "../../appearanceStore";
import {
  alongEdgePx,
  ambientSpawnPx,
  burstVelocity,
  createPool,
  offscreen,
  panelPx,
  type ParticlePool,
  type PoolSlot,
  windX,
} from "../../weather";

export interface FireflySlot extends PoolSlot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  alpha: number;
  depth: number;
  phase: number;
  pulse: number;
}

const CAPACITY = 100;

function blank(): FireflySlot {
  return {
    alive: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 1,
    size: 6,
    alpha: 0.6,
    depth: 0.5,
    phase: 0,
    pulse: 1,
  };
}

let glowSprite: HTMLCanvasElement | null = null;

function getGlowSprite() {
  if (glowSprite) return glowSprite;
  const c = document.createElement("canvas");
  c.width = 48;
  c.height = 48;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(24, 24, 0, 24, 24, 22);
  g.addColorStop(0, "rgba(255, 236, 180, 1)");
  g.addColorStop(0.25, "rgba(255, 196, 90, 0.85)");
  g.addColorStop(0.55, "rgba(232, 140, 40, 0.35)");
  g.addColorStop(1, "rgba(180, 90, 20, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(24, 24, 22, 0, Math.PI * 2);
  ctx.fill();
  glowSprite = c;
  return c;
}

export interface FireflySim {
  pool: ParticlePool<FireflySlot>;
  active: boolean;
  panel: PanelInset;
  seedAmbientField: (w: number, h: number, count: number) => void;
  boostAmbient: (edge: DockEdge, phase: string, w: number, h: number) => void;
  scatterBurst: (edge: DockEdge, kind: string, w: number, h: number) => void;
  step: (dt: number, w: number, h: number, timeSec: number) => void;
  draw: (ctx: CanvasRenderingContext2D, timeSec: number) => void;
  clear: () => void;
}

export function createFireflySim(): FireflySim {
  const pool = createPool(CAPACITY, blank);

  const sim: FireflySim = {
    pool,
    active: false,
    panel: { x: 20, y: 20, w: 60, h: 60 },

    clear() {
      pool.clear();
    },

    seedAmbientField(w, h, count) {
      for (let i = 0; i < count; i++) {
        const p = pool.acquire();
        if (!p) break;
        const depth = Math.random();
        p.x = rand(0, w);
        p.y = rand(0, h);
        p.vx = rand(-18, 18);
        p.vy = rand(-14, 14);
        p.maxLife = rand(4, 9);
        p.life = rand(0.5, p.maxLife);
        p.size = depth > 0.55 ? rand(7, 14) : rand(3, 7);
        p.alpha = depth > 0.55 ? rand(0.45, 0.85) : rand(0.15, 0.4);
        p.depth = depth;
        p.phase = rand(0, Math.PI * 2);
        p.pulse = rand(0.8, 1.4);
      }
    },

    boostAmbient(edge, phase, w, h) {
      const n = phase === "collapsed" ? 3 : 2;
      const rect = panelPx(sim.panel, w, h);
      for (let i = 0; i < n; i++) {
        const p = pool.acquire();
        if (!p) break;
        const pos = ambientSpawnPx(edge, rect, w, h);
        const depth = rand(0.4, 1);
        p.x = pos.x;
        p.y = pos.y;
        p.vx = rand(-22, 22);
        p.vy = rand(-18, 18);
        p.maxLife = rand(2.5, 5);
        p.life = p.maxLife;
        p.size = depth > 0.55 ? rand(8, 14) : rand(4, 8);
        p.alpha = rand(0.35, 0.8);
        p.depth = depth;
        p.phase = rand(0, Math.PI * 2);
        p.pulse = rand(0.9, 1.5);
      }
    },

    scatterBurst(edge, kind, w, h) {
      const rect = panelPx(sim.panel, w, h);
      const count = kind === "collapse" ? 28 : 22;
      for (let i = 0; i < count; i++) {
        const p = pool.acquire();
        if (!p) break;
        const pos = alongEdgePx(edge, rect, (i + 0.5) / count, 10);
        const vel = burstVelocity(edge, 0.45);
        p.x = pos.x;
        p.y = pos.y;
        p.vx = vel.vx * 0.5 + rand(-40, 40);
        p.vy = vel.vy * 0.4 + rand(-40, 40);
        p.maxLife = rand(1.2, 2.4);
        p.life = p.maxLife;
        p.size = rand(8, 16);
        p.alpha = rand(0.5, 0.95);
        p.depth = rand(0.6, 1);
        p.phase = rand(0, Math.PI * 2);
        p.pulse = rand(1.2, 2);
      }
    },

    step(dt, w, h, timeSec) {
      if (!sim.active) return;
      const target = densityTarget(getFxAppearance(), 55);
      const alive = pool.aliveCount();
      if (alive < target * 0.7) {
        sim.seedAmbientField(w, h, Math.min(12, target - alive));
      }

      pool.forEachAlive((p) => {
        p.life -= dt;
        if (p.life <= 0) {
          pool.release(p);
          return;
        }
        const sway = windX(timeSec, p.phase, 12 + p.depth * 10);
        p.x += (p.vx + sway) * dt;
        p.y += (p.vy + Math.sin(timeSec * p.pulse + p.phase) * 8) * dt;
        if (offscreen(p.x, p.y, w, h, 40)) {
          p.x = rand(0, w);
          p.y = rand(0, h);
          p.life = rand(3, 7);
          p.maxLife = p.life;
        }
      });
    },

    draw(ctx, timeSec) {
      const sprite = getGlowSprite();
      const app = getFxAppearance();
      const nearGain = particleGain(app, 1);
      const farGain = particleGain(app, 0);
      pool.forEachAlive((p) => {
        const t = p.life / Math.max(0.001, p.maxLife);
        const fade = t < 0.15 ? t / 0.15 : t > 0.8 ? (1 - t) / 0.2 : 1;
        const breath =
          0.55 +
          0.45 * Math.sin(timeSec * p.pulse * 2.2 + p.phase);
        const { mul, profile } = p.depth > 0.55 ? nearGain : farGain;
        const s =
          p.size *
          (0.75 + breath * 0.45) *
          (app.edgeBoost && p.depth > 0.55 ? 1.2 : 1);

        ctx.save();
        ctx.globalAlpha = Math.min(1, p.alpha * fade * breath * mul);
        ctx.filter =
          profile.colorMode === "onLight"
            ? "brightness(0.75) saturate(1.35) contrast(1.15)"
            : "brightness(1.25) saturate(1.1)";
        ctx.translate(p.x, p.y);
        ctx.drawImage(sprite, -s / 2, -s / 2, s, s);
        ctx.restore();
      });
    },
  };

  return sim;
}
