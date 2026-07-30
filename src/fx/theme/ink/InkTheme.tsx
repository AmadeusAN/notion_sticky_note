import { useEffect, useRef, useState, type CSSProperties } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  FX_EVENTS,
  type DockEdge,
  type DockPhase,
  type DockSnapshot,
  type FxAmbientPayload,
  type FxScatterPayload,
  type FxSyncPayload,
  type PanelInset,
} from "../../types";
import { WeatherCanvas } from "../../weather";
import { InkSvg } from "./InkSvg";
import { createInkBleedSim } from "./inkBleedSim";
import { makeFringe, type FringeInk, type FringeMode } from "./particles";
import "./ink.css";

const DEFAULT_PANEL: PanelInset = { x: 20, y: 20, w: 60, h: 60 };
const EXPAND_FRINGE_DELAY_MS = 340;
const COLLAPSE_STRIP_DELAY_MS = 340;

export function InkTheme() {
  const [fringe, setFringe] = useState<FringeInk[]>([]);
  const [fringeMode, setFringeMode] = useState<FringeMode | null>(null);
  const [edge, setEdge] = useState<DockEdge | null>(null);
  const [running, setRunning] = useState(true);

  const panelRef = useRef<PanelInset>(DEFAULT_PANEL);
  const [panel, setPanel] = useState<PanelInset>(DEFAULT_PANEL);
  const prevPhase = useRef<DockPhase>("free");
  const fringeModeRef = useRef<FringeMode | null>(null);
  const fringeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sizeRef = useRef({ w: window.innerWidth, h: window.innerHeight });
  const simRef = useRef(createInkBleedSim());

  const showFringe = (e: DockEdge, mode: FringeMode, count: number) => {
    setFringe(makeFringe(e, mode, count));
    setFringeMode(mode);
    fringeModeRef.current = mode;
    setEdge(e);
  };

  const clearFringe = () => {
    setFringe([]);
    setFringeMode(null);
    fringeModeRef.current = null;
  };

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
        panelRef.current = inset;
        setPanel(inset);
        setEdge(ed);
        sim.panel = inset;
        const { w, h } = sizeRef.current;
        sim.scatter(ed, kind, w, h);
      });

      await add<FxSyncPayload>(FX_EVENTS.sync, (e) => {
        const { active, edge: ed, panel: p } = e.payload;
        sim.active = active;
        setRunning(active);
        if (!active) {
          clearFringe();
          setEdge(null);
          sim.clear();
          return;
        }
        if (ed) setEdge(ed);
        if (p && p.w > 0 && p.h > 0) {
          panelRef.current = p;
          setPanel(p);
          sim.panel = p;
        }
      });

      await add<FxAmbientPayload>(FX_EVENTS.ambient, (e) => {
        const { edge: ed, phase } = e.payload;
        if (!ed || !sim.active) return;
        const { w, h } = sizeRef.current;
        const n = phase === "collapsed" ? 2 : 1;
        sim.ambient(ed, w, h, n);
      });

      await add<DockSnapshot>(FX_EVENTS.dock, (e) => {
        const { phase, edge: ed } = e.payload;
        const was = prevPhase.current;
        prevPhase.current = phase;

        if (fringeTimer.current) {
          clearTimeout(fringeTimer.current);
          fringeTimer.current = null;
        }

        if (phase === "free" || !ed) {
          clearFringe();
          setEdge(null);
          return;
        }

        setEdge(ed);
        const toExpanded = was === "collapsed" && phase === "expanded";
        const toCollapsed =
          (was === "expanded" && phase === "collapsed") ||
          (was === "free" && phase === "collapsed");

        if (toExpanded) {
          clearFringe();
          fringeTimer.current = setTimeout(() => {
            showFringe(ed, "screen", 11);
          }, EXPAND_FRINGE_DELAY_MS);
        } else if (toCollapsed) {
          clearFringe();
          fringeTimer.current = setTimeout(() => {
            showFringe(ed, "strip", 10);
          }, COLLAPSE_STRIP_DELAY_MS);
        } else if (phase === "collapsed" && fringeModeRef.current == null) {
          showFringe(ed, "strip", 10);
        } else if (phase === "expanded" && fringeModeRef.current == null) {
          showFringe(ed, "screen", 9);
        }
      });
    })();

    return () => {
      alive = false;
      if (fringeTimer.current) clearTimeout(fringeTimer.current);
      for (const u of unsubs) u();
      sim.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bandStyle = {
    "--panel-x": `${panel.x}%`,
    "--panel-y": `${panel.y}%`,
    "--panel-w": `${panel.w}%`,
    "--panel-h": `${panel.h}%`,
  } as CSSProperties;

  return (
    <div className="fx-root ink-theme" aria-hidden style={bandStyle}>
      {edge && fringeMode ? (
        <div
          className={`fx-fringe-band fx-fringe-band-${edge} fx-fringe-${fringeMode}`}
        >
          {fringe.map((blot, i) => (
            <span
              key={blot.id}
              className={
                fringeMode === "screen"
                  ? `ink-fringe ink-edge-poke ink-edge-poke-${edge}`
                  : `ink-fringe ink-fringe-${edge} ink-fringe-strip`
              }
              style={
                {
                  "--along": `${blot.along}%`,
                  "--offset": `${blot.offset}px`,
                  "--rot": `${blot.rot}deg`,
                  "--scale": String(blot.scale),
                  "--grow-delay": `${i * 32}ms`,
                } as CSSProperties
              }
            >
              <InkSvg
                color={blot.color}
                flip={blot.flip}
                variant={blot.variant}
              />
            </span>
          ))}
        </div>
      ) : null}

      <WeatherCanvas
        running={running}
        onFrame={(ctx, dt, w, h) => {
          sizeRef.current = { w, h };
          const sim = simRef.current;
          sim.panel = panelRef.current;
          sim.step(dt, w, h);
          sim.draw(ctx);
        }}
      />
    </div>
  );
}
