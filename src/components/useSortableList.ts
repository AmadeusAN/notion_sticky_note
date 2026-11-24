import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

export interface ItemRect {
  top: number;
  height: number;
}

export function arrayMove<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function measureGap(rects: readonly ItemRect[]): number {
  if (rects.length < 2) return 0;
  return Math.max(0, rects[1].top - (rects[0].top + rects[0].height));
}

export function computeTargetIndex(
  rects: readonly ItemRect[],
  draggedIndex: number,
  draggedCenterY: number,
): number {
  if (rects.length <= 1 || draggedIndex < 0 || draggedIndex >= rects.length) {
    return Math.max(0, Math.min(draggedIndex, rects.length - 1));
  }
  const gap = measureGap(rects);
  const startTop = rects[0].top;
  const draggedHalf = rects[draggedIndex].height / 2;
  const others = rects.filter((_, index) => index !== draggedIndex);

  let bestIndex = draggedIndex;
  let bestDistance = Number.POSITIVE_INFINITY;
  let prefix = 0;

  for (let slot = 0; slot < rects.length; slot++) {
    const slotCenter = startTop + prefix + draggedHalf;
    const distance = Math.abs(draggedCenterY - slotCenter);
    // Small tie-breaker bias keeps current/original slot stable at exact midpoints.
    const adjusted = slot === draggedIndex ? distance - 0.5 : distance;
    if (adjusted < bestDistance) {
      bestDistance = adjusted;
      bestIndex = slot;
    }
    if (slot < others.length) {
      prefix += others[slot].height + gap;
    }
  }
  return bestIndex;
}

export function computeDisplacement(
  index: number,
  fromIndex: number,
  toIndex: number,
  rects: readonly ItemRect[],
): number {
  if (index === fromIndex || fromIndex === toIndex || rects.length < 2) return 0;
  const span = rects[fromIndex].height + measureGap(rects);
  if (fromIndex < toIndex && index > fromIndex && index <= toIndex) {
    return -span;
  }
  if (toIndex < fromIndex && index >= toIndex && index < fromIndex) {
    return span;
  }
  return 0;
}

export function computeSettleOffset(
  rects: readonly ItemRect[],
  fromIndex: number,
  toIndex: number,
): number {
  if (fromIndex === toIndex || rects.length < 2) return 0;
  const gap = measureGap(rects);
  let offset = 0;
  if (toIndex > fromIndex) {
    for (let i = fromIndex + 1; i <= toIndex; i++) {
      offset += rects[i].height + gap;
    }
  } else {
    for (let i = toIndex; i < fromIndex; i++) {
      offset -= rects[i].height + gap;
    }
  }
  return offset;
}

const DRAG_THRESHOLD_PX = 5;
const SETTLE_DURATION_MS = 190;
const SCROLL_EDGE_PX = 40;
const SCROLL_MAX_STEP_PX = 7;

interface DragSession {
  ids: string[];
  draggedIndex: number;
  targetIndex: number;
  rects: ItemRect[];
  dx: number;
  dy: number;
  phase: "dragging" | "settling";
}

export interface SortableItemProps {
  ref: (el: HTMLElement | null) => void;
  style?: CSSProperties;
  className: string;
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  "data-drag-active"?: "true";
}

interface Options {
  ids: readonly string[];
  disabled?: boolean;
  liftScale?: number;
  onReorder: (nextIds: string[]) => void;
  scrollContainerSelector?: string;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("button, input, textarea, select, a, [data-no-drag]"));
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useSortableList({
  ids,
  disabled = false,
  liftScale = 1.02,
  onReorder,
  scrollContainerSelector = ".task-list",
}: Options) {
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const [session, setSession] = useState<DragSession | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const cleanupListenersRef = useRef<(() => void) | null>(null);
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  const idsKey = ids.join("\0");

  const abortDrag = useCallback(() => {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    cleanupListenersRef.current?.();
    cleanupListenersRef.current = null;
    setSession(null);
  }, []);

  useEffect(() => {
    return () => abortDrag();
  }, [abortDrag]);

  useEffect(() => {
    if (disabled) {
      abortDrag();
    }
  }, [disabled, abortDrag]);

  useEffect(() => {
    if (!session) return;
    if (session.ids.length !== ids.length || session.ids.some((id, i) => id !== ids[i])) {
      abortDrag();
    }
  }, [idsKey, ids, session, abortDrag]);

  const setItemRef = useCallback((id: string) => (el: HTMLElement | null) => {
    if (el) itemRefs.current.set(id, el);
    else itemRefs.current.delete(id);
  }, []);

  const handlePointerDown = useCallback(
    (id: string) => (event: ReactPointerEvent<HTMLElement>) => {
      if (disabled || ids.length < 2 || session !== null) return;
      if (event.button !== 0 || !event.isPrimary) return;
      if (isInteractiveTarget(event.target)) return;

      const draggedIndex = ids.indexOf(id);
      if (draggedIndex === -1) return;

      const startX = event.clientX;
      const startY = event.clientY;
      const snapshotIds = [...ids];
      const hostEl = itemRefs.current.get(id);
      const scrollEl = hostEl?.closest(scrollContainerSelector) as HTMLElement | null;
      const startScrollTop = scrollEl?.scrollTop ?? 0;

      let activated = false;
      let activeRects: ItemRect[] = [];
      let currentTarget = draggedIndex;
      let latestClientX = startX;
      let latestClientY = startY;
      let scrollRafId: number | null = null;

      const stopScrollLoop = () => {
        if (scrollRafId !== null) {
          window.cancelAnimationFrame(scrollRafId);
          scrollRafId = null;
        }
      };

      const updateFrame = () => {
        const scrollDelta = (scrollEl?.scrollTop ?? 0) - startScrollTop;
        const dx = latestClientX - startX;
        const dy = latestClientY - startY + scrollDelta;
        const initialCenter = activeRects[draggedIndex].top + activeRects[draggedIndex].height / 2;
        const nextTarget = computeTargetIndex(activeRects, draggedIndex, initialCenter + dy);
        currentTarget = nextTarget;
        setSession({
          ids: snapshotIds,
          draggedIndex,
          targetIndex: nextTarget,
          rects: activeRects,
          dx,
          dy,
          phase: "dragging",
        });
      };

      const stepAutoScroll = () => {
        if (!activated || !scrollEl) {
          scrollRafId = null;
          return;
        }
        const bounds = scrollEl.getBoundingClientRect();
        let delta = 0;
        if (latestClientY < bounds.top + SCROLL_EDGE_PX) {
          const ratio = Math.min(1, (bounds.top + SCROLL_EDGE_PX - latestClientY) / SCROLL_EDGE_PX);
          delta = -Math.ceil(ratio * SCROLL_MAX_STEP_PX);
        } else if (latestClientY > bounds.bottom - SCROLL_EDGE_PX) {
          const ratio = Math.min(1, (latestClientY - (bounds.bottom - SCROLL_EDGE_PX)) / SCROLL_EDGE_PX);
          delta = Math.ceil(ratio * SCROLL_MAX_STEP_PX);
        }
        if (delta !== 0) {
          const prev = scrollEl.scrollTop;
          scrollEl.scrollTop = prev + delta;
          if (scrollEl.scrollTop !== prev) {
            updateFrame();
            scrollRafId = window.requestAnimationFrame(stepAutoScroll);
            return;
          }
        }
        scrollRafId = null;
      };

      const finish = (cancelled: boolean) => {
        stopScrollLoop();
        cleanupListenersRef.current?.();
        cleanupListenersRef.current = null;
        if (!activated) return;

        const finalTarget = cancelled ? draggedIndex : currentTarget;
        const settleY = computeSettleOffset(activeRects, draggedIndex, finalTarget);
        const changed = finalTarget !== draggedIndex;

        if (prefersReducedMotion()) {
          setSession(null);
          if (changed) {
            onReorderRef.current(arrayMove(snapshotIds, draggedIndex, finalTarget));
          }
          return;
        }

        setSession({
          ids: snapshotIds,
          draggedIndex,
          targetIndex: finalTarget,
          rects: activeRects,
          dx: 0,
          dy: settleY,
          phase: "settling",
        });

        settleTimerRef.current = window.setTimeout(() => {
          settleTimerRef.current = null;
          setSession(null);
          if (changed) {
            onReorderRef.current(arrayMove(snapshotIds, draggedIndex, finalTarget));
          }
        }, SETTLE_DURATION_MS);
      };

      const onPointerMove = (moveEvent: PointerEvent) => {
        latestClientX = moveEvent.clientX;
        latestClientY = moveEvent.clientY;
        const distX = latestClientX - startX;
        const distY = latestClientY - startY;

        if (!activated) {
          if (Math.hypot(distX, distY) < DRAG_THRESHOLD_PX) return;
          const scrollTop = scrollEl?.scrollTop ?? 0;
          const measured: ItemRect[] = [];
          for (const itemId of snapshotIds) {
            const el = itemRefs.current.get(itemId);
            if (!el) return;
            const rect = el.getBoundingClientRect();
            measured.push({ top: rect.top + scrollTop, height: rect.height });
          }
          activeRects = measured;
          activated = true;
          document.body.classList.add("is-sorting-pointer");
          window.getSelection()?.removeAllRanges();
        }

        moveEvent.preventDefault();
        updateFrame();
        if (scrollEl && scrollRafId === null) {
          scrollRafId = window.requestAnimationFrame(stepAutoScroll);
        }
      };

      const onPointerUp = () => finish(false);
      const onPointerCancel = () => finish(true);
      const onKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === "Escape") {
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          finish(true);
        }
      };

      const detach = () => {
        stopScrollLoop();
        document.body.classList.remove("is-sorting-pointer");
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);
        window.removeEventListener("keydown", onKeyDown, true);
      };
      cleanupListenersRef.current = detach;

      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
      window.addEventListener("keydown", onKeyDown, true);
    },
    [disabled, ids, session, scrollContainerSelector],
  );

  const isSorting = session !== null;

  const getItemProps = useCallback(
    (id: string): SortableItemProps => {
      const ref = setItemRef(id);
      const onPointerDown = !disabled && ids.length >= 2 ? handlePointerDown(id) : undefined;
      if (!session) {
        return { ref, className: "sortable-item", onPointerDown };
      }

      const index = session.ids.indexOf(id);
      if (index === session.draggedIndex) {
        const isDragging = session.phase === "dragging";
        const scale = isDragging ? liftScale : 1;
        const x = isDragging ? session.dx * 0.14 : 0;
        return {
          ref,
          className: `sortable-item ${isDragging ? "is-dragging" : "is-settling"}`,
          "data-drag-active": "true",
          style: {
            transform: `translate3d(${x.toFixed(1)}px, ${session.dy.toFixed(1)}px, 0) scale(${scale})`,
          },
          onPointerDown,
        };
      }

      const displacement = computeDisplacement(
        index,
        session.draggedIndex,
        session.targetIndex,
        session.rects,
      );
      return {
        ref,
        className: `sortable-item${displacement !== 0 ? " is-displaced" : ""}`,
        style: displacement !== 0
          ? { transform: `translate3d(0, ${displacement.toFixed(1)}px, 0)` }
          : undefined,
        onPointerDown,
      };
    },
    [disabled, handlePointerDown, ids.length, liftScale, session, setItemRef],
  );

  return { isSorting, getItemProps };
}
