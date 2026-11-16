import { useLanguageStore } from "../stores/languageStore";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

const reactEnvironment: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
let opener: HTMLButtonElement;
beforeEach(() => {
  useLanguageStore.setState({ preference: "zh-CN", effective: "zh-CN", hydrated: true });
  opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  opener.remove();
});
async function key(element: Element, key: string, shiftKey = false) {
  await act(async () => { element.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })); });
}

it("starts on cancel, traps focus, cancels explicitly and restores the opener", async () => {
  const confirm = vi.fn(async () => {});
  const cancel = vi.fn(() => root.render(null));
  await act(async () => root.render(<ConfirmDialog title="Delete task" message="This cannot be undone." confirmLabel="Delete" onConfirm={confirm} onCancel={cancel} />));
  const buttons = container.querySelectorAll("button");
  expect(document.activeElement).toBe(buttons[0]);
  await key(buttons[0], "Tab", true);
  expect(document.activeElement).toBe(buttons[1]);
  await key(buttons[1], "Tab");
  expect(document.activeElement).toBe(buttons[0]);
  opener.focus();
  expect(container.contains(document.activeElement)).toBe(true);
  await key(document.activeElement!, "Escape");
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(opener);
});

it("keeps confirmation and failure context open, blocks duplicate pending work and retries", async () => {
  let reject!: (reason: Error) => void;
  const confirm = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; })).mockResolvedValue(undefined);
  const cancel = vi.fn();
  await act(async () => root.render(<ConfirmDialog title="Delete group" message="Archived tasks are kept." confirmLabel="Delete" onConfirm={confirm} onCancel={cancel} />));
  const buttons = container.querySelectorAll("button");
  await act(async () => {
    buttons[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    buttons[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(buttons[0].disabled).toBe(true);
  expect(buttons[1].disabled).toBe(true);
  const dialog = container.querySelector<HTMLElement>('[role="alertdialog"]')!;
  expect(document.activeElement).toBe(dialog);
  expect(dialog.getAttribute("aria-busy")).toBe("true");
  await key(dialog, "Escape");
  await key(dialog, "Tab");
  expect(document.activeElement).toBe(dialog);
  expect(cancel).not.toHaveBeenCalled();
  await act(async () => reject(new Error("Unable to delete")));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Unable to delete");
  expect(buttons[1].disabled).toBe(false);
  expect(container.textContent).toContain("Archived tasks are kept.");
  await act(async () => buttons[1].click());
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  // The consumer, not a timer or the dialog, owns successful dismissal.
  expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
  await act(async () => buttons[0].click());
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("ignores composing Escape and permits an explicit safe cancel afterwards", async () => {
  const cancel = vi.fn();
  await act(async () => root.render(<ConfirmDialog title="Clear archive" message="Permanently remove archived tasks?" confirmLabel="Clear" onConfirm={async () => {}} onCancel={cancel} />));
  const dialog = container.querySelector('[role="alertdialog"]')!;
  await act(async () => {
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true }));
  });
  expect(cancel).not.toHaveBeenCalled();
  await key(dialog, "Escape");
  expect(cancel).toHaveBeenCalledTimes(1);
});
