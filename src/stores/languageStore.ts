import { create } from "zustand";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { displayLabel, localizeError, resolvePreviewLocale, translate, type LanguagePreference, type LanguageState, type MessageKey, type MessageParams } from "../i18n";

const numberFormatters = {
  "zh-CN": new Intl.NumberFormat("zh-CN"),
  en: new Intl.NumberFormat("en"),
};

interface LanguageStore extends LanguageState {
  hydrated: boolean;
  busy: boolean;
  error: string | null;
  failure: "load" | "save" | null;
  saved: boolean;
  hydrate: () => Promise<void>;
  requestedPreference: LanguagePreference | null;
  setPreference: (preference: LanguagePreference) => Promise<void>;
}

function previewLocale() {
  return resolvePreviewLocale(typeof navigator === "undefined" ? [] : navigator.languages.length ? navigator.languages : [navigator.language]);
}

export const useLanguageStore = create<LanguageStore>((set, get) => ({
  preference: "auto",
  effective: isTauri() ? "en" : previewLocale(),
  hydrated: false,
  busy: false,
  error: null,
  failure: null,
  saved: false,
  requestedPreference: null,
  hydrate: async () => {
    if (get().busy) return;
    set({ busy: true, saved: false, error: null, failure: null });
    try {
      const state = isTauri()
        ? await invoke<LanguageState>("get_language_state")
        : { preference: get().preference, effective: get().preference === "auto" ? previewLocale() : get().preference as LanguageState["effective"] };
      set({ ...state, hydrated: true });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), failure: "load" });
    } finally {
      set({ busy: false });
    }
  },
  setPreference: async (preference) => {
    if (get().busy || !get().hydrated) return;
    set({ busy: true, saved: false, error: null, failure: null, requestedPreference: preference });
    try {
      const native = isTauri();
      const state = native
        ? await invoke<LanguageState>("set_language", { preference })
        : { preference, effective: preference === "auto" ? previewLocale() : preference };
      // Only the native acknowledgement may change persisted preference/effective state.
      set({ ...state, saved: native, requestedPreference: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), failure: "save" });
    } finally {
      set({ busy: false });
    }
  },
}));

export function useLocale() {
  const locale = useLanguageStore((state) => state.effective);
  return {
    locale,
    t: (key: MessageKey, params?: MessageParams) => translate(locale, key, params),
    label: (value: string) => displayLabel(locale, value),
    errorText: (value: unknown) => localizeError(locale, value),
    number: (value: number) => numberFormatters[locale].format(value),
  };
}
