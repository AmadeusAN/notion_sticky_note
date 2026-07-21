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
      notion: {
        token: "",
        databaseId: "",
        doneProperty: "done?",
        titleProperty: "Name",
        dateProperty: "Date",
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
