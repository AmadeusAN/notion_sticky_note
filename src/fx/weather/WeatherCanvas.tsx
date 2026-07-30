import { useEffect, useRef } from "react";
import { clampDpr } from "./motion";

export type WeatherFrameFn = (
  ctx: CanvasRenderingContext2D,
  dt: number,
  width: number,
  height: number,
  timeSec: number,
) => void;

interface Props {
  /** When false, rAF stops and canvas is cleared. */
  running?: boolean;
  className?: string;
  onFrame: WeatherFrameFn;
}

/**
 * Full-viewport transparent canvas with capped DPR and pause-on-inactive.
 */
export function WeatherCanvas({
  running = true,
  className,
  onFrame,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let raf = 0;
    let alive = true;
    let last = performance.now();
    let timeSec = 0;
    let cssW = 0;
    let cssH = 0;

    const resize = () => {
      const dpr = clampDpr(window.devicePixelRatio || 1);
      cssW = window.innerWidth;
      cssH = window.innerHeight;
      canvas.width = Math.max(1, Math.floor(cssW * dpr));
      canvas.height = Math.max(1, Math.floor(cssH * dpr));
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(document.documentElement);

    const tick = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(tick);
      if (!running) {
        last = now;
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      timeSec += dt;
      ctx.clearRect(0, 0, cssW, cssH);
      onFrameRef.current(ctx, dt, cssW, cssH, timeSec);
    };

    if (running) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      } catch {
        /* ignore */
      }
    };
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
