import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useFxScene } from "../../runtime";
import { useExpiringParticles } from "../../useExpiringParticles";
import type { DockEdge, DockPhase, PanelInset } from "../../types";
import { LeafSvg } from "./LeafSvg";
import {
  makeBushPart,
  makeExpandScatter,
  makeFall,
  makeFringe,
  type FringeLeaf,
  type FringeMode,
  type LeafParticle,
} from "./particles";
import "./leaf.css";

const DEFAULT_PANEL: PanelInset = { x: 20, y: 20, w: 60, h: 60 };
const EXPAND_FRINGE_DELAY_MS = 340;
/** Allow the bounded dock slide and overlay re-layout to settle before fringe. */
const COLLAPSE_STRIP_DELAY_MS = 340;

/**
 * Leaf visual theme for the fx overlay window.
 * Swap this module to replace the entire dock effect skin.
 */
export function LeafTheme() {
  const { particles, spawn, clear: clearParticles } = useExpiringParticles<LeafParticle>();
  const [fringe, setFringe] = useState<FringeLeaf[]>(() => []);
  const [fringeMode, setFringeMode] = useState<FringeMode | null>(null);
  const [edge, setEdge] = useState<DockEdge | null>(null);

  const panelRef = useRef<PanelInset>(DEFAULT_PANEL);
  const [panel, setPanel] = useState<PanelInset>(DEFAULT_PANEL);
  const prevPhase = useRef<DockPhase | null>(null);
  const activeRef = useRef(false);
  const staticOnlyRef = useRef(false);
  const fringeModeRef = useRef<FringeMode | null>(null);
  const fringeTimer = useRef<number | undefined>(undefined);
  const fringeGeneration = useRef(0);

  const cancelFringeTimer = () => {
    fringeGeneration.current += 1;
    window.clearTimeout(fringeTimer.current);
    fringeTimer.current = undefined;
  };

  const showFringe = (e: DockEdge, mode: FringeMode, count: number) => {
    if (!activeRef.current) return;
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

  useEffect(() => () => {
    activeRef.current = false;
    cancelFringeTimer();
    prevPhase.current = null;
    fringeModeRef.current = null;
  }, []);

  useFxScene({
    onScatter: ({ kind, edge: ed, panel: p }) => {
      if (!activeRef.current || staticOnlyRef.current || !ed) return;
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
    onSync: ({ active, staticOnly, edge: ed, panel: p }) => {
      activeRef.current = active || staticOnly;
      staticOnlyRef.current = staticOnly;
      if (!activeRef.current) {
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
    },
    onAmbient: ({ edge: ed, phase }) => {
      if (!activeRef.current || staticOnlyRef.current || !ed) return;
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
      if (!activeRef.current || !presented) {
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
        clearParticles();
        const mode = phase === "collapsed" ? "strip" : "screen";
        if (fringeModeRef.current !== mode || edge !== ed) {
          showFringe(ed, mode, phase === "collapsed" ? 12 : 10);
        }
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
    <div className="fx-root leaf-theme" aria-hidden style={bandStyle}>
      {edge && fringeMode ? (
        <div
          className={`fx-fringe-band fx-fringe-band-${edge} fx-fringe-${fringeMode}`}
        >
          {fringe.map((leaf) => (
            <span
              key={leaf.id}
              className={
                fringeMode === "screen"
                  ? `leaf-fringe leaf-edge-poke leaf-edge-poke-${edge}`
                  : `leaf-fringe leaf-fringe-${edge} leaf-fringe-strip`
              }
              style={
                {
                  "--along": `${leaf.along}%`,
                  "--offset": `${leaf.offset}px`,
                  "--rot": `${leaf.rot}deg`,
                  "--scale": String(leaf.scale),
                } as CSSProperties
              }
            >
              <LeafSvg color={leaf.color} flip={leaf.flip} />
            </span>
          ))}
        </div>
      ) : null}

      {particles.map((leaf) => (
        <span
          key={leaf.id}
          className={`leaf-particle leaf-${leaf.kind}${
            (leaf.rim ?? 0) > 0.35 ? " leaf-rim" : ""
          }`}
          style={
            {
              left: `${leaf.x}%`,
              top: `${leaf.y}%`,
              "--dx": `${leaf.dx}px`,
              "--dy": `${leaf.dy}px`,
              "--spin": `${leaf.spin}deg`,
              "--scale": String(leaf.scale),
              "--rot0": `${leaf.rot}deg`,
              "--dur": `${leaf.durationMs}ms`,
              width: leaf.size,
              height: leaf.size * 1.35,
            } as CSSProperties
          }
        >
          <LeafSvg color={leaf.color} />
        </span>
      ))}
    </div>
  );
}
