import { create } from "zustand";
import type { CalendarFocusStyle, GalleryFeedConfig, WindowMode } from "../types";
import {
  apiGetWindowMode,
  apiIsMainMaximized,
  apiListenWindowMode,
  apiMinimizeMain,
  apiSetWindowMode,
  apiToggleMaximizeMain,
} from "../services/tauriApi";

const FOCUS_STYLE_KEY = "sticky_calendar_focus_style";
const FOCUS_SIZE_KEY = "sticky_calendar_focus_size";
const GALLERY_CONFIG_KEY = "sticky_gallery_config";

const DEFAULT_WALLHAVEN_TAGS = ["minimalism", "anime", "cyberpunk", "landscape"];

const DEFAULT_GALLERY_CONFIG: GalleryFeedConfig = {
  source: "local",
  wallhavenQuery: "minimalism",
  wallhavenTags: DEFAULT_WALLHAVEN_TAGS,
  pinterestBoardUrl: "",
  unsplashQuery: "minimal workspace",
  unsplashAccessKey: "",
  proxyUrl: "",
};

function clampFocusSize(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.round(Math.max(0.65, Math.min(1.45, value)) * 100) / 100;
}

function readSavedFocusStyle(): CalendarFocusStyle {
  try {
    const raw = window.localStorage.getItem(FOCUS_STYLE_KEY);
    if (raw === "smooth" || raw === "mosaic" || raw === "off") return raw;
  } catch {
    // Ignore storage unavailability in headless or restricted contexts.
  }
  return "smooth";
}

function readSavedFocusSize(): number {
  try {
    const raw = window.localStorage.getItem(FOCUS_SIZE_KEY);
    if (raw !== null) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return clampFocusSize(parsed);
    }
  } catch {
    // Ignore storage unavailability.
  }
  return 1;
}

function readSavedGalleryConfig(): GalleryFeedConfig {
  try {
    const raw = window.localStorage.getItem(GALLERY_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GalleryFeedConfig>;
      const source =
        parsed.source === "wallhaven" ||
        parsed.source === "pinterest" ||
        parsed.source === "unsplash" ||
        parsed.source === "local"
          ? parsed.source
          : "local";
      const tags = Array.isArray(parsed.wallhavenTags)
        ? parsed.wallhavenTags
            .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
            .map((t) => t.trim())
        : DEFAULT_WALLHAVEN_TAGS;
      return {
        source,
        wallhavenQuery: typeof parsed.wallhavenQuery === "string" ? parsed.wallhavenQuery : DEFAULT_GALLERY_CONFIG.wallhavenQuery,
        wallhavenTags: tags,
        pinterestBoardUrl: typeof parsed.pinterestBoardUrl === "string" ? parsed.pinterestBoardUrl : "",
        unsplashQuery: typeof parsed.unsplashQuery === "string" ? parsed.unsplashQuery : DEFAULT_GALLERY_CONFIG.unsplashQuery,
        unsplashAccessKey: typeof parsed.unsplashAccessKey === "string" ? parsed.unsplashAccessKey : "",
        proxyUrl: typeof parsed.proxyUrl === "string" ? parsed.proxyUrl : "",
      };
    }
  } catch {
    // Ignore malformed or unavailable storage.
  }
  return { ...DEFAULT_GALLERY_CONFIG };
}

function writeSavedFocusStyle(style: CalendarFocusStyle): void {
  try {
    window.localStorage.setItem(FOCUS_STYLE_KEY, style);
  } catch {
    // Ignore storage unavailability.
  }
}

function writeSavedFocusSize(size: number): void {
  try {
    window.localStorage.setItem(FOCUS_SIZE_KEY, String(size));
  } catch {
    // Ignore storage unavailability.
  }
}

function writeSavedGalleryConfig(config: GalleryFeedConfig): void {
  try {
    window.localStorage.setItem(GALLERY_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage unavailability.
  }
}

interface ModeState {
  mode: WindowMode;
  maximized: boolean;
  switching: boolean;
  error: string | null;
  calendarFocusStyle: CalendarFocusStyle;
  calendarFocusSize: number;
  galleryConfig: GalleryFeedConfig;
  lastActiveFocusStyle: "smooth" | "mosaic";
  connectWindowMode: () => () => void;
  setMode: (mode: WindowMode) => Promise<void>;
  toggleMaximize: () => Promise<void>;
  minimize: () => Promise<void>;
  setCalendarFocusStyle: (style: CalendarFocusStyle) => void;
  setCalendarFocusSize: (size: number) => void;
  updateGalleryConfig: (patch: Partial<GalleryFeedConfig>) => void;
  toggleCalendarFocus: () => void;
  clearError: () => void;
}

export function createModeStore() {
  const initialFocusStyle = readSavedFocusStyle();
  const initialFocusSize = readSavedFocusSize();
  const initialGalleryConfig = readSavedGalleryConfig();
  const initialActiveFocusStyle: "smooth" | "mosaic" =
    initialFocusStyle === "mosaic" ? "mosaic" : "smooth";

  return create<ModeState>((set, get) => ({
    mode: "workspace",
    maximized: false,
    switching: false,
    error: null,
    calendarFocusStyle: initialFocusStyle,
    calendarFocusSize: initialFocusSize,
    galleryConfig: initialGalleryConfig,
    lastActiveFocusStyle: initialActiveFocusStyle,

    connectWindowMode: () => {
      let alive = true;
      let unlisten: (() => void) | null = null;
      void (async () => {
        try {
          const cleanup = await apiListenWindowMode((nextMode) => {
            if (alive) set({ mode: nextMode, switching: false, error: null });
          });
          if (!alive) {
            cleanup();
            return;
          }
          unlisten = cleanup;
          const [mode, maximized] = await Promise.all([apiGetWindowMode(), apiIsMainMaximized()]);
          if (alive) set({ mode, maximized });
        } catch (error) {
          if (alive) set({ error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return () => {
        alive = false;
        unlisten?.();
        unlisten = null;
      };
    },

    setMode: async (target) => {
      if (get().switching || get().mode === target) return;
      set({ switching: true, error: null });
      try {
        const applied = await apiSetWindowMode(target);
        const maximized = applied === "workspace" ? await apiIsMainMaximized().catch(() => false) : false;
        set({ mode: applied, maximized, switching: false });
      } catch (error) {
        set({
          switching: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    toggleMaximize: async () => {
      try {
        const maximized = await apiToggleMaximizeMain();
        set({ maximized });
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
      }
    },

    minimize: async () => {
      try {
        await apiMinimizeMain();
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
      }
    },

    setCalendarFocusStyle: (style) => {
      writeSavedFocusStyle(style);
      set((state) => ({
        calendarFocusStyle: style,
        lastActiveFocusStyle: style === "off" ? state.lastActiveFocusStyle : style,
      }));
    },

    setCalendarFocusSize: (size) => {
      const clamped = clampFocusSize(size);
      writeSavedFocusSize(clamped);
      set({ calendarFocusSize: clamped });
    },

    updateGalleryConfig: (patch) => {
      set((state) => {
        const next: GalleryFeedConfig = {
          ...state.galleryConfig,
          ...patch,
        };
        writeSavedGalleryConfig(next);
        return { galleryConfig: next };
      });
    },

    toggleCalendarFocus: () => {
      const { calendarFocusStyle, lastActiveFocusStyle } = get();
      const next: CalendarFocusStyle = calendarFocusStyle === "off" ? lastActiveFocusStyle : "off";
      writeSavedFocusStyle(next);
      set({ calendarFocusStyle: next });
    },

    clearError: () => set({ error: null }),
  }));
}

export const useModeStore = createModeStore();
