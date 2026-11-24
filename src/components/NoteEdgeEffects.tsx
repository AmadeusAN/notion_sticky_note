import { useEffect, useRef, type RefObject } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { themes } from "../themes";

interface Props {
  hostRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
}

/** Subtle edge glow on glass/card/motion sticky surfaces; flat paper surfaces stay clean. */
export function NoteEdgeEffects({ hostRef, enabled }: Props) {
  const themeId = useSettingsStore((s) => s.theme);
  const paper = themes[themeId].surface === "paper";
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const layer = layerRef.current;
    if (!host || !layer || paper) return;

    const preferences = [
      window.matchMedia("(prefers-reduced-motion: reduce)"),
      window.matchMedia("(prefers-reduced-transparency: reduce)"),
      window.matchMedia("(prefers-contrast: more)"),
      window.matchMedia("(forced-colors: active)"),
    ];
    let frame = 0;
    let inside = false;
    let clientX = 0;
    let clientY = 0;
    let available = false;

    const rest = () => {
      inside = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      layer.style.setProperty("--edge-strength", "0");
    };

    const configure = () => {
      rest();
      available = enabled && !document.hidden && !preferences.some((p) => p.matches);
      layer.dataset.active = String(available);
    };

    const paintPointer = () => {
      frame = 0;
      if (!inside || !available) return;
      const rect = host.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
      const reach = Math.max(96, Math.min(160, Math.min(rect.width, rect.height) * 0.45));
      const distance = Math.min(x, y, rect.width - x, rect.height - y);
      const strength = Math.max(0, 1 - distance / reach);
      layer.style.setProperty("--edge-x", `${x}px`);
      layer.style.setProperty("--edge-y", `${y}px`);
      layer.style.setProperty("--edge-strength", String(strength));
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
    document.addEventListener("visibilitychange", configure);

    return () => {
      rest();
      for (const preference of preferences) preference.removeEventListener("change", configure);
      host.removeEventListener("pointerenter", point);
      host.removeEventListener("pointermove", point);
      host.removeEventListener("pointerup", point);
      host.removeEventListener("pointerleave", rest);
      host.removeEventListener("pointerdown", rest);
      host.removeEventListener("pointercancel", rest);
      window.removeEventListener("blur", rest);
      document.removeEventListener("visibilitychange", configure);
    };
  }, [enabled, paper, themeId, hostRef]);

  if (paper) return null;

  return (
    <div
      ref={layerRef}
      className="note-edge-effects"
      data-material="glass"
      hidden={!enabled}
      aria-hidden="true"
    >
      <div className="note-edge-glow" />
      <div className="note-edge-rim" />
    </div>
  );
}
