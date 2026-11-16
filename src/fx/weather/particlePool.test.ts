import { describe, expect, it, vi } from "vitest";
import { createPool } from "./particlePool";
import { createRainSim } from "../theme/rain/rainSim";
import { createSnowSim } from "../theme/snow/snowSim";
import { createFireflySim } from "../theme/firefly/fireflySim";
import { createInkBleedSim } from "../theme/ink/inkBleedSim";
import { createIceAccentSim } from "../theme/icicle/iceAccentSim";

// These tests exercise simulation lifetime, not sprite drawing.
vi.mock("./sprites", () => ({ getWeatherSprites: () => ({}) }));

it("reuses stable slots at capacity and ignores double/foreign release", () => {
  const pool = createPool<{ alive: boolean; value: number }>(3, () => ({ alive: false, value: 0 }));
  const slots = [pool.acquire()!, pool.acquire()!, pool.acquire()!];
  expect(new Set(slots).size).toBe(3);
  expect(pool.aliveCount()).toBe(3);
  expect(pool.acquire()).toBeNull();
  pool.release(slots[1]!);
  pool.release(slots[1]!);
  pool.release({ alive: true, value: 0 });
  expect(pool.aliveCount()).toBe(2);
  expect(pool.acquire()).toBe(slots[1]);
  expect(pool.acquire()).toBeNull();
  pool.clear();
  pool.clear();
  expect(pool.aliveCount()).toBe(0);
  expect(pool.items).toEqual(slots);
  const reused = [pool.acquire(), pool.acquire(), pool.acquire()];
  expect(new Set(reused).size).toBe(3);
  expect(reused.every((slot) => slots.includes(slot!))).toBe(true);
  expect(pool.aliveCount()).toBe(3);
});

it("supports releasing the current slot while visiting live particles", () => {
  const pool = createPool(4, () => ({ alive: false }));
  for (let i = 0; i < pool.capacity; i++) pool.acquire();
  const visited: number[] = [];
  pool.forEachAlive((slot, index) => {
    visited.push(index);
    pool.release(slot);
  });
  expect(visited).toEqual([0, 1, 2, 3]);
  expect(pool.aliveCount()).toBe(0);
  expect(pool.acquire()).not.toBeNull();
});

const simulations = [
  ["rain", createRainSim], ["snow", createSnowSim], ["firefly", createFireflySim],
  ["ink", createInkBleedSim], ["icicle", createIceAccentSim],
] as const;

for (const [name, createSim] of simulations) {
  describe(name, () => {
    it("starts inactive and returns every expired slot to the pool", () => {
      const sim = createSim();
      expect(sim.active).toBe(false);
      sim.step(0.05, 320, 500, 0);
      expect(sim.pool.aliveCount()).toBe(0);
      for (let i = 0; i < sim.pool.capacity; i++) {
        const slot = sim.pool.acquire()!;
        slot.life = 0.001;
      }
      sim.active = true;
      sim.step(0.05, 320, 500, 0);
      expect(sim.pool.aliveCount()).toBe(0);
      for (let i = 0; i < sim.pool.capacity; i++) expect(sim.pool.acquire()).not.toBeNull();
      expect(sim.pool.acquire()).toBeNull();
      sim.clear();
      expect(sim.pool.aliveCount()).toBe(0);
    });
  });
}

for (const [name, createSim] of [["ink", createInkBleedSim], ["icicle", createIceAccentSim]] as const) {
  it(`${name} releases offscreen particles before their lifetime expires`, () => {
    const sim = createSim();
    sim.active = true;
    for (let i = 0; i < sim.pool.capacity; i++) {
      const slot = sim.pool.acquire()!;
      slot.life = 10;
      slot.x = -1000;
      slot.y = 10;
      slot.vx = 0;
      slot.vy = 0;
      if ("kind" in slot) slot.kind = i % 2 ? "chip" : "drip";
    }
    sim.step(0.01, 320, 500);
    expect(sim.pool.aliveCount()).toBe(0);
    for (let i = 0; i < sim.pool.capacity; i++) expect(sim.pool.acquire()).not.toBeNull();
  });
}

it("preserves weather burst amounts and allows another complete burst after clear", () => {
  for (const [createSim, expandCount, collapseCount] of [
    [createRainSim, 46, 56], [createSnowSim, 28, 34], [createFireflySim, 22, 28],
  ] as const) {
    const sim = createSim();
    sim.active = true;
    sim.scatterBurst("right", "expand", 320, 500);
    expect(sim.pool.aliveCount()).toBe(expandCount);
    sim.clear();
    sim.scatterBurst("right", "collapse", 320, 500);
    expect(sim.pool.aliveCount()).toBe(collapseCount);
  }
  const ink = createInkBleedSim();
  ink.scatter("right", "expand", 320, 500);
  expect(ink.pool.aliveCount()).toBe(16);
  ink.clear();
  ink.scatter("right", "collapse", 320, 500);
  expect(ink.pool.aliveCount()).toBe(22);
  const ice = createIceAccentSim();
  ice.scatterChips("right", "expand", 320, 500);
  expect(ice.pool.aliveCount()).toBe(22);
  ice.clear();
  ice.scatterChips("right", "collapse", 320, 500);
  expect(ice.pool.aliveCount()).toBe(28);
  ice.clear();
  ice.spawnDrips(2);
  expect(ice.pool.aliveCount()).toBe(0);
  ice.fringeTips = [{ x: 10, y: 20 }];
  ice.spawnDrips(2);
  expect(ice.pool.aliveCount()).toBe(2);
});
