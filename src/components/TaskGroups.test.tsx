import { useLanguageStore } from "../stores/languageStore";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskGroups } from "./TaskGroups";
import { useSettingsStore } from "../stores/settingsStore";
import { useTaskStore } from "../stores/taskStore";
import type { Group, Task } from "../types";

const reactEnvironment: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
const originalSettings = useSettingsStore.getState();
const originalTasks = useTaskStore.getState();
const notion: Group = { id: "notion", name: "Notion", kind: "notion", position: 99, createdAt: 1 };
const local: Group = { id: "local", name: "Local", kind: "local", position: 2, createdAt: 1 };
const other: Group = { id: "other", name: "Other", kind: "local", position: 3, createdAt: 1 };
const archive: Group = { id: "archive", name: "Archive", kind: "archive", position: -1, createdAt: 1 };
const task: Task = { id: "fixture", notionId: null, groupId: local.id, title: "Original title",
  completed: false, progress: "10%", remain: "9 days", date: "2026-11-15", tags: ["Original tag"], updatedTime: 1 };
const addTasks = vi.fn();
const confirmGroup = vi.fn();
const confirmTask = vi.fn();
let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  useLanguageStore.setState({ preference: "en", effective: "en", hydrated: true });
  addTasks.mockReset();
  confirmGroup.mockReset();
  confirmTask.mockReset();
  useTaskStore.setState({ ...originalTasks, groups: [archive, other, local, notion], tasks: [task],
    pendingTasks: {}, pendingGroups: {}, busyGroups: {}, clearingArchive: false,
    syncState: { ...originalTasks.syncState, status: "idle", lastSuccessfulAt: null } }, true);
  useSettingsStore.setState({ savedNotion: { ...originalSettings.savedNotion, token: "", databaseId: "" } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<TaskGroups onAddTasks={addTasks} onConfirmGroup={confirmGroup} onConfirmTask={confirmTask} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useTaskStore.setState(originalTasks, true);
  useSettingsStore.setState(originalSettings, true);
});

function section(name: string): HTMLElement {
  return container.querySelector<HTMLElement>(`section[aria-label="${name}"]`)!;
}

it("keeps complete changed metadata and completion visible with stable group objects", async () => {
  const longTitle = "A long task title, including a second line\n".repeat(10);
  const longTag = "Long project tag ".repeat(12);
  await act(async () => useTaskStore.setState({ tasks: [{ ...task, title: longTitle, completed: true,
    progress: "100% · finished", remain: "0 days", date: "2026-12-01 → 2026-12-31", tags: [longTag, "New tag"] }] }));
  const localSection = section("Local");
  expect(localSection.querySelector(".task-text")?.textContent).toBe(longTitle);
  expect(localSection.querySelector('[data-kind="progress"]')?.textContent).toBe("100% · finished");
  expect(localSection.querySelector('[data-kind="remain"]')?.textContent).toBe("0 days");
  expect(localSection.querySelector('[data-kind="date"]')?.textContent).toBe("Dec 1, 2026 → Dec 31, 2026");
  expect([...localSection.querySelectorAll('[data-kind="tag"]')].map((element) => element.textContent)).toEqual([longTag, "New tag"]);
  expect(localSection.querySelector('[role="checkbox"]')?.getAttribute("aria-checked")).toBe("true");
  expect(localSection.querySelector(".task-item")?.classList.contains("done")).toBe(true);
  expect(localSection.textContent).not.toContain("Original tag");
  await act(async () => useTaskStore.setState({ tasks: [{ ...task, progress: null, remain: null, date: null, tags: [] }] }));
  expect(localSection.querySelector(".task-meta")).toBeNull();
  expect(localSection.querySelector('[role="checkbox"]')?.getAttribute("aria-checked")).toBe("false");
});

it("moves a completed task into Archive and restores it to the current local group without stale buckets", async () => {
  const sibling = { ...task, id: "sibling", groupId: other.id, title: "Other task" };
  await act(async () => useTaskStore.setState({ tasks: [task, sibling] }));
  await act(async () => useTaskStore.setState({ tasks: [{ ...task, completed: true, groupId: archive.id }, sibling] }));
  expect(section("Local").querySelector(".task-item")).toBeNull();
  expect(section("Local").querySelector(".group-count")?.textContent).toBe("0");
  expect(section("Archive").querySelector(".task-text")?.textContent).toBe(task.title);
  expect(section("Archive").querySelector('[role="checkbox"]')?.getAttribute("aria-checked")).toBe("true");
  expect(section("Archive").querySelector<HTMLButtonElement>(".group-del")?.disabled).toBe(false);
  await act(async () => useTaskStore.setState({ tasks: [sibling, { ...task, groupId: other.id }] }));
  expect(section("Archive").querySelector(".task-item")).toBeNull();
  expect(section("Archive").querySelector<HTMLButtonElement>(".group-del")?.disabled).toBe(true);
  expect([...section("Other").querySelectorAll(".task-text")].map((element) => element.textContent)).toEqual(["Other task", task.title]);
  expect(section("Other").querySelector(".group-count")?.textContent).toBe("2");
});

it("updates group identity, name and ordering while keeping Notion first and Archive last", async () => {
  expect([...container.querySelectorAll(".group-title")].map((element) => element.textContent)).toEqual(["From Notion", "Local", "Other", "Archive"]);
  await act(async () => useTaskStore.setState({ groups: [archive, { ...local, name: "Renamed", position: 5 }, other, notion] }));
  expect([...container.querySelectorAll(".group-title")].map((element) => element.textContent)).toEqual(["From Notion", "Other", "Renamed", "Archive"]);
  expect(section("Renamed").querySelector(".task-text")?.textContent).toBe(task.title);
});

it("keeps pending gates current without changing task or group metadata and leaves unrelated groups usable", async () => {
  const sibling = { ...task, id: "sibling", groupId: other.id };
  const remote = { ...task, id: "remote", notionId: "page", groupId: notion.id };
  await act(async () => useTaskStore.setState({ tasks: [task, sibling, remote] }));
  await act(async () => useTaskStore.setState({ pendingGroups: { [local.id]: "delete" }, busyGroups: { [local.id]: 1 } }));
  expect(section("Local").querySelector<HTMLButtonElement>(".group-add")?.disabled).toBe(true);
  expect(section("Local").querySelector<HTMLButtonElement>(".group-del")?.disabled).toBe(true);
  expect(section("Local").querySelector<HTMLButtonElement>('[role="checkbox"]')?.disabled).toBe(true);
  expect(section("Local").querySelector<HTMLButtonElement>(".task-del")?.disabled).toBe(true);
  expect(section("Other").querySelector<HTMLButtonElement>(".group-add")?.disabled).toBe(false);
  expect(section("Other").querySelector<HTMLButtonElement>('[role="checkbox"]')?.disabled).toBe(false);
  await act(async () => useTaskStore.setState({ pendingGroups: {}, busyGroups: {}, pendingTasks: { [sibling.id]: "toggle" } }));
  expect(section("Local").querySelector<HTMLButtonElement>('[role="checkbox"]')?.disabled).toBe(false);
  expect(section("Other").querySelector<HTMLButtonElement>('[role="checkbox"]')?.disabled).toBe(true);
  expect(section("Other").querySelector(".task-item")?.getAttribute("aria-busy")).toBe("true");
  await act(async () => useTaskStore.setState({ pendingTasks: {}, clearingArchive: true }));
  expect(section("Local").querySelector<HTMLButtonElement>('[role="checkbox"]')?.disabled).toBe(true);
  await act(async () => useSettingsStore.setState({ savedNotion: { ...originalSettings.savedNotion, token: "fixture", databaseId: "fixture" } }));
  expect(section("From Notion").querySelector<HTMLButtonElement>('[role="checkbox"]')?.disabled).toBe(false);
  expect(section("From Notion").querySelector(".task-del")).toBeNull();
  expect(section("From Notion").querySelector(".group-actions")?.childElementCount).toBe(0);
});

it("distinguishes unconfigured, syncing, failed and successful empty Notion results", async () => {
  expect(section("From Notion").textContent).toContain("Configure Notion");
  await act(async () => useSettingsStore.setState({ notion: { ...originalSettings.notion, token: "draft", databaseId: "draft" } }));
  expect(section("From Notion").textContent).toContain("Configure Notion");
  await act(async () => useSettingsStore.setState({ savedNotion: { ...originalSettings.savedNotion, token: "fixture", databaseId: "fixture" } }));
  expect(section("From Notion").textContent).toContain("first sync has not completed");
  await act(async () => useTaskStore.setState({ syncState: { ...originalTasks.syncState, status: "syncing" } }));
  expect(section("From Notion").textContent).toContain("Syncing from Notion");
  await act(async () => useTaskStore.setState({ syncState: { ...originalTasks.syncState, status: "error" } }));
  expect(section("From Notion").textContent).toContain("Sync failed");
  await act(async () => useTaskStore.setState({ syncState: { ...originalTasks.syncState, status: "ok", lastSuccessfulAt: 1 } }));
  expect(section("From Notion").textContent).toContain("No tasks match today’s date filter");
});

it("updates fixed display names across locale changes without changing stored group names or user content", async () => {
  const before = useTaskStore.getState();
  await act(async () => useLanguageStore.setState({ preference: "zh-CN", effective: "zh-CN" }));
  expect([...container.querySelectorAll(".group-title")].map((element) => element.textContent)).toEqual(["来自 Notion", "Local", "Other", "归档"]);
  expect(section("Local").querySelector(".task-text")?.textContent).toBe(task.title);
  expect(useTaskStore.getState().groups).toBe(before.groups);
  expect(useTaskStore.getState().tasks).toBe(before.tasks);
  expect(before.groups.find((group) => group.kind === "archive")?.name).toBe("Archive");
});
