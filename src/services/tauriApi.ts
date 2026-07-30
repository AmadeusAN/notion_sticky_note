import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, NotionConfig, Task } from "../types";
import { MOCK_TASKS } from "../types";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function apiGetTasks(): Promise<Task[]> {
  if (!isTauri()) return MOCK_TASKS;
  return invoke<Task[]>("get_tasks");
}

export async function apiToggleTask(id: string): Promise<Task> {
  if (!isTauri()) {
    const task = MOCK_TASKS.find((t) => t.id === id);
    if (!task) throw new Error("Task not found");
    task.completed = !task.completed;
    task.updatedTime = Date.now();
    return { ...task };
  }
  return invoke<Task>("toggle_task", { id });
}

export async function apiGetSettings(): Promise<AppSettings> {
  if (!isTauri()) {
    return {
      theme: "paper",
      lightTheme: "paper",
      darkTheme: "dark",
      font: "hand",
      fxTheme: "leaf",
      fxIntensity: 1,
      fxEdgeBoost: true,
      noteBg: "#f6f0df",
      noteFg: "#3a3226",
      noteAccent: "#c4a35a",
      notePop: "#e8a87c",
      dockHandle: "grip",
      notion: {
        token: "",
        databaseId: "",
        doneProperty: "done?",
        titleProperty: "Name",
        dateProperty: "Date",
        statusProperty: "Status",
        statusDoneValue: "Done",
        statusTodoValue: "Not started",
      },
    };
  }
  return invoke<AppSettings>("get_settings");
}

export async function apiSaveNotionConfig(config: NotionConfig): Promise<void> {
  if (!isTauri()) return;
  await invoke("save_notion_config", { config });
}

export async function apiSetTheme(theme: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_theme", { theme });
}

export async function apiSetLightTheme(theme: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_light_theme", { theme });
}

export async function apiSetDarkTheme(theme: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_dark_theme", { theme });
}

export async function apiSetFont(font: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_font", { font });
}

export async function apiSetFxTheme(theme: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_fx_theme", { theme });
}

export async function apiSetFxIntensity(intensity: number): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_fx_intensity", { intensity });
}

export async function apiSetFxEdgeBoost(boost: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_fx_edge_boost", { boost });
}

export async function apiSyncFxPalette(payload: {
  bg: string;
  fg: string;
  accent: string;
  pop: string;
}): Promise<void> {
  if (!isTauri()) return;
  await invoke("sync_fx_palette", payload);
}

export async function apiSetDockHandle(handle: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_dock_handle", { handle });
}

export async function apiForceSync(): Promise<string> {
  if (!isTauri()) return "ok";
  return invoke<string>("force_sync");
}

export async function apiTestNotionConnection(
  config: NotionConfig,
): Promise<string> {
  if (!isTauri()) return "Browser preview — connect via desktop app";
  return invoke<string>("test_notion_connection", { config });
}
