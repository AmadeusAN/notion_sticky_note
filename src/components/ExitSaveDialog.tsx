import { useLocale } from "../stores/languageStore";
import { useEffect, useRef } from "react";
import { useSettingsStore } from "../stores/settingsStore";

export function ExitSaveDialog() {
  const l = useLocale();
  const state = useSettingsStore((s) => s.exitSaveState);
  const requestExit = useSettingsStore((s) => s.requestExit);
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const visible = state.status === "error" || (state.status === "saving" && state.error !== null);
  const busy = state.status === "saving";

  useEffect(() => {
    if (!visible) return;
    const previous = document.activeElement;
    cancel.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [visible]);

  if (!visible) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,.35)",
      display: "grid", placeItems: "center", padding: 8, overflow: "auto" }}>
      <div ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby="exit-save-title"
        aria-describedby="exit-save-description" aria-busy={busy} tabIndex={-1}
        style={{ background: "var(--note-bg)", color: "var(--note-fg)", padding: 16,
          borderRadius: 10, maxWidth: 360, maxHeight: "100%", overflow: "auto" }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            void requestExit("cancel");
          } else if (event.key === "Tab") {
            const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}>
        <h2 id="exit-save-title">{l.t("设置尚未保存，无法安全退出")}</h2>
        <p id="exit-save-description">{state.error ? l.errorText(state.error) : l.t("保存失败。可以重试、取消退出，或明确放弃未保存的设置。")}</p>
        <div className="btn-row" style={{ flexWrap: "wrap" }}>
          <button type="button" className="primary-btn" disabled={busy} onClick={() => void requestExit("retry")}>
            {busy ? l.t("保存并退出中…") : l.t("重试保存并退出")}
          </button>
          <button ref={cancel} type="button" className="ghost-btn" onClick={() => void requestExit("cancel")}>{l.t("取消")}</button>
          <button type="button" className="ghost-btn" disabled={busy} onClick={() => void requestExit("discard")}>{l.t("放弃未保存设置退出")}</button>
        </div>
      </div>
    </div>
  );
}
