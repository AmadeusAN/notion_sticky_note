import { lazy, memo, Suspense, useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { hasStaticFxFringe, normalizeFxThemeId } from "./themes";
import { useFxAppearanceCss } from "./useFxAppearance";
import { useFxActivityPolicy } from "./media";
import { FxSceneScope } from "./runtime";
import { fxRuntimeStore } from "./runtimeStore";
import "./fx-appearance.css";

// The native theme selects this runtime registry; static imports load all eight renderers.
const scenes = {
  leaf: memo(lazy(() => import("./theme/leaf").then((module) => ({ default: module.LeafTheme })))),
  sakura: memo(lazy(() => import("./theme/sakura").then((module) => ({ default: module.SakuraTheme })))),
  vine: memo(lazy(() => import("./theme/vine").then((module) => ({ default: module.VineTheme })))),
  icicle: memo(lazy(() => import("./theme/icicle").then((module) => ({ default: module.IcicleTheme })))),
  rain: memo(lazy(() => import("./theme/rain").then((module) => ({ default: module.RainTheme })))),
  snow: memo(lazy(() => import("./theme/snow").then((module) => ({ default: module.SnowTheme })))),
  ink: memo(lazy(() => import("./theme/ink").then((module) => ({ default: module.InkTheme })))),
  firefly: memo(lazy(() => import("./theme/firefly").then((module) => ({ default: module.FireflyTheme })))),
};

export function FxHost() {
  const snapshot = useSyncExternalStore(fxRuntimeStore.subscribe, fxRuntimeStore.getSnapshot, () => null);
  const { mediaAllowed, documentVisible } = useFxActivityPolicy();
  const staticCapable = hasStaticFxFringe(snapshot?.theme);
  const nativeAllowed = mediaAllowed || staticCapable;
  useFxAppearanceCss();

  useEffect(() => fxRuntimeStore.connect(), []);
  useLayoutEffect(() => {
    fxRuntimeStore.setPolicy(mediaAllowed, documentVisible);
  }, [mediaAllowed, documentVisible]);
  useEffect(() => {
    // Document visibility only pauses rendering: gating native show on it would
    // strand an initially hidden FX window permanently hidden.
    void invoke("set_fx_enabled", { enabled: nativeAllowed }).catch((error) => {
      console.error("Unable to update FX presentation policy", error);
    });
  }, [nativeAllowed]);

  if (!snapshot) return null;
  const theme = normalizeFxThemeId(snapshot.theme);
  if (theme === "none") return null;
  const Scene = scenes[theme];
  return (
    <div className="fx-runtime-host" data-active={snapshot.active && nativeAllowed && documentVisible} data-static={!mediaAllowed && staticCapable}>
      <FxSceneScope theme={snapshot.theme}>
        <Suspense fallback={null}><Scene key={snapshot.theme} /></Suspense>
      </FxSceneScope>
    </div>
  );
}
