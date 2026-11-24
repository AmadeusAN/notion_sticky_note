import { describe, expect, it } from "vitest";
import {
  arrayMove,
  computeDisplacement,
  computeSettleOffset,
  computeTargetIndex,
  type ItemRect,
} from "./useSortableList";

describe("useSortableList math", () => {
  it("moves elements cleanly without mutating the source array", () => {
    const source = ["a", "b", "c", "d"];
    expect(arrayMove(source, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(arrayMove(source, 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(arrayMove(source, 1, 1)).toEqual(["a", "b", "c", "d"]);
    expect(source).toEqual(["a", "b", "c", "d"]);
  });

  it("computes target index, sibling displacement, and exact settle offset for uniform heights", () => {
    const rects: ItemRect[] = [
      { top: 0, height: 48 },
      { top: 50, height: 48 },
      { top: 100, height: 48 },
    ];
    expect(computeTargetIndex(rects, 0, 24)).toBe(0);
    expect(computeTargetIndex(rects, 0, 76)).toBe(1);
    expect(computeTargetIndex(rects, 0, 128)).toBe(2);

    expect(computeDisplacement(0, 0, 2, rects)).toBe(0);
    expect(computeDisplacement(1, 0, 2, rects)).toBe(-50);
    expect(computeDisplacement(2, 0, 2, rects)).toBe(-50);

    expect(computeDisplacement(0, 2, 0, rects)).toBe(50);
    expect(computeDisplacement(1, 2, 0, rects)).toBe(50);

    expect(computeSettleOffset(rects, 0, 2)).toBe(100);
    expect(computeSettleOffset(rects, 2, 0)).toBe(-100);
  });

  it("handles variable-height groups symmetrically without visual overlap or oscillation", () => {
    // Tall group (180px), short group (60px), gap = 20px
    const rects: ItemRect[] = [
      { top: 0, height: 180 },
      { top: 200, height: 60 },
    ];
    // Slot 0 center = 90, slot 1 center = (60 + 20) + 90 = 170 -> swap boundary at 130.
    expect(computeTargetIndex(rects, 0, 125)).toBe(0);
    expect(computeTargetIndex(rects, 0, 135)).toBe(1);

    // Tall item drags past short item: short item moves up by -(180 + 20) = -200 (lands at 0..60)
    expect(computeDisplacement(1, 0, 1, rects)).toBe(-200);
    // Tall item settles down by +(60 + 20) = +80 (lands at 80..260, exact 20px gap below 0..60)
    expect(computeSettleOffset(rects, 0, 1)).toBe(80);
  });
});
