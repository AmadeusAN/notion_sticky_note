import { useEffect, useState } from "react";
import { useLocale } from "../stores/languageStore";
import type { TaskScheduleInput } from "../types";
import {
  computePresetReminder,
  formatDateTimeLocalInput,
  offsetDateIso,
  parseDateTimeLocalInput,
  todayIso,
} from "../services/taskDate";

interface Props {
  value: TaskScheduleInput;
  onChange: (next: TaskScheduleInput) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function ScheduleFields({ value, onChange, disabled = false, compact = false }: Props) {
  const l = useLocale();
  const [showCustomReminder, setShowCustomReminder] = useState(() =>
    Boolean(value.reminderAt && !value.startDate),
  );
  const [showTimeRange, setShowTimeRange] = useState(() => Boolean(value.startTime));

  useEffect(() => {
    if (value.startTime) setShowTimeRange(true);
    if (value.reminderAt && !value.startDate) setShowCustomReminder(true);
  }, [value.startTime, value.reminderAt, value.startDate]);

  const today = todayIso();
  const tomorrow = offsetDateIso(1);
  const plus2 = offsetDateIso(2);
  const hasSchedule = Boolean(value.startDate || value.reminderAt);

  const applyQuick = (startDate: string, endDate: string | null) => {
    onChange({
      ...value,
      startDate,
      endDate,
    });
  };

  const toggleTimeRange = () => {
    if (showTimeRange || value.startTime) {
      setShowTimeRange(false);
      onChange({ ...value, startTime: null, endTime: null });
    } else {
      const startDate = value.startDate ?? today;
      setShowTimeRange(true);
      onChange({
        ...value,
        startDate,
        startTime: "09:00",
        endTime: "10:00",
      });
    }
  };

  const applyPreset = (preset: "none" | "on_time" | "15m" | "1h" | "custom") => {
    if (preset === "none") {
      setShowCustomReminder(false);
      onChange({ ...value, reminderAt: null });
      return;
    }
    if (preset === "custom") {
      setShowCustomReminder(true);
      if (!value.reminderAt) {
        const base =
          computePresetReminder(value.startDate ?? today, value.startTime, "on_time") ??
          Date.now() + 15 * 60_000;
        onChange({ ...value, reminderAt: base });
      }
      return;
    }
    setShowCustomReminder(false);
    const startDate = value.startDate ?? today;
    const reminderAt = computePresetReminder(startDate, value.startTime, preset);
    onChange({
      ...value,
      startDate,
      reminderAt,
    });
  };

  return (
    <div className={`schedule-fields${compact ? " schedule-fields-compact" : ""}`}>
      <div className="schedule-quick-row">
        <button
          type="button"
          className={`chip${value.startDate === today && !value.endDate ? " active" : ""}`}
          disabled={disabled}
          onClick={() => applyQuick(today, null)}
        >
          {l.t("今天")}
        </button>
        <button
          type="button"
          className={`chip${value.startDate === tomorrow && !value.endDate ? " active" : ""}`}
          disabled={disabled}
          onClick={() => applyQuick(tomorrow, null)}
        >
          {l.t("明天")}
        </button>
        <button
          type="button"
          className={`chip${value.startDate === today && value.endDate === plus2 ? " active" : ""}`}
          disabled={disabled}
          onClick={() => applyQuick(today, plus2)}
        >
          {l.t("3 天范围")}
        </button>
        <button
          type="button"
          className={`chip${showTimeRange ? " active" : ""}`}
          disabled={disabled}
          onClick={toggleTimeRange}
        >
          {l.t("时间段")}
        </button>
        {hasSchedule && (
          <button
            type="button"
            className="chip"
            disabled={disabled}
            onClick={() => {
              setShowTimeRange(false);
              setShowCustomReminder(false);
              onChange({
                startDate: null,
                endDate: null,
                startTime: null,
                endTime: null,
                reminderAt: null,
              });
            }}
          >
            {l.t("清除时间")}
          </button>
        )}
      </div>

      {(!compact || hasSchedule || showTimeRange) && (
        <div className="schedule-grid">
          <label className="schedule-field">
            <span>{l.t("开始日期")}</span>
            <input
              type="date"
              className="composer-input schedule-input"
              aria-label={l.t("开始日期")}
              disabled={disabled}
              value={value.startDate ?? ""}
              onChange={(e) => {
                const startDate = e.target.value || null;
                const endDate =
                  startDate && value.endDate && value.endDate >= startDate ? value.endDate : null;
                onChange({
                  ...value,
                  startDate,
                  endDate,
                  startTime: startDate ? value.startTime : null,
                  endTime: startDate ? value.endTime : null,
                });
              }}
            />
          </label>
          <label className="schedule-field">
            <span>{l.t("结束日期（跨天可选）")}</span>
            <input
              type="date"
              className="composer-input schedule-input"
              aria-label={l.t("结束日期（跨天可选）")}
              min={value.startDate ?? undefined}
              disabled={disabled || !value.startDate}
              value={value.endDate ?? ""}
              onChange={(e) => onChange({ ...value, endDate: e.target.value || null })}
            />
          </label>

          {showTimeRange && (
            <>
              <label className="schedule-field">
                <span>{l.t("开始时间")}</span>
                <input
                  type="time"
                  className="composer-input schedule-input"
                  aria-label={l.t("开始时间")}
                  disabled={disabled}
                  value={value.startTime ?? ""}
                  onChange={(e) => {
                    const startTime = e.target.value || null;
                    onChange({
                      ...value,
                      startDate: value.startDate ?? today,
                      startTime,
                      endTime: startTime ? value.endTime : null,
                    });
                  }}
                />
              </label>
              <label className="schedule-field">
                <span>{l.t("结束时间")}</span>
                <input
                  type="time"
                  className="composer-input schedule-input"
                  aria-label={l.t("结束时间")}
                  disabled={disabled || !value.startTime}
                  value={value.endTime ?? ""}
                  onChange={(e) => onChange({ ...value, endTime: e.target.value || null })}
                />
              </label>
            </>
          )}

          <div className="schedule-reminder-block">
            <span className="schedule-label">{l.t("Windows 系统提醒")}</span>
            <div className="schedule-quick-row">
              <button
                type="button"
                className={`chip${!value.reminderAt && !showCustomReminder ? " active" : ""}`}
                disabled={disabled}
                onClick={() => applyPreset("none")}
              >
                {l.t("不提醒")}
              </button>
              <button
                type="button"
                className="chip"
                disabled={disabled}
                onClick={() => applyPreset("on_time")}
              >
                {l.t("准点")}
              </button>
              <button
                type="button"
                className="chip"
                disabled={disabled}
                onClick={() => applyPreset("15m")}
              >
                {l.t("提前 15 分钟")}
              </button>
              <button
                type="button"
                className="chip"
                disabled={disabled}
                onClick={() => applyPreset("1h")}
              >
                {l.t("提前 1 小时")}
              </button>
              <button
                type="button"
                className={`chip${showCustomReminder || Boolean(value.reminderAt) ? " active" : ""}`}
                disabled={disabled}
                onClick={() => applyPreset("custom")}
              >
                {l.t("自定义时间")}
              </button>
            </div>
            {(showCustomReminder || value.reminderAt !== null) && (
              <input
                type="datetime-local"
                className="composer-input schedule-input"
                aria-label={l.t("提醒时间")}
                disabled={disabled}
                value={value.reminderAt ? formatDateTimeLocalInput(value.reminderAt) : ""}
                onChange={(e) =>
                  onChange({ ...value, reminderAt: parseDateTimeLocalInput(e.target.value) })
                }
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
