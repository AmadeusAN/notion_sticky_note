import { useLocale } from "../stores/languageStore";
import { formatReminderBadge } from "../services/taskDate";
import type { Task } from "../types";

interface Props {
  reminders: Task[];
  onComplete: (id: string) => Promise<void>;
  onInspect?: (task: Task) => void;
}

export function ReminderAlert({ reminders, onComplete, onInspect }: Props) {
  const l = useLocale();
  if (reminders.length === 0) return null;

  return (
    <div className="reminder-float-stack" role="region" aria-label={l.t("提醒到点")}>
      {reminders.map((task) => {
        const timeLabel = task.reminderAt ? formatReminderBadge(task.reminderAt, l.locale) : null;
        return (
          <div
            key={task.id}
            className="reminder-alert-card"
            role="status"
            onClick={() => onInspect?.(task)}
          >
            <div className="reminder-bell-badge" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <div className="reminder-alert-body">
              <span className="reminder-alert-eyebrow">
                {l.t("提醒到点")}
                {timeLabel ? ` · ${timeLabel}` : ""}
              </span>
              <span className="reminder-alert-title">{task.title}</span>
            </div>
            <button
              type="button"
              className="reminder-done-btn"
              onClick={(e) => {
                e.stopPropagation();
                void onComplete(task.id);
              }}
            >
              {l.t("立即完成")}
            </button>
          </div>
        );
      })}
    </div>
  );
}
