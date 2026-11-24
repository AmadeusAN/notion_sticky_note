import { useLocale } from "../stores/languageStore";
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import type { Group, TaskScheduleInput } from "../types";
import { splitTaskText } from "../services/taskImport";
import { validateSchedule } from "../services/taskDate";
import { ScheduleFields } from "./ScheduleFields";
import { useModalFocus } from "./useModalFocus";

interface ComposerPayload {
  titles: string[];
  groupId: string | null;
  newGroupName: string | null;
  schedule?: TaskScheduleInput;
}

interface Props {
  groups: Group[];
  pendingGroups?: Readonly<Record<string, string>>;
  defaultGroupId: string | null;
  mode?: "single" | "batch";
  initialSchedule?: TaskScheduleInput | null;
  onSubmit: (payload: ComposerPayload) => Promise<void>;
  onCancel: () => void;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
}

export function Composer({
  groups,
  pendingGroups = {},
  defaultGroupId,
  initialSchedule = null,
  onSubmit,
  mode = "single",
  onCancel,
  fallbackFocusRef,
}: Props) {
  const l = useLocale();
  const localGroups = groups.filter((g) => g.kind === "local");
  const [title, setTitle] = useState("");
  const [groupId, setGroupId] = useState<string | "new">(() => {
    if (defaultGroupId === "new") return "new";
    if (
      defaultGroupId &&
      localGroups.some((g) => g.id === defaultGroupId)
    ) {
      return defaultGroupId;
    }
    return localGroups.length > 0 ? localGroups[0].id : "new";
  });
  const [groupName, setGroupName] = useState("");
  const [schedule, setSchedule] = useState<TaskScheduleInput>(() => ({
    startDate: initialSchedule?.startDate ?? null,
    endDate: initialSchedule?.endDate ?? null,
    startTime: initialSchedule?.startTime ?? null,
    endTime: initialSchedule?.endTime ?? null,
    reminderAt: initialSchedule?.reminderAt ?? null,
  }));
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const batchRef = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const titleId = useId();
  const hintId = useId();
  const initialFocusRef = mode === "batch" ? batchRef : titleRef;
  useModalFocus(sheetRef, initialFocusRef, fallbackFocusRef);

  useEffect(() => {
    if (busy) sheetRef.current?.focus();
  }, [busy]);

  useEffect(() => {
    if (defaultGroupId && defaultGroupId !== "new") {
      setGroupId(defaultGroupId);
    }
  }, [defaultGroupId]);

  const isNew = groupId === "new";
  const heading = mode === "batch" ? l.t("批量导入任务") : l.t("新建内容");
  const titles = useMemo(
    () => mode === "batch" ? splitTaskText(title) : title.trim() ? [title.trim()] : [],
    [mode, title],
  );
  const unavailable = !isNew && (Boolean(pendingGroups[groupId]) || !localGroups.some((group) => group.id === groupId));
  const canSubmit = !busy && !unavailable &&
    (!isNew || groupName.trim().length > 0) &&
    (titles.length > 0 || (isNew && mode === "single"));
  const [error, setError] = useState<string | null>(null);

  const hasSchedule = Boolean(
    schedule.startDate || schedule.endDate || schedule.startTime || schedule.endTime || schedule.reminderAt,
  );

  const submit = async () => {
    if (!canSubmit || submitting.current) return;
    if (mode === "single" && hasSchedule) {
      const scheduleError = validateSchedule(schedule);
      if (scheduleError) {
        setError(l.errorText(scheduleError));
        return;
      }
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        titles,
        groupId: isNew ? null : groupId,
        newGroupName: isNew ? groupName.trim() : null,
        ...(mode === "single" && hasSchedule ? { schedule } : {}),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <div
      className="composer-backdrop"
      onClick={() => { if (!submitting.current && !composing.current) onCancel(); }}
      role="presentation"
    >
      <div
        ref={sheetRef}
        className={`composer${mode === "batch" ? " composer-batch" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby={titleId}
        aria-modal="true"
        aria-busy={busy}
        tabIndex={-1}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={(e) => {
          if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (!submitting.current) onCancel();
          } else if (e.key === "Enter" && mode === "batch" && e.ctrlKey) {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <div className="composer-head">
          <span id={titleId} className="composer-title">{heading}</span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => { if (!submitting.current) onCancel(); }}
            aria-label={l.t("关闭")}
            disabled={busy}
          >
            ×
          </button>
        </div>

        <div className="composer-body">
        {mode === "batch" ? (
          <div>
            <textarea
              ref={batchRef}
              className="composer-input import-text"
              placeholder={l.t("例如：整理资料，记录要点；完成初稿;检查结果")}
              aria-label={l.t("批量任务文本")}
              aria-describedby={hintId}
              rows={3}
              disabled={busy}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <p id={hintId} className="hint import-hint">
              {l.t("仅按中英文分号（；;）拆分；逗号和段内换行保留。忽略空项，保留原顺序和重复任务。Ctrl+Enter 导入，Enter 换行。")}</p>
          </div>
        ) : (
        <input
          ref={titleRef}
          className="composer-input"
          placeholder={isNew ? l.t("首条任务（可选）") : l.t("写点什么…")}
          aria-label={l.t("任务内容")}
          disabled={busy}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !composing.current && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        )}

        <div className="composer-chips">
          {localGroups.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`chip${groupId === g.id ? " active" : ""}`}
              aria-pressed={groupId === g.id}
              disabled={busy || Boolean(pendingGroups[g.id])}
              onClick={() => setGroupId(g.id)}
            >
              {g.name}
            </button>
          ))}
          <button
            type="button"
            className={`chip chip-new${isNew ? " active" : ""}`}
            aria-pressed={isNew}
            disabled={busy}
            onClick={() => setGroupId("new")}
          >
            {l.t("＋ 新分组")}</button>
        </div>
        {unavailable && <p className="hint" role="status">{l.t("该分组正在处理其他操作或已删除，请选择其他分组；输入内容仍保留。")}</p>}

        {isNew && (
          <input
            className="composer-input composer-input-sub"
            placeholder={l.t("新分组名称")}
            aria-label={l.t("分组名称")}
            maxLength={24}
            disabled={busy}
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && mode === "single" && !composing.current && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                void submit();
              }
            }}
          />
        )}

        {mode === "single" && (
          <ScheduleFields value={schedule} onChange={setSchedule} disabled={busy} compact />
        )}

        {mode === "batch" && (
          <div>
            <p className="import-count" aria-live="polite">{l.t("预览 · {count} 条任务", { count: titles.length })}</p>
            {titles.length > 0 ? (
              <div className="import-preview" tabIndex={0} role="region" aria-label={l.t("导入任务预览")}>
                <ol>{titles.map((item, index) => <li key={index}>{item}</li>)}</ol>
              </div>
            ) : <p className="hint">{l.t("粘贴文本后，这里会显示将要导入的任务。")}</p>}
          </div>
        )}

        {error && <p role="alert">{l.errorText(error)}</p>}
        {busy && <p role="status">{mode === "batch" ? l.t("正在导入任务…") : l.t("正在保存…")}</p>}
        </div>
        <div className="composer-actions">
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => { if (!submitting.current) onCancel(); }}>
            {l.t("取消")}</button>
          <button
            type="button"
            className="btn-primary"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {busy ? (mode === "batch" ? l.t("导入中…") : l.t("保存中…"))
              : mode === "batch" ? l.t("导入 {count} 条任务", { count: titles.length })
              : isNew ? l.t("创建分组") : l.t("添加")}
          </button>
        </div>
      </div>
    </div>
  );
}