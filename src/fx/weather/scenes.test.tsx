import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DockSnapshot, FxAmbientPayload, FxScatterPayload } from "../types";
import type { FxSceneSync } from "../runtimeStore";
import { RainTheme } from "../theme/rain/RainTheme";
import { SnowTheme } from "../theme/snow/SnowTheme";
import { FireflyTheme } from "../theme/firefly/FireflyTheme";
import { InkTheme } from "../theme/ink/InkTheme";
import { IcicleTheme } from "../theme/icicle/IcicleTheme";

interface SceneHandlers {
  onSync: (payload: FxSceneSync) => void;
  onDock?: (payload: DockSnapshot) => void;
  onScatter?: (payload: FxScatterPayload) => void;
  onAmbient?: (payload: FxAmbientPayload) => void;
}
const scene = vi.hoisted(() => ({ current: null as SceneHandlers | null }));
vi.mock("../runtime", () => ({ useFxScene: (handlers: SceneHandlers) => { scene.current = handlers; } }));
vi.mock("./sprites", () => ({ getWeatherSprites: () => ({}) }));
const reactEnvironment: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
let pending: Map<number, FrameRequestCallback>;
let nextId: number;
const panel = { x: 20, y: 20, w: 60, h: 60 };

beforeEach(() => {
  vi.useFakeTimers();
  pending = new Map();
  nextId = 0;
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { pending.set(++nextId, callback); return nextId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => pending.delete(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(), setTransform: vi.fn(), save: vi.fn(), restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  expect(pending.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

for (const Theme of [RainTheme, SnowTheme, FireflyTheme, InkTheme, IcicleTheme]) {
  it(`${Theme.name} waits for authoritative activity and clears all work when inactive`, async () => {
    await act(async () => root.render(<Theme />));
    expect(pending.size).toBe(0);
    await act(async () => scene.current!.onSync({ active: true, staticOnly: false, phase: "expanded", edge: "right", panel }));
    if (Theme === InkTheme || Theme === IcicleTheme) expect(pending.size).toBe(0);
    else expect(pending.size).toBe(1);
    await act(async () => scene.current!.onScatter?.({ kind: "expand", edge: "right", panel }));
    expect(pending.size).toBe(1);
    await act(async () => {
      scene.current!.onSync({ active: false, staticOnly: false, phase: "free", edge: null, panel });
      scene.current!.onDock?.({ revision: 2, presented: false, phase: "expanded", edge: "right" });
    });
    expect(pending.size).toBe(0);
    await act(async () => {
      scene.current!.onScatter?.({ kind: "collapse", edge: "right", panel });
      scene.current!.onAmbient?.({ edge: "right", phase: "expanded" });
      vi.advanceTimersByTime(1000);
    });
    expect(pending.size).toBe(0);
  });
}

for (const [Theme, selector, initialCount] of [
  [InkTheme, ".ink-fringe", 9], [IcicleTheme, ".icicle-fringe", 10],
] as const) {
  it(`${Theme.name} cancels delayed fringe and restores current dock without replaying old transitions`, async () => {
    await act(async () => root.render(<Theme />));
    await act(async () => {
      scene.current!.onSync({ active: true, staticOnly: false, phase: "expanded", edge: "right", panel });
      scene.current!.onDock!({ revision: 1, phase: "expanded", edge: "right", presented: true });
    });
    expect(container.querySelectorAll(selector)).toHaveLength(initialCount);
    await act(async () => scene.current!.onDock!({ revision: 2, phase: "collapsed", edge: "right", presented: true }));
    expect(container.querySelectorAll(selector)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => {
      scene.current!.onSync({ active: false, staticOnly: false, phase: "free", edge: "right", panel });
      scene.current!.onDock!({ revision: 3, phase: "collapsed", edge: "right", presented: false });
      vi.advanceTimersByTime(1000);
    });
    expect(container.querySelectorAll(selector)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      scene.current!.onSync({ active: true, staticOnly: false, phase: "expanded", edge: "right", panel });
      scene.current!.onDock!({ revision: 4, phase: "expanded", edge: "right", presented: true });
    });
    expect(container.querySelectorAll(selector)).toHaveLength(initialCount);
    expect(pending.size).toBe(0);
  });

  it(`${Theme.name} keeps static fringe while clearing Canvas and rejecting new motion`, async () => {
    await act(async () => root.render(<Theme />));
    await act(async () => {
      scene.current!.onSync({ active: false, staticOnly: true, phase: "expanded", edge: "right", panel });
      scene.current!.onDock!({ revision: 1, phase: "expanded", edge: "right", presented: true });
    });
    expect(container.querySelectorAll(selector)).toHaveLength(initialCount);
    const first = container.querySelector(selector);
    await act(async () => {
      scene.current!.onScatter!({ kind: "expand", edge: "right", panel });
      scene.current!.onAmbient!({ edge: "right", phase: "expanded" });
      scene.current!.onSync({ active: false, staticOnly: true, phase: "expanded", edge: "right", panel: { ...panel } });
      scene.current!.onDock!({ revision: 2, phase: "expanded", edge: "right", presented: true });
    });
    expect(container.querySelector(selector)).toBe(first);
    expect(pending.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      scene.current!.onSync({ active: false, staticOnly: false, phase: "free", edge: null, panel: null });
      scene.current!.onDock!({ revision: 3, phase: "free", edge: null, presented: false });
    });
    expect(container.querySelectorAll(selector)).toHaveLength(0);
  });
}

for (const Theme of [RainTheme, SnowTheme, FireflyTheme]) {
  it(`${Theme.name} resumes when hide/show are batched before React commits`, async () => {
    await act(async () => root.render(<Theme />));
    await act(async () => scene.current!.onSync({ active: true, staticOnly: false, phase: "expanded", edge: "right", panel }));
    expect(pending.size).toBe(1);
    await act(async () => {
      scene.current!.onSync({ active: false, staticOnly: false, phase: "free", edge: "right", panel });
      scene.current!.onSync({ active: true, staticOnly: false, phase: "expanded", edge: "right", panel });
    });
    expect(pending.size).toBe(1);
  });
}

for (const Theme of [InkTheme, IcicleTheme]) {
  it(`${Theme.name} owns and cancels its delayed fringe on unmount`, async () => {
    await act(async () => root.render(<Theme />));
    await act(async () => {
      scene.current!.onSync({ active: true, staticOnly: false, phase: "collapsed", edge: "right", panel });
      scene.current!.onDock!({ revision: 1, phase: "collapsed", edge: "right", presented: true });
    });
    expect(vi.getTimerCount()).toBe(1);
    // afterEach unmounts and asserts that no timer or animation survives.
  });
}
