import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useLocale } from "../stores/languageStore";
import { useModeStore } from "../stores/modeStore";
import { ARCHIVE_GROUP_ID, type Task, type TaskScheduleInput, type TaskUpdateInput } from "../types";
import { todayIso } from "../services/taskDate";
import {
  computeCellFocusScore,
  computeFocusTrackWeights,
  computeRoiFramePct,
  computeSmoothLensState,
  computeTrackOffsetsPct,
} from "../services/calendarFocus";
import {
  addDays,
  applyDaySpanResizePreview,
  applyTaskMovePreview,
  clampResizeEndDate,
  computeMovedDateRange,
  diffDays,
  getMonthGridDays,
  getTaskSpan,
  getWeekDays,
  layoutMonthWeekBars,
  layoutTimedDayEvents,
  minutesToHHMM,
  parseIsoDate,
  parseTimeToMinutes,
  snapMinutes,
  toIsoDate,
  type TaskMovePreview,
  type TaskSpan,
} from "../services/calendarLayout";

export type CalendarMode = "month" | "week" | "day";

interface Props {
  tasks: Task[];
  selectedTaskId: string | null;
  externalFocusDayIso?: string | null;
  onSelectTask: (task: Task) => void;
  onToggleTask: (id: string) => Promise<void>;
  onRescheduleTask: (id: string, update: TaskUpdateInput) => Promise<unknown>;
  onCreateAtSchedule: (schedule: TaskScheduleInput) => void;
}

const HOUR_HEIGHT = 56;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface MoveDragState {
  task: Task;
  origSpan: TaskSpan | null;
  grabOffsetDays: number;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  active: boolean;
  targetKind: "month-day" | "allday" | "time" | "unscheduled" | null;
  targetDayIso: string | null;
  targetStartMin: number | null;
}

function isEditableLocalTask(task: Task): boolean {
  return task.groupId !== ARCHIVE_GROUP_ID;
}

function computeTimedTargetTimes(
  origSpan: TaskSpan | null,
  targetStartMin: number,
): { startTime: string; endTime: string } {
  const snappedStart = Math.max(0, Math.min(23 * 60 + 45, snapMinutes(targetStartMin, 15)));
  const prevStart = origSpan ? parseTimeToMinutes(origSpan.startTime) : null;
  const prevEnd = origSpan ? parseTimeToMinutes(origSpan.endTime) : null;
  const duration =
    prevStart !== null && prevEnd !== null && prevEnd > prevStart ? prevEnd - prevStart : 60;
  const endMin = Math.min(23 * 60 + 59, snappedStart + duration);
  return {
    startTime: minutesToHHMM(snappedStart),
    endTime: minutesToHHMM(endMin),
  };
}

export function CalendarView({
  tasks,
  selectedTaskId,
  externalFocusDayIso,
  onSelectTask,
  onToggleTask,
  onRescheduleTask,
  onCreateAtSchedule,
}: Props) {
  const l = useLocale();
  const [mode, setMode] = useState<CalendarMode>("month");
  const [weekSpan, setWeekSpan] = useState<5 | 7>(7);
  const [cursorIso, setCursorIso] = useState<string>(() => externalFocusDayIso || todayIso());

  useEffect(() => {
    if (externalFocusDayIso) setCursorIso(externalFocusDayIso);
  }, [externalFocusDayIso]);
  const [showUnscheduled, setShowUnscheduled] = useState(true);
  const focusStyle = useModeStore((s) => s.calendarFocusStyle);
  const focusSize = useModeStore((s) => s.calendarFocusSize);
  const toggleCalendarFocus = useModeStore((s) => s.toggleCalendarFocus);
  const focusActive = focusStyle !== "off";
  const [resizing, setResizing] = useState<{
    taskId: string;
    dayIso: string;
    startMin: number;
    endMin: number;
  } | null>(null);
  const [daySpanResize, setDaySpanResize] = useState<{
    taskId: string;
    startDate: string;
    origEndDate: string;
    previewEndDate: string;
    startTime: string | null;
    endTime: string | null;
    reminderAt: number | null;
  } | null>(null);
  const daySpanResizeRef = useRef(daySpanResize);
  daySpanResizeRef.current = daySpanResize;
  const [moveDrag, setMoveDrag] = useState<MoveDragState | null>(null);
  const moveDragRef = useRef(moveDrag);
  moveDragRef.current = moveDrag;
  const justResizedRef = useRef(false);

  const [nowMinutes, setNowMinutes] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  const timeScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const d = new Date();
      setNowMinutes(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if ((mode === "week" || mode === "day") && timeScrollRef.current) {
      timeScrollRef.current.scrollTop = 7.5 * HOUR_HEIGHT;
    }
  }, [mode]);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: PointerEvent) => {
      const col = document.querySelector<HTMLElement>(`.cal-time-col[data-day="${resizing.dayIso}"]`);
      if (!col) return;
      const rect = col.getBoundingClientRect();
      const relY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      const rawMin = (relY / HOUR_HEIGHT) * 60;
      const nextEnd = Math.max(resizing.startMin + 15, Math.min(24 * 60 - 1, snapMinutes(rawMin, 15)));
      setResizing((prev) => (prev ? { ...prev, endMin: nextEnd } : null));
    };
    const onUp = () => {
      const current = resizing;
      setResizing(null);
      if (!current) return;
      const endClamped = Math.min(23 * 60 + 59, current.endMin);
      void onRescheduleTask(current.taskId, {
        updateSchedule: true,
        startDate: current.dayIso,
        endDate: null,
        startTime: minutesToHHMM(current.startMin),
        endTime: minutesToHHMM(endClamped),
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [resizing, onRescheduleTask]);

  const isDaySpanResizing = Boolean(daySpanResize);
  useEffect(() => {
    if (!isDaySpanResizing) return;
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    const onMove = (e: PointerEvent) => {
      const curr = daySpanResizeRef.current;
      if (!curr) return;
      const elements = document.elementsFromPoint(e.clientX, e.clientY);
      let dayIso: string | null = null;
      for (const el of elements) {
        if (el instanceof HTMLElement && el.dataset.day && el.matches(".cal-day-cell, .cal-allday-cell")) {
          dayIso = el.dataset.day;
          break;
        }
      }
      if (!dayIso) return;
      const clampedEnd = clampResizeEndDate(curr.startDate, dayIso);
      if (clampedEnd === curr.previewEndDate) return;
      setDaySpanResize((prev) => (prev ? { ...prev, previewEndDate: clampedEnd } : null));
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDaySpanResize(null);
      }
    };

    const onUp = () => {
      const current = daySpanResizeRef.current;
      setDaySpanResize(null);
      justResizedRef.current = true;
      window.setTimeout(() => {
        justResizedRef.current = false;
      }, 0);
      if (current && current.previewEndDate !== current.origEndDate) {
        const isSingleDay = current.previewEndDate === current.startDate;
        void onRescheduleTask(current.taskId, {
          updateSchedule: true,
          startDate: current.startDate,
          endDate: isSingleDay ? null : current.previewEndDate,
          startTime: isSingleDay ? current.startTime : null,
          endTime: isSingleDay ? current.endTime : null,
          reminderAt: current.reminderAt,
        });
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerup", onUp);
    };
  }, [isDaySpanResizing, onRescheduleTask]);

  const today = todayIso();
  const cursorDate = useMemo(() => parseIsoDate(cursorIso) ?? new Date(), [cursorIso]);

  const spans = useMemo(() => {
    const list: TaskSpan[] = [];
    for (const task of tasks) {
      const span = getTaskSpan(task);
      if (span) list.push(span);
    }
    return list;
  }, [tasks]);

  const movePreview = useMemo<TaskMovePreview | null>(() => {
    if (
      !moveDrag?.active ||
      !moveDrag.targetDayIso ||
      !moveDrag.targetKind ||
      moveDrag.targetKind === "unscheduled"
    ) {
      return null;
    }
    const { task, origSpan, grabOffsetDays, targetKind, targetDayIso, targetStartMin } = moveDrag;
    if (targetKind === "time" && targetStartMin !== null) {
      const { startTime, endTime } = computeTimedTargetTimes(origSpan, targetStartMin);
      return {
        task,
        startDate: targetDayIso,
        endDate: targetDayIso,
        startTime,
        endTime,
        isTimed: true,
      };
    }
    if (origSpan?.isMultiDay) {
      const { startDate, endDate } = computeMovedDateRange(
        origSpan.startDate,
        origSpan.endDate,
        targetDayIso,
        grabOffsetDays,
      );
      return {
        task,
        startDate,
        endDate,
        startTime: null,
        endTime: null,
        isTimed: false,
      };
    }
    const preserveTime = targetKind === "month-day" && Boolean(origSpan?.isTimed);
    return {
      task,
      startDate: targetDayIso,
      endDate: targetDayIso,
      startTime: preserveTime ? origSpan?.startTime ?? null : null,
      endTime: preserveTime ? origSpan?.endTime ?? null : null,
      isTimed: preserveTime,
    };
  }, [moveDrag]);

  const effectiveSpans = useMemo(
    () => applyTaskMovePreview(applyDaySpanResizePreview(spans, daySpanResize), movePreview),
    [spans, daySpanResize, movePreview],
  );

  const unscheduled = useMemo(
    () =>
      tasks.filter(
        (task) => !task.completed && isEditableLocalTask(task) && getTaskSpan(task) === null,
      ),
    [tasks],
  );

  const monthHeading = useMemo(
    () =>
      new Intl.DateTimeFormat(l.locale, {
        year: "numeric",
        month: "long",
      }).format(cursorDate),
    [cursorDate, l.locale],
  );

  const weekdayShort = useMemo(() => {
    const mon = new Date(2026, 10, 23); // Monday
    const fmt = new Intl.DateTimeFormat(l.locale, { weekday: "short" });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i)));
  }, [l.locale]);

  const monthGrid = useMemo(
    () => getMonthGridDays(cursorDate.getFullYear(), cursorDate.getMonth()),
    [cursorDate],
  );
  const monthWeeks = useMemo(() => {
    const rows: string[][] = [];
    for (let i = 0; i < monthGrid.length; i += 7) rows.push(monthGrid.slice(i, i + 7));
    return rows;
  }, [monthGrid]);

  const defaultFocusCoord = useMemo(() => {
    for (let r = 0; r < monthWeeks.length; r++) {
      const c = monthWeeks[r].indexOf(today);
      if (c !== -1) return { col: c + 0.5, row: r + 0.5 };
    }
    return { col: 3.5, row: Math.max(1, monthWeeks.length) / 2 };
  }, [monthWeeks, today]);

  const defaultSmoothCoord = useMemo(
    () => ({
      x: defaultFocusCoord.col / 7,
      y: defaultFocusCoord.row / Math.max(1, monthWeeks.length),
    }),
    [defaultFocusCoord, monthWeeks.length],
  );

  const focusTargetRef = useRef<{ col: number; row: number }>(defaultFocusCoord);
  const focusCurrentRef = useRef<{ col: number; row: number }>(defaultFocusCoord);
  const smoothTargetRef = useRef<{ x: number; y: number }>(defaultSmoothCoord);
  const smoothCurrentRef = useRef<{ x: number; y: number }>(defaultSmoothCoord);
  const focusRafRef = useRef<number | null>(null);
  const monthViewportRef = useRef<HTMLDivElement>(null);
  const monthWeekdaysRef = useRef<HTMLDivElement>(null);
  const monthWeeksRef = useRef<HTMLDivElement>(null);
  const smoothBlurMaskRef = useRef<HTMLDivElement>(null);
  const roiFrameRef = useRef<HTMLDivElement>(null);
  const mosaicDomCacheRef = useRef<{
    cellContainers: HTMLElement[];
    dayCells: HTMLElement[];
    spanBars: HTMLElement[];
  }>({ cellContainers: [], dayCells: [], spanBars: [] });

  const refreshMosaicDomCache = useCallback(() => {
    const weeksEl = monthWeeksRef.current;
    if (!weeksEl) {
      mosaicDomCacheRef.current = { cellContainers: [], dayCells: [], spanBars: [] };
      return;
    }
    mosaicDomCacheRef.current = {
      cellContainers: Array.from(weeksEl.querySelectorAll<HTMLElement>(".cal-month-cells")),
      dayCells: Array.from(weeksEl.querySelectorAll<HTMLElement>(".cal-day-cell[data-col][data-row]")),
      spanBars: Array.from(weeksEl.querySelectorAll<HTMLElement>(".cal-span-bar[data-col-start][data-col-span]")),
    };
  }, []);

  const resetFocusStyles = useCallback(
    (activeStyle: "smooth" | "mosaic" | "off") => {
      const weeksEl = monthWeeksRef.current;
      const weekdaysEl = monthWeekdaysRef.current;
      const roiEl = roiFrameRef.current;
      const { cellContainers, dayCells, spanBars } = mosaicDomCacheRef.current;

      if (activeStyle !== "smooth") {
        if (weeksEl) weeksEl.style.removeProperty("transform");
        if (weekdaysEl) weekdaysEl.style.removeProperty("transform");
      }

      if (activeStyle !== "mosaic") {
        if (weekdaysEl) weekdaysEl.style.removeProperty("grid-template-columns");
        if (weeksEl) weeksEl.style.gridTemplateRows = `repeat(${Math.max(1, monthWeeks.length)}, minmax(0, 1fr))`;
        for (const container of cellContainers) {
          container.style.removeProperty("grid-template-columns");
        }
        for (const cell of dayCells) {
          cell.style.removeProperty("--cell-blur");
          cell.style.removeProperty("--cell-opacity");
          cell.style.removeProperty("--cell-focus");
          delete cell.dataset.focused;
        }
        for (const bar of spanBars) {
          const cs = Number(bar.dataset.colStart ?? 0);
          const span = Number(bar.dataset.colSpan ?? 1);
          bar.style.left = `calc(${(cs / 7) * 100}% + 3px)`;
          bar.style.width = `calc(${(span / 7) * 100}% - 6px)`;
        }
      }

      if (activeStyle === "off" && roiEl) {
        roiEl.style.opacity = "0";
      }
    },
    [monthWeeks.length],
  );

  const applySmoothFrame = useCallback(
    (x: number, y: number) => {
      const weeksEl = monthWeeksRef.current;
      const weekdaysEl = monthWeekdaysRef.current;
      const maskEl = smoothBlurMaskRef.current;
      const roiEl = roiFrameRef.current;
      if (!weeksEl) return;

      const s = computeSmoothLensState(x, y, Math.max(1, monthWeeks.length), 1.42, 1.38, focusSize);
      const tx = s.txCanvasPct.toFixed(3);
      const ty = s.tyCanvasPct.toFixed(3);
      weeksEl.style.transform = `translate3d(${tx}%, ${ty}%, 0)`;
      if (weekdaysEl) {
        weekdaysEl.style.transform = `translate3d(${tx}%, 0, 0)`;
      }
      if (maskEl) {
        maskEl.style.setProperty("--roi-left", `${s.maskLeftPct.toFixed(2)}%`);
        maskEl.style.setProperty("--roi-right", `${s.maskRightPct.toFixed(2)}%`);
        maskEl.style.setProperty("--roi-top", `${s.maskTopPct.toFixed(2)}%`);
        maskEl.style.setProperty("--roi-bottom", `${s.maskBottomPct.toFixed(2)}%`);
      }
      if (roiEl) {
        roiEl.style.left = `${s.frameLeftPct.toFixed(2)}%`;
        roiEl.style.top = `${s.frameTopPct.toFixed(2)}%`;
        roiEl.style.width = `${s.frameWidthPct.toFixed(2)}%`;
        roiEl.style.height = `${s.frameHeightPct.toFixed(2)}%`;
        roiEl.style.opacity = "1";
      }
    },
    [monthWeeks.length, focusSize],
  );

  const applyMosaicFrame = useCallback(
    (c: number, r: number) => {
      const weeksEl = monthWeeksRef.current;
      const weekdaysEl = monthWeekdaysRef.current;
      const roiEl = roiFrameRef.current;
      if (!weeksEl) return;

      const rowCount = Math.max(1, monthWeeks.length);
      const { cellContainers, dayCells, spanBars } = mosaicDomCacheRef.current;

      const colWeights = computeFocusTrackWeights(7, c, 1.15, 2.35);
      const rowWeights = computeFocusTrackWeights(rowCount, r, 1.05, 1.85);
      const colTemplate = colWeights.map((w) => `${w.toFixed(3)}fr`).join(" ");
      const rowTemplate = rowWeights.map((w) => `${w.toFixed(3)}fr`).join(" ");

      if (weekdaysEl) weekdaysEl.style.gridTemplateColumns = colTemplate;
      weeksEl.style.gridTemplateRows = rowTemplate;
      for (const container of cellContainers) {
        container.style.gridTemplateColumns = colTemplate;
      }

      for (const cell of dayCells) {
        const col = Number(cell.dataset.col);
        const row = Number(cell.dataset.row);
        const score = computeCellFocusScore(col, row, c, r, 1.35 * focusSize, 1.15 * focusSize);
        const blurPx = score >= 0.44 ? 0 : ((0.44 - score) / 0.44) * 2.6;
        const opacity = 0.48 + 0.52 * Math.min(1, score / 0.5);
        const glow = Math.max(0, (score - 0.44) / 0.56);
        cell.style.setProperty("--cell-blur", `${blurPx.toFixed(2)}px`);
        cell.style.setProperty("--cell-opacity", opacity.toFixed(3));
        cell.style.setProperty("--cell-focus", glow.toFixed(3));
        cell.dataset.focused = score >= 0.44 ? "true" : "false";
      }

      const colStops = computeTrackOffsetsPct(colWeights);
      const rowStops = computeTrackOffsetsPct(rowWeights);
      for (const bar of spanBars) {
        const cs = Math.max(0, Math.min(6, Number(bar.dataset.colStart ?? 0)));
        const span = Math.max(1, Math.min(7 - cs, Number(bar.dataset.colSpan ?? 1)));
        const leftPct = colStops[cs] ?? 0;
        const widthPct = (colStops[cs + span] ?? 100) - leftPct;
        bar.style.left = `calc(${leftPct.toFixed(3)}% + 3px)`;
        bar.style.width = `calc(${widthPct.toFixed(3)}% - 6px)`;
      }

      if (roiEl) {
        const frame = computeRoiFramePct(colStops, rowStops, c, r, 1.45 * focusSize, 1.2 * focusSize);
        roiEl.style.left = `${frame.leftPct.toFixed(2)}%`;
        roiEl.style.top = `${frame.topPct.toFixed(2)}%`;
        roiEl.style.width = `${frame.widthPct.toFixed(2)}%`;
        roiEl.style.height = `${frame.heightPct.toFixed(2)}%`;
        roiEl.style.opacity = "1";
      }
    },
    [monthWeeks.length, focusSize],
  );

  const startFocusSpring = useCallback(() => {
    if (focusRafRef.current !== null || focusStyle === "off") return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const step = () => {
      focusRafRef.current = null;
      if (focusStyle === "smooth") {
        const target = smoothTargetRef.current;
        const curr = smoothCurrentRef.current;
        const dx = target.x - curr.x;
        const dy = target.y - curr.y;
        if (reduced || (Math.abs(dx) < 0.0008 && Math.abs(dy) < 0.0008)) {
          smoothCurrentRef.current = { ...target };
          applySmoothFrame(target.x, target.y);
          return;
        }
        const next = { x: curr.x + dx * 0.16, y: curr.y + dy * 0.16 };
        smoothCurrentRef.current = next;
        applySmoothFrame(next.x, next.y);
        focusRafRef.current = window.requestAnimationFrame(step);
        return;
      }

      const target = focusTargetRef.current;
      const curr = focusCurrentRef.current;
      const dx = target.col - curr.col;
      const dy = target.row - curr.row;
      if (reduced || (Math.abs(dx) < 0.004 && Math.abs(dy) < 0.004)) {
        focusCurrentRef.current = { ...target };
        applyMosaicFrame(target.col, target.row);
        return;
      }
      const next = { col: curr.col + dx * 0.22, row: curr.row + dy * 0.22 };
      focusCurrentRef.current = next;
      applyMosaicFrame(next.col, next.row);
      focusRafRef.current = window.requestAnimationFrame(step);
    };
    focusRafRef.current = window.requestAnimationFrame(step);
  }, [focusStyle, applySmoothFrame, applyMosaicFrame]);

  useEffect(() => {
    if (focusRafRef.current !== null) {
      window.cancelAnimationFrame(focusRafRef.current);
      focusRafRef.current = null;
    }
    focusTargetRef.current = defaultFocusCoord;
    focusCurrentRef.current = defaultFocusCoord;
    smoothTargetRef.current = defaultSmoothCoord;
    smoothCurrentRef.current = defaultSmoothCoord;

    if (mode === "month") {
      refreshMosaicDomCache();
      resetFocusStyles(focusStyle);
      if (focusStyle === "smooth") {
        applySmoothFrame(defaultSmoothCoord.x, defaultSmoothCoord.y);
      } else if (focusStyle === "mosaic") {
        applyMosaicFrame(defaultFocusCoord.col, defaultFocusCoord.row);
      }
    }
    return () => {
      if (focusRafRef.current !== null) {
        window.cancelAnimationFrame(focusRafRef.current);
        focusRafRef.current = null;
      }
    };
  }, [
    mode,
    focusStyle,
    defaultFocusCoord,
    defaultSmoothCoord,
    refreshMosaicDomCache,
    resetFocusStyles,
    applySmoothFrame,
    applyMosaicFrame,
    spans.length,
  ]);

  useEffect(() => {
    if (mode !== "month") return;
    refreshMosaicDomCache();
    if (focusStyle === "mosaic") {
      applyMosaicFrame(focusCurrentRef.current.col, focusCurrentRef.current.row);
    }
  }, [
    mode,
    focusStyle,
    daySpanResize?.previewEndDate,
    movePreview?.startDate,
    movePreview?.endDate,
    refreshMosaicDomCache,
    applyMosaicFrame,
  ]);

  const beginDaySpanResize = (e: ReactPointerEvent, span: TaskSpan) => {
    e.preventDefault();
    e.stopPropagation();
    setDaySpanResize({
      taskId: span.task.id,
      startDate: span.startDate,
      origEndDate: span.endDate,
      previewEndDate: span.endDate,
      startTime: span.startTime,
      endTime: span.endTime,
      reminderAt: span.task.reminderAt ?? null,
    });
  };

  const renderSpanResizeHandle = (span: TaskSpan) => (
    <span
      className="cal-span-resize-handle"
      onPointerDown={(e) => beginDaySpanResize(e, span)}
      onClick={(e) => e.stopPropagation()}
      title={l.t("拖动调整结束日期")}
      aria-label={l.t("拖动调整结束日期")}
    >
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2 6h7.5M6.5 3l3 3-3 3" />
      </svg>
    </span>
  );

  const updateMonthFocusAtPoint = useCallback(
    (clientX: number, clientY: number) => {
      if (focusStyle === "off" || mode !== "month") return;

      if (focusStyle === "smooth") {
        const vpEl = monthViewportRef.current;
        if (!vpEl) return;
        const rect = vpEl.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
        if (
          Math.abs(x - smoothTargetRef.current.x) < 0.002 &&
          Math.abs(y - smoothTargetRef.current.y) < 0.002
        ) {
          return;
        }
        smoothTargetRef.current = { x, y };
        startFocusSpring();
        return;
      }

      const cell = document
        .elementsFromPoint(clientX, clientY)
        .find((el): el is HTMLElement => el instanceof HTMLElement && el.matches("[data-col][data-row]"));
      if (!cell) return;
      const col = Number(cell.dataset.col);
      const row = Number(cell.dataset.row);
      if (!Number.isFinite(col) || !Number.isFinite(row)) return;
      const nextTarget = { col: col + 0.5, row: row + 0.5 };
      if (
        Math.abs(nextTarget.col - focusTargetRef.current.col) < 0.01 &&
        Math.abs(nextTarget.row - focusTargetRef.current.row) < 0.01
      ) {
        return;
      }
      focusTargetRef.current = nextTarget;
      startFocusSpring();
    },
    [focusStyle, mode, startFocusSpring],
  );

  const handleMonthPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    updateMonthFocusAtPoint(e.clientX, e.clientY);
  };

  const beginTaskMoveDrag = (e: ReactPointerEvent, task: Task, span: TaskSpan | null) => {
    if (e.button !== 0 || !isEditableLocalTask(task)) return;
    if ((e.target as Element | null)?.closest("button, .cal-span-resize-handle, .cal-resize-handle")) {
      return;
    }
    e.preventDefault();
    let grabOffsetDays = 0;
    if (span && span.isMultiDay) {
      const hitCell = document
        .elementsFromPoint(e.clientX, e.clientY)
        .find(
          (el): el is HTMLElement =>
            el instanceof HTMLElement && Boolean(el.dataset.day) && el.matches(".cal-day-cell, .cal-allday-cell"),
        );
      if (hitCell?.dataset.day) {
        const spanLen = Math.max(0, diffDays(span.startDate, span.endDate));
        grabOffsetDays = Math.max(0, Math.min(spanLen, diffDays(span.startDate, hitCell.dataset.day)));
      }
    }
    setMoveDrag({
      task,
      origSpan: span,
      grabOffsetDays,
      startX: e.clientX,
      startY: e.clientY,
      clientX: e.clientX,
      clientY: e.clientY,
      active: false,
      targetKind: null,
      targetDayIso: null,
      targetStartMin: null,
    });
  };

  const applyDrop = useCallback(
    (
      task: Task,
      origSpan: TaskSpan | null,
      targetKind: "month-day" | "allday" | "time",
      targetDayIso: string,
      targetStartMin: number | null,
      grabOffsetDays: number,
    ) => {
      if (!isEditableLocalTask(task)) return;

      if (targetKind === "time" && targetStartMin !== null) {
        const { startTime, endTime } = computeTimedTargetTimes(origSpan, targetStartMin);
        if (
          origSpan &&
          !origSpan.isMultiDay &&
          origSpan.startDate === targetDayIso &&
          origSpan.startTime === startTime &&
          origSpan.endTime === endTime
        ) {
          return;
        }
        void onRescheduleTask(task.id, {
          updateSchedule: true,
          startDate: targetDayIso,
          endDate: null,
          startTime,
          endTime,
          reminderAt: task.reminderAt ?? null,
        });
        return;
      }

      if (origSpan?.isMultiDay) {
        const { startDate, endDate } = computeMovedDateRange(
          origSpan.startDate,
          origSpan.endDate,
          targetDayIso,
          grabOffsetDays,
        );
        if (startDate === origSpan.startDate && endDate === origSpan.endDate) return;
        void onRescheduleTask(task.id, {
          updateSchedule: true,
          startDate,
          endDate,
          startTime: null,
          endTime: null,
          reminderAt: task.reminderAt ?? null,
        });
        return;
      }

      const preserveTime = targetKind === "month-day" && Boolean(origSpan?.isTimed);
      if (origSpan && targetDayIso === origSpan.startDate && (preserveTime || !origSpan.isTimed)) {
        return;
      }
      void onRescheduleTask(task.id, {
        updateSchedule: true,
        startDate: targetDayIso,
        endDate: null,
        startTime: preserveTime ? origSpan?.startTime ?? null : null,
        endTime: preserveTime ? origSpan?.endTime ?? null : null,
        reminderAt: task.reminderAt ?? null,
      });
    },
    [onRescheduleTask],
  );

  const isMovingTask = Boolean(moveDrag);
  useEffect(() => {
    if (!isMovingTask) return;
    let cursorApplied = false;
    let prevCursor = "";
    let prevUserSelect = "";

    const hitTestTarget = (
      clientX: number,
      clientY: number,
      hasOrigSpan: boolean,
    ): Pick<MoveDragState, "targetKind" | "targetDayIso" | "targetStartMin"> => {
      const elements = document.elementsFromPoint(clientX, clientY);
      if (
        hasOrigSpan &&
        elements.some(
          (el) => el instanceof HTMLElement && el.matches('.cal-unscheduled, [data-unscheduled-drop="true"]'),
        )
      ) {
        return { targetKind: "unscheduled", targetDayIso: null, targetStartMin: null };
      }
      for (const el of elements) {
        if (!(el instanceof HTMLElement) || !el.dataset.day) continue;
        if (el.matches(".cal-day-cell")) {
          return { targetKind: "month-day", targetDayIso: el.dataset.day, targetStartMin: null };
        }
        if (el.matches(".cal-allday-cell")) {
          return { targetKind: "allday", targetDayIso: el.dataset.day, targetStartMin: null };
        }
        if (el.matches(".cal-time-col")) {
          const rect = el.getBoundingClientRect();
          const relY = Math.max(0, Math.min(rect.height, clientY - rect.top));
          const rawMin = (relY / HOUR_HEIGHT) * 60;
          const snappedStart = Math.max(0, Math.min(23 * 60 + 45, snapMinutes(rawMin, 15)));
          return { targetKind: "time", targetDayIso: el.dataset.day, targetStartMin: snappedStart };
        }
      }
      return { targetKind: null, targetDayIso: null, targetStartMin: null };
    };

    const onMove = (e: PointerEvent) => {
      const curr = moveDragRef.current;
      if (!curr) return;
      if (!curr.active && Math.hypot(e.clientX - curr.startX, e.clientY - curr.startY) < 5) {
        return;
      }
      if (!cursorApplied) {
        prevCursor = document.body.style.cursor;
        prevUserSelect = document.body.style.userSelect;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
        cursorApplied = true;
      }
      updateMonthFocusAtPoint(e.clientX, e.clientY);
      const target = hitTestTarget(e.clientX, e.clientY, curr.origSpan !== null);
      setMoveDrag((prev) =>
        prev
          ? {
              ...prev,
              active: true,
              clientX: e.clientX,
              clientY: e.clientY,
              ...target,
            }
          : null,
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMoveDrag(null);
      }
    };

    const onUp = () => {
      const current = moveDragRef.current;
      setMoveDrag(null);
      if (!current?.active) return;
      justResizedRef.current = true;
      window.setTimeout(() => {
        justResizedRef.current = false;
      }, 0);
      if (current.targetKind === "unscheduled" && current.origSpan !== null) {
        void onRescheduleTask(current.task.id, {
          updateSchedule: true,
          startDate: null,
          endDate: null,
          startTime: null,
          endTime: null,
          reminderAt: null,
        });
        return;
      }
      if (current.targetDayIso && current.targetKind && current.targetKind !== "unscheduled") {
        applyDrop(
          current.task,
          current.origSpan,
          current.targetKind,
          current.targetDayIso,
          current.targetStartMin,
          current.grabOffsetDays,
        );
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      if (cursorApplied) {
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevUserSelect;
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerup", onUp);
    };
  }, [isMovingTask, applyDrop, onRescheduleTask, updateMonthFocusAtPoint]);

  const isUnschedulingTarget = Boolean(moveDrag?.active && moveDrag.targetKind === "unscheduled");

  const activeDays = useMemo(() => {
    if (mode === "day") return [cursorIso];
    if (mode === "week") return getWeekDays(cursorIso, weekSpan);
    return monthGrid;
  }, [mode, cursorIso, weekSpan, monthGrid]);

  const stepNavigation = (direction: -1 | 1) => {
    if (mode === "month") {
      const next = new Date(cursorDate.getFullYear(), cursorDate.getMonth() + direction, 1);
      setCursorIso(toIsoDate(next));
    } else if (mode === "week") {
      setCursorIso(addDays(cursorIso, direction * 7));
    } else {
      setCursorIso(addDays(cursorIso, direction));
    }
  };

  return (
    <div className="calendar-root">
      <div className="calendar-toolbar">
        <div className="calendar-toolbar-left">
          <h2 className="calendar-heading">{monthHeading}</h2>
          <div className="calendar-nav-group">
            <button
              type="button"
              className="cal-nav-btn"
              aria-label={l.t("上一周期")}
              onClick={() => stepNavigation(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              className="cal-today-btn"
              onClick={() => {
                setCursorIso(today);
                focusTargetRef.current = defaultFocusCoord;
                smoothTargetRef.current = defaultSmoothCoord;
                if (focusActive && mode === "month") startFocusSpring();
              }}
            >
              {l.t("今天")}
            </button>
            <button
              type="button"
              className="cal-nav-btn"
              aria-label={l.t("下一周期")}
              onClick={() => stepNavigation(1)}
            >
              ›
            </button>
          </div>
        </div>

        <div className="calendar-toolbar-right">
          {mode === "week" && (
            <div className="cal-segmented cal-segmented-compact" role="group" aria-label={l.t("周天数")}>
              <button
                type="button"
                className={weekSpan === 5 ? "active" : ""}
                onClick={() => setWeekSpan(5)}
              >
                {l.t("5 天")}
              </button>
              <button
                type="button"
                className={weekSpan === 7 ? "active" : ""}
                onClick={() => setWeekSpan(7)}
              >
                {l.t("7 天")}
              </button>
            </div>
          )}

          <div className="cal-segmented" role="group" aria-label={l.t("日历视图模式")}>
            {(
              [
                ["month", l.t("月")],
                ["week", l.t("周")],
                ["day", l.t("日")],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                className={mode === m ? "active" : ""}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "month" && (
            <button
              type="button"
              className={`cal-drawer-toggle cal-focus-toggle${focusActive ? " active" : ""}`}
              aria-pressed={focusActive}
              title={l.t("切换日历动态聚焦与周边模糊")}
              onClick={() => toggleCalendarFocus()}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4.5 4.5" />
              </svg>
              <span>{l.t("动态聚焦")}</span>
            </button>
          )}

          <button
            type="button"
            data-unscheduled-drop="true"
            className={`cal-drawer-toggle${showUnscheduled ? " active" : ""}${isUnschedulingTarget ? " is-drop-target" : ""}`}
            aria-pressed={showUnscheduled}
            onClick={() => setShowUnscheduled((v) => !v)}
          >
            <span>{l.t("未排期")}</span>
            <span className="cal-badge">{l.number(unscheduled.length)}</span>
          </button>

          <button
            type="button"
            className="btn-primary cal-add-btn"
            onClick={() =>
              onCreateAtSchedule({
                startDate: cursorIso,
                endDate: null,
                startTime: null,
                endTime: null,
                reminderAt: null,
              })
            }
          >
            {l.t("＋ 新建日程")}
          </button>
        </div>
      </div>

      <div className="calendar-content">
        <div className="calendar-surface">
          {mode === "month" ? (
            <div
              className={`cal-month${focusStyle === "smooth" ? " is-focus-smooth" : focusStyle === "mosaic" ? " is-focus-mosaic" : ""}`}
            >
              <div className="cal-month-weekdays-clip">
                <div ref={monthWeekdaysRef} className="cal-month-weekdays">
                  {weekdayShort.map((label, idx) => (
                    <div key={idx} className="cal-weekday-cell">
                      {label}
                    </div>
                  ))}
                </div>
              </div>
              <div
                ref={monthViewportRef}
                className="cal-month-viewport"
                onPointerMove={handleMonthPointerMove}
              >
                <div
                  ref={monthWeeksRef}
                  className="cal-month-weeks"
                  style={
                    focusStyle === "mosaic"
                      ? undefined
                      : { gridTemplateRows: `repeat(${Math.max(1, monthWeeks.length)}, minmax(0, 1fr))` }
                  }
                >
                  {monthWeeks.map((weekDays, rowIndex) => {
                  const bars = layoutMonthWeekBars(weekDays, effectiveSpans);
                  const maxLane = bars.reduce((acc, bar) => Math.max(acc, bar.lane + 1), 0);
                  const visibleBars = bars.filter((b) => b.lane < 3);

                  return (
                    <div key={weekDays[0]} className="cal-month-week-row">
                      <div className="cal-month-cells">
                        {weekDays.map((dayIso, colIndex) => {
                          const dayObj = parseIsoDate(dayIso);
                          const isOtherMonth =
                            dayObj &&
                            (dayObj.getMonth() !== cursorDate.getMonth() ||
                              dayObj.getFullYear() !== cursorDate.getFullYear());
                          const isToday = dayIso === today;
                          const isDropTarget = Boolean(
                            movePreview && dayIso >= movePreview.startDate && dayIso <= movePreview.endDate,
                          );
                          const isSpanPreview = Boolean(
                            daySpanResize &&
                              dayIso >= daySpanResize.startDate &&
                              dayIso <= daySpanResize.previewEndDate,
                          );
                          const daySingles = effectiveSpans.filter(
                            (s) => !s.isMultiDay && s.startDate === dayIso,
                          );

                          return (
                            <div
                              key={dayIso}
                              data-day={dayIso}
                              data-col={colIndex}
                              data-row={rowIndex}
                              className={`cal-day-cell${isToday ? " is-today" : ""}${isOtherMonth ? " is-outside" : ""}${isDropTarget ? " is-drop-target" : ""}${isSpanPreview ? " is-span-preview" : ""}`}
                            >
                              <div className="cal-day-top">
                                <span className={`cal-day-num${isToday ? " is-today-pill" : ""}`}>
                                  {dayObj ? dayObj.getDate() : dayIso.slice(-2)}
                                </span>
                                <button
                                  type="button"
                                  className="cal-day-add"
                                  title={l.t("在此日新建任务")}
                                  aria-label={`${l.t("在此日新建任务")} ${dayIso}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onCreateAtSchedule({
                                      startDate: dayIso,
                                      endDate: null,
                                      startTime: null,
                                      endTime: null,
                                      reminderAt: null,
                                    });
                                  }}
                                >
                                  +
                                </button>
                              </div>
                              <div
                                className="cal-day-events"
                                style={{ paddingTop: `${Math.min(3, maxLane) * 23}px` }}
                              >
                                {daySingles.map((span) => {
                                  const task = span.task;
                                  const editable = isEditableLocalTask(task);
                                  const isResizingSpan = daySpanResize?.taskId === task.id;
                                  const isMovingPreview = Boolean(
                                    movePreview && movePreview.task.id === task.id,
                                  );
                                  const isUnschedulingSource = Boolean(
                                    isUnschedulingTarget && moveDrag?.task.id === task.id,
                                  );
                                  return (
                                    <div
                                      key={task.id}
                                      onPointerDown={(e) => beginTaskMoveDrag(e, task, span)}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (justResizedRef.current) return;
                                        onSelectTask(task);
                                      }}
                                      className={`cal-pill${task.completed ? " done" : ""}${task.notionId ? " is-notion" : ""}${selectedTaskId === task.id ? " is-selected" : ""}${isResizingSpan ? " is-resizing-span" : ""}${isMovingPreview ? " is-moving-preview" : ""}${isUnschedulingSource ? " is-dragging-source" : ""}`}
                                    >
                                      <button
                                        type="button"
                                        className="cal-mini-check"
                                        data-checked={task.completed}
                                        aria-checked={task.completed}
                                        role="checkbox"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void onToggleTask(task.id);
                                        }}
                                      />
                                      {span.startTime && (
                                        <span className="cal-pill-time">{span.startTime}</span>
                                      )}
                                      <span className="cal-pill-title">{task.title}</span>
                                      {(task.syncStatus === "synced" || task.syncStatus === "pending") && (
                                        <span
                                          className={`cal-sync-dot is-${task.syncStatus}`}
                                          aria-hidden="true"
                                          title={
                                            task.syncStatus === "synced"
                                              ? l.t("已同步到 Notion")
                                              : l.t("等待同步到 Notion")
                                          }
                                        >
                                          {task.syncStatus === "synced" ? "✓" : "↻"}
                                        </span>
                                      )}
                                      {editable && renderSpanResizeHandle(span)}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {visibleBars.length > 0 && (
                        <div className="cal-month-bars-overlay">
                          {visibleBars.map((bar) => {
                            const task = bar.task;
                            const editable = isEditableLocalTask(task);
                            const isResizingSpan = daySpanResize?.taskId === task.id;
                            const isMovingPreview = Boolean(
                              movePreview && movePreview.task.id === task.id,
                            );
                            const isUnschedulingSource = Boolean(
                              isUnschedulingTarget && moveDrag?.task.id === task.id,
                            );
                            const spanDays = diffDays(bar.span.startDate, bar.span.endDate) + 1;
                            return (
                              <div
                                key={`${bar.task.id}-${weekDays[0]}`}
                                data-col-start={bar.colStart}
                                data-col-span={bar.colSpan}
                                onPointerDown={(e) => beginTaskMoveDrag(e, task, bar.span)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (justResizedRef.current) return;
                                  onSelectTask(task);
                                }}
                                className={`cal-span-bar${task.completed ? " done" : ""}${task.notionId ? " is-notion" : ""}${bar.continuesLeft ? " cont-left" : ""}${bar.continuesRight ? " cont-right" : ""}${selectedTaskId === task.id ? " is-selected" : ""}${isResizingSpan ? " is-resizing-span" : ""}${isMovingPreview ? " is-moving-preview" : ""}${isUnschedulingSource ? " is-dragging-source" : ""}`}
                                style={{
                                  left: `calc(${(bar.colStart / 7) * 100}% + 3px)`,
                                  width: `calc(${(bar.colSpan / 7) * 100}% - 6px)`,
                                  top: `${28 + bar.lane * 22}px`,
                                }}
                              >
                                <button
                                  type="button"
                                  className="cal-mini-check"
                                  data-checked={task.completed}
                                  aria-checked={task.completed}
                                  role="checkbox"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void onToggleTask(task.id);
                                  }}
                                />
                                <span className="cal-pill-title">{task.title}</span>
                                {(task.syncStatus === "synced" || task.syncStatus === "pending") && (
                                  <span
                                    className={`cal-sync-dot is-${task.syncStatus}`}
                                    aria-hidden="true"
                                    title={
                                      task.syncStatus === "synced"
                                        ? l.t("已同步到 Notion")
                                        : l.t("等待同步到 Notion")
                                    }
                                  >
                                    {task.syncStatus === "synced" ? "✓" : "↻"}
                                  </span>
                                )}
                                {isResizingSpan && (
                                  <span className="cal-span-resize-badge">{spanDays}d</span>
                                )}
                                {editable && !bar.continuesRight && renderSpanResizeHandle(bar.span)}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>
                <div ref={smoothBlurMaskRef} className="cal-smooth-blur-mask" aria-hidden="true" />
                <div ref={roiFrameRef} className="cal-roi-frame" aria-hidden="true" />
              </div>
            </div>
          ) : (
            <div className="cal-timeline-root">
              <div
                className="cal-timeline-header"
                style={{ gridTemplateColumns: `56px repeat(${activeDays.length}, minmax(0, 1fr))` }}
              >
                <div className="cal-gutter-corner" />
                {activeDays.map((dayIso) => {
                  const d = parseIsoDate(dayIso);
                  const isToday = dayIso === today;
                  const weekdayLabel = d
                    ? new Intl.DateTimeFormat(l.locale, { weekday: "short" }).format(d)
                    : "";
                  return (
                    <div
                      key={dayIso}
                      className={`cal-tl-day-head${isToday ? " is-today" : ""}`}
                    >
                      <span className="cal-tl-weekday">{weekdayLabel}</span>
                      <span className={`cal-tl-daynum${isToday ? " is-today-pill" : ""}`}>
                        {d ? d.getDate() : dayIso.slice(-2)}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div
                className="cal-allday-row"
                style={{ gridTemplateColumns: `56px repeat(${activeDays.length}, minmax(0, 1fr))` }}
              >
                <div className="cal-allday-label">{l.t("全天")}</div>
                {activeDays.map((dayIso) => {
                  const allDayItems = effectiveSpans.filter(
                    (s) => !s.isTimed && s.startDate <= dayIso && dayIso <= s.endDate,
                  );
                  const isDropTarget = Boolean(
                    movePreview &&
                      !movePreview.isTimed &&
                      dayIso >= movePreview.startDate &&
                      dayIso <= movePreview.endDate,
                  );
                  const isSpanPreview = Boolean(
                    daySpanResize &&
                      dayIso >= daySpanResize.startDate &&
                      dayIso <= daySpanResize.previewEndDate,
                  );
                  return (
                    <div
                      key={dayIso}
                      data-day={dayIso}
                      className={`cal-allday-cell${isDropTarget ? " is-drop-target" : ""}${isSpanPreview ? " is-span-preview" : ""}`}
                    >
                      {allDayItems.map((span) => {
                        const editable = isEditableLocalTask(span.task);
                        const isResizingSpan = daySpanResize?.taskId === span.task.id;
                        const isMovingPreview = Boolean(
                          movePreview && movePreview.task.id === span.task.id,
                        );
                        const isUnschedulingSource = Boolean(
                          isUnschedulingTarget && moveDrag?.task.id === span.task.id,
                        );
                        return (
                          <div
                            key={span.task.id}
                            onPointerDown={(e) => beginTaskMoveDrag(e, span.task, span)}
                            onClick={() => {
                              if (justResizedRef.current) return;
                              onSelectTask(span.task);
                            }}
                            className={`cal-pill${span.task.completed ? " done" : ""}${span.task.notionId ? " is-notion" : ""}${selectedTaskId === span.task.id ? " is-selected" : ""}${isResizingSpan ? " is-resizing-span" : ""}${isMovingPreview ? " is-moving-preview" : ""}${isUnschedulingSource ? " is-dragging-source" : ""}`}
                          >
                            <button
                              type="button"
                              className="cal-mini-check"
                              data-checked={span.task.completed}
                              aria-checked={span.task.completed}
                              role="checkbox"
                              onClick={(e) => {
                                e.stopPropagation();
                                void onToggleTask(span.task.id);
                              }}
                            />
                            <span className="cal-pill-title">{span.task.title}</span>
                            {editable && dayIso === span.endDate && renderSpanResizeHandle(span)}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              <div className="cal-time-scroll" ref={timeScrollRef}>
                <div
                  className="cal-time-grid"
                  style={{
                    gridTemplateColumns: `56px repeat(${activeDays.length}, minmax(0, 1fr))`,
                    height: `${24 * HOUR_HEIGHT}px`,
                  }}
                >
                  <div className="cal-time-gutter">
                    {HOURS.map((h) => (
                      <div key={h} className="cal-hour-label" style={{ height: `${HOUR_HEIGHT}px` }}>
                        {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
                      </div>
                    ))}
                  </div>

                  {activeDays.map((dayIso) => {
                    const isToday = dayIso === today;
                    const isTimeDropTarget = Boolean(
                      moveDrag?.active && moveDrag.targetKind === "time" && moveDrag.targetDayIso === dayIso,
                    );
                    const dayTimed = layoutTimedDayEvents(dayIso, effectiveSpans, HOUR_HEIGHT);
                    return (
                      <div
                        key={dayIso}
                        data-day={dayIso}
                        className={`cal-time-col${isTimeDropTarget ? " is-drop-target" : ""}`}
                      >
                        {HOURS.map((h) => (
                          <div
                            key={h}
                            className="cal-hour-slot"
                            style={{ height: `${HOUR_HEIGHT}px` }}
                            onClick={() => {
                              const startTime = `${String(h).padStart(2, "0")}:00`;
                              const endTime = `${String(Math.min(23, h + 1)).padStart(2, "0")}:${h === 23 ? "59" : "00"}`;
                              onCreateAtSchedule({
                                startDate: dayIso,
                                endDate: null,
                                startTime,
                                endTime,
                                reminderAt: null,
                              });
                            }}
                          />
                        ))}

                        {isToday && (
                          <div
                            className="cal-now-line"
                            style={{ top: `${(nowMinutes / 60) * HOUR_HEIGHT}px` }}
                          >
                            <span className="cal-now-dot" />
                          </div>
                        )}

                        {dayTimed.map((ev) => {
                          const task = ev.task;
                          const editable = isEditableLocalTask(task);
                          const isResizingThis = resizing?.taskId === task.id;
                          const isMovingPreview = Boolean(
                            movePreview && movePreview.task.id === task.id,
                          );
                          const isUnschedulingSource = Boolean(
                            isUnschedulingTarget && moveDrag?.task.id === task.id,
                          );
                          const effectiveEnd = isResizingThis ? resizing.endMin : ev.endMin;
                          const height = isResizingThis
                            ? Math.max(((effectiveEnd - ev.startMin) / 60) * HOUR_HEIGHT, 22)
                            : ev.height;
                          const timeLabel = `${minutesToHHMM(ev.startMin)}–${minutesToHHMM(effectiveEnd)}`;

                          return (
                            <div
                              key={task.id}
                              onPointerDown={(e) => beginTaskMoveDrag(e, task, ev.span)}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (justResizedRef.current) return;
                                onSelectTask(task);
                              }}
                              className={`cal-timed-card${task.completed ? " done" : ""}${task.notionId ? " is-notion" : ""}${selectedTaskId === task.id ? " is-selected" : ""}${isMovingPreview ? " is-moving-preview" : ""}${isUnschedulingSource ? " is-dragging-source" : ""}`}
                              style={{
                                top: `${ev.top}px`,
                                height: `${height}px`,
                                left: `calc(${(ev.colIndex / ev.colCount) * 100}% + 3px)`,
                                width: `calc(${100 / ev.colCount}% - 6px)`,
                              }}
                            >
                              <div className="cal-timed-head">
                                <button
                                  type="button"
                                  className="cal-mini-check"
                                  data-checked={task.completed}
                                  aria-checked={task.completed}
                                  role="checkbox"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void onToggleTask(task.id);
                                  }}
                                />
                                <span className="cal-timed-title">{task.title}</span>
                              </div>
                              <span className="cal-timed-time">{timeLabel}</span>
                              {editable && (
                                <div
                                  className="cal-resize-handle"
                                  title={l.t("拖动调整时长")}
                                  onPointerDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setResizing({
                                      taskId: task.id,
                                      dayIso,
                                      startMin: ev.startMin,
                                      endMin: ev.endMin,
                                    });
                                  }}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {showUnscheduled && (
          <aside
            className={`cal-unscheduled${isUnschedulingTarget ? " is-drop-target" : ""}`}
            aria-label={l.t("未排期任务")}
          >
            <div className="cal-unscheduled-head">
              <h3>{l.t("未排期任务")}</h3>
              <span className="group-count">{l.number(unscheduled.length)}</span>
            </div>
            <p className="cal-unscheduled-hint">{l.t("拖动任务到日历格子即可快速排期")}</p>
            <div className="cal-unscheduled-list">
              {isUnschedulingTarget && (
                <div className="cal-unscheduled-drop-cue">
                  {l.t("松开即可清除日期并移至未排期")}
                </div>
              )}
              {unscheduled.length === 0 ? (
                <div className="board-empty">{l.t("全部本地任务均已排期")}</div>
              ) : (
                unscheduled.map((task) => {
                  const isDraggingSource = Boolean(moveDrag?.active && moveDrag.task.id === task.id);
                  return (
                    <div
                      key={task.id}
                      onPointerDown={(e) => beginTaskMoveDrag(e, task, null)}
                      onClick={() => {
                        if (justResizedRef.current) return;
                        onSelectTask(task);
                      }}
                      className={`cal-unscheduled-card${selectedTaskId === task.id ? " is-selected" : ""}${isDraggingSource ? " is-dragging-source" : ""}`}
                    >
                      <span className="cal-pill-title">{task.title}</span>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        )}
      </div>

      {moveDrag?.active && (
        <div
          className="cal-drag-ghost"
          style={{ left: `${moveDrag.clientX}px`, top: `${moveDrag.clientY}px` }}
          aria-hidden="true"
        >
          <span className="cal-drag-ghost-title">{moveDrag.task.title}</span>
          {isUnschedulingTarget ? (
            <span className="cal-drag-ghost-meta">{l.t("移至未排期")}</span>
          ) : movePreview ? (
            <span className="cal-drag-ghost-meta">
              {movePreview.endDate > movePreview.startDate
                ? `${movePreview.startDate.slice(5)} → ${movePreview.endDate.slice(5)}`
                : movePreview.isTimed && movePreview.startTime
                  ? `${movePreview.startDate.slice(5)} ${movePreview.startTime}`
                  : movePreview.startDate.slice(5)}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
