import type { Task } from "../types";
import { addDays, getTaskSpan, parseTimeToMinutes } from "./calendarLayout";

export type GreetingKey = "早上好" | "下午好" | "晚上好" | "夜深了";

export interface HomePulseDay {
  dayIso: string;
  openCount: number;
  doneCount: number;
  totalCount: number;
}

export interface HomeSnapshot {
  todayTasks: Task[];
  tomorrowTasks: Task[];
  todayDoneCount: number;
  todayTotalCount: number;
  todayProgress: number;
  nextReminder: Task | null;
  weeklyPulse: HomePulseDay[];
}

export function getGreetingKey(hour: number): GreetingKey {
  if (hour >= 5 && hour < 12) return "早上好";
  if (hour >= 12 && hour < 18) return "下午好";
  if (hour >= 18 && hour < 23) return "晚上好";
  return "夜深了";
}

function compareScheduleTasks(a: Task, b: Task): number {
  if (a.completed !== b.completed) return a.completed ? 1 : -1;
  const aMin = parseTimeToMinutes(a.startTime) ?? 24 * 60 + 1;
  const bMin = parseTimeToMinutes(b.startTime) ?? 24 * 60 + 1;
  if (aMin !== bMin) return aMin - bMin;
  return a.updatedTime - b.updatedTime;
}

export function computeHomeSnapshot(
  tasks: readonly Task[],
  today: string,
  nowMs = Date.now(),
): HomeSnapshot {
  const tomorrow = addDays(today, 1);
  const pulseDays = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const pulseCounts = new Map<string, { openCount: number; doneCount: number }>(
    pulseDays.map((dayIso) => [dayIso, { openCount: 0, doneCount: 0 }]),
  );

  const todayTasks: Task[] = [];
  const todayIds = new Set<string>();
  const tomorrowCandidates: Task[] = [];
  let nextReminder: Task | null = null;

  for (const task of tasks) {
    if (
      !task.completed &&
      task.reminderAt != null &&
      task.reminderAt > nowMs &&
      !task.remindedAt
    ) {
      if (!nextReminder || task.reminderAt < (nextReminder.reminderAt ?? Infinity)) {
        nextReminder = task;
      }
    }

    const span = getTaskSpan(task);
    if (!span) continue;

    if (span.startDate <= today && today <= span.endDate) {
      todayTasks.push(task);
      todayIds.add(task.id);
    } else if (!task.completed && span.startDate <= tomorrow && tomorrow <= span.endDate) {
      tomorrowCandidates.push(task);
    }

    for (const dayIso of pulseDays) {
      if (span.startDate <= dayIso && dayIso <= span.endDate) {
        const entry = pulseCounts.get(dayIso)!;
        if (task.completed) entry.doneCount += 1;
        else entry.openCount += 1;
      }
    }
  }

  todayTasks.sort(compareScheduleTasks);
  const tomorrowTasks = tomorrowCandidates
    .filter((t) => !todayIds.has(t.id))
    .sort(compareScheduleTasks);

  const todayDoneCount = todayTasks.reduce((acc, t) => acc + Number(t.completed), 0);
  const todayTotalCount = todayTasks.length;
  const todayProgress = todayTotalCount === 0 ? 0 : todayDoneCount / todayTotalCount;

  const weeklyPulse: HomePulseDay[] = pulseDays.map((dayIso) => {
    const counts = pulseCounts.get(dayIso) ?? { openCount: 0, doneCount: 0 };
    return {
      dayIso,
      openCount: counts.openCount,
      doneCount: counts.doneCount,
      totalCount: counts.openCount + counts.doneCount,
    };
  });

  return {
    todayTasks,
    tomorrowTasks,
    todayDoneCount,
    todayTotalCount,
    todayProgress,
    nextReminder,
    weeklyPulse,
  };
}
