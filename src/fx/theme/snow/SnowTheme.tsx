import { useEffect, useRef, useState, type CSSProperties } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  FX_EVENTS,
  type DockSnapshot,
  type FxAmbientPayload,
  type FxScatterPayload,
  type FxSyncPayload,
  type PanelInset,
} from "../../types";
import { SnowSvg } from "./SnowSvg";
import {
  makeBushPart,
  makeExpandScatter,
  makeFall,
  type SnowParticle,
} from "./particles";
import "./snow.css";

const DEFAULT_PANEL: PanelInset = { x: 20, y: 20, w: 60, h: 60 };

/**
 * Weather theme: scatter + ambient drift only (no edge fringe).
 */
export function SnowTheme() {
  const [particles, setParticles] = useState<SnowParticle[]>([]);
  const panelRef = useRef<PanelInset>(DEFAULT_PANEL);

  const spawn = (batch: SnowParticle[]) => {
    if (batch.length === 0) return;
    setParticles((list) => [...list, ...batch]);
    for (const flake of batch) {
      window.setTimeout(() => {
        setParticles((list) => list.filter((f) => f.id !== flake.id));
      }, flake.durationMs + 80);
    }
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

        spawn(
          kind === "collapse"
            ? makeBushPart(ed, inset)
            : makeExpandScatter(ed, inset),
        );
      });

      await add<FxSyncPayload>(FX_EVENTS.sync, (e) => {
        const { active, panel: p } = e.payload;
        if (!active) return;
        if (p && p.w > 0 && p.h > 0) {
          panelRef.current = p;
        }
      });

      await add<FxAmbientPayload>(FX_EVENTS.ambient, (e) => {
        const { edge: ed, phase } = e.payload;
        if (!ed) return;
        const inset = panelRef.current;
        if (phase === "collapsed") {
          const n = Math.random() < 0.5 ? 2 : 1;
          spawn(
            Array.from({ length: n }, () =>
              makeFall(ed, "collapsed", inset),
            ),
          );
        } else {
          spawn([makeFall(ed, "expanded", inset)]);
        }
      });

      await add<DockSnapshot>(FX_EVENTS.dock, () => {
        /* weather themes have no fringe */
      });
    })();

    return () => {
      alive = false;
      for (const u of unsubs) u();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fx-root snow-theme" aria-hidden>
      {particles.map((flake) => (
        <span
          key={flake.id}
          className={`snow-particle snow-${flake.kind}${
            (flake.rim ?? 0) > 0.35 ? " snow-rim" : ""
          }`}
          style={
            {
              left: `${flake.x}%`,
              top: `${flake.y}%`,
              "--dx": `${flake.dx}px`,
              "--dy": `${flake.dy}px`,
              "--spin": `${flake.spin}deg`,
              "--scale": String(flake.scale),
              "--rot0": `${flake.rot}deg`,
              "--dur": `${flake.durationMs}ms`,
              width: flake.size,
              height: flake.size,
            } as CSSProperties
          }
        >
          <SnowSvg color={flake.color} />
        </span>
      ))}
    </div>
  );
}
