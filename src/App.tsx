import { useEffect, useState } from "react";
import { StickyNote } from "./components/StickyNote";
import { SettingsPanel } from "./components/SettingsPanel";
import { useTaskStore } from "./stores/taskStore";
import { useSettingsStore } from "./stores/settingsStore";
import { themes } from "./themes";
import { fonts, ensureFontLoaded } from "./fonts";

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const themeId = useSettingsStore((s) => s.theme);
  const fontId = useSettingsStore((s) => s.font);
  const hydrate = useSettingsStore((s) => s.hydrate);
  const loadTasks = useTaskStore((s) => s.loadTasks);
  const startPolling = useTaskStore((s) => s.startPolling);
  const stopPolling = useTaskStore((s) => s.stopPolling);
  const theme = themes[themeId] ?? themes.paper;
  const font = fonts[fontId] ?? fonts.hand;

  useEffect(() => {
    void hydrate();
    void loadTasks();
    startPolling();
    return () => stopPolling();
  }, [hydrate, loadTasks, startPolling, stopPolling]);

  const startSystemThemeListener = useSettingsStore(
    (s) => s.startSystemThemeListener,
  );

  useEffect(() => {
    return startSystemThemeListener();
  }, [startSystemThemeListener]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeId;
    document.documentElement.dataset.surface = theme.surface;
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
    document.documentElement.style.setProperty("--note-shadow", theme.shadow);
    document.documentElement.style.setProperty("--note-border", theme.border);
    document.documentElement.style.setProperty(
      "--note-blur",
      theme.blur ? "12px" : "0px",
    );
    document.documentElement.style.setProperty(
      "--note-opacity",
      String(theme.opacity),
    );
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
    <div className={`app-shell theme-${themeId}`}>
      {showSettings ? (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      ) : (
        <StickyNote onOpenSettings={() => setShowSettings(true)} />
      )}
    </div>
  );
}

export default App;
