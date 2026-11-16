import { expect, it } from "vitest";
import { getFxAppearance } from "./appearanceStore";
import { createFxRuntimeStore, type FxBridge, type FxSceneSync } from "./runtimeStore";
import type { FxAction, FxSnapshot } from "./types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function snapshot(changes: Partial<FxSnapshot> = {}): FxSnapshot {
  return {
    revision: 1, eventId: 0, generation: 1, theme: "leaf",
    appearance: { bg: "#ffffff", fg: "#111111", accent: "#ff8800", pop: "#8855ff", intensity: 1, edgeBoost: true },
    dock: { revision: 1, phase: "collapsed", edge: "left", presented: true },
    active: true, edge: "left", panel: { x: 20, y: 20, w: 60, h: 60 }, ...changes,
  };
}
function action(eventId: number, stateRevision: number, generation = 1, kind = "expand"): FxAction {
  return { eventId, stateRevision, generation, kind: "scatter",
    payload: { kind, edge: "left", panel: { x: 20, y: 20, w: 60, h: 60 } } };
}
async function fixture() {
  const initial = deferred<FxSnapshot>();
  const requested = deferred<void>();
  let receiveState!: (state: FxSnapshot) => void;
  let receiveAction!: (value: FxAction) => void;
  const bridge: FxBridge = {
    getSnapshot: () => { requested.resolve(); return initial.promise; },
    listenState: async (receive) => { receiveState = receive; return () => {}; },
    listenAction: async (receive) => { receiveAction = receive; return () => {}; },
  };
  const store = createFxRuntimeStore(bridge);
  store.setPolicy(true, true);
  const disconnect = store.connect();
  await requested.promise;
  return { store, initial, disconnect, state: (value: FxSnapshot) => receiveState(value),
    action: (value: FxAction) => receiveAction(value) };
}

it("does not roll back the live palette when an older bootstrap read completes", async () => {
  const f = await fixture();
  const latest = snapshot({ revision: 5, appearance: { ...snapshot().appearance, bg: "#000000" } });
  f.state(latest);
  f.initial.resolve(snapshot());
  await f.initial.promise;
  expect(f.store.getSnapshot()?.revision).toBe(5);
  expect(getFxAppearance().luminance).toBeLessThan(0.01);
  f.disconnect();
});

it("mounts from the current dock without replaying old actions and does not coalesce fresh bursts", async () => {
  const f = await fixture();
  f.initial.resolve(snapshot({ revision: 40, eventId: 10 }));
  await f.initial.promise;
  const bursts: string[] = [];
  const stop = f.store.subscribeScene({ onSync: () => {}, onScatter: (payload) => bursts.push(payload.kind) }, "leaf");
  f.action(action(10, 40));
  f.state(snapshot({ revision: 41, eventId: 11 }));
  f.action(action(11, 41));
  f.action(action(11, 41));
  f.state(snapshot({ revision: 42, eventId: 12 }));
  f.action(action(12, 42, 1, "collapse"));
  f.state(snapshot({ revision: 43, eventId: 13 }));
  f.action(action(13, 43));
  expect(bursts).toEqual(["expand", "collapse", "expand"]);
  stop(); f.disconnect();
});

it("waits for the matching pose before delivering an action and drops an old generation after resume", async () => {
  const f = await fixture();
  f.initial.resolve(snapshot());
  await f.initial.promise;
  const bursts: string[] = [];
  const stop = f.store.subscribeScene({ onSync: () => {}, onScatter: (payload) => bursts.push(payload.kind) }, "leaf");
  f.action(action(1, 2));
  expect(bursts).toEqual([]);
  f.state(snapshot({ revision: 2, eventId: 1 }));
  expect(bursts).toEqual(["expand"]);
  f.state(snapshot({ revision: 3, generation: 2, active: false,
    dock: { revision: 2, phase: "collapsed", edge: "left", presented: false } }));
  f.state(snapshot({ revision: 4, generation: 3 }));
  f.action(action(2, 2, 1, "collapse"));
  f.state(snapshot({ revision: 5, generation: 3, eventId: 3 }));
  f.action(action(3, 5, 3));
  expect(bursts).toEqual(["expand", "expand"]);
  stop(); f.disconnect();
});

it("deactivates the old renderer immediately on a theme switch without giving it new-theme actions", async () => {
  const f = await fixture();
  f.initial.resolve(snapshot());
  await f.initial.promise;
  let oldActive = false;
  const oldBursts: string[] = [];
  const stopOld = f.store.subscribeScene({ onSync: (state) => { oldActive = state.active; },
    onScatter: (payload) => oldBursts.push(payload.kind) }, "leaf");
  f.state(snapshot({ revision: 2, theme: "sakura", eventId: 1 }));
  f.action(action(1, 2));
  expect(oldActive).toBe(false);
  expect(oldBursts).toEqual([]);
  const freshBursts: string[] = [];
  const stopNew = f.store.subscribeScene({ onSync: () => {}, onScatter: (payload) => freshBursts.push(payload.kind) }, "sakura");
  f.action(action(1, 2));
  f.state(snapshot({ revision: 3, theme: "sakura", eventId: 2 }));
  f.action(action(2, 3));
  expect(freshBursts).toEqual(["expand"]);
  stopOld(); stopNew(); f.disconnect();
});

it("does not replay a suppressed burst when document or media policy is restored", async () => {
  const f = await fixture();
  f.initial.resolve(snapshot());
  await f.initial.promise;
  const bursts: string[] = [];
  const stop = f.store.subscribeScene({ onSync: () => {}, onScatter: (payload) => bursts.push(payload.kind) }, "leaf");
  f.store.setPolicy(false, true);
  f.state(snapshot({ revision: 2, eventId: 1 }));
  f.action(action(1, 2));
  f.store.setPolicy(true, false);
  f.state(snapshot({ revision: 3, eventId: 2 }));
  f.action(action(2, 3));
  f.store.setPolicy(true, true);
  expect(bursts).toEqual([]);
  f.state(snapshot({ revision: 4, eventId: 3 }));
  f.action(action(3, 4));
  expect(bursts).toEqual(["expand"]);
  stop(); f.disconnect();
});

for (const theme of ["leaf", "sakura", "vine", "icicle", "ink", "rain", "snow", "firefly"]) {
  it(`${theme} preserves only suitable static fringe under media restriction and never replays suppressed motion`, async () => {
    const f = await fixture();
    f.initial.resolve(snapshot({ theme }));
    await f.initial.promise;
    let pose: FxSceneSync | undefined;
    const bursts: string[] = [];
    const stop = f.store.subscribeScene({
      onSync: (state) => { pose = state; },
      onScatter: (payload) => bursts.push(payload.kind),
    }, theme);
    f.store.setPolicy(false, true);
    const hasFringe = ["leaf", "sakura", "vine", "icicle", "ink"].includes(theme);
    expect(pose?.active).toBe(false);
    expect(pose?.staticOnly).toBe(hasFringe);
    expect(pose?.panel).toEqual(hasFringe ? { x: 20, y: 20, w: 60, h: 60 } : null);
    f.state(snapshot({ theme, revision: 2, eventId: 1 }));
    f.action(action(1, 2));
    f.store.setPolicy(false, false);
    expect(pose?.staticOnly).toBe(false);
    expect(pose?.panel).toBeNull();
    f.store.setPolicy(true, true);
    expect(pose?.active).toBe(true);
    expect(bursts).toEqual([]);
    f.state(snapshot({ theme, revision: 3, eventId: 2 }));
    f.action(action(2, 3));
    expect(bursts).toEqual(["expand"]);
    stop(); f.disconnect();
  });
}

it("releases a late listener and cannot rehydrate a disconnected host", async () => {
  const registration = deferred<() => void>();
  const listeners = new Set<(value: FxSnapshot) => void>();
  let receiveState!: (value: FxSnapshot) => void;
  const store = createFxRuntimeStore({
    getSnapshot: async () => snapshot(),
    listenState: (receive) => { receiveState = receive; listeners.add(receive); return registration.promise; },
    listenAction: async () => () => {},
  });
  const disconnect = store.connect();
  disconnect();
  receiveState(snapshot({ revision: 99 }));
  registration.resolve(() => { listeners.delete(receiveState); });
  await registration.promise;
  expect(listeners.size).toBe(0);
  expect(store.getSnapshot()).toBeNull();
});
