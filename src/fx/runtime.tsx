import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { fxRuntimeStore, type FxSceneHandlers } from "./runtimeStore";

export type { FxSceneHandlers } from "./runtimeStore";
const SceneTheme = createContext<string | null>(null);

export function FxSceneScope({ theme, children }: { theme: string; children: ReactNode }) {
  return <SceneTheme.Provider value={theme}>{children}</SceneTheme.Provider>;
}

/** One native bridge; each mounted scene receives current state, never old actions. */
export function useFxScene(handlers: FxSceneHandlers) {
  const latest = useRef(handlers);
  latest.current = handlers;
  const theme = useContext(SceneTheme);
  useEffect(() => fxRuntimeStore.subscribeScene({
    onSync: (payload) => latest.current.onSync(payload),
    onDock: (payload) => latest.current.onDock?.(payload),
    onScatter: (payload) => latest.current.onScatter?.(payload),
    onAmbient: (payload) => latest.current.onAmbient?.(payload),
  }, theme), [theme]);
}
