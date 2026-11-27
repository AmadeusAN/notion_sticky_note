import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLanguageStore } from "../stores/languageStore";
import { ReminderAlert } from "./ReminderAlert";
import type { Task } from "../types";

const reactEnvironment: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const sampleTask: Task = {
  id: "rem-1",
  notionId: null,
  title: "Review release notes",
  completed: false,
  progress: null,
  remain: null,
  date: "2026-11-26",
  tags: [],
  updatedTime: 1000,
  groupId: "local",
  startDate: "2026-11-26",
  reminderAt: 1_795_700_000_000,
  remindedAt: 1_795_700_000_000,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useLanguageStore.setState({ preference: "en", effective: "en", hydrated: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("renders persistent vibrating reminder card without Dismiss and completes on click", async () => {
  const onComplete = vi.fn().mockResolvedValue(undefined);
  await act(async () => {
    root.render(<ReminderAlert reminders={[sampleTask]} onComplete={onComplete} />);
  });

  const card = container.querySelector(".reminder-alert-card");
  expect(card).not.toBeNull();
  expect(card?.textContent).toContain("Review release notes");
  expect(card?.textContent).not.toContain("Dismiss");

  const doneBtn = container.querySelector<HTMLButtonElement>(".reminder-done-btn");
  expect(doneBtn?.textContent).toBe("Done");
  await act(async () => {
    doneBtn?.click();
  });
  expect(onComplete).toHaveBeenCalledWith("rem-1");

  await act(async () => {
    root.render(<ReminderAlert reminders={[]} onComplete={onComplete} />);
  });
  expect(container.querySelector(".reminder-alert-card")).toBeNull();
});
