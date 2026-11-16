import { useLocale } from "../stores/languageStore";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { useModalFocus } from "./useModalFocus";

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel, fallbackFocusRef }: Props) {
  const l = useLocale();
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  const composing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const messageId = useId();
  useModalFocus(dialog, cancel, fallbackFocusRef);
  useEffect(() => {
    if (busy) dialog.current?.focus();
  }, [busy]);

  const confirm = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="composer-backdrop" role="presentation">
      <div ref={dialog} className="composer" role="alertdialog" aria-modal="true"
        aria-labelledby={titleId} aria-describedby={messageId} aria-busy={busy} tabIndex={-1}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !composing.current && !event.nativeEvent.isComposing && event.keyCode !== 229) {
            event.preventDefault();
            event.stopPropagation();
            if (!submitting.current) onCancel();
          }
        }}>
        <div className="composer-head"><span id={titleId} className="composer-title">{title}</span></div>
        <div className="composer-body">
          <p id={messageId}>{message}</p>
          {error && <p role="alert">{l.errorText(error)}</p>}
          {busy && <p role="status">{l.t("处理中…")}</p>}
        </div>
        <div className="composer-actions">
          <button ref={cancel} type="button" className="btn-ghost" disabled={busy}
            onClick={() => { if (!submitting.current) onCancel(); }}>{l.t("取消")}</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void confirm()}>
            {busy ? l.t("处理中…") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
