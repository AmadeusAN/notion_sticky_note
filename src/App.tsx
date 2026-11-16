import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { StickyNote } from "./components/StickyNote";
import { SettingsPanel } from "./components/SettingsPanel";
import { useTaskStore } from "./stores/taskStore";
import { useSettingsStore } from "./stores/settingsStore";
import { themes } from "./themes";
import { fonts, ensureFontLoaded } from "./fonts";
import { AppearanceFeedback } from "./components/AppearanceFeedback";
import { ExitSaveDialog } from "./components/ExitSaveDialog";
import { useDockStore } from "./stores/dockStore";
import { useFxAmbientPulse } from "./fx/useFxAmbientPulse";
import { useLanguageStore, useLocale } from "./stores/languageStore";

function App() {
  const l = useLocale();
  const languageFailure = useLanguageStore((s) => s.failure);
  const languageError = useLanguageStore((s) => s.error);
  const hydrateLanguage = useLanguageStore((s) => s.hydrate);
  const retryLanguagePreference = useLanguageStore((s) => s.requestedPreference);
  const setLanguagePreference = useLanguageStore((s) => s.setPreference);
  const languageBusy = useLanguageStore((s) => s.busy);
  useEffect(() => {
    document.documentElement.lang = l.locale;
    document.title = "Sticky Note";
  }, [l.locale]);
  const [showSettings, setShowSettings] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { shellRef.current?.scrollTo(0, 0); }, [showSettings]);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const themeId = useSettingsStore((s) => s.theme);
  const fontId = useSettingsStore((s) => s.font);
  const connectSettings = useSettingsStore((s) => s.connectSettings);
  const flushAppearance = useSettingsStore((s) => s.flushAppearance);
  const exitState = useSettingsStore((s) => s.exitSaveState);
  const exitDialogOpen = exitState.status === "error" || (exitState.status === "saving" && exitState.error !== null);
  const refreshTaskView = useTaskStore((s) => s.refreshTaskView);
  const connectSyncState = useTaskStore((s) => s.connectSyncState);
  const theme = themes[themeId] ?? themes.paper;
  const font = fonts[fontId] ?? fonts.hand;
  const dock = useDockStore((s) => s.snapshot);
  const connectDock = useDockStore((s) => s.connectDock);
  useFxAmbientPulse(dock.phase, dock.edge, dock.presented, dock.revision);

  useEffect(() => {
    const disconnectSync = connectSyncState();
    const disconnectSettings = connectSettings();
    const disconnectDock = connectDock();
    void refreshTaskView();
    return () => { disconnectSync(); disconnectSettings(); disconnectDock(); };
  }, [connectSettings, refreshTaskView, connectSyncState, connectDock, connectionAttempt]);

  const startSystemThemeListener = useSettingsStore(
    (s) => s.startSystemThemeListener,
  );

  useEffect(() => {
    return startSystemThemeListener();
  }, [startSystemThemeListener]);

  useEffect(() => {
    document.documentElement.dataset.dockPhase = dock.phase;
    document.documentElement.dataset.dockEdge = dock.edge ?? "";
    document.documentElement.dataset.dockPresented = String(dock.presented);
    return () => {
      delete document.documentElement.dataset.dockPhase;
      delete document.documentElement.dataset.dockEdge;
      delete document.documentElement.dataset.dockPresented;
    };
  }, [dock.phase, dock.edge, dock.presented]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeId;
    document.documentElement.dataset.surface = theme.surface;
    document.documentElement.dataset.mode = theme.mode;
    document.documentElement.style.setProperty("--note-bg", theme.background);
    document.documentElement.style.setProperty("--note-fg", theme.foreground);
    document.documentElement.style.setProperty("--note-muted", theme.muted);
    document.documentElement.style.setProperty("--note-accent", theme.accent);
    document.documentElement.style.setProperty("--note-pop", theme.pop);
    document.documentElement.style.setProperty("--note-pop-soft", theme.popSoft);
    document.documentElement.style.setProperty(
      "--note-tray",
      theme.tray ?? theme.background,
    );
    document.documentElement.style.setProperty(
      "--note-card",
      theme.card ?? theme.background,
    );
    document.documentElement.style.setProperty("--note-border", theme.border);
    document.documentElement.style.setProperty(
      "--note-radius",
      theme.surface === "paper"
        ? "2px 2px 10px 10px"
        : theme.surface === "layered" || theme.surface === "motion"
          ? "16px"
          : "12px",
    );
    document.documentElement.dataset.motion =
      theme.surface === "motion" ? "on" : "off";

  }, [theme, themeId]);

  useEffect(() => {
    ensureFontLoaded(fontId);
    document.documentElement.style.setProperty("--note-font", font.family);
  }, [font, fontId]);

  return (
    <div ref={shellRef} className={`app-shell theme-${themeId}`}>
      <div
        inert={exitDialogOpen}
        className="app-content"
        onPointerUpCapture={() => void flushAppearance()}
        onKeyUpCapture={() => void flushAppearance()}
        onBlurCapture={() => void flushAppearance()}
      >
        <div className="app-view">
        {!showSettings && languageError && <div className="msg error" role="alert">
          {l.t(languageFailure === "load" ? "语言读取失败：{error}" : "语言保存失败：{error}", { error: l.errorText(languageError) })}
          <button type="button" disabled={languageBusy}
            onClick={() => void (languageFailure === "load" ? hydrateLanguage() : retryLanguagePreference && setLanguagePreference(retryLanguagePreference))}>{l.t("重试")}</button>
        </div>}
        {showSettings ? (
          <SettingsPanel onClose={() => { void flushAppearance(); setShowSettings(false); }} />
        ) : (
          <StickyNote dock={dock} onOpenSettings={() => setShowSettings(true)} />
        )}
        </div>
        <AppearanceFeedback
          settingsOpen={showSettings}
          onOpenSettings={() => setShowSettings(true)}
          onRetryHydration={() => setConnectionAttempt((attempt) => attempt + 1)}
        />
      </div>
      <ExitSaveDialog />
    </div>
  );
}

export default App;
