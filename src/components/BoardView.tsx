import { useState } from "react";
import { useLocale } from "../stores/languageStore";
import type { Group, Task } from "../types";
import { formatReminderBadge, formatScheduleBadge } from "../services/taskDate";

interface Props {
  groups: Group[];
  tasks: Task[];
  selectedTaskId: string | null;
  onSelectTask: (task: Task) => void;
  onToggleTask: (id: string) => Promise<void>;
  onMoveTask: (taskId: string, groupId: string) => Promise<unknown>;
  onAddTasks: (groupId: string) => void;
  onCreateGroup: () => void;
  onDeleteGroup: (group: Group) => void;
}

export function BoardView({
  groups,
  tasks,
  selectedTaskId,
  onSelectTask,
  onToggleTask,
  onMoveTask,
  onAddTasks,
  onCreateGroup,
  onDeleteGroup,
}: Props) {
  const l = useLocale();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const rank = (kind: string) => (kind === "notion" ? 0 : kind === "archive" ? 2 : 1);
  const orderedGroups = [...groups].sort((a, b) => rank(a.kind) - rank(b.kind) || a.position - b.position);

  return (
    <div className="board-scroll">
      <div className="board-columns">
        {orderedGroups.map((group) => {
          const isLocal = group.kind === "local";
          const isArchive = group.kind === "archive";
          const colTasks = tasks.filter((t) => t.groupId === group.id);
          const groupTitle =
            group.kind === "notion"
              ? l.t("来自 Notion")
              : isArchive
                ? l.t("归档")
                : group.name;
          const isOver = dropTargetId === group.id;

          return (
            <section
              key={group.id}
              className={`board-column${isOver ? " is-drop-target" : ""}`}
              aria-label={groupTitle}
              onDragOver={(e) => {
                if (!isLocal) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dropTargetId !== group.id) setDropTargetId(group.id);
              }}
              onDragLeave={() => {
                if (dropTargetId === group.id) setDropTargetId(null);
              }}
              onDrop={(e) => {
                if (!isLocal) return;
                e.preventDefault();
                setDropTargetId(null);
                const taskId = e.dataTransfer.getData("text/sticky-task-id") || draggingId;
                setDraggingId(null);
                if (!taskId) return;
                const dragged = tasks.find((t) => t.id === taskId);
                if (!dragged || dragged.groupId === group.id) return;
                void onMoveTask(taskId, group.id);
              }}
            >
              <header className="board-col-head">
                <span className={`group-badge group-badge-${group.kind}`} aria-hidden>
                  {group.kind === "notion" ? "N" : isArchive ? "A" : "L"}
                </span>
                <h3 className="board-col-title">{groupTitle}</h3>
                <span className="group-count">{l.number(colTasks.length)}</span>
                <div className="board-col-actions">
                  {isLocal && (
                    <button
                      type="button"
                      className="group-add"
                      title={l.t("在「{name}」新建", { name: group.name })}
                      aria-label={l.t("新建任务")}
                      onClick={() => onAddTasks(group.id)}
                    >
                      ＋
                    </button>
                  )}
                  {(isLocal || isArchive) && colTasks.length > 0 && (
                    <button
                      type="button"
                      className="group-del"
                      title={isArchive ? l.t("清空 Archive 中的任务") : l.t("删除分组「{name}」", { name: group.name })}
                      aria-label={isArchive ? l.t("清空归档") : l.t("删除分组")}
                      onClick={() => onDeleteGroup(group)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></svg>
                    </button>
                  )}
                </div>
              </header>

              <div className="board-col-cards">
                {colTasks.length === 0 ? (
                  <div className="board-empty">
                    {isLocal ? l.t("拖拽或点 ＋ 添加任务") : l.t("暂无任务")}
                  </div>
                ) : (
                  colTasks.map((task) => {
                    const scheduleLabel = formatScheduleBadge(task, l.locale);
                    const reminderLabel = task.reminderAt ? formatReminderBadge(task.reminderAt, l.locale) : null;
                    const canDragCard = isLocal && !task.completed;
                    return (
                      <div
                        key={task.id}
                        draggable={canDragCard}
                        className={`board-card${task.completed ? " done" : ""}${selectedTaskId === task.id ? " is-selected" : ""}${draggingId === task.id ? " is-dragging-card" : ""}`}
                        onDragStart={(e) => {
                          if (!canDragCard) return;
                          e.dataTransfer.setData("text/sticky-task-id", task.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDraggingId(task.id);
                        }}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setDropTargetId(null);
                        }}
                        onClick={() => onSelectTask(task)}
                      >
                        <div className="board-card-top">
                          <button
                            type="button"
                            className="task-check"
                            data-checked={task.completed}
                            aria-checked={task.completed}
                            role="checkbox"
                            onClick={(e) => {
                              e.stopPropagation();
                              void onToggleTask(task.id);
                            }}
                          />
                          <span className="board-card-title">{task.title}</span>
                        </div>
                        {(scheduleLabel || reminderLabel || task.progress || task.tags.length > 0) && (
                          <div className="task-meta">
                            {scheduleLabel && <span className="meta-chip">{scheduleLabel}</span>}
                            {reminderLabel && (
                              <span className="meta-chip meta-chip-reminder">🔔 {reminderLabel}</span>
                            )}
                            {task.progress && <span className="meta-chip">{task.progress}</span>}
                            {task.tags.map((tag) => (
                              <span className="meta-chip" key={tag}>{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {isLocal && (
                <button
                  type="button"
                  className="board-col-footer-add"
                  onClick={() => onAddTasks(group.id)}
                >
                  {l.t("＋ 新建任务")}
                </button>
              )}
            </section>
          );
        })}

        <button type="button" className="board-add-group-col" onClick={onCreateGroup}>
          {l.t("＋ 新建分组")}
        </button>
      </div>
    </div>
  );
}
