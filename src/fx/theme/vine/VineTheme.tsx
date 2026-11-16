import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useFxScene } from "../../runtime";
import { useExpiringParticles } from "../../useExpiringParticles";
import type { DockEdge, DockPhase, PanelInset } from "../../types";
import { VineSvg } from "./VineSvg";
import {
  makeBushPart,
  makeExpandScatter,
  makeFall,
  makeFringe,
  type FringeVine,
  type FringeMode,
  type VineParticle,
} from "./particles";
import "./vine.css";

const DEFAULT_PANEL: PanelInset = { x: 20, y: 20, w: 60, h: 60 };
const EXPAND_FRINGE_DELAY_MS = 340;
/** Allow the bounded dock slide and overlay re-layout to settle before fringe. */
const COLLAPSE_STRIP_DELAY_MS = 340;

/**
 * Vine visual theme for the fx overlay window.
 * Swap this module to replace the entire dock effect skin.
 */
export function VineTheme() {
  const { particles, spawn, clear: clearParticles } = useExpiringParticles<VineParticle>();
  const [fringe, setFringe] = useState<FringeVine[]>(() => []);
  const [fringeMode, setFringeMode] = useState<FringeMode | null>(null);
  const [edge, setEdge] = useState<DockEdge | null>(null);

  const panelRef = useRef<PanelInset>(DEFAULT_PANEL);
  const [panel, setPanel] = useState<PanelInset>(DEFAULT_PANEL);
  const prevPhase = useRef<DockPhase | null>(null);
  const activeRef = useRef(false);
  const presentedRef = useRef(false);
  const staticOnlyRef = useRef(false);
  const fringeEdgeRef = useRef<DockEdge | null>(null);
  const fringeModeRef = useRef<FringeMode | null>(null);
  const fringeTimer = useRef<number | undefined>(undefined);
  const fringeGeneration = useRef(0);

  const cancelFringeTimer = () => {
    fringeGeneration.current += 1;
    window.clearTimeout(fringeTimer.current);
    fringeTimer.current = undefined;
  };

  const showFringe = (e: DockEdge, mode: FringeMode, count: number) => {
    if (!presentedRef.current) return;
    if (fringeModeRef.current === mode && fringeEdgeRef.current === e) return;
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

  useEffect(() => () => {
    activeRef.current = false;
    presentedRef.current = false;
    staticOnlyRef.current = false;
    cancelFringeTimer();
    prevPhase.current = null;
    fringeModeRef.current = null;
  }, []);

  useFxScene({
    onScatter: ({ kind, edge: ed, panel: p }) => {
      if (!activeRef.current || !ed) return;
      const inset = p && p.w > 0 && p.h > 0 ? p : DEFAULT_PANEL;
      panelRef.current = inset;
      setPanel(inset);
      setEdge(ed);
      spawn(
        kind === "collapse"
          ? makeBushPart(ed, inset)
          : makeExpandScatter(ed, inset),
      );
    },
    onSync: ({ active, staticOnly, phase, edge: ed, panel: p }) => {
      activeRef.current = active && !staticOnly;
      staticOnlyRef.current = staticOnly;
      presentedRef.current = active || staticOnly;
      if (!presentedRef.current) {
        cancelFringeTimer();
        clearParticles();
        clearFringe();
        prevPhase.current = null;
        setEdge(null);
        return;
      }
      if (ed) setEdge(ed);
      if (p && p.w > 0 && p.h > 0) {
        panelRef.current = p;
        setPanel(p);
      }
      if (staticOnly) {
        cancelFringeTimer();
        clearParticles();
        prevPhase.current = phase;
        if (ed && phase !== "free") {
          showFringe(ed, phase === "collapsed" ? "strip" : "screen", phase === "collapsed" ? 12 : 10);
        } else {
          clearFringe();
          setEdge(null);
        }
      }
    },
    onAmbient: ({ edge: ed, phase }) => {
      if (!activeRef.current || !ed) return;
      const inset = panelRef.current;
      if (phase === "collapsed") {
        const n = Math.random() < 0.45 ? 2 : 1;
        spawn(Array.from({ length: n }, () => makeFall(ed, "collapsed", inset)));
      } else {
        spawn([makeFall(ed, "expanded", inset)]);
      }
    },
    onDock: ({ phase, edge: ed, presented }) => {
      cancelFringeTimer();
      if (!presentedRef.current || !presented) {
        clearParticles();
        clearFringe();
        prevPhase.current = null;
        setEdge(null);
        return;
      }
      const was = prevPhase.current;
      prevPhase.current = phase;
      if (phase === "free" || !ed) {
        clearFringe();
        setEdge(null);
        return;
      }
      setEdge(ed);
      if (staticOnlyRef.current) {
        showFringe(ed, phase === "collapsed" ? "strip" : "screen", phase === "collapsed" ? 12 : 10);
        return;
      }
      const toExpanded = was === "collapsed" && phase === "expanded";
      const toCollapsed =
        (was === "expanded" && phase === "collapsed") ||
        ((was === null || was === "free") && phase === "collapsed");
      if (toExpanded || toCollapsed) {
        clearFringe();
        const generation = fringeGeneration.current;
        // Let the dock slide and overlay layout settle before growing fringe.
        fringeTimer.current = window.setTimeout(() => {
          if (!activeRef.current || generation !== fringeGeneration.current) return;
          fringeTimer.current = undefined;
          showFringe(ed, toExpanded ? "screen" : "strip", toExpanded ? 13 : 12);
        }, toExpanded ? EXPAND_FRINGE_DELAY_MS : COLLAPSE_STRIP_DELAY_MS);
      } else if (phase === "collapsed" && fringeModeRef.current == null) {
        showFringe(ed, "strip", 12);
      } else if (phase === "expanded" && fringeModeRef.current == null) {
        showFringe(ed, "screen", 10);
      }
    },
  });

  const bandStyle = {
    "--panel-x": `${panel.x}%`,
    "--panel-y": `${panel.y}%`,
    "--panel-w": `${panel.w}%`,
    "--panel-h": `${panel.h}%`,
  } as CSSProperties;

  return (
    <div className="fx-root vine-theme" aria-hidden style={bandStyle}>
      {edge && fringeMode ? (
        <div
          className={`fx-fringe-band fx-fringe-band-${edge} fx-fringe-${fringeMode}`}
        >
          {fringe.map((tendril) => (
            <span
              key={tendril.id}
              className={
                fringeMode === "screen"
                  ? `vine-fringe vine-edge-poke vine-edge-poke-${edge}`
                  : `vine-fringe vine-fringe-${edge} vine-fringe-strip`
              }
              style={
                {
                  "--along": `${tendril.along}%`,
                  "--offset": `${tendril.offset}px`,
                  "--rot": `${tendril.rot}deg`,
                  "--scale": String(tendril.scale),
                } as CSSProperties
              }
            >
              <VineSvg color={tendril.color} flip={tendril.flip} />
            </span>
          ))}
        </div>
      ) : null}

      {particles.map((tendril) => (
        <span
          key={tendril.id}
          className={`vine-particle vine-${tendril.kind}${
            (tendril.rim ?? 0) > 0.35 ? " vine-rim" : ""
          }`}
          style={
            {
              left: `${tendril.x}%`,
              top: `${tendril.y}%`,
              "--dx": `${tendril.dx}px`,
              "--dy": `${tendril.dy}px`,
              "--spin": `${tendril.spin}deg`,
              "--scale": String(tendril.scale),
              "--rot0": `${tendril.rot}deg`,
              "--dur": `${tendril.durationMs}ms`,
              width: tendril.size,
              height: tendril.size * 1.8,
            } as CSSProperties
          }
        >
          <VineSvg color={tendril.color} />
        </span>
      ))}
    </div>
  );
}
