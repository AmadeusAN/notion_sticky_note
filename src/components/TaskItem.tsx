import { useLocale } from "../stores/languageStore";
import { memo } from "react";
import { formatTaskDate } from "../i18n";
import type { Task } from "../types";
import { useTaskStore } from "../stores/taskStore";
import { useSettingsStore } from "../stores/settingsStore";
import { isNotionConfigured, NOTION_GROUP_ID } from "../types";
import type { SortableItemProps } from "./useSortableList";

interface Props {
  task: Task;
  /** When provided (local tasks only), show a delete control. */
  onDelete?: (task: Task) => void;
  canDrag?: boolean;
  sortable?: SortableItemProps;
}

export const TaskItem = memo(function TaskItem({ task, onDelete, canDrag = false, sortable }: Props) {
  const l = useLocale();
  const toggleTask = useTaskStore((s) => s.toggleTask);
  const configured = useSettingsStore((s) => isNotionConfigured(s.savedNotion));
  const needsConfiguration = Boolean(task.notionId || task.groupId === NOTION_GROUP_ID) && !configured;
  const pending = useTaskStore((s) => s.pendingTasks[task.id]);
  const groupDeleting = useTaskStore((s) => s.pendingGroups[task.groupId] === "delete");
  const archiveBusy = useTaskStore((s) => s.clearingArchive && !task.notionId);
  const busy = Boolean(pending) || groupDeleting || archiveBusy;
  const canDelete = Boolean(onDelete) && !task.notionId && task.groupId !== NOTION_GROUP_ID;

  const canDragRow = canDrag && !busy;
  const itemClass = [
    "task-item",
    task.completed ? "done" : "",
    canDragRow ? "is-draggable" : "",
    sortable?.className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={sortable?.ref}
      style={sortable?.style}
      className={itemClass}
      aria-busy={Boolean(pending)}
      data-busy={Boolean(pending)}
      data-drag-active={sortable?.["data-drag-active"]}
      onPointerDown={canDragRow ? sortable?.onPointerDown : undefined}
    >
      <button
        type="button"
        className="task-check"
        data-checked={task.completed}
        aria-checked={task.completed}
        role="checkbox"
        disabled={needsConfiguration || busy}
        title={needsConfiguration ? l.t("请先在设置中配置 Notion，再修改完成状态") : undefined}
        onClick={() => void toggleTask(task.id)}
        aria-label={needsConfiguration ? l.t("请先配置 Notion，暂不能修改完成状态") : pending === "delete" ? l.t("正在删除任务") : pending ? l.t("正在保存完成状态") : task.completed ? l.t("标记未完成") : l.t("标记完成")}
      >
        {pending && <span className="task-pending-mark" aria-hidden>…</span>}
      </button>
      <div className="task-body">
        <p className="task-text">{task.title}</p>
        {(task.progress || task.remain || task.date || task.tags.length > 0) && (
          <div className="task-meta">
            {task.progress ? (
              <span className="meta-chip" data-kind="progress">
                {task.progress}
              </span>
            ) : null}
            {task.remain ? (
              <span className="meta-chip" data-kind="remain">
                {task.remain}
              </span>
            ) : null}
            {task.date ? (
              <span className="meta-chip" data-kind="date">
                {formatTaskDate(l.locale, task.date)}
              </span>
            ) : null}
            {task.tags.map((tag) => (
              <span className="meta-chip" data-kind="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
      {canDelete ? (
        <button
          disabled={busy}
          aria-busy={pending === "delete"}
          type="button"
          className="task-del"
          title={l.t("永久删除任务")}
          aria-label={l.t("删除任务「{title}」", { title: task.title })}
          onClick={() => onDelete?.(task)}
        >
          ×
        </button>
      ) : null}
    </div>
  );
});