import { useLanguageStore } from "../stores/languageStore";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskItem } from "./TaskItem";
import { ConfirmDialog } from "./ConfirmDialog";
import { useSettingsStore } from "../stores/settingsStore";
import { useTaskStore } from "../stores/taskStore";
import type { Task } from "../types";

const reactEnvironment: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
const originalSettings = useSettingsStore.getState();
const originalTasks = useTaskStore.getState();
const task: Task = {
  id: "fixture-page", notionId: "fixture-page", groupId: "notion", title: "Cached task",
  completed: false, progress: null, remain: null, date: null, tags: [], updatedTime: 1,
};
let container: HTMLDivElement;
let root: Root;
const toggle = vi.fn(async () => {});

beforeEach(() => {
  useLanguageStore.setState({ preference: "zh-CN", effective: "zh-CN", hydrated: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  toggle.mockClear();
  useTaskStore.setState({ ...originalTasks, toggleTask: toggle, tasks: [], pendingTasks: {}, pendingGroups: {}, busyGroups: {}, clearingArchive: false }, true);
  useSettingsStore.setState({
    savedNotion: { ...originalSettings.savedNotion, token: "", databaseId: "" },
    notion: { ...originalSettings.notion, token: "", databaseId: "" },
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useSettingsStore.setState(originalSettings, true);
  useTaskStore.setState(originalTasks, true);
});

it("preserves a cached Notion task but blocks changes until configuration is saved", async () => {
  await act(async () => root.render(<TaskItem task={task} />));
  const checkbox = container.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
  expect(container.textContent).toContain("Cached task");
  expect(checkbox.disabled).toBe(true);
  expect(checkbox.getAttribute("aria-label")).toContain("配置 Notion");
  await act(async () => checkbox.click());
  expect(toggle).not.toHaveBeenCalled();
  await act(async () => useSettingsStore.setState({ notion: { ...originalSettings.notion, token: "fixture", databaseId: "fixture" } }));
  expect(checkbox.disabled).toBe(true);
  await act(async () => useSettingsStore.setState({ savedNotion: { ...originalSettings.savedNotion, token: "fixture", databaseId: "fixture" } }));
  expect(checkbox.disabled).toBe(false);
  await act(async () => checkbox.click());
  expect(toggle).toHaveBeenCalledWith(task.id);
});

it("keeps local tasks operable without Notion configuration", async () => {
  await act(async () => root.render(<TaskItem task={{ ...task, notionId: null, groupId: "local-fixture" }} />));
  const checkbox = container.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
  expect(checkbox.disabled).toBe(false);
  await act(async () => checkbox.click());
  expect(toggle).toHaveBeenCalledWith(task.id);
});

const localTask: Task = { ...task, notionId: null, groupId: "local-fixture", title: "Local task" };

function DeletableTask({ onDelete }: { onDelete: (id: string) => Promise<void> }) {
  const currentTask = useTaskStore((s) => s.tasks.find((item) => item.id === localTask.id));
  const [confirmation, setConfirmation] = useState<Task | null>(null);
  return (
    <>
      <div inert={Boolean(confirmation)}>
        {currentTask ? <TaskItem task={currentTask} onDelete={setConfirmation} /> : <p role="status">任务已删除</p>}
      </div>
      {confirmation && (
        <ConfirmDialog
          title="永久删除任务"
          message={`永久删除任务「${confirmation.title}」？此操作无法撤销。`}
          confirmLabel="永久删除"
          onCancel={() => setConfirmation(null)}
          onConfirm={async () => {
            await onDelete(confirmation.id);
            setConfirmation(null);
          }}
        />
      )}
    </>
  );
}

it("keeps a local task until parent confirmation succeeds and returns focus after Escape or cancel", async () => {
  const remove = async (id: string) => {
    useTaskStore.setState((state) => ({ tasks: state.tasks.filter((item) => item.id !== id) }));
  };
  useTaskStore.setState({ tasks: [localTask] });
  await act(async () => root.render(<DeletableTask onDelete={remove} />));
  await act(async () => {
    container.querySelector<HTMLButtonElement>(".task-del")!.focus();
    container.querySelector<HTMLButtonElement>(".task-del")!.click();
  });
  expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain(`永久删除任务「${localTask.title}」？此操作无法撤销。`);
  expect(container.querySelector(".task-text")?.textContent).toBe(localTask.title);
  expect(document.activeElement?.textContent).toBe("取消");
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  expect(document.activeElement).toBe(container.querySelector(".task-del"));
  await act(async () => container.querySelector<HTMLButtonElement>(".task-del")!.click());
  await act(async () => container.querySelector<HTMLButtonElement>(".composer-actions .btn-ghost")!.click());
  expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  expect(document.activeElement).toBe(container.querySelector(".task-del"));
  const updated = { ...localTask, title: "Updated title before deletion" };
  await act(async () => useTaskStore.setState({ tasks: [updated] }));
  await act(async () => container.querySelector<HTMLButtonElement>(".task-del")!.click());
  expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain(updated.title);
  await act(async () => container.querySelector<HTMLButtonElement>(".composer-actions .btn-primary")!.click());
  expect(container.querySelector(".task-item")).toBeNull();
  expect(container.querySelector('[role="status"]')?.textContent).toBe("任务已删除");
});

it("preserves the task and shared confirmation on deletion failure and prevents duplicate in-flight deletion", async () => {
  let fail: ((error: Error) => void) | undefined;
  let attempts = 0;
  const remove = async (id: string) => {
    attempts++;
    useTaskStore.setState({ pendingTasks: { [id]: "delete" } });
    try {
      // This project targets ES2022, before Promise.withResolvers is available.
      if (attempts === 1) await new Promise<void>((_resolve, reject) => { fail = reject; });
      useTaskStore.setState((state) => ({ tasks: state.tasks.filter((item) => item.id !== id) }));
    } finally {
      useTaskStore.setState({ pendingTasks: {} });
    }
  };
  useTaskStore.setState({ tasks: [localTask] });
  await act(async () => root.render(<DeletableTask onDelete={remove} />));
  await act(async () => container.querySelector<HTMLButtonElement>(".task-del")!.click());
  const confirm = container.querySelector<HTMLButtonElement>(".composer-actions .btn-primary")!;
  await act(async () => { confirm.click(); confirm.click(); });
  expect(attempts).toBe(1);
  expect(confirm.disabled).toBe(true);
  expect(container.querySelector<HTMLButtonElement>(".composer-actions .btn-ghost")?.disabled).toBe(true);
  expect(container.querySelector('[role="checkbox"]')?.hasAttribute("disabled")).toBe(true);
  expect(container.querySelector(".task-item")?.getAttribute("aria-busy")).toBe("true");
  await act(async () => container.querySelector('[role="alertdialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
  await act(async () => fail!(new Error("磁盘暂时不可写")));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("磁盘暂时不可写");
  expect(container.querySelector(".task-text")?.textContent).toBe(localTask.title);
  expect(confirm.disabled).toBe(false);
  await act(async () => confirm.click());
  expect(container.querySelector(".task-item")).toBeNull();
  expect(container.querySelector('[role="status"]')?.textContent).toBe("任务已删除");
});

it("does not expose cached Notion deletion even when a delete handler is supplied", async () => {
  await act(async () => root.render(<TaskItem task={task} onDelete={() => {}} />));
  expect(container.querySelector(".task-text")?.textContent).toBe(task.title);
  expect(container.querySelector(".task-del")).toBeNull();
});
