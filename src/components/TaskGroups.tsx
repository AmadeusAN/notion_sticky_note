import { useLocale } from "../stores/languageStore";
import { memo, useEffect, useMemo, useRef } from "react";
import { TaskItem } from "./TaskItem";
import { useTaskStore } from "../stores/taskStore";
import { useSettingsStore } from "../stores/settingsStore";
import { isNotionConfigured, type Group, type Task } from "../types";

interface Props {
  onAddTasks: (groupId: string) => void;
  onConfirmGroup: (group: Group) => void;
  onConfirmTask: (task: Task) => void;
}

type TaskIndex = Map<string, Task[]>;
const EMPTY_TASKS: Task[] = [];

function indexTasks(tasks: Task[], previous: TaskIndex): TaskIndex {
  const index: TaskIndex = new Map();
  for (const task of tasks) {
    const bucket = index.get(task.groupId);
    if (bucket) bucket.push(task);
    else index.set(task.groupId, [task]);
  }
  // Store reconciliation preserves unchanged Task objects. Keep their group bucket
  // too, so an unrelated group's update does not invalidate a memoized section.
  for (const [groupId, bucket] of index) {
    const before = previous.get(groupId);
    if (before && before.length === bucket.length && bucket.every((task, i) => task === before[i])) {
      index.set(groupId, before);
    }
  }
  return index;
}

function NotionEmpty() {
  const l = useLocale();
  const configured = useSettingsStore((s) => isNotionConfigured(s.savedNotion));
  const status = useTaskStore((s) => s.syncState.status);
  const lastSuccessfulAt = useTaskStore((s) => s.syncState.lastSuccessfulAt);
  return (
    <div className="group-empty" role="status">
      {!configured ? l.t("配置 Notion 后即可同步今天的任务。")
        : status === "syncing" ? l.t("正在从 Notion 同步…")
        : status === "error" ? l.t("同步失败；已有缓存未被替换，请重试。")
        : lastSuccessfulAt === null ? l.t("尚未完成首次同步。")
        : l.t("今天没有符合日期筛选的任务。")}
    </div>
  );
}

interface SectionProps extends Props {
  group: Group;
  tasks: Task[];
}

const TaskGroup = memo(function TaskGroup({ group, tasks, onAddTasks, onConfirmGroup, onConfirmTask }: SectionProps) {
  const l = useLocale();
  const groupName = group.kind === "notion" ? l.t("来自 Notion") : group.kind === "archive" ? l.t("归档") : group.name;
  const isLocal = group.kind === "local";
  const isArchive = group.kind === "archive";
  const pending = useTaskStore((s) => s.pendingGroups[group.id]);
  const busy = useTaskStore((s) => Boolean(s.busyGroups[group.id]));
  const clearingArchive = useTaskStore((s) => isArchive && s.clearingArchive);
  const notionConfigured = useSettingsStore((s) => group.kind === "notion" && isNotionConfigured(s.savedNotion));

  return (
    <section className="group" aria-label={groupName}>
      <header className="group-header">
        <span className={`group-badge group-badge-${group.kind}`} aria-hidden>
          {group.kind === "notion" ? "N" : isArchive ? "A" : "L"}
        </span>
        <h2 className="group-title">{groupName}</h2>
        <span className="group-count">{l.number(tasks.length)}</span>
        <div className="group-actions">
          {isLocal && (
            <button
              type="button"
              className="group-add"
              title={l.t("在「{name}」新建", { name: group.name })}
              aria-label={l.t("新建任务")}
              disabled={Boolean(pending)}
              aria-busy={pending === "import"}
              onClick={() => onAddTasks(group.id)}
            >
              ＋
            </button>
          )}
          {(isLocal || isArchive) && (
            <button
              type="button"
              className="group-del"
              title={isArchive ? l.t("清空 Archive 中的任务") : l.t("删除分组「{name}」", { name: group.name })}
              aria-label={isArchive ? l.t("清空归档") : l.t("删除分组")}
              disabled={busy || Boolean(pending) || clearingArchive || (isArchive && tasks.length === 0)}
              aria-busy={isArchive ? clearingArchive : pending === "delete"}
              onClick={() => onConfirmGroup(group)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></svg>
            </button>
          )}
        </div>
      </header>
      {group.kind === "notion" && !notionConfigured && tasks.length > 0 && (
        <p className="group-empty" role="status">{l.t("请先在设置中配置 Notion；已有缓存仍保留。")}</p>
      )}
      <div className="group-tasks">
        {tasks.length === 0 ? (
          group.kind === "notion" ? <NotionEmpty /> : (
            <div className="group-empty">
              {isArchive ? l.t("已完成的本地任务会移到这里，由你决定何时清空。")
                : l.t("还没有任务，点右上 ＋ 新建。")}
            </div>
          )
        ) : tasks.map((task) => (
          <TaskItem key={task.id} task={task} onDelete={isLocal || isArchive ? onConfirmTask : undefined} />
        ))}
      </div>
    </section>
  );
});

export const TaskGroups = memo(function TaskGroups({ onAddTasks, onConfirmGroup, onConfirmTask }: Props) {
  const tasks = useTaskStore((s) => s.tasks);
  const groups = useTaskStore((s) => s.groups);
  const previousIndex = useRef<TaskIndex | null>(null);
  const taskIndex = useMemo(() => indexTasks(tasks, previousIndex.current ?? new Map()), [tasks]);
  useEffect(() => { previousIndex.current = taskIndex; }, [taskIndex]);
  const orderedGroups = useMemo(() => {
    const rank = (group: Group) => group.kind === "notion" ? 0 : group.kind === "archive" ? 2 : 1;
    return [...groups].sort((a, b) => rank(a) - rank(b) || a.position - b.position);
  }, [groups]);

  return orderedGroups.map((group) => (
    <TaskGroup
      key={group.id}
      group={group}
      tasks={taskIndex.get(group.id) ?? EMPTY_TASKS}
      onAddTasks={onAddTasks}
      onConfirmGroup={onConfirmGroup}
      onConfirmTask={onConfirmTask}
    />
  ));
});
