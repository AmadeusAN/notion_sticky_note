import { useLanguageStore } from "../stores/languageStore";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import type { Group } from "../types";

const reactEnvironment: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
const group: Group = { id: "local", name: "Local", kind: "local", position: 0, createdAt: 1 };
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
async function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function key(element: Element, value: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options });
  await act(async () => { element.dispatchEvent(event); });
  return event;
}

it("does not submit or cancel during IME and submits a single task after composition", async () => {
  const submit = vi.fn(async () => {});
  const cancel = vi.fn();
  await act(async () => root.render(<Composer groups={[group]} defaultGroupId={group.id} onSubmit={submit} onCancel={cancel} />));
  const input = container.querySelector("input")!;
  await type(input, "中文任务");
  await act(async () => { input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); });
  await key(input, "Enter");
  await key(input, "Escape");
  expect(submit).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
  await act(async () => { input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); });
  await key(input, "Enter", { isComposing: true });
  await key(input, "Enter", { keyCode: 229 });
  expect(submit).not.toHaveBeenCalled();
  await key(input, "Enter");
  expect(submit).toHaveBeenCalledWith({ titles: ["中文任务"], groupId: group.id, newGroupName: null });
});

it("keeps batch Enter as newline data and uses non-composing Ctrl+Enter for atomic semicolon import", async () => {
  const submit = vi.fn(async () => {});
  await act(async () => root.render(<Composer groups={[group]} defaultGroupId={group.id} mode="batch" onSubmit={submit} onCancel={() => {}} />));
  const input = container.querySelector("textarea")!;
  await type(input, "甲，乙；丙");
  expect((await key(input, "Enter")).defaultPrevented).toBe(false);
  // Native textarea default insertion is represented by the resulting input event.
  await type(input, "甲，乙；丙\n丁;甲，乙;;");
  await key(input, "Enter", { ctrlKey: true, isComposing: true });
  expect(submit).not.toHaveBeenCalled();
  expect((await key(input, "Enter", { ctrlKey: true })).defaultPrevented).toBe(true);
  expect(submit).toHaveBeenCalledWith({ titles: ["甲，乙", "丙\n丁", "甲，乙"], groupId: group.id, newGroupName: null });
});

it("traps both Tab directions including the preview and returns focus to a surviving fallback", async () => {
  const fallback = createRef<HTMLButtonElement>();
  const fallbackButton = document.createElement("button");
  document.body.append(fallbackButton);
  fallback.current = fallbackButton;
  await act(async () => root.render(<Composer groups={[group]} defaultGroupId={group.id} mode="batch" onSubmit={async () => {}} onCancel={() => {}} fallbackFocusRef={fallback} />));
  const input = container.querySelector("textarea")!;
  expect(document.activeElement).toBe(input);
  await type(input, "task");
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
  buttons[0].focus();
  await key(buttons[0], "Tab", { shiftKey: true });
  expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  await key(document.activeElement!, "Tab");
  expect(document.activeElement).toBe(buttons[0]);
  const preview = container.querySelector<HTMLElement>('[role="region"]')!;
  preview.focus();
  expect(document.activeElement).toBe(preview);
  opener.remove();
  await act(async () => root.render(null));
  expect(document.activeElement).toBe(fallbackButton);
  fallbackButton.remove();
});

it("blocks duplicate pending work and preserves new-group draft after failure for a retry", async () => {
  let reject!: (reason: Error) => void;
  const submit = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; })).mockResolvedValue(undefined);
  const cancel = vi.fn();
  await act(async () => root.render(<Composer groups={[]} defaultGroupId="new" onSubmit={submit} onCancel={cancel} />));
  const inputs = container.querySelectorAll("input");
  await type(inputs[0], "First task");
  await type(inputs[1], "Draft group");
  await act(async () => {
    const event = () => new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
    inputs[0].dispatchEvent(event());
    inputs[0].dispatchEvent(event());
  });
  expect(submit).toHaveBeenCalledTimes(1);
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(document.activeElement).toBe(dialog);
  await key(dialog, "Escape");
  await key(dialog, "Tab");
  expect(document.activeElement).toBe(dialog);
  expect(cancel).not.toHaveBeenCalled();
  await act(async () => reject(new Error("Write failed")));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Write failed");
  expect(inputs[0].value).toBe("First task");
  expect(inputs[1].value).toBe("Draft group");
  await key(inputs[1], "Enter");
  expect(submit).toHaveBeenLastCalledWith({ titles: ["First task"], groupId: null, newGroupName: "Draft group" });
  expect(submit).toHaveBeenCalledTimes(2);
});

it("keeps drafts when the selected group disappears or becomes pending", async () => {
  const submit = vi.fn(async () => {});
  const render = (groups: Group[], pendingGroups = {}) => root.render(<Composer groups={groups} pendingGroups={pendingGroups} defaultGroupId={group.id} onSubmit={submit} onCancel={() => {}} />);
  await act(async () => render([group]));
  const input = container.querySelector("input")!;
  await type(input, "Keep this task");
  await act(async () => render([group], { [group.id]: "delete" }));
  await key(input, "Enter");
  await act(async () => render([]));
  await key(input, "Enter");
  expect(submit).not.toHaveBeenCalled();
  expect(input.value).toBe("Keep this task");
  await act(async () => render([group]));
  await key(input, "Enter");
  expect(submit).toHaveBeenCalledWith({ titles: ["Keep this task"], groupId: group.id, newGroupName: null });
});

it("returns focus to the original opener when the sheet closes", async () => {
  await act(async () => root.render(<Composer groups={[group]} defaultGroupId={group.id} onSubmit={async () => {}} onCancel={() => {}} />));
  await act(async () => root.render(null));
  expect(document.activeElement).toBe(opener);
});
