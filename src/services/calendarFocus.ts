export function gaussianWeight(distance: number, sigma: number): number {
  if (sigma <= 0) return distance === 0 ? 1 : 0;
  return Math.exp(-(distance * distance) / (2 * sigma * sigma));
}

export function computeFocusTrackWeights(
  count: number,
  center: number,
  sigma: number,
  boost: number,
): number[] {
  const weights: number[] = [];
  for (let i = 0; i < count; i++) {
    const w = gaussianWeight(i + 0.5 - center, sigma);
    weights.push(1 + boost * w);
  }
  return weights;
}

/** Returns cumulative percentage stops of length `weights.length + 1` in [0, 100]. */
export function computeTrackOffsetsPct(weights: readonly number[]): number[] {
  const total = weights.reduce((acc, w) => acc + w, 0);
  if (total <= 0 || weights.length === 0) return [0];
  const stops: number[] = [0];
  let acc = 0;
  for (const w of weights) {
    acc += w;
    stops.push((acc / total) * 100);
  }
  stops[stops.length - 1] = 100;
  return stops;
}

export function computeCellFocusScore(
  col: number,
  row: number,
  centerCol: number,
  centerRow: number,
  sigmaX: number,
  sigmaY: number,
): number {
  return gaussianWeight(col + 0.5 - centerCol, sigmaX) * gaussianWeight(row + 0.5 - centerRow, sigmaY);
}

/** Interpolate any fractional track position `pos` in `[0, offsets.length - 1]` to `[0, 100]%`. */
export function sampleTrackPct(offsetsPct: readonly number[], pos: number): number {
  const maxIdx = offsetsPct.length - 1;
  if (maxIdx <= 0) return 0;
  const clamped = Math.max(0, Math.min(maxIdx, pos));
  const idx = Math.floor(clamped);
  if (idx >= maxIdx) return offsetsPct[maxIdx];
  const frac = clamped - idx;
  return offsetsPct[idx] + (offsetsPct[idx + 1] - offsetsPct[idx]) * frac;
}

export function computeRoiFramePct(
  colOffsetsPct: readonly number[],
  rowOffsetsPct: readonly number[],
  centerCol: number,
  centerRow: number,
  radiusCols = 1.45,
  radiusRows = 1.25,
): { leftPct: number; topPct: number; widthPct: number; heightPct: number } {
  const left = sampleTrackPct(colOffsetsPct, centerCol - radiusCols);
  const right = sampleTrackPct(colOffsetsPct, centerCol + radiusCols);
  const top = sampleTrackPct(rowOffsetsPct, centerRow - radiusRows);
  const bottom = sampleTrackPct(rowOffsetsPct, centerRow + radiusRows);
  return {
    leftPct: left,
    topPct: top,
    widthPct: Math.max(8, right - left),
    heightPct: Math.max(8, bottom - top),
  };
}

export interface SmoothLensState {
  txCanvasPct: number;
  tyCanvasPct: number;
  frameLeftPct: number;
  frameTopPct: number;
  frameWidthPct: number;
  frameHeightPct: number;
  maskCenterXPct: number;
  maskCenterYPct: number;
  maskRadiusXPct: number;
  maskRadiusYPct: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Compute GPU-only canvas translation, ROI highlight box, and radial blur cutout
 * for a uniformly zoomed calendar surface (`zoomX` x `zoomY`) panned by `[vpX, vpY]`.
 */
export function computeSmoothLensState(
  vpX: number,
  vpY: number,
  rowCount: number,
  zoomX = 1.42,
  zoomY = 1.38,
  roiScale = 1,
): SmoothLensState {
  const x = clamp(vpX, 0, 1);
  const y = clamp(vpY, 0, 1);
  const rows = Math.max(1, rowCount);
  const scale = clamp(roiScale, 0.65, 1.45);

  const dxView = (1 - zoomX) * x;
  const dyView = (1 - zoomY) * y;
  const txCanvasPct = (dxView / zoomX) * 100 || 0;
  const tyCanvasPct = (dyView / zoomY) * 100 || 0;

  const frameWidthPct = clamp((zoomX / 7) * 2.85 * scale * 100, 26, 86);
  const frameHeightPct = clamp((zoomY / rows) * 2.35 * scale * 100, 28, 86);
  const frameLeftPct = clamp(x * 100 - frameWidthPct / 2, 1.5, 98.5 - frameWidthPct);
  const frameTopPct = clamp(y * 100 - frameHeightPct / 2, 1.5, 98.5 - frameHeightPct);

  const maskCenterXPct = frameLeftPct + frameWidthPct / 2;
  const maskCenterYPct = frameTopPct + frameHeightPct / 2;
  const maskRadiusXPct = frameWidthPct * 0.56;
  const maskRadiusYPct = frameHeightPct * 0.56;

  return {
    txCanvasPct,
    tyCanvasPct,
    frameLeftPct,
    frameTopPct,
    frameWidthPct,
    frameHeightPct,
    maskCenterXPct,
    maskCenterYPct,
    maskRadiusXPct,
    maskRadiusYPct,
  };
}
