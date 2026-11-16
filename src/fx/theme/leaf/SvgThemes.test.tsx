import { act, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeafTheme } from "./LeafTheme";
import { SakuraTheme } from "../sakura/SakuraTheme";
import { VineTheme } from "../vine/VineTheme";
import { useExpiringParticles } from "../../useExpiringParticles";
import type {
  DockSnapshot,
  FxAmbientPayload,
  FxScatterPayload,
} from "../../types";
import type { FxSceneSync } from "../../runtimeStore";

interface SceneHandlers {
  onSync: (payload: FxSceneSync) => void;
  onDock?: (payload: DockSnapshot) => void;
  onScatter?: (payload: FxScatterPayload) => void;
  onAmbient?: (payload: FxAmbientPayload) => void;
}

// An isolated semantic-event driver; particle generators and DOM stay real.
const scene = vi.hoisted(() => ({ current: null as SceneHandlers | null }));
vi.mock("../../runtime", () => ({
  useFxScene(handlers: SceneHandlers) {
    const latest = useRef(handlers);
    latest.current = handlers;
    useEffect(() => {
      const bridge: SceneHandlers = {
        onSync: (payload) => latest.current.onSync(payload),
        onDock: (payload) => latest.current.onDock?.(payload),
        onScatter: (payload) => latest.current.onScatter?.(payload),
        onAmbient: (payload) => latest.current.onAmbient?.(payload),
      };
      scene.current = bridge;
      return () => { scene.current = null; };
    }, []);
  },
}));

const reactEnvironment: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
const panel = { x: 20, y: 20, w: 60, h: 60 };
let container: HTMLDivElement;
let root: Root;
let mounted: boolean;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mounted = true;
});

afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function sync(active: boolean) {
  scene.current!.onSync({ active, staticOnly: false, phase: "free", edge: "right", panel });
}

function dock(phase: DockSnapshot["phase"], presented = true) {
  scene.current!.onDock!({ revision: 1, phase, edge: "right", presented });
}

const themes = [
  { name: "leaf", Theme: LeafTheme },
  { name: "sakura", Theme: SakuraTheme },
  { name: "vine", Theme: VineTheme },
];

describe.each(themes)("$name SVG lifecycle", ({ name, Theme }) => {
  const particleSelector = `.${name}-particle`;
  const fringeSelector = `.${name}-fringe`;

  it("waits for authority, initializes the current dock and expires a whole real burst with one timer", async () => {
    await act(async () => root.render(<Theme />));
    await act(async () => {
      dock("expanded");
      scene.current!.onScatter!({ kind: "expand", edge: "right", panel });
      scene.current!.onAmbient!({ edge: "right", phase: "expanded" });
    });
    expect(container.querySelectorAll(particleSelector)).toHaveLength(0);
    expect(container.querySelectorAll(fringeSelector)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => { sync(true); dock("expanded"); });
    expect(container.querySelectorAll(fringeSelector)).toHaveLength(10);
    expect(container.querySelectorAll(particleSelector)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => scene.current!.onScatter!({ kind: "expand", edge: "right", panel }));
    const burst = Array.from(container.querySelectorAll<HTMLElement>(particleSelector));
    expect(burst).toHaveLength(24);
    expect(vi.getTimerCount()).toBe(1);
    const lastExpiry = Math.max(...burst.map((node) => parseFloat(node.style.getPropertyValue("--dur")) + 80));
    await act(async () => vi.advanceTimersByTime(Math.ceil(lastExpiry)));
    expect(container.querySelectorAll(particleSelector)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves delayed strip/screen counts and collapse burst size", async () => {
    await act(async () => root.render(<Theme />));
    await act(async () => { sync(true); dock("collapsed"); });
    expect(container.querySelectorAll(fringeSelector)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => vi.advanceTimersByTime(339));
    expect(container.querySelectorAll(fringeSelector)).toHaveLength(0);
    await act(async () => vi.advanceTimersByTime(1));
    expect(container.querySelectorAll(fringeSelector)).toHaveLength(12);

    await act(async () => dock("expanded"));
    expect(container.querySelectorAll(fringeSelector)).toHaveLength(0);
    await act(async () => vi.advanceTimersByTime(340));
    expect(container.querySelectorAll(fringeSelector)).toHaveLength(13);

    await act(async () => {
      dock("collapsed");
      scene.current!.onScatter!({ kind: "collapse", edge: "right", panel });
    });
    expect(container.querySelectorAll(particleSelector)).toHaveLength(24);
    expect(vi.getTimerCount()).toBe(2); // One fringe delay plus one shared expiry.
    await act(async () => vi.advanceTimersByTime(340));
    expect(container.querySelectorAll(fringeSelector)).toHaveLength(12);
  });

  it("clears on inactivity, rejects cancelled fringe callbacks after resume and leaves no unmount work", async () => {
    const timeouts = vi.spyOn(window, "setTimeout");
    await act(async () => root.render(<Theme />));
    await act(async () => { sync(true); dock("collapsed"); });
    await act(async () => vi.advanceTimersByTime(340));
    await act(async () => {
      dock("expanded");
      scene.current!.onScatter!({ kind: "expand", edge: "right", panel });
    });
    const delayedFringe = timeouts.mock.calls.filter(([, delay]) => delay === 340).at(-1)![0] as () => void;
    const lateActions = scene.current!;
    await act(async () => { sync(false); dock("expanded", false); });
    expect(container.querySelectorAll(particleSelector)).toHaveLength(0);
    expect(container.querySelectorAll(fringeSelector)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      lateActions.onScatter!({ kind: "collapse", edge: "right", panel });
      lateActions.onAmbient!({ edge: "right", phase: "collapsed" });
      delayedFringe();
      vi.advanceTimersByTime(10_000);
    });
    expect(container.querySelectorAll(particleSelector)).toHaveLength(0);
    expect(container.querySelectorAll(fringeSelector)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => { sync(true); dock("expanded"); delayedFringe(); });
    expect(container.querySelectorAll(fringeSelector)).toHaveLength(10);
    expect(container.querySelectorAll(particleSelector)).toHaveLength(0);
    await act(async () => scene.current!.onAmbient!({ edge: "right", phase: "expanded" }));
    expect(container.querySelectorAll(particleSelector)).toHaveLength(1);
    await act(async () => dock("collapsed"));
    expect(vi.getTimerCount()).toBe(2);
    const unmountFringe = timeouts.mock.calls.filter(([, delay]) => delay === 340).at(-1)![0] as () => void;
    await act(async () => root.unmount());
    mounted = false;
    await act(async () => {
      unmountFringe();
      lateActions.onScatter!({ kind: "expand", edge: "right", panel });
      lateActions.onAmbient!({ edge: "right", phase: "expanded" });
      vi.advanceTimersByTime(10_000);
    });
    expect(container.childElementCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a stable static fringe without particles or delayed work under restricted media", async () => {
    await act(async () => root.render(<Theme />));
    await act(async () => {
      scene.current!.onSync({ active: false, staticOnly: true, phase: "expanded", edge: "right", panel });
      dock("expanded");
    });
    const first = container.querySelector(fringeSelector);
    expect(first).not.toBeNull();
    await act(async () => {
      scene.current!.onScatter!({ kind: "expand", edge: "right", panel });
      scene.current!.onAmbient!({ edge: "right", phase: "expanded" });
      scene.current!.onSync({ active: false, staticOnly: true, phase: "expanded", edge: "right", panel: { ...panel } });
      dock("expanded");
    });
    expect(container.querySelector(fringeSelector)).toBe(first);
    expect(container.querySelectorAll(particleSelector)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { sync(false); dock("expanded", false); });
    expect(container.querySelectorAll(fringeSelector)).toHaveLength(0);
  });
});

interface FixtureParticle { id: string; durationMs: number }
interface ParticleControls { spawn: (batch: FixtureParticle[]) => void; clear: () => void }
let controls: ParticleControls;
function ParticleProbe() {
  const { particles, spawn, clear } = useExpiringParticles<FixtureParticle>();
  useEffect(() => { controls = { spawn, clear }; }, [spawn, clear]);
  return <>{particles.map((particle) => <span key={particle.id}>{particle.id}</span>)}</>;
}

it("expires particles at duration plus 80ms, rearms the nearest deadline and ignores stale expiry callbacks", async () => {
  const timeouts = vi.spyOn(window, "setTimeout");
  await act(async () => root.render(<ParticleProbe />));
  await act(async () => controls.spawn([{ id: "short", durationMs: 100 }, { id: "long", durationMs: 400 }]));
  expect(container.textContent).toBe("shortlong");
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => vi.advanceTimersByTime(100));
  await act(async () => controls.spawn([{ id: "middle", durationMs: 100 }]));
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => vi.advanceTimersByTime(79));
  expect(container.textContent).toBe("shortlongmiddle");
  await act(async () => vi.advanceTimersByTime(1));
  expect(container.textContent).toBe("longmiddle");
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => vi.advanceTimersByTime(100));
  expect(container.textContent).toBe("long");
  expect(vi.getTimerCount()).toBe(1);

  const staleExpiry = timeouts.mock.calls.at(-1)![0] as () => void;
  await act(async () => controls.clear());
  expect(container.textContent).toBe("");
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => controls.spawn([{ id: "new", durationMs: 500 }]));
  await act(async () => { staleExpiry(); vi.advanceTimersByTime(200); });
  expect(container.textContent).toBe("new");
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => vi.advanceTimersByTime(380));
  expect(container.textContent).toBe("");
  expect(vi.getTimerCount()).toBe(0);
});
