import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { setFxAppearance } from "./appearanceStore";
import { FX_EVENTS, type DockPhase, type DockSnapshot, type FxAction, type FxAmbientPayload, type FxScatterPayload, type FxSnapshot, type FxSyncPayload, type PanelInset } from "./types";
import { hasStaticFxFringe } from "./themes";

export interface FxSceneSync extends FxSyncPayload {
  staticOnly: boolean;
  phase: DockPhase;
}

export interface FxSceneHandlers {
  onSync: (payload: FxSceneSync) => void;
  onDock?: (payload: DockSnapshot) => void;
  onScatter?: (payload: FxScatterPayload) => void;
  onAmbient?: (payload: FxAmbientPayload) => void;
}

export interface FxBridge {
  getSnapshot: () => Promise<FxSnapshot>;
  listenState: (receive: (state: FxSnapshot) => void) => Promise<() => void>;
  listenAction: (receive: (action: FxAction) => void) => Promise<() => void>;
}

const nativeBridge: FxBridge = {
  getSnapshot: () => invoke<FxSnapshot>("get_fx_snapshot"),
  listenState: (receive) => listen<FxSnapshot>(FX_EVENTS.state, (event) => receive(event.payload)),
  listenAction: (receive) => listen<FxAction>(FX_EVENTS.action, (event) => receive(event.payload)),
};
const freeDock: DockSnapshot = { revision: 0, phase: "free", edge: null, presented: false };
const inactive: FxSceneSync = { active: false, staticOnly: false, phase: "free", edge: null, panel: null };

interface SceneState {
  theme: string | null;
  generation: number;
  sync: FxSceneSync;
  dock: DockSnapshot;
}
interface Scene {
  handlers: FxSceneHandlers;
  theme: string | null;
  eventId: number;
}

export function createFxRuntimeStore(bridge: FxBridge = nativeBridge) {
  let snapshot: FxSnapshot | null = null;
  let connection = 0;
  let mediaAllowed = false;
  let documentVisible = false;
  let eventCursor = 0;
  let lastAction = 0;
  let pending: FxAction[] = [];
  let sceneState: SceneState | null = null;
  const listeners = new Set<() => void>();
  const scenes = new Set<Scene>();

  const notifyScene = (scene: Scene, state: SceneState) => {
    if (scene.theme === null) scene.theme = state.theme;
    const presented = (state.sync.active || state.sync.staticOnly) && scene.theme === state.theme;
    scene.handlers.onSync(presented ? state.sync : inactive);
    scene.handlers.onDock?.(presented || !state.dock.presented ? state.dock : { ...state.dock, presented: false });
  };
  const refreshScenes = () => {
    const visible = !!snapshot?.active && documentVisible;
    const active = visible && mediaAllowed;
    const staticOnly = visible && !mediaAllowed && hasStaticFxFringe(snapshot?.theme);
    const edge = active || staticOnly ? snapshot!.edge : null;
    const panel: PanelInset | null = active || staticOnly ? snapshot!.panel : null;
    const dock = snapshot?.dock ?? freeDock;
    const presented = (active || staticOnly) && dock.presented;
    const theme = snapshot?.theme ?? null;
    const generation = snapshot?.generation ?? 0;
    if (sceneState && sceneState.theme === theme && sceneState.generation === generation
      && sceneState.sync.active === active && sceneState.sync.staticOnly === staticOnly && sceneState.sync.edge === edge
      && (sceneState.sync.panel === panel || (!!sceneState.sync.panel && !!panel
        && sceneState.sync.panel.x === panel.x && sceneState.sync.panel.y === panel.y
        && sceneState.sync.panel.w === panel.w && sceneState.sync.panel.h === panel.h))
      && sceneState.dock.revision === dock.revision && sceneState.dock.phase === dock.phase
      && sceneState.dock.edge === dock.edge && sceneState.dock.presented === presented) return;
    sceneState = {
      theme, generation, sync: { active, staticOnly, phase: dock.phase, edge, panel },
      dock: dock.presented === presented ? dock : { ...dock, presented },
    };
    for (const scene of scenes) notifyScene(scene, sceneState);
  };
  const deliver = (action: FxAction) => {
    if (!snapshot || action.generation !== snapshot.generation) return;
    const active = snapshot.active && mediaAllowed && documentVisible;
    for (const scene of scenes) {
      if (action.eventId <= scene.eventId) continue;
      scene.eventId = action.eventId;
      if (!active || scene.theme !== snapshot.theme) continue;
      if (action.kind === "scatter") scene.handlers.onScatter?.(action.payload);
      else scene.handlers.onAmbient?.(action.payload);
    }
  };
  const drain = () => {
    if (!snapshot) return;
    const waiting = pending;
    pending = [];
    for (const action of waiting) {
      if (action.generation < snapshot.generation) continue;
      if (action.stateRevision > snapshot.revision || action.generation > snapshot.generation) pending.push(action);
      else deliver(action);
    }
  };
  const receiveState = (next: FxSnapshot) => {
    if (snapshot && next.revision <= snapshot.revision) return;
    const previous = snapshot;
    snapshot = next;
    eventCursor = Math.max(eventCursor, next.eventId);
    const before = previous?.appearance;
    const after = next.appearance;
    if (!before || before.bg !== after.bg || before.fg !== after.fg || before.accent !== after.accent
      || before.pop !== after.pop || before.intensity !== after.intensity || before.edgeBoost !== after.edgeBoost) {
      setFxAppearance(after);
    }
    refreshScenes();
    drain();
    for (const listener of listeners) listener();
  };
  const receiveAction = (action: FxAction) => {
    if (action.eventId <= lastAction) return;
    lastAction = action.eventId;
    eventCursor = Math.max(eventCursor, action.eventId);
    if (!snapshot || action.stateRevision > snapshot.revision || action.generation > snapshot.generation) pending.push(action);
    else deliver(action);
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setPolicy: (allowed: boolean, visible: boolean) => {
      if (mediaAllowed === allowed && documentVisible === visible) return;
      mediaAllowed = allowed;
      documentVisible = visible;
      refreshScenes();
    },
    subscribeScene: (handlers: FxSceneHandlers, theme: string | null = snapshot?.theme ?? null) => {
      refreshScenes();
      const scene: Scene = { handlers, theme, eventId: eventCursor };
      scenes.add(scene);
      if (sceneState) notifyScene(scene, sceneState);
      return () => { scenes.delete(scene); };
    },
    connect: () => {
      const current = ++connection;
      let alive = true;
      const unsubs: Array<() => void> = [];
      const register = async <T,>(listenValue: (receive: (value: T) => void) => Promise<() => void>, receive: (value: T) => void) => {
        const stop = await listenValue((value) => { if (alive && current === connection) receive(value); });
        if (alive && current === connection) unsubs.push(stop);
        else stop();
      };
      const reset = () => {
        snapshot = null;
        pending = [];
        refreshScenes();
        for (const listener of listeners) listener();
      };
      const stop = () => {
        alive = false;
        for (const unsubscribe of unsubs) unsubscribe();
        unsubs.length = 0;
      };
      void (async () => {
        try {
          await Promise.all([register(bridge.listenState, receiveState), register(bridge.listenAction, receiveAction)]);
          if (!alive || current !== connection) return;
          const initial = await bridge.getSnapshot();
          if (alive && current === connection) receiveState(initial);
        } catch (error) {
          if (alive && current === connection) {
            stop();
            reset();
            console.error("Unable to initialize FX state", error);
          }
        }
      })();
      return () => {
        stop();
        if (current === connection) { connection += 1; reset(); }
      };
    },
  };
}

export const fxRuntimeStore = createFxRuntimeStore();
