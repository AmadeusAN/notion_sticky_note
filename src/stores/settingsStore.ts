import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import type {
  AppSettings, AppearanceSettings, AppearanceSaveState, ExitAction, ExitSaveState,
  FontId, NotionConfig, ThemeId,
} from "../types";
import { fonts, ensureFontLoaded } from "../fonts";
import { DEFAULT_FX_THEME, normalizeFxThemeId, type FxThemeId } from "../fx/themes";
import { DEFAULT_FX_EDGE_BOOST, DEFAULT_FX_INTENSITY, clampIntensity } from "../fx/appearance";
import { DEFAULT_DOCK_HANDLE, normalizeDockHandleId, type DockHandleId } from "../dockHandles";
import {
  DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, getSystemThemeMode, normalizeThemeId,
  resolveActiveTheme, themes, type ThemeMode,
} from "../themes";
import {
  apiGetSettings, apiListenAppearanceSaveState, apiUpdateAppearance,
  apiGetExitState, apiListenExitSaveState, apiRequestExit,
  apiSaveNotionConfig, apiTestNotionConnection,
} from "../services/tauriApi";

export interface SettingsState extends AppSettings {
  systemMode: ThemeMode;
  hydrated: boolean;
  hydrating: boolean;
  hydrationError: string | null;
  appearanceSaveState: AppearanceSaveState;
  appearanceDirty: boolean;
  exitSaveState: ExitSaveState;
  message: string | null;
  error: string | null;
  notionOperation: "saving" | "testing" | null;
  savedNotion: NotionConfig;
  notionDraftRevision: number;
  notionConfirmation: { pendingCount: number; pendingVersion: number } | null;
  hydrate: () => Promise<void>;
  connectSettings: () => () => void;
  startSystemThemeListener: () => () => void;
  flushAppearance: () => Promise<void>;
  retryAppearance: () => Promise<void>;
  requestExit: (action?: ExitAction) => Promise<void>;
  setLightThemeLocal: (theme: ThemeId) => Promise<void>;
  setDarkThemeLocal: (theme: ThemeId) => Promise<void>;
  setFontLocal: (font: FontId) => Promise<void>;
  setFxThemeLocal: (theme: FxThemeId) => Promise<void>;
  setFxIntensityLocal: (intensity: number) => Promise<void>;
  setFxEdgeBoostLocal: (boost: boolean) => Promise<void>;
  setDockHandleLocal: (handle: DockHandleId) => Promise<void>;
  updateNotionDraft: (partial: Partial<NotionConfig>) => void;
  saveNotion: () => Promise<void>;
  discardPendingAndSaveNotion: () => Promise<void>;
  cancelNotionConfirmation: () => void;
  testNotion: () => Promise<void>;
}

export type SettingsStore = UseBoundStore<StoreApi<SettingsState>>;

const defaultNotion: NotionConfig = {
  token: "", databaseId: "", doneProperty: "done?", titleProperty: "Name",
  dateProperty: "Date", statusProperty: "Status",
  statusDoneValue: "Done", statusTodoValue: "Not started",
};

function applyFontCss(font: FontId) {
  ensureFontLoaded(font);
  document.documentElement.style.setProperty("--note-font", fonts[font]?.family ?? fonts.hand.family);
}

function palette(theme: ThemeId) {
  const config = themes[theme];
  return {
    noteBg: config.background, noteFg: config.foreground,
    noteAccent: config.accent, notePop: config.pop,
  };
}

function appearanceOf(state: AppSettings): AppearanceSettings {
  const colors = palette(state.theme);
  return {
    theme: state.theme, lightTheme: state.lightTheme, darkTheme: state.darkTheme,
    font: state.font, fxTheme: state.fxTheme, fxIntensity: state.fxIntensity,
    fxEdgeBoost: state.fxEdgeBoost, dockHandle: state.dockHandle,
    noteBg: state.noteBg ?? colors.noteBg, noteFg: state.noteFg ?? colors.noteFg,
    noteAccent: state.noteAccent ?? colors.noteAccent, notePop: state.notePop ?? colors.notePop,
  };
}

function coerceThemePair(settings: AppSettings) {
  const legacy = normalizeThemeId(settings.theme, DEFAULT_LIGHT_THEME);
  let lightTheme = normalizeThemeId(settings.lightTheme,
    themes[legacy].mode === "light" ? legacy : DEFAULT_LIGHT_THEME);
  let darkTheme = normalizeThemeId(settings.darkTheme,
    themes[legacy].mode === "dark" ? legacy : DEFAULT_DARK_THEME);
  if (themes[lightTheme].mode !== "light") lightTheme = DEFAULT_LIGHT_THEME;
  if (themes[darkTheme].mode !== "dark") darkTheme = DEFAULT_DARK_THEME;
  return { lightTheme, darkTheme };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A factory keeps isolated consumers/tests from sharing pending IPC or animation frames.
export function createSettingsStore(): SettingsStore {
  return create<SettingsState>((set, get) => {
    let frame: number | null = null;
    let pending = false;
    let sending: Promise<void> | null = null;
    let hydrateGeneration = 0;
    let connectionGeneration = 0;
    let exitRequest = 0;
    let disconnectCurrent: (() => void) | null = null;

    const acceptAppearance = (next: AppearanceSaveState) => {
      const current = get().appearanceSaveState;
      if (next.revision < current.revision) return;
      // A delayed receipt must not undo a terminal event for the same revision.
      if (next.revision === current.revision && current.status === "saved") return;
      if (next.revision === current.revision && next.status === "saving" && current.status !== "saving") return;
      set({ appearanceSaveState: next, appearanceDirty: next.status !== "saved" });
    };

    const acceptExit = (next: ExitSaveState) => {
      const current = get().exitSaveState;
      if (next.revision < current.revision) return;
      if (next.revision === current.revision && current.status === "idle" && next.status !== "idle") return;
      if (next.revision === current.revision && current.status === "error" && next.status === "saving") return;
      set({ exitSaveState: next });
    };

    const flushAppearance = async () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      // One in-flight submission and one replaceable latest snapshot.
      while (sending || pending) {
        if (sending) {
          await sending;
          continue;
        }
        if (!get().hydrated) return;
        pending = false;
        const appearance = appearanceOf(get());
        const revision = get().appearanceSaveState.revision;
        sending = (async () => {
          try {
            acceptAppearance(await apiUpdateAppearance(appearance, revision));
          } catch (error) {
            acceptAppearance({ revision, status: "error", error: errorMessage(error) });
          }
        })().finally(() => { sending = null; });
        await sending;
      }
    };

    const preview = (partial: Partial<AppearanceSettings>, force = false) => {
      if (!get().hydrated) return;
      const patch = partial.theme ? { ...partial, ...palette(partial.theme) } : partial;
      if (!force && Object.entries(patch).every(([key, value]) => get()[key as keyof AppearanceSettings] === value)) return;
      set({
        ...patch, appearanceDirty: true,
        appearanceSaveState: { revision: get().appearanceSaveState.revision + 1, status: "saving", error: null },
      });
      pending = true;
      if (frame === null) frame = requestAnimationFrame(() => {
        frame = null;
        void flushAppearance();
      });
    };

    const hydrate = async () => {
      const generation = ++hydrateGeneration;
      const draftRevision = get().notionDraftRevision;
      set({ hydrating: true, hydrationError: null });
      try {
        let snapshot = await apiGetSettings();
        // An event received during the read wins; obtain its matching preview.
        while (generation === hydrateGeneration &&
          snapshot.appearanceSaveState.revision < get().appearanceSaveState.revision) {
          // Local previews are already newer than a reconnect read.
          if (get().hydrated) return;
          snapshot = await apiGetSettings();
        }
        if (generation !== hydrateGeneration) return;
        const { settings, appearanceSaveState } = snapshot;
        const systemMode = getSystemThemeMode();
        const { lightTheme, darkTheme } = coerceThemePair(settings);
        const theme = normalizeThemeId(settings.theme, DEFAULT_LIGHT_THEME);
        const font = settings.font in fonts ? settings.font : "hand";
        set({
          ...appearanceOf({ ...settings, theme }),
          lightTheme, darkTheme, font,
          fxTheme: normalizeFxThemeId(settings.fxTheme),
          fxIntensity: clampIntensity(settings.fxIntensity ?? DEFAULT_FX_INTENSITY),
          fxEdgeBoost: settings.fxEdgeBoost ?? DEFAULT_FX_EDGE_BOOST,
          dockHandle: normalizeDockHandleId(settings.dockHandle),
          ...(get().notionDraftRevision === draftRevision
            ? { notion: { ...defaultNotion, ...settings.notion } } : {}),
          savedNotion: { ...defaultNotion, ...settings.notion },
          systemMode, hydrated: true, appearanceSaveState,
          appearanceDirty: appearanceSaveState.status !== "saved",
        });
        applyFontCss(font);
        const active = resolveActiveTheme(systemMode, lightTheme, darkTheme);
        if (active !== theme) preview({ theme: active });
      } catch (error) {
        if (generation === hydrateGeneration) set({ hydrationError: errorMessage(error) });
      } finally {
        if (generation === hydrateGeneration) set({ hydrating: false });
      }
    };

    const safeError = (error: unknown, config: NotionConfig) => {
      const message = errorMessage(error);
      return config.token ? message.split(config.token).join("[redacted]") : message;
    };

    const saveNotion = async (discardPending: boolean) => {
      const state = get();
      if (state.notionOperation) return;
      if (discardPending && !state.notionConfirmation) return;
      const config = { ...state.notion };
      const revision = state.notionDraftRevision;
      const options = discardPending
        ? { discardPending: true, expectedPendingVersion: state.notionConfirmation!.pendingVersion }
        : {};
      set({ notionOperation: "saving", message: null, error: null });
      try {
        const result = await apiSaveNotionConfig(config, options);
        if (result.status === "saved") {
          set({ savedNotion: config });
          if (get().notionDraftRevision === revision) {
            set({ message: "Notion 配置已保存", notionConfirmation: null });
          }
        } else if (get().notionDraftRevision === revision) {
          set({ notionConfirmation: { pendingCount: result.pendingCount, pendingVersion: result.pendingVersion } });
        }
      } catch (error) {
        if (get().notionDraftRevision === revision) set({ error: safeError(error, config) });
      } finally {
        set({ notionOperation: null });
      }
    };

    return {
      theme: DEFAULT_LIGHT_THEME, lightTheme: DEFAULT_LIGHT_THEME, darkTheme: DEFAULT_DARK_THEME,
      font: "hand", fxTheme: DEFAULT_FX_THEME, fxIntensity: DEFAULT_FX_INTENSITY,
      fxEdgeBoost: DEFAULT_FX_EDGE_BOOST, dockHandle: DEFAULT_DOCK_HANDLE,
      ...palette(DEFAULT_LIGHT_THEME),
      notion: { ...defaultNotion }, savedNotion: { ...defaultNotion },
      systemMode: getSystemThemeMode(), hydrated: false, hydrating: false, hydrationError: null,
      appearanceSaveState: { revision: 0, status: "saved", error: null }, appearanceDirty: false,
      exitSaveState: { revision: 0, status: "idle", error: null },
      message: null, error: null, notionOperation: null, notionDraftRevision: 0, notionConfirmation: null,
      hydrate,
      connectSettings: () => {
        disconnectCurrent?.();
        const generation = ++connectionGeneration;
        let alive = true;
        const unlisteners: (() => void)[] = [];
        const register = async <T,>(listen: (callback: (value: T) => void) => Promise<() => void>, accept: (value: T) => void) => {
          const unlisten = await listen((value) => { if (alive) accept(value); });
          if (!alive) unlisten();
          else unlisteners.push(unlisten);
        };
        void (async () => {
          try {
            await Promise.all([
              register(apiListenAppearanceSaveState, acceptAppearance),
              register(apiListenExitSaveState, acceptExit),
            ]);
            if (!alive) return;
            await Promise.all([
              hydrate(),
              apiGetExitState().then((state) => { if (alive) acceptExit(state); }),
            ]);
          } catch (error) {
            if (alive) set({ hydrationError: errorMessage(error), hydrating: false });
          }
        })();
        const disconnect = () => {
          alive = false;
          unlisteners.splice(0).forEach((unlisten) => unlisten());
          if (generation === connectionGeneration) {
            ++hydrateGeneration;
            set({ hydrating: false });
            disconnectCurrent = null;
          }
          // Delivery does not depend on the settings panel or App remaining mounted.
          void flushAppearance();
        };
        disconnectCurrent = disconnect;
        return disconnect;
      },
      startSystemThemeListener: () => {
        if (typeof window === "undefined" || !window.matchMedia) return () => {};
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        const apply = (matches: boolean) => {
          const systemMode: ThemeMode = matches ? "dark" : "light";
          set({ systemMode });
          preview({ theme: resolveActiveTheme(systemMode, get().lightTheme, get().darkTheme) });
        };
        const onChange = (event: MediaQueryListEvent) => apply(event.matches);
        apply(media.matches);
        media.addEventListener("change", onChange);
        return () => media.removeEventListener("change", onChange);
      },
      flushAppearance,
      retryAppearance: async () => {
        if (!get().hydrated) return;
        preview({}, true);
        await flushAppearance();
      },
      requestExit: async (action) => {
        if (get().exitSaveState.status === "saving" && action !== "cancel") return;
        const request = ++exitRequest;
        const current = get().exitSaveState;
        if (action === "cancel") {
          set({ exitSaveState: { revision: current.revision + 1, status: "idle", error: null } });
        } else {
          set({ exitSaveState: { ...current, status: "saving" } });
        }
        try {
          if (action !== "cancel" && action !== "discard") {
            await flushAppearance();
            // An IPC failure leaves a preview the native exit coordinator has never received.
            if (pending || get().appearanceSaveState.status === "error") {
              // Resubmit with a fresh revision; the native writer owns persistence retries.
              await get().retryAppearance();
              if (get().appearanceSaveState.status === "error") {
                throw new Error(get().appearanceSaveState.error ?? "外观设置尚未送达，无法安全退出。");
              }
            }
          }
          if (request !== exitRequest) return;
          const state = await apiRequestExit(action);
          if (request === exitRequest) acceptExit(state);
        } catch (error) {
          if (request === exitRequest) set({
            exitSaveState: { revision: get().exitSaveState.revision, status: "error", error: errorMessage(error) },
          });
        }
      },
      setLightThemeLocal: async (lightTheme) => {
        if (themes[lightTheme].mode !== "light") return;
        preview({ lightTheme, theme: resolveActiveTheme(get().systemMode, lightTheme, get().darkTheme) });
      },
      setDarkThemeLocal: async (darkTheme) => {
        if (themes[darkTheme].mode !== "dark") return;
        preview({ darkTheme, theme: resolveActiveTheme(get().systemMode, get().lightTheme, darkTheme) });
      },
      setFontLocal: async (font) => {
        preview({ font });
        if (get().hydrated) applyFontCss(font);
      },
      setFxThemeLocal: async (fxTheme) => preview({ fxTheme }),
      setFxIntensityLocal: async (raw) => preview({ fxIntensity: clampIntensity(raw) }),
      setFxEdgeBoostLocal: async (fxEdgeBoost) => preview({ fxEdgeBoost }),
      setDockHandleLocal: async (dockHandle) => preview({ dockHandle }),
      updateNotionDraft: (partial) => set({
        notion: { ...get().notion, ...partial }, notionDraftRevision: get().notionDraftRevision + 1,
        notionConfirmation: null, message: null, error: null,
      }),
      saveNotion: () => saveNotion(false),
      discardPendingAndSaveNotion: () => saveNotion(true),
      cancelNotionConfirmation: () => {
        if (!get().notionOperation) set({ notionConfirmation: null, message: null, error: null });
      },
      testNotion: async () => {
        if (get().notionOperation) return;
        const config = { ...get().notion };
        const revision = get().notionDraftRevision;
        set({ notionOperation: "testing", message: null, error: null });
        try {
          const message = await apiTestNotionConnection(config);
          if (get().notionDraftRevision === revision) set({ message });
        } catch (error) {
          if (get().notionDraftRevision === revision) set({ error: safeError(error, config) });
        } finally {
          set({ notionOperation: null });
        }
      },
    };
  });
}

export const useSettingsStore = createSettingsStore();
