import { useEffect, useSyncExternalStore } from "react";
import {
  appearanceCssVars,
  type FxAppearance,
} from "./appearance";
import {
  getFxAppearance,
  subscribeFxAppearance,
} from "./appearanceStore";

function useFxAppearance(): FxAppearance {
  return useSyncExternalStore(
    subscribeFxAppearance,
    getFxAppearance,
    getFxAppearance,
  );
}

/** Writes appearance CSS vars onto documentElement for DOM FX themes. */
export function useFxAppearanceCss() {
  const appearance = useFxAppearance();
  useEffect(() => {
    const vars = appearanceCssVars(appearance);
    const root = document.documentElement;
    for (const [k, v] of Object.entries(vars)) {
      root.style.setProperty(k, v);
    }
    root.dataset.fxColorMode =
      appearance.luminance >= 0.55 ? "on-light" : "on-dark";
    root.dataset.fxEdgeBoost = appearance.edgeBoost ? "on" : "off";
  }, [appearance]);
  return appearance;
}

