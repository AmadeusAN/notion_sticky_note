import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { computeHomeSnapshot, getGreetingKey } from "./homeMetrics";

function makeTask(partial: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
    notionId: null,
    completed: false,
    progress: null,
    remain: null,
    date: null,
    tags: [],
    updatedTime: 1000,
    groupId: "local-1",
    ...partial,
  };
}

describe("homeMetrics", () => {
  it("maps hours to localized greeting keys", () => {
    expect(getGreetingKey(8)).toBe("早上好");
    expect(getGreetingKey(14)).toBe("下午好");
    expect(getGreetingKey(20)).toBe("晚上好");
    expect(getGreetingKey(1)).toBe("夜深了");
  });

  it("partitions today vs tomorrow, sorts incomplete timed first, and builds 7-day pulse", () => {
    const today = "2026-11-24";
    const nowMs = Date.UTC(2026, 10, 24, 9, 0, 0);

    const tasks: Task[] = [
      makeTask({
        id: "t-done",
        title: "Morning review",
        completed: true,
        startDate: today,
        startTime: "08:00",
      }),
      makeTask({
        id: "t-late",
        title: "All day today",
        startDate: today,
      }),
      makeTask({
        id: "t-early",
        title: "Standup",
        startDate: today,
        startTime: "10:00",
        reminderAt: nowMs + 3_600_000,
      }),
      makeTask({
        id: "t-tmr",
        title: "Interview tomorrow",
        startDate: "2026-11-25",
        startTime: "14:00",
        reminderAt: nowMs + 600_000,
      }),
      makeTask({
        id: "t-span",
        title: "Sprint span",
        startDate: "2026-11-24",
        endDate: "2026-11-26",
      }),
    ];

    const snap = computeHomeSnapshot(tasks, today, nowMs);
    expect(snap.todayTasks.map((t) => t.id)).toEqual(["t-early", "t-late", "t-span", "t-done"]);
    expect(snap.tomorrowTasks.map((t) => t.id)).toEqual(["t-tmr"]);
    expect(snap.todayDoneCount).toBe(1);
    expect(snap.todayTotalCount).toBe(4);
    expect(snap.todayProgress).toBe(0.25);
    expect(snap.nextReminder?.id).toBe("t-tmr");
    expect(snap.weeklyPulse).toHaveLength(7);
    expect(snap.weeklyPulse[0]).toEqual({
      dayIso: "2026-11-24",
      openCount: 3,
      doneCount: 1,
      totalCount: 4,
    });
    expect(snap.weeklyPulse[1]).toEqual({
      dayIso: "2026-11-25",
      openCount: 2,
      doneCount: 0,
      totalCount: 2,
    });
  });
});
