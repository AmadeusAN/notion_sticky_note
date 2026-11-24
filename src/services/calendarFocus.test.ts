import { describe, expect, it } from "vitest";
import {
  computeCellFocusScore,
  computeFocusTrackWeights,
  computeRoiFramePct,
  computeSmoothLensState,
  computeTrackOffsetsPct,
} from "./calendarFocus";

describe("calendarFocus", () => {
  it("expands the focused column/row symmetrically around the cursor center", () => {
    const weights = computeFocusTrackWeights(7, 3.5, 1.15, 2.3);
    expect(weights).toHaveLength(7);
    expect(weights[3]).toBeCloseTo(3.3, 5);
    expect(weights[2]).toBeCloseTo(weights[4], 5);
    expect(weights[0]).toBeLessThan(weights[2]);
    expect(weights[2]).toBeLessThan(weights[3]);

    const stops = computeTrackOffsetsPct(weights);
    expect(stops).toHaveLength(8);
    expect(stops[0]).toBe(0);
    expect(stops[7]).toBe(100);
    // Center column 3 should be wider than the far edge column 0.
    expect(stops[4] - stops[3]).toBeGreaterThan(stops[1] - stops[0]);
  });

  it("scores cells inside the ROI near 1 and distant cells low for peripheral blur", () => {
    const centerScore = computeCellFocusScore(3, 2, 3.5, 2.5, 1.35, 1.15);
    const neighborScore = computeCellFocusScore(4, 2, 3.5, 2.5, 1.35, 1.15);
    const farScore = computeCellFocusScore(0, 0, 3.5, 2.5, 1.35, 1.15);
    expect(centerScore).toBe(1);
    expect(neighborScore).toBeGreaterThan(0.6);
    expect(farScore).toBeLessThan(0.05);
  });

  it("computes bounded ROI lens frame percentages inside the calendar", () => {
    const colStops = computeTrackOffsetsPct(computeFocusTrackWeights(7, 3.5, 1.15, 2.3));
    const rowStops = computeTrackOffsetsPct(computeFocusTrackWeights(5, 2.5, 1.05, 1.8));
    const frame = computeRoiFramePct(colStops, rowStops, 3.5, 2.5);
    expect(frame.leftPct).toBeGreaterThan(15);
    expect(frame.leftPct + frame.widthPct).toBeLessThan(85);
    expect(frame.topPct).toBeGreaterThan(10);
    expect(frame.topPct + frame.heightPct).toBeLessThan(90);
  });

  it("computes GPU smooth lens translation, clamped ROI bounds, and blur cutout", () => {
    const topLeft = computeSmoothLensState(0, 0, 5, 1.42, 1.38);
    expect(topLeft.txCanvasPct).toBe(0);
    expect(topLeft.tyCanvasPct).toBe(0);
    expect(topLeft.frameLeftPct).toBeGreaterThanOrEqual(1.5);
    expect(topLeft.frameTopPct).toBeGreaterThanOrEqual(1.5);

    const center = computeSmoothLensState(0.5, 0.5, 5, 1.42, 1.38);
    expect(center.maskCenterXPct).toBeCloseTo(50, 2);
    expect(center.maskCenterYPct).toBeCloseTo(50, 2);

    const bottomRight = computeSmoothLensState(1, 1, 5, 1.42, 1.38);
    expect(bottomRight.txCanvasPct).toBeCloseTo(((1 - 1.42) / 1.42) * 100, 4);
    expect(bottomRight.tyCanvasPct).toBeCloseTo(((1 - 1.38) / 1.38) * 100, 4);
    expect(bottomRight.frameLeftPct + bottomRight.frameWidthPct).toBeLessThanOrEqual(98.5);
    expect(bottomRight.frameTopPct + bottomRight.frameHeightPct).toBeLessThanOrEqual(98.5);

    const compact = computeSmoothLensState(0.5, 0.5, 5, 1.42, 1.38, 0.7);
    const expanded = computeSmoothLensState(0.5, 0.5, 5, 1.42, 1.38, 1.35);
    expect(compact.frameWidthPct).toBeLessThan(center.frameWidthPct);
    expect(compact.frameHeightPct).toBeLessThan(center.frameHeightPct);
    expect(compact.maskRadiusXPct).toBeLessThan(center.maskRadiusXPct);
    expect(expanded.frameWidthPct).toBeGreaterThan(center.frameWidthPct);
    expect(expanded.frameHeightPct).toBeGreaterThan(center.frameHeightPct);
    expect(expanded.frameLeftPct).toBeGreaterThanOrEqual(1.5);
    expect(expanded.frameTopPct + expanded.frameHeightPct).toBeLessThanOrEqual(98.5);
  });
});
