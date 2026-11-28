import { useLocale } from "../stores/languageStore";
import { memo } from "react";
import { formatReminderBadge, formatScheduleBadge } from "../services/taskDate";
import type { Task } from "../types";
import { useTaskStore } from "../stores/taskStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useToastStore } from "../stores/toastStore";
import { ARCHIVE_GROUP_ID, isNotionConfigured, NOTION_GROUP_ID } from "../types";
import type { SortableItemProps } from "./useSortableList";

interface Props {
  task: Task;
  /** When provided (local tasks only), show a delete control. */
  onDelete?: (task: Task) => void;
  onEdit?: (task: Task) => void;
  canDrag?: boolean;
  sortable?: SortableItemProps;
}

export const TaskItem = memo(function TaskItem({ task, onDelete, onEdit, canDrag = false, sortable }: Props) {
  const l = useLocale();
  const toggleTask = useTaskStore((s) => s.toggleTask);
  const configured = useSettingsStore((s) => isNotionConfigured(s.savedNotion));
  const needsConfiguration = Boolean(task.notionId || task.groupId === NOTION_GROUP_ID) && !configured;
  const pending = useTaskStore((s) => s.pendingTasks[task.id]);
  const groupDeleting = useTaskStore((s) => s.pendingGroups[task.groupId] === "delete");
  const archiveBusy = useTaskStore((s) => s.clearingArchive && !task.notionId);
  const busy = Boolean(pending) || groupDeleting || archiveBusy;
  const canDelete = Boolean(onDelete) && !task.notionId && task.groupId !== NOTION_GROUP_ID;
  const canEdit = Boolean(onEdit) && !needsConfiguration && task.groupId !== ARCHIVE_GROUP_ID && !task.completed;
  const syncStatus = task.syncStatus ?? (task.notionId ? "synced" : task.startDate ? "local" : "unscheduled");
  const scheduleLabel = formatScheduleBadge(task, l.locale);
  const reminderLabel = task.reminderAt ? formatReminderBadge(task.reminderAt, l.locale) : null;

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
        onClick={() => {
          const prevCompleted = task.completed;
          void toggleTask(task.id).then(() => {
            const next = useTaskStore.getState().tasks.find((t) => t.id === task.id);
            if (next && next.completed !== prevCompleted) {
              useToastStore.getState().pushToast(
                next.completed ? l.t("已完成任务") : l.t("已重新打开任务"),
              );
            }
          });
        }}
        aria-label={needsConfiguration ? l.t("请先配置 Notion，暂不能修改完成状态") : pending === "delete" ? l.t("正在删除任务") : pending ? l.t("正在保存完成状态") : task.completed ? l.t("标记未完成") : l.t("标记完成")}
      >
        {pending && <span className="task-pending-mark" aria-hidden>…</span>}
      </button>
      <div className="task-body">
        <div className="task-title-line">
          <p className="task-text">{task.title}</p>
          <span
            className={`task-sync-badge is-${syncStatus}`}
            title={
              syncStatus === "synced"
                ? l.t("已同步到 Notion")
                : syncStatus === "pending"
                  ? l.t("等待同步到 Notion")
                  : syncStatus === "unscheduled"
                    ? l.t("未排期（暂不同步）")
                    : l.t("仅本地保存")
            }
            aria-label={
              syncStatus === "synced"
                ? l.t("已同步到 Notion")
                : syncStatus === "pending"
                  ? l.t("等待同步到 Notion")
                  : syncStatus === "unscheduled"
                    ? l.t("未排期（暂不同步）")
                    : l.t("仅本地保存")
            }
          >
            {syncStatus === "synced" ? "✓" : syncStatus === "pending" ? "↻" : "○"}
          </span>
        </div>
        {(task.progress || task.remain || scheduleLabel || reminderLabel || task.tags.length > 0) && (
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
            {scheduleLabel ? (
              canEdit ? (
                <button
                  type="button"
                  className="meta-chip meta-chip-btn"
                  data-kind="date"
                  disabled={busy}
                  onClick={() => onEdit?.(task)}
                  title={l.t("编辑任务与时间")}
                >
                  {scheduleLabel}
                </button>
              ) : (
                <span className="meta-chip" data-kind="date">
                  {scheduleLabel}
                </span>
              )
            ) : null}
            {reminderLabel ? (
              canEdit ? (
                <button
                  type="button"
                  className={`meta-chip meta-chip-btn meta-chip-reminder${task.remindedAt ? " is-reminded" : ""}`}
                  data-kind="reminder"
                  disabled={busy}
                  onClick={() => onEdit?.(task)}
                  title={l.t("编辑任务与时间")}
                >
                  🔔 {reminderLabel}
                </button>
              ) : (
                <span className={`meta-chip meta-chip-reminder${task.remindedAt ? " is-reminded" : ""}`} data-kind="reminder">
                  🔔 {reminderLabel}
                </span>
              )
            ) : null}
            {task.tags.map((tag) => (
              <span className="meta-chip" data-kind="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
      {canEdit ? (
        <button
          disabled={busy}
          type="button"
          className="task-edit"
          title={l.t("编辑任务与时间")}
          aria-label={l.t("编辑任务「{title}」", { title: task.title })}
          onClick={() => onEdit?.(task)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5v5l3 2" />
          </svg>
        </button>
      ) : null}
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