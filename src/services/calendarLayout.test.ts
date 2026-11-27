import { describe, expect, it } from "vitest";
import type { Task } from "../types";
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
  snapMinutes,
} from "./calendarLayout";

const baseTask = (patch: Partial<Task>): Task => ({
  id: "t1",
  notionId: null,
  title: "Task",
  completed: false,
  progress: null,
  remain: null,
  date: null,
  tags: [],
  updatedTime: 1,
  groupId: "g1",
  ...patch,
});

describe("calendarLayout", () => {
  it("builds Monday-first month grids and 5/7-day weeks", () => {
    const nov2026 = getMonthGridDays(2026, 10); // Nov 1 2026 is Sunday -> Mon Oct 26 starts grid
    expect(nov2026[0]).toBe("2026-10-26");
    expect(nov2026.length % 7).toBe(0);
    expect(getWeekDays("2026-11-25", 7)).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ]);
    expect(getWeekDays("2026-11-25", 5).length).toBe(5);
    expect(addDays("2026-11-24", 3)).toBe("2026-11-27");
    expect(diffDays("2026-11-24", "2026-11-27")).toBe(3);
  });

  it("assigns non-overlapping lanes to multi-day month bars across week boundaries", () => {
    const week = getWeekDays("2026-11-25", 7);
    const s1 = getTaskSpan(baseTask({ id: "a", startDate: "2026-11-20", endDate: "2026-11-25" }))!;
    const s2 = getTaskSpan(baseTask({ id: "b", startDate: "2026-11-24", endDate: "2026-12-01" }))!;
    const s3 = getTaskSpan(baseTask({ id: "c", startDate: "2026-11-26", endDate: "2026-11-27" }))!;
    const bars = layoutMonthWeekBars(week, [s1, s2, s3]);
    expect(bars).toHaveLength(3);
    const barA = bars.find((b) => b.task.id === "a")!;
    const barB = bars.find((b) => b.task.id === "b")!;
    const barC = bars.find((b) => b.task.id === "c")!;
    expect(barA).toMatchObject({ colStart: 0, colSpan: 3, lane: 0, continuesLeft: true, continuesRight: false });
    expect(barB).toMatchObject({ colStart: 1, colSpan: 6, lane: 1, continuesLeft: false, continuesRight: true });
    // barC (Thu-Fri, cols 3-4) fits back into lane 0 since barA ended on Wed (col 2)!
    expect(barC).toMatchObject({ colStart: 3, colSpan: 2, lane: 0 });
  });

  it("splits overlapping timed events into side-by-side columns and snaps minutes", () => {
    const spans = [
      getTaskSpan(baseTask({ id: "t1", startDate: "2026-11-24", startTime: "09:00", endTime: "11:00" }))!,
      getTaskSpan(baseTask({ id: "t2", startDate: "2026-11-24", startTime: "10:00", endTime: "12:00" }))!,
      getTaskSpan(baseTask({ id: "t3", startDate: "2026-11-24", startTime: "14:00", endTime: "15:00" }))!,
    ];
    const events = layoutTimedDayEvents("2026-11-24", spans, 60);
    expect(events[0]).toMatchObject({ colIndex: 0, colCount: 2, top: 540, height: 120 });
    expect(events[1]).toMatchObject({ colIndex: 1, colCount: 2, top: 600, height: 120 });
    expect(events[2]).toMatchObject({ colIndex: 0, colCount: 1, top: 840, height: 60 });
    expect(snapMinutes(553, 15)).toBe(555);
    expect(minutesToHHMM(555)).toBe("09:15");
  });

  it("clamps resize end dates and previews live multi-day stretching/shrinking", () => {
    expect(clampResizeEndDate("2026-11-25", "2026-11-27")).toBe("2026-11-27");
    expect(clampResizeEndDate("2026-11-25", "2026-11-25")).toBe("2026-11-25");
    expect(clampResizeEndDate("2026-11-25", "2026-11-22")).toBe("2026-11-25");
    expect(clampResizeEndDate("2026-11-25", "not-a-date")).toBe("2026-11-25");

    const single = getTaskSpan(
      baseTask({ id: "s1", startDate: "2026-11-25", startTime: "10:00", endTime: "11:00" }),
    )!;
    const other = getTaskSpan(baseTask({ id: "s2", startDate: "2026-11-24" }))!;

    expect(applyDaySpanResizePreview([single, other], null)).toEqual([single, other]);

    const extended = applyDaySpanResizePreview([single, other], {
      taskId: "s1",
      startDate: "2026-11-25",
      previewEndDate: "2026-11-27",
    });
    expect(extended[0]).toMatchObject({
      startDate: "2026-11-25",
      endDate: "2026-11-27",
      isMultiDay: true,
      isTimed: false,
    });
    expect(extended[1]).toBe(other);

    const week = getWeekDays("2026-11-25", 7);
    const bars = layoutMonthWeekBars(week, extended);
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ colStart: 2, colSpan: 3 });

    const shrunk = applyDaySpanResizePreview(extended, {
      taskId: "s1",
      startDate: "2026-11-25",
      previewEndDate: "2026-11-25",
    });
    expect(shrunk[0]).toMatchObject({
      startDate: "2026-11-25",
      endDate: "2026-11-25",
      isMultiDay: false,
      isTimed: true,
    });
  });

  it("computes moved date ranges with grab offset and previews unscheduled & multi-day moves", () => {
    expect(computeMovedDateRange("2026-11-25", "2026-11-25", "2026-11-27", 0)).toEqual({
      startDate: "2026-11-27",
      endDate: "2026-11-27",
    });
    // 3-day bar (Nov 24..26) grabbed on middle day (offset = 1) and hovered over Nov 28 -> Nov 27..29
    expect(computeMovedDateRange("2026-11-24", "2026-11-26", "2026-11-28", 1)).toEqual({
      startDate: "2026-11-27",
      endDate: "2026-11-29",
    });

    const multi = getTaskSpan(baseTask({ id: "m1", startDate: "2026-11-24", endDate: "2026-11-26" }))!;
    const unschedTask = baseTask({ id: "u1", title: "Unscheduled task" });

    expect(applyTaskMovePreview([multi], null)).toEqual([multi]);

    const movedMulti = applyTaskMovePreview([multi], {
      task: multi.task,
      startDate: "2026-11-27",
      endDate: "2026-11-29",
      startTime: null,
      endTime: null,
      isTimed: false,
    });
    expect(movedMulti).toHaveLength(1);
    expect(movedMulti[0]).toMatchObject({
      startDate: "2026-11-27",
      endDate: "2026-11-29",
      isMultiDay: true,
      isTimed: false,
    });

    const scheduledPreview = applyTaskMovePreview([multi], {
      task: unschedTask,
      startDate: "2026-11-26",
      endDate: "2026-11-26",
      startTime: null,
      endTime: null,
      isTimed: false,
    });
    expect(scheduledPreview).toHaveLength(2);
    expect(scheduledPreview[1]).toMatchObject({
      task: unschedTask,
      startDate: "2026-11-26",
      endDate: "2026-11-26",
      isMultiDay: false,
      isTimed: false,
    });
  });
});
