import { useLanguageStore } from "../stores/languageStore";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type * as TauriApi from "../services/tauriApi";
import type { Group, Task, TaskImportResult } from "../types";

vi.mock("../services/tauriApi", async (importOriginal) => ({
  ...(await importOriginal<typeof TauriApi>()),
  apiImportTasks: vi.fn(),
  apiCreateGroup: vi.fn(),
}));
// Decorative rendering has separate runtime/visual coverage; these tests exercise task commits.
vi.mock("./NoteEdgeEffects", () => ({ NoteEdgeEffects: () => null }));

import { StickyNote } from "./StickyNote";
import { useTaskStore } from "../stores/taskStore";
import { apiCreateGroup, apiImportTasks } from "../services/tauriApi";

const reactEnvironment: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
const original = useTaskStore.getState();
const local: Group = { id: "local", name: "Existing", kind: "local", position: 1, createdAt: 1 };
const created: Group = { ...local, id: "created", name: "New group", position: 2, createdAt: 2 };
const task: Task = { id: "new-task", notionId: null, title: "First task", completed: false,
  progress: null, remain: null, date: null, tags: [], updatedTime: 2, groupId: created.id };
let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  useLanguageStore.setState({ preference: "zh-CN", effective: "zh-CN", hydrated: true });
  vi.resetAllMocks();
  useTaskStore.setState({ ...original, groups: [
    { ...local, id: "notion", name: "Notion", kind: "notion", position: 0 },
    local, { ...local, id: "archive", name: "Archive", kind: "archive" },
  ], tasks: [] }, true);
  vi.mocked(apiCreateGroup).mockResolvedValue(created);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<StickyNote dock={{ revision: 0, phase: "free", edge: null, presented: true }} onOpenSettings={() => {}} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useTaskStore.setState(original, true);
});

function button(selector: string): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>(selector);
  if (!element) throw new Error(`Missing button: ${selector}`);
  return element;
}

async function fill(label: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!input || !setValue) throw new Error(`Missing input: ${label}`);
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function newGroupWithFirstTask() {
  await act(async () => button('button[aria-label="新建内容"]').click());
  await act(async () => button(".chip-new").click());
  await fill("任务内容", task.title);
  await fill("分组名称", created.name);
}

it("submits a new group and its first task as one atomic import and blocks duplicate submits", async () => {
  // Node 20 does not provide Promise.withResolvers().
  let resolve!: (result: TaskImportResult) => void;
  const pending = new Promise<TaskImportResult>((done) => { resolve = done; });
  vi.mocked(apiImportTasks).mockReturnValueOnce(pending);
  try {
    await newGroupWithFirstTask();
    await act(async () => button(".composer-actions .btn-primary").click());
    expect(button(".composer-actions .btn-primary").disabled).toBe(true);
    await act(async () => button(".composer-actions .btn-primary").click());
    expect(apiImportTasks).toHaveBeenCalledTimes(1);
    expect(apiImportTasks).toHaveBeenCalledWith([task.title], null, created.name);
    expect(apiCreateGroup).not.toHaveBeenCalled();
    await act(async () => { resolve({ group: created, tasks: [task] }); await pending; });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain(task.title);
    expect(useTaskStore.getState().groups.some((group) => group.id === created.id)).toBe(true);
  } finally {
    await act(async () => { resolve({ group: created, tasks: [task] }); await pending; });
  }
});

it("a failed atomic import leaves no empty group and preserves the entered draft for retry", async () => {
  vi.mocked(apiImportTasks).mockRejectedValueOnce(new Error("Transaction rejected"));
  await newGroupWithFirstTask();
  await act(async () => button(".composer-actions .btn-primary").click());
  expect(container.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain("Transaction rejected");
  expect(container.querySelector<HTMLInputElement>('input[aria-label="任务内容"]')?.value).toBe(task.title);
  expect(container.querySelector<HTMLInputElement>('input[aria-label="分组名称"]')?.value).toBe(created.name);
  expect(useTaskStore.getState().groups.some((group) => group.id === created.id)).toBe(false);
  expect(useTaskStore.getState().tasks).toEqual([]);
  expect(apiCreateGroup).not.toHaveBeenCalled();
  expect(button(".composer-actions .btn-primary").disabled).toBe(false);
});

it("localizes the complete English task surface without changing task or group content", async () => {
  await act(async () => {
    useLanguageStore.setState({ preference: "en", effective: "en" });
    useTaskStore.setState({ tasks: [{ ...task, groupId: local.id, title: "用户内容；keep, intact" }],
      syncState: { ...original.syncState, status: "ok", lastSuccessfulAt: 1, pendingCount: 1, unresolvedCount: 0 } });
  });
  expect(container.querySelector("h1")?.textContent).toBe("My sticky note");
  expect(container.querySelector('[aria-label="Create content"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Import tasks"]')).not.toBeNull();
  expect(container.querySelector(".task-text")?.textContent).toBe("用户内容；keep, intact");
  expect(container.querySelector(".note-footer")?.textContent).toContain("1 pending change");
  expect(container.querySelector(".note-footer")?.textContent).toContain("1 task");
  await act(async () => button(".task-del").click());
  expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain("Permanently delete “用户内容；keep, intact”?");
  expect(container.querySelector('[role="alertdialog"] button')?.textContent).toBe("Cancel");
  await act(async () => container.querySelector<HTMLButtonElement>('[role="alertdialog"] button')!.click());
  await act(async () => button('button[aria-label="Import tasks"]').click());
  expect(container.querySelector("textarea")?.getAttribute("aria-label")).toBe("Task import text");
  expect(container.querySelector(".import-hint")?.textContent).toContain("Ctrl+Enter imports");
  expect(container.querySelector(".import-count")?.textContent).toBe("Preview · 0 tasks");
  expect(useTaskStore.getState().groups.find((group) => group.id === local.id)?.name).toBe("Existing");
});
