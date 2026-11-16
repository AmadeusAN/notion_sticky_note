import { useEffect, useRef, useState } from "react";
import { useFxScene } from "../../runtime";
import type { PanelInset } from "../../types";
import { WeatherCanvas, type WeatherCanvasController } from "../../weather";
import { createSnowSim } from "./snowSim";
import "./snow.css";

const DEFAULT_PANEL: PanelInset = { x: 20, y: 20, w: 60, h: 60 };

/**
 * Realistic snow — soft-flake Canvas field with wind drift and depth.
 */
export function SnowTheme() {
  const [sim] = useState(createSnowSim);
  const canvas = useRef<WeatherCanvasController | null>(null);
  const [running, setRunning] = useState(false);
  const seeded = useRef(false);

  useFxScene({
    onScatter: ({ kind, edge: ed, panel: p }) => {
      if (!sim.active) return;
      sim.panel = p && p.w > 0 && p.h > 0 ? p : DEFAULT_PANEL;
      sim.edge = ed;
      const w = window.innerWidth;
      const h = window.innerHeight;
      sim.scatterBurst(ed, kind, w, h);
    },
    onSync: ({ active, panel: p, edge: ed }) => {
      sim.active = active;
      setRunning(active);
      sim.edge = ed;
      if (p && p.w > 0 && p.h > 0) sim.panel = p;
      if (!active) {
        seeded.current = false;
        sim.clear();
        canvas.current?.stopAndClear();
      }
      if (active) canvas.current?.wake();
    },
    onAmbient: ({ edge: ed, phase }) => {
      if (!sim.active) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      sim.edge = ed;
      sim.boostAmbient(ed, phase, w, h);
    },
  });
  useEffect(() => () => {
    sim.active = false;
    sim.clear();
    seeded.current = false;
    canvas.current?.stopAndClear();
  }, [sim]);

  return (
    <div className="fx-root snow-theme" aria-hidden>
      <WeatherCanvas
        running={running}
        controllerRef={canvas}
        onFrame={(ctx, dt, w, h, timeSec) => {
          if (!seeded.current && w > 0 && h > 0) {
            sim.seedAmbientField(w, h, 70);
            seeded.current = true;
          }
          sim.step(dt, w, h, timeSec);
          sim.draw(ctx, w, h, timeSec);
        }}
      />
    </div>
  );
}
