import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WeatherCanvas } from "./WeatherCanvas";
import type { WeatherCanvasController } from "./frameLoop";

const reactEnvironment: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let notifyResize: () => void;
let notifyResolution: () => void;
let pending: Map<number, FrameRequestCallback>;
let id: number;
const clearRect = vi.fn();
const onFrame = vi.fn();
const controller = { current: null as WeatherCanvasController | null };

beforeEach(() => {
  pending = new Map();
  id = 0;
  clearRect.mockClear();
  onFrame.mockClear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { pending.set(++id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => pending.delete(key));
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { notifyResize = callback; }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    addEventListener: (_: string, callback: () => void) => { notifyResolution = callback; },
    removeEventListener: vi.fn(),
  })));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect, setTransform: vi.fn(), save: vi.fn(), restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("innerWidth", 320);
  vi.stubGlobal("innerHeight", 500);
  vi.stubGlobal("devicePixelRatio", 1);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function frame() {
  await act(async () => {
    const [key, callback] = pending.entries().next().value!;
    pending.delete(key);
    callback(performance.now());
  });
}

it("does not animate before sync, keeps one RAF, and clears on stop/unmount", async () => {
  await act(async () => root.render(<WeatherCanvas controllerRef={controller} onFrame={onFrame} />));
  expect(pending.size).toBe(0);
  await act(async () => root.render(<WeatherCanvas running controllerRef={controller} onFrame={onFrame} />));
  controller.current!.wake();
  controller.current!.wake();
  expect(pending.size).toBe(1);
  await frame();
  expect(onFrame).toHaveBeenCalledTimes(1);
  expect(pending.size).toBe(1);
  const clears = clearRect.mock.calls.length;
  await act(async () => root.render(<WeatherCanvas running={false} controllerRef={controller} onFrame={onFrame} />));
  expect(pending.size).toBe(0);
  expect(clearRect.mock.calls.length).toBeGreaterThan(clears);
});

it("coalesces unchanged resize and follows DPR-only changes without resetting unchanged bitmaps", async () => {
  const width = vi.spyOn(HTMLCanvasElement.prototype, "width", "set");
  const height = vi.spyOn(HTMLCanvasElement.prototype, "height", "set");
  await act(async () => root.render(<WeatherCanvas running controllerRef={controller} onFrame={onFrame} />));
  const canvas = container.querySelector("canvas")!;
  expect(canvas.width).toBe(320);
  expect(canvas.height).toBe(500);
  width.mockClear();
  height.mockClear();
  notifyResize();
  notifyResize();
  expect(pending.size).toBe(1);
  await frame();
  expect(width).not.toHaveBeenCalled();
  expect(height).not.toHaveBeenCalled();
  vi.stubGlobal("devicePixelRatio", 2);
  notifyResolution();
  notifyResize();
  await frame();
  expect(canvas.width).toBe(560);
  expect(canvas.height).toBe(875);
  expect(width).toHaveBeenCalledTimes(1);
  expect(height).toHaveBeenCalledTimes(1);
  width.mockClear();
  height.mockClear();
  vi.stubGlobal("devicePixelRatio", 3);
  notifyResolution();
  await frame();
  expect(width).not.toHaveBeenCalled();
  expect(height).not.toHaveBeenCalled();
});

it("sleeps an empty transient canvas and wakes only for real new work", async () => {
  let work = false;
  await act(async () => root.render(<WeatherCanvas running controllerRef={controller} hasWork={() => work} onFrame={onFrame} />));
  controller.current!.wake();
  expect(pending.size).toBe(0);
  work = true;
  controller.current!.wake();
  expect(pending.size).toBe(1);
  onFrame.mockImplementationOnce(() => { work = false; });
  await frame();
  expect(pending.size).toBe(0);
  work = true;
  controller.current!.wake();
  expect(pending.size).toBe(1);
  await act(async () => root.unmount());
  expect(pending.size).toBe(0);
  expect(controller.current).toBeNull();
  // Keep afterEach responsible for one mounted root.
  root = createRoot(container);
});
