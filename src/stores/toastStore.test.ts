import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToastStore } from "./toastStore";

describe("toastStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.getState().clearToasts();
  });

  afterEach(() => {
    useToastStore.getState().clearToasts();
    vi.useRealTimers();
  });

  it("pushes toasts, caps at 3 FIFO, supports manual dismiss, and auto-dismisses", () => {
    const store = useToastStore.getState();
    const id1 = store.pushToast("First", "success", 2000);
    const id2 = store.pushToast("Second", "info", 2000);
    const id3 = store.pushToast("Third", "success", 2000);
    const id4 = store.pushToast("Fourth", "error", 2000);

    expect(useToastStore.getState().toasts.map((t) => t.id)).toEqual([id2, id3, id4]);
    expect(id1).not.toBe(id2);

    store.dismissToast(id2);
    expect(useToastStore.getState().toasts.map((t) => t.id)).toEqual([id3, id4]);

    vi.advanceTimersByTime(2000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
