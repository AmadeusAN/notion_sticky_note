import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "../stores/languageStore";
import { useTaskStore } from "../stores/taskStore";
import { useToastStore } from "../stores/toastStore";
import type { Group, Task, TaskScheduleInput, TaskUpdateInput } from "../types";
import { apiListenTaskReminder } from "../services/tauriApi";

export type Removal = { kind: "group"; group: Group } | { kind: "task"; task: Task };

export function useTaskActions() {
  const l = useLocale();
  const tasks = useTaskStore((s) => s.tasks);
  const createGroup = useTaskStore((s) => s.createGroup);
  const deleteGroup = useTaskStore((s) => s.deleteGroup);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const importTasks = useTaskStore((s) => s.importTasks);
  const storeUpdateTask = useTaskStore((s) => s.updateTask);
  const storeToggleTask = useTaskStore((s) => s.toggleTask);
  const clearArchive = useTaskStore((s) => s.clearArchive);
  const pushToast = useToastStore((s) => s.pushToast);

  const [composer, setComposer] = useState<{
    groupId: string | null;
    mode: "single" | "batch";
    initialSchedule?: TaskScheduleInput | null;
  } | null>(null);
  const [confirmation, setConfirmation] = useState<Removal | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [firedReminderIds, setFiredReminderIds] = useState<string[]>([]);

  const editingTask = useMemo(
    () => (editingTaskId ? tasks.find((t) => t.id === editingTaskId) ?? null : null),
    [editingTaskId, tasks],
  );
  const modalOpen = Boolean(composer || confirmation || editingTask);

  useEffect(() => {
    let alive = true;
    let cleanup: (() => void) | null = null;
    void apiListenTaskReminder((firedTask) => {
      if (!alive) return;
      setFiredReminderIds((prev) => (prev.includes(firedTask.id) ? prev : [...prev, firedTask.id]));
      useTaskStore.setState((state) => ({
        tasks: state.tasks.map((t) => (t.id === firedTask.id ? firedTask : t)),
      }));
    })
      .then((unlisten) => {
        if (alive) cleanup = unlisten;
        else unlisten();
      })
      .catch(() => {});
    return () => {
      alive = false;
      cleanup?.();
    };
  }, []);

  const activeReminders = useMemo(
    () =>
      tasks.filter(
        (t) => !t.completed && (Boolean(t.remindedAt) || firedReminderIds.includes(t.id)),
      ),
    [tasks, firedReminderIds],
  );

  const openComposer = useCallback(
    (
      groupId: string | null,
      mode: "single" | "batch" = "single",
      initialSchedule: TaskScheduleInput | null = null,
    ) => setComposer({ groupId, mode, initialSchedule }),
    [],
  );
  const addGroupTasks = useCallback((groupId: string) => setComposer({ groupId, mode: "single" }), []);
  const confirmGroup = useCallback((group: Group) => setConfirmation({ kind: "group", group }), []);
  const confirmTask = useCallback((task: Task) => setConfirmation({ kind: "task", task }), []);
  const editTask = useCallback((task: Task) => setEditingTaskId(task.id), []);

  const handleComposerSubmit = async (p: {
    titles: string[];
    groupId: string | null;
    newGroupName: string | null;
    schedule?: TaskScheduleInput;
  }) => {
    if (p.titles.length > 0) {
      await importTasks(p.titles, p.groupId, p.newGroupName, p.schedule);
      pushToast(l.t("已添加 {count} 条任务", { count: p.titles.length }));
    } else if (p.newGroupName && !p.groupId) {
      await createGroup(p.newGroupName);
      pushToast(l.t("已创建分组「{name}」", { name: p.newGroupName }));
    } else {
      throw new Error(l.t("请填写任务或新分组名称"));
    }
    setComposer(null);
  };

  const confirmRemoval = async () => {
    if (!confirmation) return;
    if (confirmation.kind === "task") {
      await deleteTask(confirmation.task.id);
      pushToast(l.t("已删除任务"));
    } else if (confirmation.group.kind === "archive") {
      await clearArchive();
      pushToast(l.t("已清空归档"));
    } else {
      await deleteGroup(confirmation.group.id);
      pushToast(l.t("已删除分组"));
    }
    setConfirmation(null);
  };

  const updateTask = useCallback(
    async (id: string, update: TaskUpdateInput) => {
      const updated = await storeUpdateTask(id, update);
      if (updated) {
        if (update.groupId) {
          pushToast(l.t("已移动到新分组"));
        } else if (update.updateSchedule && !update.title) {
          pushToast(l.t("已更新日程"));
        } else {
          pushToast(l.t("已保存任务更改"));
        }
      }
      return updated;
    },
    [l, pushToast, storeUpdateTask],
  );

  const toggleTask = useCallback(
    async (id: string) => {
      const prev = useTaskStore.getState().tasks.find((t) => t.id === id);
      if (!prev) return;
      await storeToggleTask(id);
      const next = useTaskStore.getState().tasks.find((t) => t.id === id);
      if (next && next.completed !== prev.completed) {
        pushToast(next.completed ? l.t("已完成任务") : l.t("已重新打开任务"));
      }
    },
    [l, pushToast, storeToggleTask],
  );

  const removalCount =
    confirmation?.kind === "group"
      ? tasks.reduce((count, task) => count + (task.groupId === confirmation.group.id ? 1 : 0), 0)
      : 0;

  const removal =
    confirmation &&
    (confirmation.kind === "task"
      ? {
          title: l.t("删除任务"),
          message: l.t("永久删除「{title}」？此操作无法撤销。", { title: confirmation.task.title }),
          label: l.t("永久删除"),
        }
      : confirmation.group.kind === "archive"
        ? {
            title: l.t("清空归档"),
            message: l.t("永久清空 {count} 条归档任务？此操作无法撤销，Notion 任务不受影响。", {
              count: removalCount,
            }),
            label: l.t("清空归档"),
          }
        : {
            title: l.t("删除分组"),
            message: l.t(
              "删除「{name}」及其中的 {count} 条任务？此操作无法撤销。属于此分组的已归档任务会保留，但之后无法恢复回此分组。",
              { name: confirmation.group.name, count: removalCount },
            ),
            label: l.t("删除分组"),
          });

  return {
    composer,
    setComposer,
    confirmation,
    setConfirmation,
    editingTask,
    setEditingTaskId,
    activeReminders,
    modalOpen,
    openComposer,
    addGroupTasks,
    confirmGroup,
    confirmTask,
    editTask,
    handleComposerSubmit,
    confirmRemoval,
    removal,
    updateTask,
    toggleTask,
  };
}
