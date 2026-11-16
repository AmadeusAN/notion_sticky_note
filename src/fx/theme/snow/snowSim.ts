/** Canvas snow particle simulation. */

import type { DockEdge, PanelInset } from "../../types";
import { rand } from "../../math";
import { densityTarget, particleGain, type FxParticleGain } from "../../appearance";
import { getFxAppearance } from "../../appearanceStore";
import {
  alongEdgePx,
  ambientSpawnPx,
  burstVelocity,
  createPool,
  getWeatherSprites,
  offscreen,
  panelPx,
  type ParticlePool,
  type PoolSlot,
  windX,
} from "../../weather";

export interface SnowSlot extends PoolSlot {
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
  rot: number;
  spin: number;
  near: boolean;
}

const CAPACITY = 140;

function blank(): SnowSlot {
  return {
    alive: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 1,
    size: 8,
    alpha: 0.6,
    depth: 0.5,
    phase: 0,
    rot: 0,
    spin: 0,
    near: false,
  };
}

export interface SnowSim {
  pool: ParticlePool<SnowSlot>;
  wind: number;
  active: boolean;
  panel: PanelInset;
  edge: DockEdge | null;
  seedAmbientField: (w: number, h: number, count: number) => void;
  boostAmbient: (edge: DockEdge, phase: string, w: number, h: number) => void;
  scatterBurst: (
    edge: DockEdge,
    kind: "expand" | "collapse" | string,
    w: number,
    h: number,
  ) => void;
  step: (dt: number, w: number, h: number, timeSec: number) => void;
  draw: (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    timeSec: number,
  ) => void;
  clear: () => void;
}

export function createSnowSim(): SnowSim {
  const pool = createPool(CAPACITY, blank);
  const sprites = getWeatherSprites();

  const sim: SnowSim = {
    pool,
    wind: 22,
    active: false,
    panel: { x: 20, y: 20, w: 60, h: 60 },
    edge: null,

    clear() {
      pool.clear();
    },

    seedAmbientField(w, h, count) {
      for (let i = 0; i < count; i++) {
        const p = pool.acquire();
        if (!p) break;
        const depth = Math.random();
        const near = depth > 0.62;
        p.x = rand(-20, w + 20);
        p.y = rand(-30, h);
        p.vx = sim.wind * (0.3 + depth * 0.5) + rand(-10, 10);
        p.vy = near ? rand(28, 55) : rand(14, 32);
        p.maxLife = rand(3.5, 7);
        p.life = rand(0.5, p.maxLife);
        p.size = near ? rand(10, 18) : rand(4, 9);
        p.alpha = near ? rand(0.55, 0.9) : rand(0.18, 0.45);
        p.depth = depth;
        p.phase = rand(0, Math.PI * 2);
        p.rot = rand(0, Math.PI * 2);
        p.spin = rand(-0.6, 0.6);
        p.near = near;
      }
    },

    boostAmbient(edge, phase, w, h) {
      const n = phase === "collapsed" ? (Math.random() < 0.5 ? 3 : 2) : 2;
      const rect = panelPx(sim.panel, w, h);
      for (let i = 0; i < n; i++) {
        const p = pool.acquire();
        if (!p) break;
        const pos = ambientSpawnPx(edge, rect, w, h);
        const depth = rand(0.3, 1);
        const near = depth > 0.62;
        p.x = pos.x;
        p.y = pos.y;
        p.vx = sim.wind * 0.4 + rand(-20, 20);
        p.vy = near ? rand(30, 60) : rand(16, 35);
        p.maxLife = rand(2.2, 4.5);
        p.life = p.maxLife;
        p.size = near ? rand(9, 16) : rand(4, 8);
        p.alpha = near ? rand(0.5, 0.85) : rand(0.2, 0.4);
        p.depth = depth;
        p.phase = rand(0, Math.PI * 2);
        p.rot = rand(0, Math.PI * 2);
        p.spin = rand(-0.7, 0.7);
        p.near = near;
      }
    },

    scatterBurst(edge, kind, w, h) {
      const rect = panelPx(sim.panel, w, h);
      const count = kind === "collapse" ? 34 : 28;
      const strength = kind === "collapse" ? 1.1 : 0.95;

      for (let i = 0; i < count; i++) {
        const p = pool.acquire();
        if (!p) break;
        const t = (i + 0.5) / count;
        const pos = alongEdgePx(edge, rect, t, 8);
        const vel = burstVelocity(edge, strength * 0.55);
        const depth = rand(0.4, 1);
        const near = depth > 0.55;
        p.x = pos.x;
        p.y = pos.y;
        p.vx = vel.vx + rand(-40, 40);
        p.vy = Math.abs(vel.vy) * 0.35 + rand(20, 70);
        if (edge === "bottom") p.vy = rand(-40, 30);
        p.maxLife = rand(1.1, 2.2);
        p.life = p.maxLife;
        p.size = near ? rand(11, 20) : rand(5, 11);
        p.alpha = rand(0.4, 0.9);
        p.depth = depth;
        p.phase = rand(0, Math.PI * 2);
        p.rot = rand(0, Math.PI * 2);
        p.spin = rand(-1.2, 1.2);
        p.near = near;
      }
    },

    step(dt, w, h, timeSec) {
      if (!sim.active) return;
      const target = densityTarget(getFxAppearance(), 85);
      const alive = pool.aliveCount();
      if (alive < target * 0.7) {
        sim.seedAmbientField(w, h, Math.min(14, target - alive));
      }

      pool.forEachAlive((p) => {
        p.life -= dt;
        if (p.life <= 0) {
          pool.release(p);
          return;
        }

        const sway = windX(timeSec, p.phase, 22 + p.depth * 18);
        p.x += (p.vx + sway) * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt;

        if (offscreen(p.x, p.y, w, h, 50)) {
          p.x = rand(-20, w + 20);
          p.y = rand(-40, -6);
          p.life = rand(2.5, 6);
          p.maxLife = p.life;
        }
      });
    },

    draw(ctx) {
      const soft = sprites.snowSoft;
      const nearSpr = sprites.snowNear;
      const app = getFxAppearance();
      const nearGain = particleGain(app, 1);
      const farGain = particleGain(app, 0);

      pool.forEachAlive((p) => {
        if (p.near) return;
        drawFlake(ctx, soft, p, p.depth > 0.55 ? nearGain : farGain, app.edgeBoost);
      });
      pool.forEachAlive((p) => {
        if (!p.near) return;
        drawFlake(ctx, nearSpr, p, p.depth > 0.55 ? nearGain : farGain, app.edgeBoost);
      });
    },
  };

  return sim;
}

function drawFlake(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement,
  p: SnowSlot,
  gain: FxParticleGain,
  edgeBoost: boolean,
) {
  const t = Math.min(1, p.life / Math.max(0.001, p.maxLife));
  const fade = t < 0.12 ? t / 0.12 : t > 0.82 ? (1 - t) / 0.18 : 1;
  const { mul, profile } = gain;
  const s =
    p.size *
    (edgeBoost && p.near ? 1.2 : 1);

  ctx.save();
  ctx.globalAlpha = Math.min(1, p.alpha * fade * mul);
  ctx.filter =
    profile.colorMode === "onLight"
      ? "brightness(0.72) contrast(1.15) drop-shadow(0 0 1px rgba(80,100,120,0.45))"
      : "brightness(1.15)";
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.drawImage(sprite, -s / 2, -s / 2, s, s);
  ctx.restore();
}
