import { useEffect, useState } from "react";
import { useLocale } from "../stores/languageStore";
import { ARCHIVE_GROUP_ID, NOTION_GROUP_ID, type Group, type Task, type TaskScheduleInput, type TaskUpdateInput } from "../types";
import { formatReminderBadge, formatScheduleBadge, validateSchedule } from "../services/taskDate";
import { ScheduleFields } from "./ScheduleFields";

interface Props {
  task: Task;
  groups: Group[];
  onSave: (id: string, update: TaskUpdateInput) => Promise<unknown>;
  onToggle: (id: string) => Promise<void>;
  onDelete: (task: Task) => void;
  onClose: () => void;
}

export function TaskInspector({ task, groups, onSave, onToggle, onDelete, onClose }: Props) {
  const l = useLocale();
  const isNotion = Boolean(task.notionId || task.groupId === NOTION_GROUP_ID);
  const isArchive = task.groupId === ARCHIVE_GROUP_ID;
  const readonly = isArchive;
  const localGroups = groups.filter((g) => g.kind === "local");
  const syncStatus = task.syncStatus ?? (task.notionId ? "synced" : task.startDate ? "local" : "unscheduled");

  const [title, setTitle] = useState(task.title);
  const [groupId, setGroupId] = useState(task.groupId);
  const [schedule, setSchedule] = useState<TaskScheduleInput>({
    startDate: task.startDate ?? null,
    endDate: task.endDate ?? null,
    startTime: task.startTime ?? null,
    endTime: task.endTime ?? null,
    reminderAt: task.reminderAt ?? null,
  });
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(task.title);
    setGroupId(task.groupId);
    setSchedule({
      startDate: task.startDate ?? null,
      endDate: task.endDate ?? null,
      startTime: task.startTime ?? null,
      endTime: task.endTime ?? null,
      reminderAt: task.reminderAt ?? null,
    });
    setJustSaved(false);
    setError(null);
  }, [task.id, task.title, task.groupId, task.startDate, task.endDate, task.startTime, task.endTime, task.reminderAt]);

  useEffect(() => {
    if (!justSaved) return;
    const timer = window.setTimeout(() => setJustSaved(false), 1600);
    return () => window.clearTimeout(timer);
  }, [justSaved]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const scheduleSummary = formatScheduleBadge(task, l.locale);
  const reminderSummary = task.reminderAt ? formatReminderBadge(task.reminderAt, l.locale) : null;

  const handleSave = async () => {
    if (readonly || busy) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setError(l.t("任务标题不能为空"));
      return;
    }
    const scheduleErr = validateSchedule(schedule);
    if (scheduleErr) {
      setError(l.errorText(scheduleErr));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await onSave(task.id, {
        title: trimmed,
        groupId: groupId !== task.groupId ? groupId : undefined,
        updateSchedule: true,
        ...schedule,
      });
      if (saved !== null) setJustSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="task-inspector" aria-label={l.t("任务详情")}>
      <div className="inspector-head">
        <button
          type="button"
          className={`inspector-complete-pill${task.completed ? " done" : ""}`}
          onClick={() => void onToggle(task.id)}
        >
          <span className="inspector-check-dot">{task.completed ? "✓" : ""}</span>
          <span>{task.completed ? l.t("已完成") : l.t("标记完成")}</span>
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={l.t("关闭")}
          title={l.t("关闭")}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="inspector-body">
        <div className="inspector-sync-banner" data-sync={syncStatus}>
          <span className={`task-sync-badge is-${syncStatus}`} aria-hidden="true">
            {syncStatus === "synced" ? "✓" : syncStatus === "pending" ? "↻" : "○"}
          </span>
          <span>
            {syncStatus === "synced"
              ? l.t("已同步到 Notion")
              : syncStatus === "pending"
                ? l.t("等待同步到 Notion")
                : syncStatus === "unscheduled"
                  ? l.t("未设置日期，仅保存在本地（拖入日历后开启同步）")
                  : l.t("仅本地保存")}
          </span>
        </div>
        {readonly ? (
          <>
            <p className="inspector-readonly-banner" role="status">
              {l.t("请先取消归档再编辑任务")}
            </p>
            <h3 className="inspector-readonly-title">{task.title}</h3>
            {(scheduleSummary || reminderSummary || task.progress || task.remain || task.tags.length > 0) && (
              <div className="inspector-meta-list">
                {scheduleSummary && (
                  <div className="inspector-meta-row">
                    <span>{l.t("日程时间")}</span>
                    <span className="meta-chip">{scheduleSummary}</span>
                  </div>
                )}
                {reminderSummary && (
                  <div className="inspector-meta-row">
                    <span>{l.t("提醒时间")}</span>
                    <span className="meta-chip meta-chip-reminder">🔔 {reminderSummary}</span>
                  </div>
                )}
                {task.progress && (
                  <div className="inspector-meta-row">
                    <span>Progress</span>
                    <span className="meta-chip">{task.progress}</span>
                  </div>
                )}
                {task.remain && (
                  <div className="inspector-meta-row">
                    <span>Remain</span>
                    <span className="meta-chip">{task.remain}</span>
                  </div>
                )}
                {task.tags.length > 0 && (
                  <div className="inspector-meta-row">
                    <span>Tags</span>
                    <div className="task-meta">
                      {task.tags.map((tag) => (
                        <span className="meta-chip" key={tag}>{tag}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <label className="schedule-field">
              <span>{l.t("任务内容")}</span>
              <input
                type="text"
                className="composer-input"
                aria-label={l.t("任务内容")}
                disabled={busy}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void handleSave();
                  }
                }}
              />
            </label>

            {localGroups.length > 0 && (
              <label className="schedule-field">
                <span>{l.t("所属分组")}</span>
                <select
                  className="composer-input schedule-input"
                  aria-label={l.t("所属分组")}
                  disabled={busy}
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                >
                  {localGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="inspector-divider" />
            <ScheduleFields value={schedule} onChange={setSchedule} disabled={busy} />
          </>
        )}

        {error && <p className="msg error" role="alert">{l.errorText(error)}</p>}
      </div>

      <div className="inspector-foot">
        {!isNotion && (
          <button
            type="button"
            className="btn-ghost inspector-del-btn"
            disabled={busy}
            onClick={() => onDelete(task)}
          >
            {l.t("删除任务")}
          </button>
        )}
        {!readonly && (
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !title.trim()}
            onClick={() => void handleSave()}
          >
            {busy ? l.t("保存中…") : justSaved ? `✓ ${l.t("已保存")}` : l.t("保存更改")}
          </button>
        )}
      </div>
    </aside>
  );
}
