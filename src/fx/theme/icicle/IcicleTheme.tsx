import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useFxScene } from "../../runtime";
import type { DockEdge, DockPhase, PanelInset } from "../../types";
import { WeatherCanvas, type WeatherCanvasController } from "../../weather";
import { IcicleSvg } from "./IcicleSvg";
import {
  computeFringeTips,
  createIceAccentSim,
} from "./iceAccentSim";
import {
  makeFringe,
  type FringeIcicle,
  type FringeMode,
} from "./particles";
import "./icicle.css";

const DEFAULT_PANEL: PanelInset = { x: 20, y: 20, w: 60, h: 60 };
const EXPAND_FRINGE_DELAY_MS = 340;
const COLLAPSE_STRIP_DELAY_MS = 340;

/**
 * Crystal icicle theme — DOM fringe growth + canvas chips/drips.
 */
export function IcicleTheme() {
  const [fringe, setFringe] = useState<FringeIcicle[]>([]);
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
  const fringeRef = useRef<FringeIcicle[]>([]);
  const edgeRef = useRef<DockEdge | null>(null);
  const modeRef = useRef<FringeMode | null>(null);
  const [sim] = useState(createIceAccentSim);

  const showFringe = (e: DockEdge, mode: FringeMode, count: number) => {
    if (!presentedRef.current) return;
    const next = makeFringe(e, mode, count);
    fringeRef.current = next;
    setFringe(next);
    setFringeMode(mode);
    fringeModeRef.current = mode;
    fringeEdgeRef.current = e;
    modeRef.current = mode;
    setEdge(e);
    edgeRef.current = e;
  };

  const clearFringe = () => {
    fringeRef.current = [];
    setFringe([]);
    setFringeMode(null);
    fringeModeRef.current = null;
    fringeEdgeRef.current = null;
    modeRef.current = null;
    sim.fringeTips = [];
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
      edgeRef.current = ed;
      sim.panel = inset;
      sim.edge = ed;
      sim.scatterChips(ed, kind, window.innerWidth, window.innerHeight);
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
        edgeRef.current = null;
        sim.edge = null;
        sim.clear();
        canvas.current?.stopAndClear();
        return;
      }
      sim.edge = ed;
      if (ed) {
        setEdge(ed);
        edgeRef.current = ed;
      }
      if (p && p.w > 0 && p.h > 0) {
        panelRef.current = p;
        setPanel(p);
        sim.panel = p;
      }
      if (staticOnly) {
        cancelFringeTimer();
        sim.clear();
        sim.fringeTips = [];
        canvas.current?.stopAndClear();
        prevPhase.current = phase;
        if (phase === "free" || !ed) {
          clearFringe();
          setEdge(null);
          edgeRef.current = null;
          return;
        }
        const mode = phase === "collapsed" ? "strip" : "screen";
        if (fringeModeRef.current !== mode || fringeEdgeRef.current !== ed) {
          showFringe(ed, mode, phase === "collapsed" ? 12 : 10);
        }
      }
    },
    onAmbient: ({ edge: ed, phase }) => {
      if (!sim.active || staticOnlyRef.current) return;
      edgeRef.current = ed;
      setEdge(ed);
      if (modeRef.current && fringeRef.current.length > 0) {
        sim.fringeTips = computeFringeTips(
          ed, panelRef.current, fringeRef.current, modeRef.current,
          window.innerWidth, window.innerHeight,
        );
        sim.spawnDrips(phase === "collapsed" ? (Math.random() < 0.45 ? 2 : 1) : 1);
        canvas.current?.wake();
      }
    },
    onDock: ({ phase, edge: ed, presented }) => {
      cancelFringeTimer();
      if (!presentedRef.current || !presented) {
        prevPhase.current = "free";
        clearFringe();
        setEdge(null);
        edgeRef.current = null;
        return;
      }
      if (staticOnlyRef.current) return;
      const was = prevPhase.current;
      prevPhase.current = phase;
      if (phase === "free" || !ed) {
        clearFringe();
        setEdge(null);
        edgeRef.current = null;
        return;
      }
      setEdge(ed);
      edgeRef.current = ed;
      const toExpanded = was === "collapsed" && phase === "expanded";
      const toCollapsed =
        (was === "expanded" && phase === "collapsed") ||
        (was === "free" && phase === "collapsed");
      if (toExpanded || toCollapsed) {
        clearFringe();
        fringeTimer.current = window.setTimeout(() => {
          fringeTimer.current = undefined;
          showFringe(ed, toExpanded ? "screen" : "strip", toExpanded ? 13 : 12);
        }, toExpanded ? EXPAND_FRINGE_DELAY_MS : COLLAPSE_STRIP_DELAY_MS);
      } else if (fringeModeRef.current == null) {
        showFringe(ed, phase === "collapsed" ? "strip" : "screen", phase === "collapsed" ? 12 : 10);
      }
    },
  });
  useEffect(() => () => {
    sim.active = false;
    presentedRef.current = false;
    staticOnlyRef.current = false;
    cancelFringeTimer();
    prevPhase.current = "free";
    fringeRef.current = [];
    fringeModeRef.current = null;
    fringeEdgeRef.current = null;
    modeRef.current = null;
    edgeRef.current = null;
    sim.fringeTips = [];
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
    <div className="fx-root icicle-theme" aria-hidden style={bandStyle}>
      {edge && fringeMode ? (
        <div
          className={`fx-fringe-band fx-fringe-band-${edge} fx-fringe-${fringeMode}`}
        >
          {fringe.map((spike, i) => (
            <span
              key={spike.id}
              className={
                fringeMode === "screen"
                  ? `icicle-fringe icicle-edge-poke icicle-edge-poke-${edge}`
                  : `icicle-fringe icicle-fringe-${edge} icicle-fringe-strip`
              }
              style={
                {
                  "--along": `${spike.along}%`,
                  "--offset": `${spike.offset}px`,
                  "--rot": `${spike.rot}deg`,
                  "--scale": String(spike.scale),
                  "--grow-delay": `${i * 28}ms`,
                } as CSSProperties
              }
            >
              <IcicleSvg
                color={spike.color}
                flip={spike.flip}
                variant={spike.variant}
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
