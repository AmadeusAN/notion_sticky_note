import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useFxScene } from "../../runtime";
import type { DockEdge, DockPhase, PanelInset } from "../../types";
import { WeatherCanvas, type WeatherCanvasController } from "../../weather";
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
  const [running, setRunning] = useState(false);
  const canvas = useRef<WeatherCanvasController | null>(null);

  const panelRef = useRef<PanelInset>(DEFAULT_PANEL);
  const [panel, setPanel] = useState<PanelInset>(DEFAULT_PANEL);
  const prevPhase = useRef<DockPhase>("free");
  const fringeModeRef = useRef<FringeMode | null>(null);
  const fringeEdgeRef = useRef<DockEdge | null>(null);
  const presentedRef = useRef(false);
  const staticOnlyRef = useRef(false);
  const fringeTimer = useRef<number | undefined>(undefined);
  const [sim] = useState(createInkBleedSim);

  const showFringe = (e: DockEdge, mode: FringeMode, count: number) => {
    if (!presentedRef.current) return;
    setFringe(makeFringe(e, mode, count));
    setFringeMode(mode);
    fringeModeRef.current = mode;
    fringeEdgeRef.current = e;
    setEdge(e);
  };

  const clearFringe = () => {
    setFringe([]);
    setFringeMode(null);
    fringeModeRef.current = null;
    fringeEdgeRef.current = null;
  };

  const cancelFringeTimer = () => {
    window.clearTimeout(fringeTimer.current);
    fringeTimer.current = undefined;
  };

  useFxScene({
    onScatter: ({ kind, edge: ed, panel: p }) => {
      if (!sim.active || staticOnlyRef.current) return;
      const inset = p && p.w > 0 && p.h > 0 ? p : DEFAULT_PANEL;
      panelRef.current = inset;
      setPanel(inset);
      setEdge(ed);
      sim.panel = inset;
      sim.scatter(ed, kind, window.innerWidth, window.innerHeight);
      canvas.current?.wake();
    },
    onSync: ({ active, staticOnly, phase, edge: ed, panel: p }) => {
      presentedRef.current = active || staticOnly;
      staticOnlyRef.current = staticOnly;
      sim.active = active && !staticOnly;
      setRunning(sim.active);
      if (!presentedRef.current) {
        cancelFringeTimer();
        prevPhase.current = "free";
        clearFringe();
        setEdge(null);
        sim.clear();
        canvas.current?.stopAndClear();
        return;
      }
      if (ed) setEdge(ed);
      if (p && p.w > 0 && p.h > 0) {
        panelRef.current = p;
        setPanel(p);
        sim.panel = p;
      }
      if (staticOnly) {
        cancelFringeTimer();
        sim.clear();
        canvas.current?.stopAndClear();
        prevPhase.current = phase;
        if (phase === "free" || !ed) {
          clearFringe();
          setEdge(null);
          return;
        }
        const mode = phase === "collapsed" ? "strip" : "screen";
        if (fringeModeRef.current !== mode || fringeEdgeRef.current !== ed) {
          showFringe(ed, mode, phase === "collapsed" ? 10 : 9);
        }
      }
    },
    onAmbient: ({ edge: ed, phase }) => {
      if (!sim.active || staticOnlyRef.current) return;
      sim.ambient(ed, window.innerWidth, window.innerHeight, phase === "collapsed" ? 2 : 1);
      canvas.current?.wake();
    },
    onDock: ({ phase, edge: ed, presented }) => {
      cancelFringeTimer();
      if (!presentedRef.current || !presented) {
        prevPhase.current = "free";
        clearFringe();
        setEdge(null);
        return;
      }
      if (staticOnlyRef.current) return;
      const was = prevPhase.current;
      prevPhase.current = phase;
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
      if (toExpanded || toCollapsed) {
        clearFringe();
        fringeTimer.current = window.setTimeout(() => {
          fringeTimer.current = undefined;
          showFringe(ed, toExpanded ? "screen" : "strip", toExpanded ? 11 : 10);
        }, toExpanded ? EXPAND_FRINGE_DELAY_MS : COLLAPSE_STRIP_DELAY_MS);
      } else if (fringeModeRef.current == null) {
        showFringe(ed, phase === "collapsed" ? "strip" : "screen", phase === "collapsed" ? 10 : 9);
      }
    },
  });
  useEffect(() => () => {
    sim.active = false;
    presentedRef.current = false;
    staticOnlyRef.current = false;
    cancelFringeTimer();
    prevPhase.current = "free";
    fringeModeRef.current = null;
    fringeEdgeRef.current = null;
    sim.clear();
    canvas.current?.stopAndClear();
  }, [sim]);

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
        controllerRef={canvas}
        hasWork={() => sim.active && sim.pool.aliveCount() > 0}
        onFrame={(ctx, dt, w, h) => {
          sim.panel = panelRef.current;
          sim.step(dt, w, h);
          sim.draw(ctx);
        }}
      />
    </div>
  );
}
