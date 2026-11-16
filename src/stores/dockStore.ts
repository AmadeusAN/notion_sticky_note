import { create } from "zustand";
import type { DockSnapshot } from "../fx/types";
import { apiGetEdgeDock, apiListenEdgeDock } from "../services/tauriApi";

interface DockStore {
  snapshot: DockSnapshot;
  connectDock: () => () => void;
}

export function createDockStore() {
  let generation = 0;
  return create<DockStore>((set, get) => ({
    snapshot: { revision: 0, phase: "free", edge: null, presented: false },
    connectDock: () => {
      const connection = ++generation;
      let alive = true;
      let unlisten: (() => void) | undefined;
      const accept = (snapshot: DockSnapshot) => {
        if (!alive || connection !== generation || snapshot.revision < get().snapshot.revision) return;
        const previous = get().snapshot;
        if (snapshot.revision === previous.revision && snapshot.phase === previous.phase
          && snapshot.edge === previous.edge && snapshot.presented === previous.presented) return;
        set({ snapshot });
      };
      void (async () => {
        try {
          const stop = await apiListenEdgeDock(accept);
          if (!alive || connection !== generation) { stop(); return; }
          unlisten = stop;
          accept(await apiGetEdgeDock());
        } catch (error) {
          if (alive && connection === generation) console.error("无法读取贴边窗口状态", error);
        }
      })();
      return () => {
        alive = false;
        unlisten?.();
        if (connection === generation) generation += 1;
      };
    },
  }));
}

export const useDockStore = createDockStore();
