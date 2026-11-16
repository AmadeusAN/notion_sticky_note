import { useLocale } from "../stores/languageStore";
import { useSettingsStore } from "../stores/settingsStore";

interface Props {
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onRetryHydration: () => void;
}

export function AppearanceFeedback({ settingsOpen, onOpenSettings, onRetryHydration }: Props) {
  const l = useLocale();
  const hydrated = useSettingsStore((s) => s.hydrated);
  const hydrating = useSettingsStore((s) => s.hydrating);
  const hydrationError = useSettingsStore((s) => s.hydrationError);
  const saveState = useSettingsStore((s) => s.appearanceSaveState);
  const retryAppearance = useSettingsStore((s) => s.retryAppearance);
  const failed = hydrationError !== null || (hydrated && saveState.status === "error");
  if (!failed && hydrated && saveState.status === "saved") return null;

  return (
    <div
      className={`msg${failed ? " error" : ""}`}
      role={failed ? "alert" : "status"}
      aria-busy={hydrating}
      style={{ flexShrink: 0, maxHeight: "40%", overflow: "auto",
        padding: 10, background: "var(--note-bg)", color: "var(--note-fg)",
        border: "1px solid var(--note-border)", borderRadius: 8 }}
    >
      <span>{hydrationError ? l.t("设置读取失败：{error}", { error: l.errorText(hydrationError) })
        : !hydrated ? l.t("正在读取设置…")
        : saveState.status === "error" ? l.t("未保存 · {error}", { error: saveState.error ? l.errorText(saveState.error) : l.t("外观设置保存失败") })
        : l.t("外观设置保存中…")}</span>
      {failed ? (
        <div className="btn-row">
          <button type="button" className="ghost-btn" disabled={hydrating}
            onClick={() => hydrationError ? onRetryHydration() : void retryAppearance()}>
            {hydrationError ? l.t("重试读取设置") : l.t("重试保存")}
          </button>
          {!settingsOpen ? <button type="button" className="ghost-btn" onClick={onOpenSettings}>{l.t("打开设置")}</button> : null}
        </div>
      ) : null}
    </div>
  );
}
