import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { LeafTheme } from "./theme/leaf";
import { SakuraTheme } from "./theme/sakura";
import { VineTheme } from "./theme/vine";
import { IcicleTheme } from "./theme/icicle";
import { RainTheme } from "./theme/rain";
import { SnowTheme } from "./theme/snow";
import {
  DEFAULT_FX_THEME,
  normalizeFxThemeId,
  type FxThemeId,
} from "./themes";
import { FX_EVENTS } from "./types";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Transparent fx window entry — hosts the active visual theme.
 */
export function FxHost() {
  const [theme, setTheme] = useState<FxThemeId>(DEFAULT_FX_THEME);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;

    void (async () => {
      if (isTauri()) {
        try {
          const settings = await invoke<{ fxTheme?: string }>("get_settings");
          if (alive) setTheme(normalizeFxThemeId(settings.fxTheme));
        } catch {
          /* keep default */
        }
        try {
          unlisten = await listen<string>(FX_EVENTS.theme, (e) => {
            setTheme(normalizeFxThemeId(e.payload));
          });
        } catch {
          /* ignore */
        }
      }
    })();

    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  if (theme === "none") return null;
  if (theme === "sakura") return <SakuraTheme />;
  if (theme === "vine") return <VineTheme />;
  if (theme === "icicle") return <IcicleTheme />;
  if (theme === "rain") return <RainTheme />;
  if (theme === "snow") return <SnowTheme />;
  return <LeafTheme />;
}
