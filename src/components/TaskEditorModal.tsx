import { useId, useRef, useState, type RefObject } from "react";
import { useLocale } from "../stores/languageStore";
import type { Task, TaskScheduleInput, TaskUpdateInput } from "../types";
import { validateSchedule } from "../services/taskDate";
import { ScheduleFields } from "./ScheduleFields";
import { useModalFocus } from "./useModalFocus";

interface Props {
  task: Task;
  onSave: (id: string, update: TaskUpdateInput) => Promise<unknown>;
  onCancel: () => void;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
}

export function TaskEditorModal({ task, onSave, onCancel, fallbackFocusRef }: Props) {
  const l = useLocale();
  const [title, setTitle] = useState(task.title);
  const [schedule, setSchedule] = useState<TaskScheduleInput>({
    startDate: task.startDate ?? null,
    endDate: task.endDate ?? null,
    startTime: task.startTime ?? null,
    endTime: task.endTime ?? null,
    reminderAt: task.reminderAt ?? null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const composing = useRef(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  useModalFocus(sheetRef, titleRef, fallbackFocusRef);

  const submit = async () => {
    if (submitting.current) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setError(l.t("任务标题不能为空"));
      return;
    }
    const scheduleError = validateSchedule(schedule);
    if (scheduleError) {
      setError(l.errorText(scheduleError));
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSave(task.id, {
        title: trimmed,
        updateSchedule: true,
        ...schedule,
      });
      onCancel();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <div
      className="composer-backdrop"
      onClick={() => {
        if (!submitting.current && !composing.current) onCancel();
      }}
      role="presentation"
    >
      <div
        ref={sheetRef}
        className="composer task-editor-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby={titleId}
        aria-modal="true"
        aria-busy={busy}
        tabIndex={-1}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(e) => {
          if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (!submitting.current) onCancel();
          }
        }}
      >
        <div className="composer-head">
          <span id={titleId} className="composer-title">
            {l.t("编辑任务与时间")}
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              if (!submitting.current) onCancel();
            }}
            aria-label={l.t("关闭")}
            disabled={busy}
          >
            ×
          </button>
        </div>

        <div className="composer-body">
          <input
            ref={titleRef}
            className="composer-input"
            aria-label={l.t("任务内容")}
            disabled={busy}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !composing.current &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                void submit();
              }
            }}
          />

          <ScheduleFields value={schedule} onChange={setSchedule} disabled={busy} />
          {error && <p role="alert">{l.errorText(error)}</p>}
        </div>

        <div className="composer-actions">
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => {
              if (!submitting.current) onCancel();
            }}
          >
            {l.t("取消")}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !title.trim()}
            onClick={() => void submit()}
          >
            {busy ? l.t("保存中…") : l.t("保存")}
          </button>
        </div>
      </div>
    </div>
  );
}
