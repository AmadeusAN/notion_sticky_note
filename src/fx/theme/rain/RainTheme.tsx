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
import { RainSvg } from "./RainSvg";
import {
  makeBushPart,
  makeExpandScatter,
  makeFall,
  type RainParticle,
} from "./particles";
import "./rain.css";

const DEFAULT_PANEL: PanelInset = { x: 20, y: 20, w: 60, h: 60 };

/**
 * Weather theme: scatter + ambient fall only (no edge fringe).
 */
export function RainTheme() {
  const [particles, setParticles] = useState<RainParticle[]>([]);
  const panelRef = useRef<PanelInset>(DEFAULT_PANEL);

  const spawn = (batch: RainParticle[]) => {
    if (batch.length === 0) return;
    setParticles((list) => [...list, ...batch]);
    for (const drop of batch) {
      window.setTimeout(() => {
        setParticles((list) => list.filter((d) => d.id !== drop.id));
      }, drop.durationMs + 80);
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
          const n = Math.random() < 0.55 ? 3 : 2;
          spawn(
            Array.from({ length: n }, () =>
              makeFall(ed, "collapsed", inset),
            ),
          );
        } else {
          spawn([
            makeFall(ed, "expanded", inset),
            makeFall(ed, "expanded", inset),
          ]);
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
    <div className="fx-root rain-theme" aria-hidden>
      {particles.map((drop) => (
        <span
          key={drop.id}
          className={`rain-particle rain-${drop.kind}${
            (drop.rim ?? 0) > 0.35 ? " rain-rim" : ""
          }`}
          style={
            {
              left: `${drop.x}%`,
              top: `${drop.y}%`,
              "--dx": `${drop.dx}px`,
              "--dy": `${drop.dy}px`,
              "--spin": `${drop.spin}deg`,
              "--scale": String(drop.scale),
              "--rot0": `${drop.rot}deg`,
              "--dur": `${drop.durationMs}ms`,
              width: drop.size,
              height: drop.size * 3.2,
            } as CSSProperties
          }
        >
          <RainSvg color={drop.color} />
        </span>
      ))}
    </div>
  );
}
