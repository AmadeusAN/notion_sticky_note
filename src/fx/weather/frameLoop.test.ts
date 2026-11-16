import { expect, it, vi } from "vitest";
import { createWeatherFrameLoop } from "./frameLoop";

function fixture() {
  let enabled = false;
  let work = false;
  let now = 0;
  let nextId = 0;
  const pending = new Map<number, FrameRequestCallback>();
  const onFrame = vi.fn();
  const clear = vi.fn();
  const loop = createWeatherFrameLoop({
    enabled: () => enabled,
    hasWork: () => work,
    onFrame,
    clear,
    request: (callback) => { pending.set(++nextId, callback); return nextId; },
    cancel: (id) => { pending.delete(id); },
    now: () => now,
  });
  return {
    loop, pending, onFrame, clear,
    enable(value: boolean) { enabled = value; },
    work(value: boolean) { work = value; },
    advance(milliseconds: number) { now += milliseconds; },
    frame() {
      const [id, callback] = pending.entries().next().value!;
      pending.delete(id);
      callback(now);
    },
  };
}

it("starts inactive, sleeps empty, and coalesces wake into one frame", () => {
  const f = fixture();
  f.loop.wake();
  expect(f.pending.size).toBe(0);
  f.enable(true);
  f.loop.wake();
  expect(f.pending.size).toBe(0);
  f.work(true);
  f.loop.wake();
  f.loop.wake();
  f.loop.wake();
  expect(f.pending.size).toBe(1);
  f.advance(16);
  f.frame();
  expect(f.pending.size).toBe(1);
  expect(f.onFrame.mock.calls[0]![0]).toBeCloseTo(0.016);
  f.work(false);
  f.advance(16);
  f.frame();
  expect(f.pending.size).toBe(0);
});

it("clears immediately, cancels pending work, and never catches up hidden time", () => {
  const f = fixture();
  f.enable(true);
  f.work(true);
  f.loop.wake();
  f.advance(5000);
  f.frame();
  expect(f.onFrame.mock.calls[0]![0]).toBe(0.05);
  f.loop.stopAndClear();
  f.enable(false);
  expect(f.clear).toHaveBeenCalledTimes(1);
  expect(f.pending.size).toBe(0);
  f.advance(60000);
  f.enable(true);
  f.loop.wake();
  f.advance(10);
  f.frame();
  expect(f.onFrame.mock.calls[1]![0]).toBeCloseTo(0.01);
  expect(f.onFrame.mock.calls[1]![1]).toBeCloseTo(0.06);
});

it("allows particles spawned after exhaustion to wake the same loop", () => {
  const f = fixture();
  f.enable(true);
  f.work(true);
  f.onFrame.mockImplementationOnce(() => f.work(false));
  f.loop.wake();
  f.advance(16);
  f.frame();
  expect(f.pending.size).toBe(0);
  f.advance(60000);
  f.work(true);
  f.loop.wake();
  f.advance(16);
  f.frame();
  expect(f.onFrame.mock.calls[1]![0]).toBeCloseTo(0.016);
  expect(f.pending.size).toBe(1);
});
