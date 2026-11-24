import { useToastStore } from "../stores/toastStore";

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismissToast = useToastStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-host" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`toast-pill is-${toast.tone}`}
          onClick={() => dismissToast(toast.id)}
        >
          <span className="toast-icon" aria-hidden="true">
            {toast.tone === "error" ? "!" : toast.tone === "info" ? "i" : "✓"}
          </span>
          <span className="toast-message">{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
