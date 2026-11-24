import type { Task } from "../types";

export interface TaskSpan {
  task: Task;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  isTimed: boolean;
  isMultiDay: boolean;
}

export interface MonthWeekBar {
  task: Task;
  span: TaskSpan;
  colStart: number; // 0..6
  colSpan: number; // 1..7
  lane: number;
  continuesLeft: boolean;
  continuesRight: boolean;
}

export interface TimedEventLayout {
  task: Task;
  span: TaskSpan;
  startMin: number;
  endMin: number;
  top: number;
  height: number;
  colIndex: number;
  colCount: number;
}

export interface DaySpanResizePreview {
  taskId: string;
  startDate: string;
  previewEndDate: string;
}

export function clampResizeEndDate(startDate: string, hoveredDayIso: string): string {
  if (!parseIsoDate(hoveredDayIso)) return startDate;
  if (!parseIsoDate(startDate)) return hoveredDayIso;
  return hoveredDayIso < startDate ? startDate : hoveredDayIso;
}

export function applyDaySpanResizePreview(
  spans: readonly TaskSpan[],
  preview: DaySpanResizePreview | null,
): TaskSpan[] {
  if (!preview) return spans as TaskSpan[];
  return spans.map((span) => {
    if (span.task.id !== preview.taskId) return span;
    const endDate = clampResizeEndDate(span.startDate, preview.previewEndDate);
    const isMultiDay = endDate > span.startDate;
    const isTimed = !isMultiDay && parseTimeToMinutes(span.startTime) !== null;
    return {
      ...span,
      endDate,
      isMultiDay,
      isTimed,
    };
  });
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function parseIsoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function addDays(iso: string, delta: number): string {
  const d = parseIsoDate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + delta);
  return toIsoDate(d);
}

export function diffDays(startIso: string, endIso: string): number {
  const s = parseIsoDate(startIso);
  const e = parseIsoDate(endIso);
  if (!s || !e) return 0;
  return Math.round((e.getTime() - s.getTime()) / 86_400_000);
}

/** Monday-first calendar grid (35 or 42 days covering the entire month). */
export function getMonthGridDays(year: number, monthIndex0: number): string[] {
  const first = new Date(year, monthIndex0, 1);
  const last = new Date(year, monthIndex0 + 1, 0);
  const firstWeekday = (first.getDay() + 6) % 7; // Mon=0 .. Sun=6
  const totalCells = firstWeekday + last.getDate() > 35 ? 42 : 35;
  const gridStart = new Date(year, monthIndex0, 1 - firstWeekday);
  const out: string[] = [];
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    out.push(toIsoDate(d));
  }
  return out;
}

/** Returns 7 (Mon..Sun) or 5 (Mon..Fri) ISO dates containing anchorIso. */
export function getWeekDays(anchorIso: string, span: 5 | 7 = 7): string[] {
  const d = parseIsoDate(anchorIso) ?? new Date();
  const mondayOffset = (d.getDay() + 6) % 7;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - mondayOffset);
  const days: string[] = [];
  for (let i = 0; i < span; i++) {
    days.push(toIsoDate(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)));
  }
  return days;
}

export function parseTimeToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function minutesToHHMM(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}`;
}

export function snapMinutes(totalMinutes: number, step = 15): number {
  return Math.max(0, Math.min(24 * 60, Math.round(totalMinutes / step) * step));
}

export function getTaskSpan(task: Task): TaskSpan | null {
  let startDate = task.startDate?.trim() || null;
  let endDate = task.endDate?.trim() || null;
  if (!startDate && task.date) {
    const matches = task.date.match(/\b\d{4}-\d{2}-\d{2}\b/g);
    if (matches && matches.length > 0) {
      startDate = matches[0];
      if (matches.length > 1 && matches[1] !== matches[0]) endDate = matches[1];
    }
  }
  if (!startDate || !parseIsoDate(startDate)) return null;
  if (endDate && (!parseIsoDate(endDate) || endDate < startDate)) endDate = null;
  const normalizedEnd = endDate ?? startDate;
  const isMultiDay = normalizedEnd > startDate;
  const startTime = task.startTime?.trim() || null;
  const endTime = startTime ? task.endTime?.trim() || null : null;
  const isTimed = !isMultiDay && parseTimeToMinutes(startTime) !== null;
  return {
    task,
    startDate,
    endDate: normalizedEnd,
    startTime,
    endTime,
    isTimed,
    isMultiDay,
  };
}

/**
 * Lay out multi-day task bars across a 7-day month row without overlapping lanes.
 */
export function layoutMonthWeekBars(weekDays: readonly string[], spans: readonly TaskSpan[]): MonthWeekBar[] {
  if (weekDays.length === 0) return [];
  const weekStart = weekDays[0];
  const weekEnd = weekDays[weekDays.length - 1];

  const multiDays = spans
    .filter((s) => s.isMultiDay && s.endDate >= weekStart && s.startDate <= weekEnd)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || b.endDate.localeCompare(a.endDate));

  const lanes: number[] = []; // tracks last occupied column per lane
  const bars: MonthWeekBar[] = [];

  for (const span of multiDays) {
    const colStart = span.startDate <= weekStart ? 0 : Math.max(0, diffDays(weekStart, span.startDate));
    const colEnd =
      span.endDate >= weekEnd
        ? weekDays.length - 1
        : Math.min(weekDays.length - 1, diffDays(weekStart, span.endDate));
    const colSpan = Math.max(1, colEnd - colStart + 1);

    let lane = lanes.findIndex((lastCol) => lastCol < colStart);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(colEnd);
    } else {
      lanes[lane] = colEnd;
    }

    bars.push({
      task: span.task,
      span,
      colStart,
      colSpan,
      lane,
      continuesLeft: span.startDate < weekStart,
      continuesRight: span.endDate > weekEnd,
    });
  }
  return bars;
}

/**
 * Lay out single-day timed tasks on a 24h vertical timeline with column splitting on collisions.
 */
export function layoutTimedDayEvents(
  dayIso: string,
  spans: readonly TaskSpan[],
  hourHeight: number,
): TimedEventLayout[] {
  const timed = spans
    .filter((s) => s.isTimed && s.startDate === dayIso)
    .map((span) => {
      const startMin = parseTimeToMinutes(span.startTime) ?? 9 * 60;
      const rawEnd = parseTimeToMinutes(span.endTime);
      const endMin = rawEnd !== null && rawEnd > startMin ? rawEnd : Math.min(24 * 60, startMin + 60);
      return { span, startMin, endMin };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  if (timed.length === 0) return [];

  // Partition into overlap clusters so non-overlapping groups use full width.
  const clusters: typeof timed[] = [];
  let current: typeof timed = [];
  let clusterEnd = -1;
  for (const item of timed) {
    if (current.length === 0 || item.startMin < clusterEnd) {
      current.push(item);
      clusterEnd = Math.max(clusterEnd, item.endMin);
    } else {
      clusters.push(current);
      current = [item];
      clusterEnd = item.endMin;
    }
  }
  if (current.length > 0) clusters.push(current);

  const result: TimedEventLayout[] = [];
  for (const cluster of clusters) {
    const colEndTimes: number[] = [];
    const placed: Array<{ item: (typeof timed)[number]; colIndex: number }> = [];
    for (const item of cluster) {
      let col = colEndTimes.findIndex((end) => end <= item.startMin);
      if (col === -1) {
        col = colEndTimes.length;
        colEndTimes.push(item.endMin);
      } else {
        colEndTimes[col] = item.endMin;
      }
      placed.push({ item, colIndex: col });
    }
    const colCount = Math.max(1, colEndTimes.length);
    for (const { item, colIndex } of placed) {
      const top = (item.startMin / 60) * hourHeight;
      const height = Math.max(((item.endMin - item.startMin) / 60) * hourHeight, 22);
      result.push({
        task: item.span.task,
        span: item.span,
        startMin: item.startMin,
        endMin: item.endMin,
        top,
        height,
        colIndex,
        colCount,
      });
    }
  }
  return result;
}
