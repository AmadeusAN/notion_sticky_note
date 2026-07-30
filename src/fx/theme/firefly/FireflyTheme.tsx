import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  FX_EVENTS,
  type FxAmbientPayload,
  type FxScatterPayload,
  type FxSyncPayload,
  type PanelInset,
} from "../../types";
import { WeatherCanvas } from "../../weather";
import { createFireflySim } from "./fireflySim";
import "./firefly.css";

const DEFAULT_PANEL: PanelInset = { x: 20, y: 20, w: 60, h: 60 };

export function FireflyTheme() {
  const simRef = useRef(createFireflySim());
  const sizeRef = useRef({ w: window.innerWidth, h: window.innerHeight });
  const [running, setRunning] = useState(true);
  const seeded = useRef(false);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    let alive = true;
    const sim = simRef.current;

    const add = async <T,>(
      event: string,
      handler: (e: { payload: T }) => void,
    ) => {
      const un = await listen<T>(event, handler);
      if (!alive) {
        un();
        return;
      }
      unsubs.push(un);
    };

    void (async () => {
      await add<FxScatterPayload>(FX_EVENTS.scatter, (e) => {
        const { kind, edge: ed, panel: p } = e.payload;
        if (!ed) return;
        const inset = p && p.w > 0 && p.h > 0 ? p : DEFAULT_PANEL;
        sim.panel = inset;
        const { w, h } = sizeRef.current;
        sim.scatterBurst(ed, kind, w, h);
      });

      await add<FxSyncPayload>(FX_EVENTS.sync, (e) => {
        const { active, panel: p } = e.payload;
        sim.active = active;
        setRunning(active);
        if (p && p.w > 0 && p.h > 0) sim.panel = p;
        if (!active) sim.clear();
      });

      await add<FxAmbientPayload>(FX_EVENTS.ambient, (e) => {
        const { edge: ed, phase } = e.payload;
        if (!ed || !sim.active) return;
        const { w, h } = sizeRef.current;
        sim.boostAmbient(ed, phase, w, h);
      });
    })();

    return () => {
      alive = false;
      for (const u of unsubs) u();
      sim.clear();
    };
  }, []);

  return (
    <div className="fx-root firefly-theme" aria-hidden>
      <WeatherCanvas
        running={running}
        onFrame={(ctx, dt, w, h, timeSec) => {
          sizeRef.current = { w, h };
          const sim = simRef.current;
          if (!seeded.current && w > 0 && h > 0) {
            sim.seedAmbientField(w, h, 45);
            seeded.current = true;
          }
          sim.step(dt, w, h, timeSec);
          sim.draw(ctx, timeSec);
        }}
      />
    </div>
  );
}
