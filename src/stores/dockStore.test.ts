import { beforeEach, expect, it, vi } from "vitest";
import type { DockSnapshot } from "../fx/types";

vi.mock("../services/tauriApi", () => ({ apiGetEdgeDock: vi.fn(), apiListenEdgeDock: vi.fn() }));
import { apiGetEdgeDock, apiListenEdgeDock } from "../services/tauriApi";
import { createDockStore } from "./dockStore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const free: DockSnapshot = { revision: 1, phase: "free", edge: null, presented: true };
const collapsed: DockSnapshot = { revision: 3, phase: "collapsed", edge: "left", presented: true };
let listeners: Set<(state: DockSnapshot) => void>;
function emit(snapshot: DockSnapshot) { listeners.forEach((receive) => receive(snapshot)); }

beforeEach(() => {
  vi.resetAllMocks();
  listeners = new Set();
  vi.mocked(apiListenEdgeDock).mockImplementation(async (receive) => {
    listeners.add(receive);
    return () => { listeners.delete(receive); };
  });
});

it("keeps a live collapse event when an older initial read completes later", async () => {
  const initial = deferred<DockSnapshot>();
  vi.mocked(apiGetEdgeDock).mockReturnValue(initial.promise);
  const store = createDockStore();
  const disconnect = store.getState().connectDock();
  await Promise.resolve();
  emit(collapsed);
  initial.resolve(free);
  await initial.promise;
  expect(store.getState().snapshot).toEqual(collapsed);
  disconnect();
});

it("releases a listener that finishes registering after the owner unmounts", async () => {
  const registration = deferred<() => void>();
  vi.mocked(apiListenEdgeDock).mockImplementation((receive) => {
    listeners.add(receive);
    return registration.promise;
  });
  const store = createDockStore();
  const disconnect = store.getState().connectDock();
  disconnect();
  emit(collapsed);
  expect(store.getState().snapshot.presented).toBe(false);
  registration.resolve(() => { listeners.clear(); });
  await registration.promise;
  expect(listeners.size).toBe(0);
});

it("ignores an abandoned connection without disconnecting its replacement", async () => {
  const abandoned = deferred<DockSnapshot>();
  const current = deferred<DockSnapshot>();
  vi.mocked(apiGetEdgeDock).mockReturnValueOnce(abandoned.promise).mockReturnValueOnce(current.promise);
  const store = createDockStore();
  const disconnectOld = store.getState().connectDock();
  await Promise.resolve();
  const disconnectNew = store.getState().connectDock();
  disconnectOld();
  await Promise.resolve();
  const expanded: DockSnapshot = { revision: 7, phase: "expanded", edge: "right", presented: true };
  emit(expanded);
  abandoned.resolve({ ...collapsed, revision: 99 });
  current.resolve({ ...free, revision: 6 });
  await Promise.all([abandoned.promise, current.promise]);
  expect(store.getState().snapshot).toEqual(expanded);
  expect(listeners.size).toBe(1);
  disconnectNew();
  expect(listeners.size).toBe(0);
});

it("does not revive presentation from an old event after suspension", async () => {
  vi.mocked(apiGetEdgeDock).mockResolvedValue(collapsed);
  const store = createDockStore();
  const disconnect = store.getState().connectDock();
  await Promise.resolve();
  await Promise.resolve();
  const suspended = { ...collapsed, revision: 4, presented: false };
  emit(suspended);
  emit(collapsed);
  expect(store.getState().snapshot).toEqual(suspended);
  disconnect();
});
