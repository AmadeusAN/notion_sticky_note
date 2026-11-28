export type AppIconPresetId = "c3" | "c2" | "c4" | "l3a" | "l3b" | "l3c" | "l3d";
export type AppIconId = AppIconPresetId | "custom";

export interface AppIconState {
  iconId: AppIconId;
  customDataUrl: string | null;
}

export interface AppIconPresetMeta {
  id: AppIconPresetId;
  mode: "dark" | "light";
  labelKey:
    | "图标 · 青金暗夜 (C3)"
    | "图标 · 亮角霓虹 (C2)"
    | "图标 · 无框暗卡 (C4)"
    | "图标 · 浮白微点青金 (L3-A)"
    | "图标 · 浮白微点青紫 (L3-B)"
    | "图标 · 浮白图谱青金 (L3-C)"
    | "图标 · 浮白图谱青紫 (L3-D)";
  shortLabel: string;
}

export const DEFAULT_APP_ICON_ID: AppIconPresetId = "c3";

export const APP_ICON_PRESETS: readonly AppIconPresetMeta[] = [
  { id: "c3", mode: "dark", labelKey: "图标 · 青金暗夜 (C3)", shortLabel: "C3" },
  { id: "c2", mode: "dark", labelKey: "图标 · 亮角霓虹 (C2)", shortLabel: "C2" },
  { id: "c4", mode: "dark", labelKey: "图标 · 无框暗卡 (C4)", shortLabel: "C4" },
  { id: "l3a", mode: "light", labelKey: "图标 · 浮白微点青金 (L3-A)", shortLabel: "L3-A" },
  { id: "l3b", mode: "light", labelKey: "图标 · 浮白微点青紫 (L3-B)", shortLabel: "L3-B" },
  { id: "l3c", mode: "light", labelKey: "图标 · 浮白图谱青金 (L3-C)", shortLabel: "L3-C" },
  { id: "l3d", mode: "light", labelKey: "图标 · 浮白图谱青紫 (L3-D)", shortLabel: "L3-D" },
] as const;

const SQUIRCLE_PATH =
  "M256,16 C400,16 496,16 496,256 C496,496 400,496 256,496 C112,496 16,496 16,256 C16,16 112,16 256,16 Z";
const FRONT_CARD_PATH =
  "M154,116 H308 L368,176 V382 C368,397 356,408 342,408 H154 C140,408 128,397 128,382 V142 C128,127 140,116 154,116 Z";
const FOLD_LINE_PATH = "M306,118 V178 H366";
const FOLD_TRI_PATH = "M308,116 L368,176 H316 C311,176 308,173 308,168 Z";
const BACK_CARD_RECT =
  '<rect x="158" y="88" width="224" height="288" rx="30" transform="rotate(8 270 232)"';

export function isAppIconPresetId(value: string): value is AppIconPresetId {
  return APP_ICON_PRESETS.some((p) => p.id === value);
}

export function normalizeAppIconId(value: string | null | undefined): AppIconId {
  if (value === "custom") return "custom";
  if (value && isAppIconPresetId(value)) return value;
  return DEFAULT_APP_ICON_ID;
}

export function buildPresetIconSvg(id: AppIconPresetId): string {
  if (id === "c3") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="c3_rim" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#88FFEA"/><stop offset="50%" stop-color="#70D6FF"/><stop offset="100%" stop-color="#FFD479"/>
    </linearGradient>
    <linearGradient id="c3_front" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#DDFFF8"/><stop offset="50%" stop-color="#6BFFE4"/><stop offset="100%" stop-color="#38CFFF"/>
    </linearGradient>
    <linearGradient id="c3_back" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FFE6A8"/><stop offset="100%" stop-color="#FFB84D"/>
    </linearGradient>
  </defs>
  <path d="${SQUIRCLE_PATH}" fill="#050609"/>
  <path d="${SQUIRCLE_PATH}" fill="none" stroke="url(#c3_rim)" stroke-width="10"/>
  ${BACK_CARD_RECT} fill="#110E08" stroke="url(#c3_back)" stroke-width="11"/>
  <path d="${FRONT_CARD_PATH}" fill="#06080D" stroke="url(#c3_front)" stroke-width="13" stroke-linejoin="round"/>
  <path d="${FOLD_LINE_PATH}" fill="none" stroke="#C8FFF4" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="196" cy="274" r="13" fill="#7AFFEA"/>
  <circle cx="248" cy="274" r="13" fill="#FFD479"/>
  <circle cx="300" cy="274" r="13" fill="#54D3FF"/>
  <line x1="184" y1="330" x2="312" y2="330" stroke="#59A89F" stroke-width="12" stroke-linecap="round"/>
</svg>`;
  }

  if (id === "c2") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="c2_rim" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/><stop offset="28%" stop-color="#76FFE8"/><stop offset="70%" stop-color="#4FC8FF"/><stop offset="100%" stop-color="#C6A6FF"/>
    </linearGradient>
    <linearGradient id="c2_front" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/><stop offset="35%" stop-color="#6DFFE6"/><stop offset="100%" stop-color="#38D0FF"/>
    </linearGradient>
    <linearGradient id="c2_corner" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#5BFFDF"/>
    </linearGradient>
  </defs>
  <path d="${SQUIRCLE_PATH}" fill="#040508"/>
  <path d="${SQUIRCLE_PATH}" fill="none" stroke="url(#c2_rim)" stroke-width="11"/>
  ${BACK_CARD_RECT} fill="#0A0C14" stroke="#A688FF" stroke-width="11"/>
  <path d="${FRONT_CARD_PATH}" fill="#06080D" stroke="url(#c2_front)" stroke-width="14" stroke-linejoin="round"/>
  <path d="${FOLD_TRI_PATH}" fill="url(#c2_corner)"/>
  <circle cx="196" cy="274" r="13" fill="#A6FFF0"/>
  <circle cx="248" cy="274" r="13" fill="#C4A6FF"/>
  <circle cx="300" cy="274" r="13" fill="#52D6FF"/>
  <line x1="184" y1="330" x2="312" y2="330" stroke="#5EB8AE" stroke-width="12" stroke-linecap="round"/>
</svg>`;
  }

  if (id === "c4") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="c4_front" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#E6FFF9"/><stop offset="45%" stop-color="#64FFE4"/><stop offset="100%" stop-color="#2FC6FF"/>
    </linearGradient>
    <linearGradient id="c4_back" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#D4BCFF"/><stop offset="100%" stop-color="#8A61FF"/>
    </linearGradient>
    <filter id="c4_shadow" x="-15%" y="-15%" width="130%" height="130%">
      <feDropShadow dx="0" dy="14" stdDeviation="14" flood-color="#000000" flood-opacity="0.38"/>
    </filter>
  </defs>
  <g filter="url(#c4_shadow)">
    <g transform="translate(256 256) scale(1.22) translate(-256 -256)">
      ${BACK_CARD_RECT} fill="#080A12" stroke="url(#c4_back)" stroke-width="12"/>
      <path d="${FRONT_CARD_PATH}" fill="#050609" stroke="url(#c4_front)" stroke-width="15" stroke-linejoin="round"/>
      <path d="${FOLD_TRI_PATH}" fill="#8CFFEE"/>
      <circle cx="196" cy="274" r="13.5" fill="#7DFFEA"/>
      <circle cx="248" cy="274" r="13.5" fill="#BE9EFF"/>
      <circle cx="300" cy="274" r="13.5" fill="#46CFFF"/>
      <line x1="184" y1="330" x2="312" y2="330" stroke="#5CB8AE" stroke-width="13" stroke-linecap="round"/>
    </g>
  </g>
</svg>`;
  }

  // Light L3 borderless variants: l3a, l3b, l3c, l3d
  const isAmber = id === "l3a" || id === "l3c";
  const isMicroBar = id === "l3a" || id === "l3b";

  const backGrad = isAmber
    ? '<stop offset="0%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#EA580C"/>'
    : '<stop offset="0%" stop-color="#8B5CF6"/><stop offset="100%" stop-color="#6D28D9"/>';
  const backFill = isAmber ? "#FFFBEB" : "#F5F3FF";
  const midDotColor = isAmber ? "#D97706" : "#7C3AED";
  const hairColor = isAmber ? "#0D9488" : "#6D28D9";

  const innerGlyph = isMicroBar
    ? `<circle cx="178" cy="314" r="8.5" fill="#0D9488"/>
      <circle cx="206" cy="314" r="8.5" fill="${midDotColor}"/>
      <circle cx="234" cy="314" r="8.5" fill="#0284C7"/>
      <line x1="170" y1="346" x2="254" y2="346" stroke="#64748B" stroke-width="9" stroke-linecap="round"/>`
    : `<line x1="184" y1="286" x2="236" y2="272" stroke="${hairColor}" stroke-width="4" stroke-opacity="0.42" stroke-linecap="round"/>
      <line x1="236" y1="272" x2="206" y2="330" stroke="${hairColor}" stroke-width="4" stroke-opacity="0.42" stroke-linecap="round"/>
      <line x1="184" y1="286" x2="206" y2="330" stroke="${hairColor}" stroke-width="4" stroke-opacity="0.28" stroke-linecap="round"/>
      <circle cx="184" cy="286" r="8.5" fill="#0D9488"/>
      <circle cx="236" cy="272" r="8.5" fill="${midDotColor}"/>
      <circle cx="206" cy="330" r="9.5" fill="#0284C7"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="${id}_front" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0D9488"/><stop offset="50%" stop-color="#0284C7"/><stop offset="100%" stop-color="#1D4ED8"/>
    </linearGradient>
    <linearGradient id="${id}_back" x1="0" y1="0" x2="1" y2="1">${backGrad}</linearGradient>
    <linearGradient id="${id}_corner" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0D9488"/><stop offset="100%" stop-color="#0284C7"/>
    </linearGradient>
    <filter id="${id}_shadow" x="-18%" y="-18%" width="136%" height="136%">
      <feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#0F172A" flood-opacity="0.22"/>
    </filter>
  </defs>
  <g filter="url(#${id}_shadow)">
    <g transform="translate(256 256) scale(1.22) translate(-256 -256)">
      ${BACK_CARD_RECT} fill="${backFill}" stroke="url(#${id}_back)" stroke-width="12"/>
      <path d="${FRONT_CARD_PATH}" fill="#FFFFFF" stroke="url(#${id}_front)" stroke-width="15" stroke-linejoin="round"/>
      <path d="${FOLD_TRI_PATH}" fill="url(#${id}_corner)"/>
      ${innerGlyph}
    </g>
  </g>
</svg>`;
}

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function presetIconDataUrl(id: AppIconPresetId): string {
  return svgToDataUrl(buildPresetIconSvg(id));
}

export function resolveAppIconDataUrl(
  iconId: AppIconId,
  customDataUrl: string | null | undefined,
): string {
  if (iconId === "custom" && customDataUrl && customDataUrl.startsWith("data:image/")) {
    return customDataUrl;
  }
  const preset = isAppIconPresetId(iconId) ? iconId : DEFAULT_APP_ICON_ID;
  return presetIconDataUrl(preset);
}

const ALLOWED_ICON_EXTS = /\.(png|jpe?g|webp|svg|ico)$/i;
const ALLOWED_ICON_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);
export const MAX_UPLOAD_ICON_BYTES = 5 * 1024 * 1024;

export function validateCustomIconFile(file: {
  type: string;
  name: string;
  size: number;
}): string | null {
  if (!ALLOWED_ICON_MIMES.has(file.type) && !ALLOWED_ICON_EXTS.test(file.name)) {
    return "请选择 PNG、JPG、WebP、SVG 或 ICO 格式的图标图片。";
  }
  if (file.size <= 0) {
    return "图标文件为空，无法读取。";
  }
  if (file.size > MAX_UPLOAD_ICON_BYTES) {
    return "图标文件不能超过 5 MB。";
  }
  return null;
}

export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("图标读取失败"));
    };
    reader.onerror = () => reject(new Error("图标读取失败"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("无法解析该图标图片"));
    img.src = src;
  });
}

function drawContainedRgba(img: HTMLImageElement, size: number): {
  rgba: number[];
  canvas: HTMLCanvasElement;
} {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { rgba: new Array(size * size * 4).fill(0), canvas };
  }
  const w = img.naturalWidth || size;
  const h = img.naturalHeight || size;
  const scale = Math.min(size / w, size / h);
  const drawW = w * scale;
  const drawH = h * scale;
  const offsetX = (size - drawW) / 2;
  const offsetY = (size - drawH) / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
  const data = ctx.getImageData(0, 0, size, size).data;
  return { rgba: Array.from(data), canvas };
}

export async function rasterizeIconDataUrl(src: string): Promise<{
  rgba128: number[];
  rgba32: number[];
  previewDataUrl: string;
}> {
  const img = await loadImage(src);
  const out128 = drawContainedRgba(img, 128);
  const out32 = drawContainedRgba(img, 32);
  let previewDataUrl = src;
  try {
    previewDataUrl = out128.canvas.toDataURL("image/png");
  } catch {
    previewDataUrl = src;
  }
  return {
    rgba128: out128.rgba,
    rgba32: out32.rgba,
    previewDataUrl,
  };
}

export function syncDocumentFavicon(dataUrl: string): void {
  if (typeof document === "undefined") return;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = dataUrl;
}
