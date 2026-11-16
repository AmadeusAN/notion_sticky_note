import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { rand } from "./math";
import type { DockEdge, DockPhase } from "./types";
import { useSettingsStore } from "../stores/settingsStore";
import { useFxActivityPolicy } from "./media";

const EXPAND_FRINGE_DELAY_MS = 340;


/**
 * Main-window hook: reliable timers that pulse ambient FX while docked.
 * No particle DOM — visuals live entirely in the fx window.
 */
export function useFxAmbientPulse(
  phase: DockPhase,
  edge: DockEdge | null,
  presented: boolean,
  revision: number,
) {
  const timer = useRef<number | undefined>(undefined);
  const fxTheme = useSettingsStore((s) => s.fxTheme);
  const { mediaAllowed, documentVisible } = useFxActivityPolicy();

  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    if (!("__TAURI_INTERNALS__" in window) || !presented || !edge || !mediaAllowed || !documentVisible) return;
    if (fxTheme === "none" || (phase !== "collapsed" && phase !== "expanded")) return;
    let cancelled = false;
    const pulse = () => {
      if (cancelled) return;
      void invoke("pulse_fx_ambient", { edge, phase, revision }).catch((error) => {
        console.error("Unable to pulse FX", error);
      });
      timer.current = window.setTimeout(pulse, phase === "collapsed" ? rand(700, 1500) : rand(1800, 3400));
    };
    timer.current = window.setTimeout(pulse, phase === "collapsed" ? 350 : EXPAND_FRINGE_DELAY_MS + 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer.current);
      timer.current = undefined;
    };
  }, [phase, edge, presented, revision, fxTheme, mediaAllowed, documentVisible]);
}
