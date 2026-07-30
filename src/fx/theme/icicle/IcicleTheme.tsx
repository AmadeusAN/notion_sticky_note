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
  const [running, setRunning] = useState(true);

  const panelRef = useRef<PanelInset>(DEFAULT_PANEL);
  const [panel, setPanel] = useState<PanelInset>(DEFAULT_PANEL);
  const prevPhase = useRef<DockPhase>("free");
  const fringeModeRef = useRef<FringeMode | null>(null);
  const fringeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fringeRef = useRef<FringeIcicle[]>([]);
  const edgeRef = useRef<DockEdge | null>(null);
  const modeRef = useRef<FringeMode | null>(null);
  const sizeRef = useRef({ w: window.innerWidth, h: window.innerHeight });
  const simRef = useRef(createIceAccentSim());

  const showFringe = (e: DockEdge, mode: FringeMode, count: number) => {
    const next = makeFringe(e, mode, count);
    fringeRef.current = next;
    setFringe(next);
    setFringeMode(mode);
    fringeModeRef.current = mode;
    modeRef.current = mode;
    setEdge(e);
    edgeRef.current = e;
  };

  const clearFringe = () => {
    fringeRef.current = [];
    setFringe([]);
    setFringeMode(null);
    fringeModeRef.current = null;
    modeRef.current = null;
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
        edgeRef.current = ed;
        sim.panel = inset;
        sim.edge = ed;
        const { w, h } = sizeRef.current;
        sim.scatterChips(ed, kind, w, h);
      });

      await add<FxSyncPayload>(FX_EVENTS.sync, (e) => {
        const { active, edge: ed, panel: p } = e.payload;
        sim.active = active;
        setRunning(active);
        if (!active) {
          clearFringe();
          setEdge(null);
          edgeRef.current = null;
          sim.clear();
          return;
        }
        if (ed) {
          setEdge(ed);
          edgeRef.current = ed;
          sim.edge = ed;
        }
        if (p && p.w > 0 && p.h > 0) {
          panelRef.current = p;
          setPanel(p);
          sim.panel = p;
        }
      });

      await add<FxAmbientPayload>(FX_EVENTS.ambient, (e) => {
        const { edge: ed, phase } = e.payload;
        if (!ed || !sim.active) return;
        edgeRef.current = ed;
        setEdge(ed);
        const { w, h } = sizeRef.current;
        if (modeRef.current && fringeRef.current.length > 0) {
          sim.fringeTips = computeFringeTips(
            ed,
            panelRef.current,
            fringeRef.current,
            modeRef.current,
            w,
            h,
          );
          const n = phase === "collapsed" ? (Math.random() < 0.45 ? 2 : 1) : 1;
          sim.spawnDrips(n);
        }
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
          edgeRef.current = null;
          return;
        }

        setEdge(ed);
        edgeRef.current = ed;

        const toExpanded = was === "collapsed" && phase === "expanded";
        const toCollapsed =
          (was === "expanded" && phase === "collapsed") ||
          (was === "free" && phase === "collapsed");

        if (toExpanded) {
          clearFringe();
          fringeTimer.current = setTimeout(() => {
            showFringe(ed, "screen", 13);
          }, EXPAND_FRINGE_DELAY_MS);
        } else if (toCollapsed) {
          clearFringe();
          fringeTimer.current = setTimeout(() => {
            showFringe(ed, "strip", 12);
          }, COLLAPSE_STRIP_DELAY_MS);
        } else if (phase === "collapsed" && fringeModeRef.current == null) {
          showFringe(ed, "strip", 12);
        } else if (phase === "expanded" && fringeModeRef.current == null) {
          showFringe(ed, "screen", 10);
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
