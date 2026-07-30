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
/** Wait for jelly slide (~300ms) before strip fringe so FX has re-laid out. */
const COLLAPSE_STRIP_DELAY_MS = 340;

/**
 * Vine visual theme for the fx overlay window.
 * Swap this module to replace the entire dock effect skin.
 */
export function VineTheme() {
  const [particles, setParticles] = useState<VineParticle[]>([]);
  const [fringe, setFringe] = useState<FringeVine[]>([]);
  const [fringeMode, setFringeMode] = useState<FringeMode | null>(null);
  const [edge, setEdge] = useState<DockEdge | null>(null);

  const panelRef = useRef<PanelInset>(DEFAULT_PANEL);
  const [panel, setPanel] = useState<PanelInset>(DEFAULT_PANEL);
  const prevPhase = useRef<DockPhase>("free");
  const fringeModeRef = useRef<FringeMode | null>(null);
  const fringeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const spawn = (batch: VineParticle[]) => {
    if (batch.length === 0) return;
    setParticles((list) => [...list, ...batch]);
    for (const tendril of batch) {
      window.setTimeout(() => {
        setParticles((list) => list.filter((p) => p.id !== tendril.id));
      }, tendril.durationMs + 80);
    }
  };

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

        spawn(
          kind === "collapse"
            ? makeBushPart(ed, inset)
            : makeExpandScatter(ed, inset),
        );
      });

      await add<FxSyncPayload>(FX_EVENTS.sync, (e) => {
        const { active, edge: ed, panel: p } = e.payload;
        if (!active) {
          clearFringe();
          setEdge(null);
          return;
        }
        if (ed) setEdge(ed);
        if (p && p.w > 0 && p.h > 0) {
          panelRef.current = p;
          setPanel(p);
        }
      });

      await add<FxAmbientPayload>(FX_EVENTS.ambient, (e) => {
        const { edge: ed, phase } = e.payload;
        if (!ed) return;
        const inset = panelRef.current;
        if (phase === "collapsed") {
          const n = Math.random() < 0.45 ? 2 : 1;
          spawn(
            Array.from({ length: n }, () =>
              makeFall(ed, "collapsed", inset),
            ),
          );
        } else {
          spawn([makeFall(ed, "expanded", inset)]);
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
          return;
        }

        setEdge(ed);

        const toExpanded = was === "collapsed" && phase === "expanded";
        const toCollapsed =
          (was === "expanded" && phase === "collapsed") ||
          (was === "free" && phase === "collapsed");

        if (toExpanded) {
          clearFringe();
          // After expand slide settles; FX was already laid out at the expanded rect.
          fringeTimer.current = setTimeout(() => {
            showFringe(ed, "screen", 13);
          }, EXPAND_FRINGE_DELAY_MS);
        } else if (toCollapsed) {
          // Don't draw screen fringe mid-slide (FX stays put while main moves).
          // Wait until slide + keep_fx_overlay, then grow strip at the peek edge.
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
