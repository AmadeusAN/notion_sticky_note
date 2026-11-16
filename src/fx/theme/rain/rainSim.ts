/** Canvas rain particle simulation. */

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

export type RainKind = "streak" | "splash";

export interface RainSlot extends PoolSlot {
  kind: RainKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  len: number;
  width: number;
  alpha: number;
  depth: number;
  phase: number;
}

const CAPACITY = 200;

function blank(): RainSlot {
  return {
    alive: false,
    kind: "streak",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 1,
    len: 12,
    width: 1,
    alpha: 0.5,
    depth: 0.5,
    phase: 0,
  };
}

export interface RainSim {
  pool: ParticlePool<RainSlot>;
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

export function createRainSim(): RainSim {
  const pool = createPool(CAPACITY, blank);
  const sprites = getWeatherSprites();

  const sim: RainSim = {
    pool,
    wind: 38,
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
        const near = depth > 0.55;
        p.kind = "streak";
        p.x = rand(-20, w + 20);
        p.y = rand(-40, h);
        p.vx = sim.wind * (0.55 + depth * 0.7) + rand(-12, 12);
        p.vy = (near ? rand(520, 780) : rand(280, 480)) * (0.7 + depth * 0.5);
        p.maxLife = rand(1.2, 2.8);
        p.life = rand(0.2, p.maxLife);
        p.len = near ? rand(16, 28) : rand(8, 16);
        p.width = near ? rand(1.2, 2.2) : rand(0.6, 1.2);
        p.alpha = near ? rand(0.45, 0.75) : rand(0.12, 0.35);
        p.depth = depth;
        p.phase = rand(0, Math.PI * 2);
      }
    },

    boostAmbient(edge, phase, w, h) {
      const n = phase === "collapsed" ? (Math.random() < 0.55 ? 5 : 3) : 4;
      const rect = panelPx(sim.panel, w, h);
      for (let i = 0; i < n; i++) {
        const p = pool.acquire();
        if (!p) break;
        const pos = ambientSpawnPx(edge, rect, w, h);
        const depth = rand(0.25, 1);
        const near = depth > 0.55;
        p.kind = "streak";
        p.x = pos.x;
        p.y = pos.y;
        p.vx = sim.wind * (0.6 + depth * 0.55) + rand(-18, 18);
        p.vy = near ? rand(480, 720) : rand(260, 420);
        p.maxLife = rand(0.7, 1.4);
        p.life = p.maxLife;
        p.len = near ? rand(14, 26) : rand(8, 14);
        p.width = near ? rand(1.1, 2) : rand(0.55, 1.1);
        p.alpha = near ? rand(0.4, 0.7) : rand(0.15, 0.35);
        p.depth = depth;
        p.phase = rand(0, Math.PI * 2);
      }
    },

    scatterBurst(edge, kind, w, h) {
      const rect = panelPx(sim.panel, w, h);
      const count = kind === "collapse" ? 42 : 36;
      const strength = kind === "collapse" ? 1.15 : 1;

      for (let i = 0; i < count; i++) {
        const p = pool.acquire();
        if (!p) break;
        const t = (i + 0.5) / count;
        const pos = alongEdgePx(edge, rect, t, 6);
        const vel = burstVelocity(edge, strength);
        const depth = rand(0.35, 1);
        p.kind = "streak";
        p.x = pos.x;
        p.y = pos.y;
        p.vx = vel.vx + sim.wind * 0.4;
        p.vy = Math.max(180, Math.abs(vel.vy)) * (0.85 + depth * 0.4);
        if (edge === "bottom") p.vy = -Math.abs(p.vy) * 0.35 + rand(80, 200);
        p.maxLife = rand(0.45, 0.95);
        p.life = p.maxLife;
        p.len = rand(12, 28) * (0.7 + depth * 0.5);
        p.width = rand(0.9, 2.2);
        p.alpha = rand(0.35, 0.8);
        p.depth = depth;
        p.phase = rand(0, Math.PI * 2);
      }

      const splashes = kind === "collapse" ? 14 : 10;
      for (let i = 0; i < splashes; i++) {
        const p = pool.acquire();
        if (!p) break;
        const t = Math.random();
        const pos = alongEdgePx(edge, rect, t, 10);
        p.kind = "splash";
        p.x = pos.x + rand(-8, 8);
        p.y = pos.y + rand(-4, 8);
        p.vx = rand(-30, 30);
        p.vy = rand(-10, 40);
        p.maxLife = rand(0.25, 0.5);
        p.life = p.maxLife;
        p.len = rand(10, 18);
        p.width = p.len;
        p.alpha = rand(0.4, 0.75);
        p.depth = 1;
        p.phase = 0;
      }
    },

    step(dt, w, h, timeSec) {
      if (!sim.active) return;
      const target = densityTarget(getFxAppearance(), 110);
      const alive = pool.aliveCount();
      if (alive < target * 0.65) {
        sim.seedAmbientField(w, h, Math.min(18, target - alive));
      }

      pool.forEachAlive((p) => {
        p.life -= dt;
        if (p.life <= 0) {
          pool.release(p);
          return;
        }

        if (p.kind === "splash") {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= 0.92;
          p.vy += 40 * dt;
          return;
        }

        const gust = windX(timeSec, p.phase, 18 + p.depth * 12);
        p.x += (p.vx + gust) * dt;
        p.y += p.vy * dt;

        if (offscreen(p.x, p.y, w, h, 60)) {
          // recycle into top as continuous rain
          p.x = rand(-30, w + 30);
          p.y = rand(-50, -8);
          p.life = rand(0.8, 2.2);
          p.maxLife = p.life;
        }
      });
    },

    draw(ctx, _w, _h, _timeSec) {
      const streak = sprites.rainStreak;
      const splash = sprites.splash;
      const app = getFxAppearance();
      const nearGain = particleGain(app, 1);
      const farGain = particleGain(app, 0);

      // Far streaks first
      pool.forEachAlive((p) => {
        if (p.kind !== "streak" || p.depth >= 0.55) return;
        drawStreak(ctx, streak, p, p.depth > 0.55 ? nearGain : farGain, app.edgeBoost);
      });
      pool.forEachAlive((p) => {
        if (p.kind !== "streak" || p.depth < 0.55) return;
        drawStreak(ctx, streak, p, p.depth > 0.55 ? nearGain : farGain, app.edgeBoost);
      });
      pool.forEachAlive((p) => {
        if (p.kind !== "splash") return;
        const t = p.life / p.maxLife;
        const s = p.len * (1.1 - t * 0.4);
        const { mul, profile } = nearGain;
        ctx.save();
        ctx.globalAlpha = Math.min(1, p.alpha * t * mul);
        ctx.filter =
          profile.colorMode === "onLight"
            ? "brightness(0.55) contrast(1.2)"
            : "brightness(1.15)";
        ctx.translate(p.x, p.y);
        ctx.drawImage(splash, -s / 2, -s / 2, s, s);
        ctx.restore();
      });
    },
  };

  return sim;
}

function drawStreak(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement,
  p: RainSlot,
  gain: FxParticleGain,
  edgeBoost: boolean,
) {
  const t = Math.min(1, p.life / Math.max(0.001, p.maxLife));
  const fade = t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1;
  const speed = Math.hypot(p.vx, p.vy);
  const len = p.len * (0.7 + Math.min(1.4, speed / 500));
  const angle = Math.atan2(p.vy, p.vx + 0.001) - Math.PI / 2;
  const { mul, profile } = gain;
  const width =
    p.width *
    (edgeBoost && p.depth > 0.55 ? 1.25 : 1);

  ctx.save();
  ctx.globalAlpha = Math.min(1, p.alpha * fade * mul);
  ctx.filter =
    profile.colorMode === "onLight"
      ? "brightness(0.52) contrast(1.25) saturate(1.1)"
      : "brightness(1.2) contrast(1.05)";
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);
  ctx.drawImage(sprite, -width / 2, -len * 0.15, width, len);
  ctx.restore();
}
