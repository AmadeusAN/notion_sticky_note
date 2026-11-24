import { create } from "zustand";

export type ToastTone = "success" | "info" | "error";

export interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
}

interface ToastState {
  toasts: ToastItem[];
  pushToast: (message: string, tone?: ToastTone, durationMs?: number) => string;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
}

const MAX_TOASTS = 3;
const timers = new Map<string, number>();
let seq = 0;

function clearToastTimer(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timers.delete(id);
  }
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  pushToast: (message, tone = "success", durationMs = 2600) => {
    seq += 1;
    const id = `toast-${seq}`;
    set((state) => {
      const next = [...state.toasts, { id, message, tone }];
      if (next.length > MAX_TOASTS) {
        const dropped = next.slice(0, next.length - MAX_TOASTS);
        for (const item of dropped) clearToastTimer(item.id);
        return { toasts: next.slice(-MAX_TOASTS) };
      }
      return { toasts: next };
    });

    if (durationMs > 0) {
      const timer = window.setTimeout(() => {
        timers.delete(id);
        get().dismissToast(id);
      }, durationMs);
      timers.set(id, timer);
    }
    return id;
  },

  dismissToast: (id) => {
    clearToastTimer(id);
    set((state) => ({
      toasts: state.toasts.filter((item) => item.id !== id),
    }));
  },

  clearToasts: () => {
    for (const id of timers.keys()) {
      clearToastTimer(id);
    }
    set({ toasts: [] });
  },
}));
