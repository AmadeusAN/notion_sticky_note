import { create } from "zustand";
import type { AppSettings, FontId, NotionConfig, ThemeId } from "../types";
import { fonts, ensureFontLoaded } from "../fonts";
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  getSystemThemeMode,
  normalizeThemeId,
  resolveActiveTheme,
  themes,
  type ThemeMode,
} from "../themes";
import {
  apiGetSettings,
  apiSaveNotionConfig,
  apiSetDarkTheme,
  apiSetFont,
  apiSetLightTheme,
  apiSetTheme,
  apiTestNotionConnection,
} from "../services/tauriApi";

interface SettingsState extends AppSettings {
  systemMode: ThemeMode;
  hydrated: boolean;
  message: string | null;
  error: string | null;
  saving: boolean;
  hydrate: () => Promise<void>;
  startSystemThemeListener: () => () => void;
  setLightThemeLocal: (theme: ThemeId) => Promise<void>;
  setDarkThemeLocal: (theme: ThemeId) => Promise<void>;
  setFontLocal: (font: FontId) => Promise<void>;
  updateNotionDraft: (partial: Partial<NotionConfig>) => void;
  saveNotion: () => Promise<void>;
  testNotion: () => Promise<void>;
}

const defaultNotion: NotionConfig = {
  token: "",
  databaseId: "",
  doneProperty: "done?",
  titleProperty: "Name",
  dateProperty: "Date",
  statusProperty: "Status",
  statusDoneValue: "Done",
  statusTodoValue: "Not started",
};

function applyFontCss(font: FontId) {
  ensureFontLoaded(font);
  const family = fonts[font]?.family ?? fonts.hand.family;
  document.documentElement.style.setProperty("--note-font", family);
}

function coerceThemePair(
  settings: Partial<AppSettings> & { theme?: string },
): { lightTheme: ThemeId; darkTheme: ThemeId; theme: ThemeId } {
  const legacy = settings.theme;
  let lightTheme = normalizeThemeId(
    settings.lightTheme,
    DEFAULT_LIGHT_THEME,
  );
  let darkTheme = normalizeThemeId(settings.darkTheme, DEFAULT_DARK_THEME);

  if (!settings.lightTheme && legacy) {
    const id = normalizeThemeId(legacy, DEFAULT_LIGHT_THEME);
    lightTheme =
      themes[id].mode === "light" ? id : DEFAULT_LIGHT_THEME;
  }
  if (!settings.darkTheme && legacy) {
    const id = normalizeThemeId(legacy, DEFAULT_DARK_THEME);
    darkTheme = themes[id].mode === "dark" ? id : DEFAULT_DARK_THEME;
  }

  if (themes[lightTheme].mode !== "light") lightTheme = DEFAULT_LIGHT_THEME;
  if (themes[darkTheme].mode !== "dark") darkTheme = DEFAULT_DARK_THEME;

  const systemMode = getSystemThemeMode();
  const theme = resolveActiveTheme(systemMode, lightTheme, darkTheme);
  return { lightTheme, darkTheme, theme };
}

async function persistActiveTheme(theme: ThemeId) {
  try {
    await apiSetTheme(theme);
  } catch {
    /* ignore in browser preview */
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: DEFAULT_LIGHT_THEME,
  lightTheme: DEFAULT_LIGHT_THEME,
  darkTheme: DEFAULT_DARK_THEME,
  font: "hand",
  notion: { ...defaultNotion },
  systemMode: getSystemThemeMode(),
  hydrated: false,
  message: null,
  error: null,
  saving: false,

  hydrate: async () => {
    try {
      const settings = await apiGetSettings();
      const systemMode = getSystemThemeMode();
      const { lightTheme, darkTheme, theme } = coerceThemePair(settings);
      const font = (settings.font as FontId) || "hand";
      set({
        theme,
        lightTheme,
        darkTheme,
        font,
        notion: { ...defaultNotion, ...settings.notion },
        systemMode,
        hydrated: true,
      });
      applyFontCss(font);
      await persistActiveTheme(theme);
      // Ensure pair is saved for older installs
      try {
        await apiSetLightTheme(lightTheme);
        await apiSetDarkTheme(darkTheme);
      } catch {
        /* ignore */
      }
    } catch {
      applyFontCss("hand");
      const systemMode = getSystemThemeMode();
      const theme = resolveActiveTheme(
        systemMode,
        DEFAULT_LIGHT_THEME,
        DEFAULT_DARK_THEME,
      );
      set({
        theme,
        lightTheme: DEFAULT_LIGHT_THEME,
        darkTheme: DEFAULT_DARK_THEME,
        systemMode,
        hydrated: true,
      });
    }
  },

  startSystemThemeListener: () => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return () => undefined;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (matches: boolean) => {
      const systemMode: ThemeMode = matches ? "dark" : "light";
      const { lightTheme, darkTheme, theme: prev } = get();
      const theme = resolveActiveTheme(systemMode, lightTheme, darkTheme);
      set({ systemMode, theme });
      if (theme !== prev) {
        void persistActiveTheme(theme);
      }
    };
    const onChange = (event: MediaQueryListEvent) => apply(event.matches);
    apply(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  },

  setLightThemeLocal: async (themeId) => {
    if (themes[themeId].mode !== "light") return;
    const { systemMode, darkTheme } = get();
    const theme = resolveActiveTheme(systemMode, themeId, darkTheme);
    set({ lightTheme: themeId, theme });
    try {
      await apiSetLightTheme(themeId);
    } catch {
      /* ignore */
    }
    await persistActiveTheme(theme);
  },

  setDarkThemeLocal: async (themeId) => {
    if (themes[themeId].mode !== "dark") return;
    const { systemMode, lightTheme } = get();
    const theme = resolveActiveTheme(systemMode, lightTheme, themeId);
    set({ darkTheme: themeId, theme });
    try {
      await apiSetDarkTheme(themeId);
    } catch {
      /* ignore */
    }
    await persistActiveTheme(theme);
  },

  setFontLocal: async (font) => {
    set({ font });
    applyFontCss(font);
    try {
      await apiSetFont(font);
    } catch {
      /* ignore */
    }
  },

  updateNotionDraft: (partial) => {
    set({ notion: { ...get().notion, ...partial } });
  },

  saveNotion: async () => {
    set({ saving: true, message: null, error: null });
    try {
      await apiSaveNotionConfig(get().notion);
      set({ message: "Notion 配置已保存", saving: false });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : String(e),
        saving: false,
      });
    }
  },

  testNotion: async () => {
    set({ saving: true, message: null, error: null });
    try {
      const msg = await apiTestNotionConnection(get().notion);
      set({ message: msg, saving: false });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : String(e),
        saving: false,
      });
    }
  },
}));
