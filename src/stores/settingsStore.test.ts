import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as TauriApi from "../services/tauriApi";
import type * as Fonts from "../fonts";
import type { AppearanceSaveState, ExitSaveState, SettingsSnapshot } from "../types";
import { themes } from "../themes";

vi.mock("../services/tauriApi", async (importOriginal) => ({
  ...(await importOriginal<typeof TauriApi>()),
  apiGetSettings: vi.fn(), apiUpdateAppearance: vi.fn(),
  apiListenAppearanceSaveState: vi.fn(), apiListenExitSaveState: vi.fn(),
  apiGetExitState: vi.fn(), apiRequestExit: vi.fn(),
}));
vi.mock("../fonts", async (importOriginal) => ({
  ...(await importOriginal<typeof Fonts>()), ensureFontLoaded: vi.fn(),
}));

import * as api from "../services/tauriApi";
import { createSettingsStore, type SettingsStore } from "./settingsStore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const snapshot = (revision = 4): SettingsSnapshot => ({
  settings: {
    theme: "paper", lightTheme: "paper", darkTheme: "dark", font: "hand",
    fxTheme: "leaf", fxIntensity: 1, fxEdgeBoost: true, dockHandle: "grip",
    noteBg: themes.paper.background, noteFg: themes.paper.foreground,
    noteAccent: themes.paper.accent, notePop: themes.paper.pop,
    notion: { token: "fixture", databaseId: "fixture", doneProperty: "done?", titleProperty: "Name",
      dateProperty: "Date", statusProperty: "Status", statusDoneValue: "Done", statusTodoValue: "Not started" },
  },
  appearanceSaveState: { revision, status: "saved", error: null },
});

let appearanceEvent: (state: AppearanceSaveState) => void;
let store: SettingsStore;
let exitEvent: (state: ExitSaveState) => void;
let frames: Map<number, FrameRequestCallback>;
let mediaListeners: Set<(event: MediaQueryListEvent) => void>;
let dark: boolean;
let disconnect: (() => void) | undefined;
let stopMedia: (() => void) | undefined;

// Drain only promise jobs, never native debounce time or animation frames.
async function settle() {
  for (let i = 0; i < 16; i++) await Promise.resolve();
}

async function connect() {
  disconnect = store.getState().connectSettings();
  await settle();
  expect(store.getState().hydrated).toBe(true);
}

beforeEach(() => {
  vi.resetAllMocks();
  frames = new Map();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)));
  dark = false;
  mediaListeners = new Set();
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    get matches() { return dark; }, media: "(prefers-color-scheme: dark)",
    addEventListener: (_name: string, callback: (event: MediaQueryListEvent) => void) => mediaListeners.add(callback),
    removeEventListener: (_name: string, callback: (event: MediaQueryListEvent) => void) => mediaListeners.delete(callback),
  })));
  vi.mocked(api.apiGetSettings).mockResolvedValue(snapshot());
  vi.mocked(api.apiUpdateAppearance).mockImplementation(async (_appearance, revision) => ({ revision, status: "saving", error: null }));
  vi.mocked(api.apiListenAppearanceSaveState).mockImplementation(async (callback) => { appearanceEvent = callback; return vi.fn(); });
  vi.mocked(api.apiListenExitSaveState).mockImplementation(async (callback) => { exitEvent = callback; return vi.fn(); });
  vi.mocked(api.apiGetExitState).mockResolvedValue({ revision: 0, status: "idle", error: null });
  vi.mocked(api.apiRequestExit).mockImplementation(async (action) => ({ revision: 8, status: action === "cancel" ? "idle" : "saving", error: null }));
  store = createSettingsStore();
  disconnect = undefined;
  stopMedia = undefined;
});

afterEach(async () => {
  stopMedia?.();
  disconnect?.();
  await store.getState().flushAppearance();
  vi.unstubAllGlobals();
});

describe("appearance delivery and truthful feedback", () => {
  it("previews immediately and coalesces a frame into one complete latest snapshot", async () => {
    await connect();
    await store.getState().setFxIntensityLocal(1.2);
    await store.getState().setFxThemeLocal("snow");
    await store.getState().setLightThemeLocal("glass");
    expect(store.getState().fxIntensity).toBe(1.2);
    expect(store.getState().theme).toBe("glass");
    expect(api.apiUpdateAppearance).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(16));
    await settle();
    expect(api.apiUpdateAppearance).toHaveBeenCalledTimes(1);
    const [appearance, revision] = vi.mocked(api.apiUpdateAppearance).mock.calls[0];
    expect(appearance).toEqual({
      theme: "glass", lightTheme: "glass", darkTheme: "dark", font: "hand", fxTheme: "snow",
      fxIntensity: 1.2, fxEdgeBoost: true, dockHandle: "grip",
      noteBg: themes.glass.background, noteFg: themes.glass.foreground,
      noteAccent: themes.glass.accent, notePop: themes.glass.pop,
    });
    expect(appearance).not.toHaveProperty("notion");
    expect(revision).toBe(7);
    expect(store.getState().appearanceSaveState.status).toBe("saving");
    expect(store.getState().appearanceDirty).toBe(true);
  });

  it("ignores old acknowledgements and a receipt arriving after the saved event", async () => {
    await connect();
    const receipt = deferred<AppearanceSaveState>();
    vi.mocked(api.apiUpdateAppearance).mockReturnValueOnce(receipt.promise);
    await store.getState().setFxIntensityLocal(1.1);
    const flush = store.getState().flushAppearance();
    const revision = store.getState().appearanceSaveState.revision;
    appearanceEvent({ revision, status: "saved", error: null });
    receipt.resolve({ revision, status: "saving", error: null });
    await flush;
    expect(store.getState().appearanceDirty).toBe(false);
    await store.getState().setFxIntensityLocal(1.3);
    appearanceEvent({ revision, status: "saved", error: null });
    expect(store.getState().appearanceDirty).toBe(true);
    expect(store.getState().fxIntensity).toBe(1.3);
    expect(store.getState().appearanceSaveState.revision).toBe(revision + 1);
  });

  it("keeps failed previews dirty without automatic retry and explicitly retries a newer revision", async () => {
    await connect();
    await store.getState().setFxThemeLocal("snow");
    await store.getState().flushAppearance();
    const failedRevision = store.getState().appearanceSaveState.revision;
    appearanceEvent({ revision: failedRevision, status: "error", error: "disk full" });
    await store.getState().flushAppearance();
    await settle();
    expect(api.apiUpdateAppearance).toHaveBeenCalledTimes(1);
    expect(store.getState().fxTheme).toBe("snow");
    expect(store.getState().appearanceDirty).toBe(true);
    expect(store.getState().appearanceSaveState.error).toBe("disk full");
    await store.getState().retryAppearance();
    expect(api.apiUpdateAppearance).toHaveBeenLastCalledWith(expect.objectContaining({ fxTheme: "snow" }), failedRevision + 1);
    appearanceEvent({ revision: failedRevision, status: "saved", error: null });
    expect(store.getState().appearanceDirty).toBe(true);
    appearanceEvent({ revision: failedRevision + 1, status: "saved", error: null });
    expect(store.getState().appearanceDirty).toBe(false);
  });

  it("retains only the latest snapshot while a receipt is in flight and flush survives disconnect", async () => {
    await connect();
    const first = deferred<AppearanceSaveState>();
    vi.mocked(api.apiUpdateAppearance).mockReturnValueOnce(first.promise);
    await store.getState().setFxIntensityLocal(1.1);
    const flush = store.getState().flushAppearance();
    await store.getState().setFxIntensityLocal(1.2);
    await store.getState().setFxIntensityLocal(1.4);
    disconnect!();
    disconnect = undefined;
    first.resolve({ revision: 5, status: "saving", error: null });
    await flush;
    expect(api.apiUpdateAppearance).toHaveBeenCalledTimes(2);
    expect(api.apiUpdateAppearance).toHaveBeenLastCalledWith(expect.objectContaining({ fxIntensity: 1.4 }), 7);
  });

  it("reports IPC failures, retains the preview, and permits new input to retry", async () => {
    await connect();
    vi.mocked(api.apiUpdateAppearance).mockRejectedValueOnce(new Error("IPC unavailable"));
    await store.getState().setFxIntensityLocal(1.2);
    await store.getState().flushAppearance();
    expect(store.getState().appearanceSaveState).toEqual({ revision: 5, status: "error", error: "IPC unavailable" });
    expect(store.getState().fxIntensity).toBe(1.2);
    await store.getState().setFxIntensityLocal(1.4);
    await store.getState().flushAppearance();
    expect(api.apiUpdateAppearance).toHaveBeenCalledTimes(2);
    expect(store.getState().appearanceSaveState.status).toBe("saving");
  });

  it("changes the system theme and palette together through the same writer", async () => {
    await connect();
    stopMedia = store.getState().startSystemThemeListener();
    dark = true;
    mediaListeners.forEach((listener) => listener({ matches: true } as MediaQueryListEvent));
    expect(store.getState().theme).toBe("dark");
    expect(store.getState().noteBg).toBe(themes.dark.background);
    await store.getState().flushAppearance();
    expect(api.apiUpdateAppearance).toHaveBeenCalledTimes(1);
    expect(api.apiUpdateAppearance).toHaveBeenCalledWith(expect.objectContaining({ theme: "dark", noteAccent: themes.dark.accent }), 5);
    stopMedia();
    stopMedia = undefined;
    expect(mediaListeners.size).toBe(0);
  });
});

describe("settings lifecycle", () => {
  it("never persists defaults or enables input when desktop hydration fails", async () => {
    vi.mocked(api.apiGetSettings).mockRejectedValueOnce(new Error("database unavailable"));
    await store.getState().hydrate();
    expect(store.getState().hydrated).toBe(false);
    expect(store.getState().hydrationError).toBe("database unavailable");
    await store.getState().setLightThemeLocal("glass");
    await store.getState().flushAppearance();
    expect(api.apiUpdateAppearance).not.toHaveBeenCalled();
    expect(store.getState().theme).toBe("paper");
    await store.getState().hydrate();
    expect(store.getState().hydrated).toBe(true);
    expect(store.getState().hydrationError).toBeNull();
    expect(api.apiUpdateAppearance).not.toHaveBeenCalled();
  });

  it("registers before reading, reads the native latest preview, and rejects a stale snapshot", async () => {
    const read = deferred<SettingsSnapshot>();
    vi.mocked(api.apiGetSettings).mockReturnValueOnce(read.promise).mockResolvedValueOnce({
      ...snapshot(6), settings: { ...snapshot(6).settings, fxIntensity: 1.4 },
      appearanceSaveState: { revision: 6, status: "error", error: "disk full" },
    });
    disconnect = store.getState().connectSettings();
    await settle();
    expect(api.apiListenAppearanceSaveState).toHaveBeenCalled();
    expect(api.apiListenExitSaveState).toHaveBeenCalled();
    appearanceEvent({ revision: 6, status: "error", error: "disk full" });
    read.resolve(snapshot(4));
    await settle();
    expect(store.getState().fxIntensity).toBe(1.4);
    expect(store.getState().appearanceSaveState.revision).toBe(6);
    expect(store.getState().appearanceSaveState.error).toBe("disk full");
    expect(api.apiUpdateAppearance).not.toHaveBeenCalled();
  });

  it("immediately removes subscriptions that resolve after unmount and ignores their callbacks", async () => {
    const appearanceListen = deferred<() => void>();
    const exitListen = deferred<() => void>();
    const removeAppearance = vi.fn();
    const removeExit = vi.fn();
    vi.mocked(api.apiListenAppearanceSaveState).mockImplementationOnce((callback) => {
      appearanceEvent = callback;
      return appearanceListen.promise;
    });
    vi.mocked(api.apiListenExitSaveState).mockImplementationOnce((callback) => {
      exitEvent = callback;
      return exitListen.promise;
    });
    const stop = store.getState().connectSettings();
    stop();
    appearanceListen.resolve(removeAppearance);
    exitListen.resolve(removeExit);
    await settle();
    appearanceEvent({ revision: 9, status: "error", error: "late" });
    exitEvent({ revision: 9, status: "error", error: "late" });
    expect(removeAppearance).toHaveBeenCalledTimes(1);
    expect(removeExit).toHaveBeenCalledTimes(1);
    expect(api.apiGetSettings).not.toHaveBeenCalled();
    expect(store.getState().appearanceSaveState.revision).toBe(0);
    expect(store.getState().exitSaveState.status).toBe("idle");
  });

  it("does not apply a read that finishes after disconnect", async () => {
    const read = deferred<SettingsSnapshot>();
    vi.mocked(api.apiGetSettings).mockReturnValueOnce(read.promise);
    const stop = store.getState().connectSettings();
    await settle();
    stop();
    read.resolve(snapshot());
    await settle();
    expect(store.getState().hydrated).toBe(false);
    expect(store.getState().hydrating).toBe(false);
  });
});

describe("exit feedback", () => {
  it("ignores stale exit reads and old errors after cancellation", async () => {
    const read = deferred<ExitSaveState>();
    vi.mocked(api.apiGetExitState).mockReturnValueOnce(read.promise);
    disconnect = store.getState().connectSettings();
    await settle();
    exitEvent({ revision: 7, status: "error", error: "disk full" });
    read.resolve({ revision: 0, status: "idle", error: null });
    await settle();
    expect(store.getState().exitSaveState.status).toBe("error");
    const cancelled = deferred<ExitSaveState>();
    vi.mocked(api.apiRequestExit).mockReturnValueOnce(cancelled.promise);
    const cancel = store.getState().requestExit("cancel");
    expect(store.getState().exitSaveState.status).toBe("idle");
    exitEvent({ revision: 7, status: "error", error: "late disk failure" });
    expect(store.getState().exitSaveState.status).toBe("idle");
    cancelled.resolve({ revision: 8, status: "idle", error: null });
    await cancel;
    expect(store.getState().exitSaveState.revision).toBe(8);
  });

  it("sends the final preview before requesting exit and keeps a retry failure visible", async () => {
    await connect();
    exitEvent({ revision: 7, status: "error", error: "disk full" });
    await store.getState().setFxIntensityLocal(1.4);
    vi.mocked(api.apiRequestExit).mockResolvedValueOnce({ revision: 8, status: "error", error: "still full" });
    await store.getState().requestExit("retry");
    expect(api.apiUpdateAppearance).toHaveBeenCalledWith(expect.objectContaining({ fxIntensity: 1.4 }), 5);
    expect(api.apiRequestExit).toHaveBeenCalledWith("retry");
    expect(vi.mocked(api.apiUpdateAppearance).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.apiRequestExit).mock.invocationCallOrder[0]);
    expect(store.getState().exitSaveState).toEqual({ revision: 8, status: "error", error: "still full" });
  });

  it("never requests an ordinary exit if its final preview could not reach native", async () => {
    await connect();
    vi.mocked(api.apiUpdateAppearance).mockRejectedValue(new Error("IPC unavailable"));
    await store.getState().setFxIntensityLocal(1.4);
    await store.getState().requestExit("retry");
    expect(api.apiRequestExit).not.toHaveBeenCalled();
    expect(store.getState().exitSaveState.status).toBe("error");
    expect(store.getState().fxIntensity).toBe(1.4);
    vi.mocked(api.apiRequestExit).mockResolvedValueOnce({ revision: 1, status: "saving", error: null });
    await store.getState().requestExit("discard");
    expect(api.apiRequestExit).toHaveBeenCalledWith("discard");
  });

  it("browser APIs cannot claim persistence or an exit succeeded", async () => {
    const actual = await vi.importActual<typeof TauriApi>("../services/tauriApi");
    const preview = await actual.apiGetSettings();
    expect(preview.appearanceSaveState.status).toBe("error");
    await expect(actual.apiUpdateAppearance({ ...preview.settings, noteBg: "#fff", noteFg: "#000", noteAccent: "#888", notePop: "#aaa" }, 1)).rejects.toThrow("浏览器");
    await expect(actual.apiRequestExit()).rejects.toThrow("浏览器");
  });
});
