import { describe, expect, it } from "vitest";
import {
  buildDateSummary,
  computePresetReminder,
  formatReminderBadge,
  formatScheduleBadge,
  offsetDateIso,
  validateSchedule,
} from "./taskDate";

describe("taskDate helpers", () => {
  it("formats single-day, multi-day, and timed schedules consistently", () => {
    expect(buildDateSummary({ startDate: "2026-11-24" })).toBe("2026-11-24");
    expect(buildDateSummary({ startDate: "2026-11-24", endDate: "2026-11-24" })).toBe("2026-11-24");
    expect(buildDateSummary({ startDate: "2026-11-24", endDate: "2026-11-27" })).toBe("2026-11-24 → 2026-11-27");
    expect(
      buildDateSummary({ startDate: "2026-11-24", startTime: "11:00", endTime: "15:00" }),
    ).toBe("2026-11-24 11:00–15:00");
    expect(
      formatScheduleBadge({ date: null, startDate: "2026-11-24", startTime: "09:30" }, "en"),
    ).toContain("09:30");
  });

  it("validates date ranges and same-day time bounds", () => {
    expect(
      validateSchedule({
        startDate: "2026-11-26",
        endDate: "2026-11-24",
        startTime: null,
        endTime: null,
        reminderAt: null,
      }),
    ).toBe("结束日期不能早于开始日期");
    expect(
      validateSchedule({
        startDate: "2026-11-24",
        endDate: null,
        startTime: "14:00",
        endTime: "13:00",
        reminderAt: null,
      }),
    ).toBe("结束时间必须晚于开始时间");
    expect(
      validateSchedule({
        startDate: "2026-11-24",
        endDate: "2026-11-25",
        startTime: "14:00",
        endTime: "09:00",
        reminderAt: null,
      }),
    ).toBeNull();
  });

  it("computes preset reminders relative to the task start anchor", () => {
    const onTime = computePresetReminder("2026-11-24", "10:30", "on_time")!;
    const before15 = computePresetReminder("2026-11-24", "10:30", "15m")!;
    const before1h = computePresetReminder("2026-11-24", "10:30", "1h")!;
    expect(onTime - before15).toBe(15 * 60_000);
    expect(onTime - before1h).toBe(60 * 60_000);
    expect(computePresetReminder("2026-11-24", null, "none")).toBeNull();
    expect(formatReminderBadge(onTime, "en").length).toBeGreaterThan(0);
    expect(offsetDateIso(1, new Date(2026, 10, 24))).toBe("2026-11-25");
  });
});
