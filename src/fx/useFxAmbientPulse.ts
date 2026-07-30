import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { rand } from "./math";
import type { DockEdge, DockPhase } from "./types";
import { useSettingsStore } from "../stores/settingsStore";

const EXPAND_FRINGE_DELAY_MS = 340;

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Main-window hook: reliable timers that pulse ambient FX while docked.
 * No particle DOM — visuals live entirely in the fx window.
 */
export function useFxAmbientPulse(
  phase: DockPhase,
  edge: DockEdge | null,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fxTheme = useSettingsStore((s) => s.fxTheme);

  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!isTauri() || !edge) return;
    if (fxTheme === "none") return;
    if (phase !== "collapsed" && phase !== "expanded") return;

    let cancelled = false;
    const fire = () => {
      void invoke("pulse_fx_ambient", { edge, phase }).catch(() => {
        /* fx may not be ready */
      });
    };
    const schedule = () => {
      const wait =
        phase === "collapsed" ? rand(700, 1500) : rand(1800, 3400);
      timer.current = setTimeout(() => {
        if (cancelled) return;
        fire();
        schedule();
      }, wait);
    };

    timer.current = setTimeout(
      () => {
        if (cancelled) return;
        fire();
        schedule();
      },
      phase === "collapsed" ? 350 : EXPAND_FRINGE_DELAY_MS + 250,
    );

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [phase, edge, fxTheme]);
}
