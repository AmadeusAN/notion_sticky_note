import { formatTaskDate, type Locale } from "../i18n";
import type { Task, TaskScheduleInput } from "../types";

export type ReminderPreset = "none" | "on_time" | "15m" | "1h" | "custom";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatLocalIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function offsetDateIso(days: number, base = new Date()): string {
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
  return formatLocalIsoDate(next);
}

export function todayIso(): string {
  return offsetDateIso(0);
}

export function formatDateTimeLocalInput(epochMs: number): string {
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return "";
  return `${formatLocalIsoDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function parseDateTimeLocalInput(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

export function buildDateSummary(schedule: {
  startDate?: string | null;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
}): string | null {
  const start = schedule.startDate?.trim() || null;
  if (!start) return null;
  const endRaw = schedule.endDate?.trim() || null;
  const end = endRaw && endRaw !== start ? endRaw : null;
  if (end) return `${start} → ${end}`;
  const startTime = schedule.startTime?.trim() || null;
  const endTime = schedule.endTime?.trim() || null;
  if (startTime && endTime) return `${start} ${startTime}–${endTime}`;
  if (startTime) return `${start} ${startTime}`;
  return start;
}

export function computePresetReminder(
  startDate: string | null,
  startTime: string | null,
  preset: Exclude<ReminderPreset, "custom">,
): number | null {
  if (preset === "none" || !startDate) return null;
  const [y, m, d] = startDate.split("-").map(Number);
  if (!y || !m || !d) return null;
  const [hh, mm] = (startTime || "09:00").split(":").map(Number);
  const anchor = new Date(y, m - 1, d, Number.isFinite(hh) ? hh : 9, Number.isFinite(mm) ? mm : 0, 0, 0);
  const offsetMs = preset === "15m" ? 15 * 60_000 : preset === "1h" ? 60 * 60_000 : 0;
  return anchor.getTime() - offsetMs;
}

export function validateSchedule(schedule: TaskScheduleInput): string | null {
  const startDate = schedule.startDate?.trim() || null;
  const endDate = schedule.endDate?.trim() || null;
  const startTime = schedule.startTime?.trim() || null;
  const endTime = schedule.endTime?.trim() || null;

  if (!startDate && endDate) return "请先选择开始日期";
  if (!startDate && (startTime || endTime)) return "请先设置日期再设置具体时间";
  if (startDate && endDate && endDate < startDate) return "结束日期不能早于开始日期";
  if (startTime && endTime && (!endDate || endDate === startDate) && endTime <= startTime) {
    return "结束时间必须晚于开始时间";
  }
  return null;
}

export function formatScheduleBadge(task: Pick<Task, "date" | "startDate" | "endDate" | "startTime" | "endTime">, locale: Locale): string | null {
  const summary =
    task.date ??
    buildDateSummary({
      startDate: task.startDate,
      endDate: task.endDate,
      startTime: task.startTime,
      endTime: task.endTime,
    });
  if (!summary) return null;
  return formatTaskDate(locale, summary);
}

export function formatReminderBadge(reminderAt: number, locale: Locale): string {
  const d = new Date(reminderAt);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}
