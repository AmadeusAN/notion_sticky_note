import { useEffect, useRef, type RefObject } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { themes } from "../themes";
import "../materials/paper-peel.js";

interface Props {
  hostRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
}

/** Decorative surfaces never own input, move the window, or change task content. */
export function NoteEdgeEffects({ hostRef, enabled }: Props) {
  const themeId = useSettingsStore((s) => s.theme);
  const paper = themes[themeId].surface === "paper";
  const layerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const layer = layerRef.current;
    const canvas = canvasRef.current;
    if (!host || !layer || !canvas) return;

    const preferences = [
      window.matchMedia("(prefers-reduced-motion: reduce)"),
      window.matchMedia("(prefers-reduced-transparency: reduce)"),
      window.matchMedia("(prefers-contrast: more)"),
      window.matchMedia("(forced-colors: active)"),
    ];
    let renderer: StickyPaperPeelController | undefined;
    let paletteFrame = 0;
    let frame = 0;
    let inside = false;
    let clientX = 0;
    let clientY = 0;
    let suppressed = false;
    let available = false;

    const rest = () => {
      inside = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      layer.style.setProperty("--edge-strength", "0");
      renderer?.setTarget(0, 0.5);
    };

    const configure = () => {
      rest();
      if (paletteFrame) cancelAnimationFrame(paletteFrame);
      paletteFrame = 0;
      renderer?.destroy();
      renderer = undefined;
      available = enabled && !document.hidden && !preferences.some((p) => p.matches);
      layer.dataset.active = String(available);
      if (available && paper) {
        renderer = window.StickyPaperPeel.create(host, canvas);
        // Parent theme CSS is applied in its effect; refresh after that commit.
        paletteFrame = requestAnimationFrame(() => {
          paletteFrame = 0;
          renderer?.refresh();
        });
      }
    };

    const paintPointer = () => {
      frame = 0;
      if (!inside || !available) return;
      const rect = host.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
      const resizeCorner = rect.width - x < 26 && rect.height - y < 26;
      if (paper) {
        // The entire right edge participates; controls and the resize corner stay flat.
        const reach = Math.min(180, rect.width * 0.42);
        const proximity = Math.max(0, 1 - (rect.width - x) / reach);
        const amount = suppressed || resizeCorner ? 0 : proximity * proximity * (3 - 2 * proximity);
        renderer?.setTarget(amount, y / rect.height);
      } else {
        // Broad activation, but light is masked to the rim instead of washing over text.
        const reach = Math.max(96, Math.min(160, Math.min(rect.width, rect.height) * 0.45));
        const distance = Math.min(x, y, rect.width - x, rect.height - y);
        const strength = Math.max(0, 1 - distance / reach);
        layer.style.setProperty("--edge-x", `${x}px`);
        layer.style.setProperty("--edge-y", `${y}px`);
        layer.style.setProperty("--edge-strength", String(strength));
      }
    };

    const point = (event: PointerEvent) => {
      if (event.pointerType === "touch" || !available) return;
      if (event.buttons !== 0) {
        rest();
        return;
      }
      inside = true;
      clientX = event.clientX;
      clientY = event.clientY;
      suppressed = event.target instanceof Element && !!event.target.closest(
        "button, input, textarea, select, [role=checkbox], .resize-handle",
      );
      if (!frame) frame = requestAnimationFrame(paintPointer);
    };

    configure();
    for (const preference of preferences) preference.addEventListener("change", configure);
    host.addEventListener("pointerenter", point, { passive: true });
    host.addEventListener("pointermove", point, { passive: true });
    host.addEventListener("pointerup", point, { passive: true });
    host.addEventListener("pointerleave", rest);
    host.addEventListener("pointerdown", rest);
    host.addEventListener("pointercancel", rest);
    window.addEventListener("blur", rest);
    const onVisibility = () => configure();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      rest();
      renderer?.destroy();
      for (const preference of preferences) preference.removeEventListener("change", configure);
      host.removeEventListener("pointerenter", point);
      host.removeEventListener("pointermove", point);
      host.removeEventListener("pointerup", point);
      host.removeEventListener("pointerleave", rest);
      if (paletteFrame) cancelAnimationFrame(paletteFrame);
      host.removeEventListener("pointerdown", rest);
      host.removeEventListener("pointercancel", rest);
      window.removeEventListener("blur", rest);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, paper, themeId, hostRef]);

  return (
    <div
      ref={layerRef}
      className="note-edge-effects"
      data-material={paper ? "paper" : "glass"}
      hidden={!enabled}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="note-paper-peel" />
      <div className="note-edge-glow" />
      <div className="note-edge-rim" />
    </div>
  );
}
