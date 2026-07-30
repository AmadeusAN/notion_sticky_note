import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { LeafTheme } from "./theme/leaf";
import { SakuraTheme } from "./theme/sakura";
import { VineTheme } from "./theme/vine";
import { IcicleTheme } from "./theme/icicle";
import { RainTheme } from "./theme/rain";
import { SnowTheme } from "./theme/snow";
import { InkTheme } from "./theme/ink";
import { FireflyTheme } from "./theme/firefly";
import {
  DEFAULT_FX_THEME,
  normalizeFxThemeId,
  type FxThemeId,
} from "./themes";
import {
  DEFAULT_FX_EDGE_BOOST,
  DEFAULT_FX_INTENSITY,
  clampIntensity,
} from "./appearance";
import { setFxAppearance } from "./appearanceStore";
import { useFxAppearanceCss } from "./useFxAppearance";
import { FX_EVENTS, type FxAppearancePayload } from "./types";
import "./fx-appearance.css";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function applyAppearancePayload(p: FxAppearancePayload) {
  setFxAppearance({
    bg: p.bg,
    fg: p.fg,
    accent: p.accent,
    pop: p.pop,
    intensity: clampIntensity(p.intensity ?? DEFAULT_FX_INTENSITY),
    edgeBoost: p.edgeBoost ?? DEFAULT_FX_EDGE_BOOST,
  });
}

/**
 * Transparent fx window entry — hosts the active visual theme.
 */
export function FxHost() {
  const [theme, setTheme] = useState<FxThemeId>(DEFAULT_FX_THEME);
  useFxAppearanceCss();

  useEffect(() => {
    let alive = true;
    const unsubs: Array<() => void> = [];

    void (async () => {
      if (!isTauri()) return;
      try {
        const settings = await invoke<{
          fxTheme?: string;
          fxIntensity?: number;
          fxEdgeBoost?: boolean;
          noteBg?: string;
          noteFg?: string;
          noteAccent?: string;
          notePop?: string;
        }>("get_settings");
        if (!alive) return;
        setTheme(normalizeFxThemeId(settings.fxTheme));
        setFxAppearance({
          bg: settings.noteBg ?? "#f6f0df",
          fg: settings.noteFg ?? "#3a3226",
          accent: settings.noteAccent ?? "#c4a35a",
          pop: settings.notePop ?? "#e8a87c",
          intensity: clampIntensity(
            settings.fxIntensity ?? DEFAULT_FX_INTENSITY,
          ),
          edgeBoost: settings.fxEdgeBoost ?? DEFAULT_FX_EDGE_BOOST,
        });
      } catch {
        /* keep default */
      }

      try {
        unsubs.push(
          await listen<string>(FX_EVENTS.theme, (e) => {
            setTheme(normalizeFxThemeId(e.payload));
          }),
        );
      } catch {
        /* ignore */
      }

      try {
        unsubs.push(
          await listen<FxAppearancePayload>(FX_EVENTS.appearance, (e) => {
            applyAppearancePayload(e.payload);
          }),
        );
      } catch {
        /* ignore */
      }
    })();

    return () => {
      alive = false;
      for (const u of unsubs) u();
    };
  }, []);

  if (theme === "none") return null;
  if (theme === "sakura") return <SakuraTheme />;
  if (theme === "vine") return <VineTheme />;
  if (theme === "icicle") return <IcicleTheme />;
  if (theme === "rain") return <RainTheme />;
  if (theme === "snow") return <SnowTheme />;
  if (theme === "ink") return <InkTheme />;
  if (theme === "firefly") return <FireflyTheme />;
  return <LeafTheme />;
}
