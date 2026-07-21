export type FontId =
  | "hand"
  | "inter"
  | "notoSans"
  | "notoSerif"
  | "dmSans"
  | "literata"
  | "caveat"
  | "jetbrains"
  | "spaceGrotesk"
  | "zcool";

export interface FontConfig {
  id: FontId;
  label: string;
  /** CSS font-family stack */
  family: string;
  /** Google Fonts family query fragment; null = system / local only */
  google?: string | null;
}

export const fonts: Record<FontId, FontConfig> = {
  hand: {
    id: "hand",
    label: "手写便签",
    family: '"Segoe Print", "Comic Sans MS", "Bradley Hand", cursive, system-ui',
    google: null,
  },
  inter: {
    id: "inter",
    label: "Inter",
    family: '"Inter", "Noto Sans SC", system-ui, sans-serif',
    google: "Inter:wght@400;600;700",
  },
  notoSans: {
    id: "notoSans",
    label: "Noto Sans 中文",
    family: '"Noto Sans SC", "Inter", system-ui, sans-serif',
    google: "Noto+Sans+SC:wght@400;500;700",
  },
  notoSerif: {
    id: "notoSerif",
    label: "Noto Serif 中文",
    family: '"Noto Serif SC", "Literata", Georgia, serif',
    google: "Noto+Serif+SC:wght@400;600;700",
  },
  dmSans: {
    id: "dmSans",
    label: "DM Sans",
    family: '"DM Sans", "Noto Sans SC", system-ui, sans-serif',
    google: "DM+Sans:wght@400;500;700",
  },
  literata: {
    id: "literata",
    label: "Literata",
    family: '"Literata", "Noto Serif SC", Georgia, serif',
    google: "Literata:wght@400;600;700",
  },
  caveat: {
    id: "caveat",
    label: "Caveat 手写",
    family: '"Caveat", "Ma Shan Zheng", cursive',
    google: "Caveat:wght@400;600;700&family=Ma+Shan+Zheng",
  },
  jetbrains: {
    id: "jetbrains",
    label: "JetBrains Mono",
    family: '"JetBrains Mono", "Noto Sans SC", ui-monospace, monospace',
    google: "JetBrains+Mono:wght@400;500;600",
  },
  spaceGrotesk: {
    id: "spaceGrotesk",
    label: "Space Grotesk",
    family: '"Space Grotesk", "Noto Sans SC", system-ui, sans-serif',
    google: "Space+Grotesk:wght@400;500;600;700",
  },
  zcool: {
    id: "zcool",
    label: "站酷小薇",
    family: '"ZCOOL XiaoWei", "Noto Serif SC", serif',
    google: "ZCOOL+XiaoWei",
  },
};

export const fontIds = Object.keys(fonts) as FontId[];

const loaded = new Set<string>();

/** Lazily inject a Google Fonts stylesheet once per family query. */
export function ensureFontLoaded(fontId: FontId): void {
  const cfg = fonts[fontId];
  if (!cfg?.google || loaded.has(cfg.google)) return;
  if (typeof document === "undefined") return;

  const href = `https://fonts.googleapis.com/css2?family=${cfg.google}&display=swap`;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.fontId = fontId;
  document.head.appendChild(link);
  loaded.add(cfg.google);
}
