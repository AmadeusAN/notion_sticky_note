import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";
import { createWeatherFrameLoop, type WeatherCanvasController } from "./frameLoop";
import { clampDpr } from "./motion";

export type WeatherFrameFn = (
  ctx: CanvasRenderingContext2D,
  dt: number,
  width: number,
  height: number,
  timeSec: number,
) => void;

interface Props {
  /** Authoritative scene activity; false immediately clears and sleeps. */
  running?: boolean;
  className?: string;
  onFrame: WeatherFrameFn;
  /** Omit for continuous weather; transient scenes supply their live count. */
  hasWork?: () => boolean;
  controllerRef?: MutableRefObject<WeatherCanvasController | null>;
}

/**
 * Full-viewport transparent canvas with capped DPR and pause-on-inactive.
 */
export function WeatherCanvas({
  running = false,
  className,
  onFrame,
  hasWork,
  controllerRef,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const callbacks = useRef({ running, onFrame, hasWork });
  callbacks.current = { running, onFrame, hasWork };
  const loopRef = useRef<WeatherCanvasController | null>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    let cssW = 0;
    let cssH = 0;
    let dpr = 0;
    let resizePending = true;
    let disposed = false;
    const clear = () => {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    };
    const resize = () => {
      resizePending = false;
      const nextDpr = clampDpr(window.devicePixelRatio || 1);
      const nextW = window.innerWidth;
      const nextH = window.innerHeight;
      if (cssW === nextW && cssH === nextH && dpr === nextDpr) return;
      cssW = nextW;
      cssH = nextH;
      dpr = nextDpr;
      const width = Math.max(1, Math.floor(cssW * dpr));
      const height = Math.max(1, Math.floor(cssH * dpr));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const loop = createWeatherFrameLoop({
      enabled: () => !disposed && callbacks.current.running,
      hasWork: () => resizePending || (callbacks.current.hasWork?.() ?? true),
      onFrame: (dt, timeSec) => {
        if (resizePending) resize();
        ctx.clearRect(0, 0, cssW, cssH);
        if (callbacks.current.hasWork?.() ?? true) {
          callbacks.current.onFrame(ctx, dt, cssW, cssH, timeSec);
        }
      },
      clear,
      request: (callback) => requestAnimationFrame(callback),
      cancel: (id) => cancelAnimationFrame(id),
      now: () => performance.now(),
    });
    loopRef.current = loop;
    if (controllerRef) controllerRef.current = loop;
    const notifyResize = () => {
      resizePending = true;
      loop.wake();
    };
    const ro = new ResizeObserver(notifyResize);
    ro.observe(document.documentElement);
    window.addEventListener("resize", notifyResize);
    let resolution: MediaQueryList | undefined;
    const watchDpr = () => {
      resolution?.removeEventListener("change", onDprChange);
      resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      resolution.addEventListener("change", onDprChange);
    };
    const onDprChange = () => {
      watchDpr();
      notifyResize();
    };
    watchDpr();
    resize();
    loop.wake();
    return () => {
      disposed = true;
      loop.stopAndClear();
      ro.disconnect();
      window.removeEventListener("resize", notifyResize);
      resolution?.removeEventListener("change", onDprChange);
      loopRef.current = null;
      if (controllerRef?.current === loop) controllerRef.current = null;
    };
  }, [controllerRef]);

  useEffect(() => {
    if (running) loopRef.current?.wake();
    else loopRef.current?.stopAndClear();
  }, [running]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        display: "block",
      }}
    />
  );
}
