export type ThemeId =
  | "paper"
  | "glass"
  | "dark"
  | "notion"
  | "notionDark"
  | "claude"
  | "google"
  | "cardNotion"
  | "cardCoral"
  | "cardInk"
  | "cardSky"
  | "cardMeadow"
  | "auroraMotion"
  | "sunsetMotion"
  | "inkMotion";

export type ThemeSurface = "paper" | "flat" | "glass" | "layered" | "motion";
export type ThemeGroup = "flat" | "layered" | "motion";
export type ThemeMode = "light" | "dark";

export interface ThemeConfig {
  id: ThemeId;
  label: string;
  group: ThemeGroup;
  mode: ThemeMode;
  background: string;
  foreground: string;
  muted: string;
  accent: string;
  /** Sparse accent for badges / checked / chips */
  pop: string;
  popSoft: string;
  tray?: string;
  card?: string;
  shadow: string;
  border: string;
  blur: boolean;
  opacity: number;
  acrylic: boolean;
  surface: ThemeSurface;
}

export const themes: Record<ThemeId, ThemeConfig> = {
  // —— Flat ——
  paper: {
    id: "paper",
    label: "Classic Paper",
    group: "flat",
    mode: "light",
    background: "#fff4a3",
    foreground: "#2a2418",
    muted: "#6b5e45",
    accent: "#c45c26",
    pop: "#c45c26",
    popSoft: "rgba(196, 92, 38, 0.12)",
    shadow: "0 18px 40px rgba(40, 28, 8, 0.28)",
    border: "rgba(120, 90, 40, 0.18)",
    blur: false,
    opacity: 1,
    acrylic: false,
    surface: "paper",
  },
  glass: {
    id: "glass",
    label: "Glass",
    group: "flat",
    mode: "light",
    background: "rgba(230, 238, 248, 0.45)",
    foreground: "#1c2430",
    muted: "#5b6b7c",
    accent: "#2f6fed",
    pop: "#2f6fed",
    popSoft: "rgba(47, 111, 237, 0.12)",
    shadow: "0 18px 42px rgba(20, 35, 60, 0.28)",
    border: "rgba(255, 255, 255, 0.35)",
    blur: true,
    opacity: 0.95,
    acrylic: true,
    surface: "glass",
  },
  dark: {
    id: "dark",
    label: "Dark OLED",
    group: "flat",
    mode: "dark",
    background: "#1a1c1f",
    foreground: "#ece8e1",
    muted: "#9a948a",
    accent: "#e0a45a",
    pop: "#e0a45a",
    popSoft: "rgba(224, 164, 90, 0.16)",
    shadow: "0 18px 40px rgba(0, 0, 0, 0.45)",
    border: "rgba(255, 255, 255, 0.08)",
    blur: false,
    opacity: 0.98,
    acrylic: false,
    surface: "flat",
  },
  notion: {
    id: "notion",
    label: "Notion",
    group: "flat",
    mode: "light",
    background: "#ffffff",
    foreground: "#37352f",
    muted: "#787774",
    accent: "#2383e2",
    pop: "#2383e2",
    popSoft: "rgba(35, 131, 226, 0.12)",
    shadow: "0 12px 32px rgba(15, 15, 15, 0.12)",
    border: "rgba(55, 53, 47, 0.12)",
    blur: false,
    opacity: 1,
    acrylic: false,
    surface: "flat",
  },
  notionDark: {
    id: "notionDark",
    label: "Notion Dark",
    group: "flat",
    mode: "dark",
    background: "#191919",
    foreground: "#ffffffcf",
    muted: "#ffffff73",
    accent: "#529cca",
    pop: "#529cca",
    popSoft: "rgba(82, 156, 202, 0.18)",
    shadow: "0 14px 36px rgba(0, 0, 0, 0.45)",
    border: "rgba(255, 255, 255, 0.1)",
    blur: false,
    opacity: 0.98,
    acrylic: false,
    surface: "flat",
  },
  claude: {
    id: "claude",
    label: "Claude",
    group: "flat",
    mode: "light",
    background: "#f5f0e8",
    foreground: "#3d3929",
    muted: "#7a7468",
    accent: "#d97757",
    pop: "#d97757",
    popSoft: "rgba(217, 119, 87, 0.14)",
    shadow: "0 16px 36px rgba(61, 57, 41, 0.16)",
    border: "rgba(61, 57, 41, 0.12)",
    blur: false,
    opacity: 1,
    acrylic: false,
    surface: "flat",
  },
  google: {
    id: "google",
    label: "Google",
    group: "flat",
    mode: "light",
    background: "#f8f9fa",
    foreground: "#202124",
    muted: "#5f6368",
    accent: "#1a73e8",
    pop: "#ea4335",
    popSoft: "rgba(234, 67, 53, 0.1)",
    shadow:
      "0 1px 3px rgba(60, 64, 67, 0.2), 0 4px 12px rgba(60, 64, 67, 0.12)",
    border: "rgba(218, 220, 224, 1)",
    blur: false,
    opacity: 1,
    acrylic: false,
    surface: "flat",
  },

  // —— Layered (card depth + badge accents, no side stripe) ——
  cardNotion: {
    id: "cardNotion",
    label: "Notion Card",
    group: "layered",
    mode: "light",
    background: "#f7f6f3",
    tray: "#f7f6f3",
    card: "#ffffff",
    foreground: "#37352f",
    muted: "#787774",
    accent: "#2383e2",
    pop: "#0f7b6c",
    popSoft: "rgba(15, 123, 108, 0.12)",
    shadow: "0 8px 24px rgba(15,15,15,0.06)",
    border: "rgba(55, 53, 47, 0.08)",
    blur: false,
    opacity: 1,
    acrylic: false,
    surface: "layered",
  },
  cardCoral: {
    id: "cardCoral",
    label: "Coral Deck",
    group: "layered",
    mode: "light",
    background: "#fff7f4",
    tray: "#fff7f4",
    card: "#ffffff",
    foreground: "#2b211c",
    muted: "#8a6e63",
    accent: "#ff6b4a",
    pop: "#e11d48",
    popSoft: "rgba(225, 29, 72, 0.1)",
    shadow: "0 10px 28px rgba(60, 24, 12, 0.08)",
    border: "rgba(255, 120, 90, 0.14)",
    blur: false,
    opacity: 1,
    acrylic: false,
    surface: "layered",
  },
  cardInk: {
    id: "cardInk",
    label: "Ink Stack",
    group: "layered",
    mode: "dark",
    background: "#14161c",
    tray: "#14161c",
    card: "#1e222b",
    foreground: "#eef0f5",
    muted: "#9aa0b0",
    accent: "#7c9cff",
    pop: "#34d399",
    popSoft: "rgba(52, 211, 153, 0.14)",
    shadow: "0 12px 32px rgba(0,0,0,0.4)",
    border: "rgba(255, 255, 255, 0.07)",
    blur: false,
    opacity: 0.98,
    acrylic: false,
    surface: "layered",
  },
  cardSky: {
    id: "cardSky",
    label: "Sky Board",
    group: "layered",
    mode: "light",
    background: "#f3f7ff",
    tray: "#f3f7ff",
    card: "#ffffff",
    foreground: "#1a2333",
    muted: "#5b6b84",
    accent: "#2f6fed",
    pop: "#f59e0b",
    popSoft: "rgba(245, 158, 11, 0.14)",
    shadow: "0 10px 26px rgba(30, 60, 120, 0.08)",
    border: "rgba(47, 111, 237, 0.1)",
    blur: false,
    opacity: 1,
    acrylic: false,
    surface: "layered",
  },
  cardMeadow: {
    id: "cardMeadow",
    label: "Meadow Card",
    group: "layered",
    mode: "light",
    background: "#f4faf5",
    tray: "#f4faf5",
    card: "#ffffff",
    foreground: "#1f2e24",
    muted: "#5f7566",
    accent: "#2f9e6b",
    pop: "#a855f7",
    popSoft: "rgba(168, 85, 247, 0.12)",
    shadow: "0 10px 26px rgba(20, 60, 40, 0.07)",
    border: "rgba(47, 158, 107, 0.12)",
    blur: false,
    opacity: 1,
    acrylic: false,
    surface: "layered",
  },

  // —— Motion (animated ambient + orbiting border) ——
  auroraMotion: {
    id: "auroraMotion",
    label: "Aurora Flow",
    group: "motion",
    mode: "light",
    background: "#f4f7ff",
    tray: "#eef3ff",
    card: "#ffffff",
    foreground: "#1c2436",
    muted: "#667089",
    accent: "#6366f1",
    pop: "#22d3ee",
    popSoft: "rgba(34, 211, 238, 0.14)",
    shadow: "0 14px 36px rgba(60, 80, 160, 0.14)",
    border: "rgba(99, 102, 241, 0.18)",
    blur: false,
    opacity: 1,
    acrylic: false,
    surface: "motion",
  },
  sunsetMotion: {
    id: "sunsetMotion",
    label: "Sunset Drift",
    group: "motion",
    mode: "light",
    background: "#fff6f0",
    tray: "#ffefe6",
    card: "#ffffff",
    foreground: "#2c211c",
    muted: "#8a6f63",
    accent: "#f97316",
    pop: "#ec4899",
    popSoft: "rgba(236, 72, 153, 0.12)",
    shadow: "0 14px 36px rgba(180, 60, 40, 0.12)",
    border: "rgba(249, 115, 22, 0.18)",
    blur: false,
    opacity: 1,
    acrylic: false,
    surface: "motion",
  },
  inkMotion: {
    id: "inkMotion",
    label: "Ink Pulse",
    group: "motion",
    mode: "dark",
    background: "#10131a",
    tray: "#151922",
    card: "#1c212c",
    foreground: "#e8ecf5",
    muted: "#95a0b5",
    accent: "#818cf8",
    pop: "#34d399",
    popSoft: "rgba(52, 211, 153, 0.14)",
    shadow: "0 16px 40px rgba(0,0,0,0.45)",
    border: "rgba(129, 140, 248, 0.22)",
    blur: false,
    opacity: 0.98,
    acrylic: false,
    surface: "motion",
  },
};

export const themeIds = Object.keys(themes) as ThemeId[];

export const DEFAULT_LIGHT_THEME: ThemeId = "paper";
export const DEFAULT_DARK_THEME: ThemeId = "dark";

export const lightThemeIds = themeIds.filter(
  (id) => themes[id].mode === "light",
);
export const darkThemeIds = themeIds.filter((id) => themes[id].mode === "dark");

export const flatThemeIds = themeIds.filter((id) => themes[id].group === "flat");
export const layeredThemeIds = themeIds.filter(
  (id) => themes[id].group === "layered",
);
export const motionThemeIds = themeIds.filter(
  (id) => themes[id].group === "motion",
);

export function themesInMode(
  mode: ThemeMode,
  group?: ThemeGroup,
): ThemeId[] {
  return themeIds.filter((id) => {
    const t = themes[id];
    return t.mode === mode && (group == null || t.group === group);
  });
}

export function isThemeId(value: string): value is ThemeId {
  return value in themes;
}

export function normalizeThemeId(
  value: string | undefined | null,
  fallback: ThemeId,
): ThemeId {
  return value && isThemeId(value) ? value : fallback;
}

export function getSystemThemeMode(): ThemeMode {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function resolveActiveTheme(
  systemMode: ThemeMode,
  lightTheme: ThemeId,
  darkTheme: ThemeId,
): ThemeId {
  return systemMode === "dark" ? darkTheme : lightTheme;
}
