import { useEffect, useRef } from "react";
import { createSpring, stepSpring, clamp } from "../physics/spring";

/**
 * Sticky-note tilt:
 * - Hover / move over the note → gentle parallax toward the cursor
 * - Drag on the title bar → stronger tilt from movement deltas
 * - Always springs back (Tauri drag-region often eats pointerup / freezes moves)
 */
export function useNotePhysics(enabled = true) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    let rot = createSpring(0);
    let skew = createSpring(0);
    let raf = 0;
    let lastT = performance.now();
    let lastX = 0;
    let lastY = 0;
    let dragging = false;
    let pointerInside = false;
    let targetRot = 0;
    let targetSkew = 0;
    let dragStartedAt = 0;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const nearRest = () =>
      Math.abs(rot.x) < 0.04 &&
      Math.abs(skew.x) < 0.04 &&
      Math.abs(rot.v) < 0.015 &&
      Math.abs(skew.v) < 0.015 &&
      Math.abs(targetRot) < 0.04 &&
      Math.abs(targetSkew) < 0.04;

    const apply = () => {
      if (nearRest()) {
        el.style.transform = "";
        return;
      }
      el.style.transform = `rotate(${rot.x.toFixed(3)}deg) skewX(${skew.x.toFixed(3)}deg)`;
    };

    const ensureRaf = () => {
      if (!raf) {
        lastT = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };

    const setTargets = (rotT: number, skewT: number) => {
      targetRot = clamp(rotT, -8, 8);
      targetSkew = clamp(skewT, -5, 5);
      ensureRaf();
    };

    const clearSettleTimer = () => {
      if (settleTimer != null) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
    };

    const goHome = () => {
      dragging = false;
      clearSettleTimer();
      targetRot = 0;
      targetSkew = 0;
      ensureRaf();
    };

    /** If OS steals the gesture and moves stop, still return to rest. */
    const armDragSettle = () => {
      clearSettleTimer();
      settleTimer = setTimeout(() => {
        if (dragging) goHome();
      }, 240);
    };

    const tick = (now: number) => {
      const dt = Math.min(0.033, Math.max(0.001, (now - lastT) / 1000));
      lastT = now;
      rot = stepSpring(rot, targetRot, dt, 160, 16);
      skew = stepSpring(skew, targetSkew, dt, 150, 15);
      apply();

      if (nearRest() && !dragging) {
        raf = 0;
        el.style.transform = "";
        rot = createSpring(0);
        skew = createSpring(0);
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    const hoverTiltFromEvent = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const nx = (e.clientX - rect.left) / rect.width - 0.5;
      const ny = (e.clientY - rect.top) / rect.height - 0.5;
      setTargets(nx * 6.5, ny * 3.8 + nx * 1.4);
    };

    const onPointerEnter = () => {
      pointerInside = true;
    };

    const onPointerLeave = () => {
      pointerInside = false;
      if (!dragging) goHome();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (!target?.closest("[data-tauri-drag-region]")) return;
      dragging = true;
      dragStartedAt = performance.now();
      lastX = e.clientX;
      lastY = e.clientY;
      setTargets(2.6, 1.2);
      armDragSettle();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (dragging && e.buttons === 0) {
        // Ignore the immediate post-down "buttons cleared" from Tauri
        if (performance.now() - dragStartedAt < 120) {
          ensureRaf();
          return;
        }
        goHome();
        if (pointerInside) hoverTiltFromEvent(e);
        return;
      }

      if (dragging && e.buttons !== 0) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        setTargets(
          clamp(targetRot + dx * 0.45, -8, 8),
          clamp(targetSkew + dy * 0.18 + dx * 0.1, -5, 5),
        );
        armDragSettle();
        return;
      }

      if (pointerInside && e.buttons === 0) {
        hoverTiltFromEvent(e);
      }
    };

    const onPointerUp = () => {
      if (dragging) goHome();
    };

    const onBlur = () => goHome();
    const onVisibility = () => {
      if (document.hidden) goHome();
    };

    el.addEventListener("pointerenter", onPointerEnter);
    el.addEventListener("pointerleave", onPointerLeave);
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("lostpointercapture", onPointerUp);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearSettleTimer();
      el.removeEventListener("pointerenter", onPointerEnter);
      el.removeEventListener("pointerleave", onPointerLeave);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("lostpointercapture", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      if (raf) cancelAnimationFrame(raf);
      el.style.transform = "";
    };
  }, [enabled]);

  return { ref };
}
