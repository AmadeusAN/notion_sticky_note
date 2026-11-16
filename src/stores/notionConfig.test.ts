// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotionConfig, SaveNotionConfigResult } from "../types";
import type * as TauriApi from "../services/tauriApi";

vi.mock("../services/tauriApi", async (importOriginal) => ({
  ...(await importOriginal<typeof TauriApi>()),
  apiSaveNotionConfig: vi.fn(),
  apiTestNotionConnection: vi.fn(),
}));

import { apiSaveNotionConfig, apiTestNotionConnection } from "../services/tauriApi";
import { useSettingsStore } from "./settingsStore";

const save = vi.mocked(apiSaveNotionConfig);
const testConnection = vi.mocked(apiTestNotionConnection);
const config: NotionConfig = {
  token: "fixture-token",
  databaseId: "fixture-database",
  doneProperty: "done?",
  titleProperty: "Name",
  dateProperty: "Date",
  statusProperty: "Status",
  statusDoneValue: "Done",
  statusTodoValue: "Not started",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  useSettingsStore.setState({
    notion: { ...config },
    savedNotion: { ...config },
    notionDraftRevision: 0,
    notionConfirmation: null,
    notionOperation: null,
    message: null,
    error: null,
  });
  save.mockResolvedValue({ status: "saved" });
  testConnection.mockResolvedValue("连接成功");
});

describe("Notion configuration confirmation", () => {
  it("requires explicit discard and sends the confirmed pending version", async () => {
    save.mockResolvedValueOnce({ status: "confirmationRequired", pendingCount: 3, pendingVersion: 7 });
    useSettingsStore.getState().updateNotionDraft({ databaseId: "other-database" });
    await useSettingsStore.getState().saveNotion();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ databaseId: "other-database" }), {});
    expect(useSettingsStore.getState().notionConfirmation).toEqual({ pendingCount: 3, pendingVersion: 7 });
    expect(useSettingsStore.getState().message).toBeNull();
    expect(useSettingsStore.getState().savedNotion.databaseId).toBe(config.databaseId);
    await useSettingsStore.getState().discardPendingAndSaveNotion();
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ databaseId: "other-database" }), {
      discardPending: true, expectedPendingVersion: 7,
    });
    expect(useSettingsStore.getState().notionConfirmation).toBeNull();
    expect(useSettingsStore.getState().savedNotion.databaseId).toBe("other-database");
  });

  it("reconfirms a changed queue version without automatically discarding newer operations", async () => {
    save.mockResolvedValueOnce({ status: "confirmationRequired", pendingCount: 1, pendingVersion: 2 });
    save.mockResolvedValueOnce({ status: "confirmationRequired", pendingCount: 2, pendingVersion: 3 });
    await useSettingsStore.getState().saveNotion();
    await useSettingsStore.getState().discardPendingAndSaveNotion();
    expect(save).toHaveBeenCalledTimes(2);
    expect(useSettingsStore.getState().message).toBeNull();
    expect(useSettingsStore.getState().notionConfirmation).toEqual({ pendingCount: 2, pendingVersion: 3 });
    await useSettingsStore.getState().discardPendingAndSaveNotion();
    expect(save).toHaveBeenLastCalledWith(config, { discardPending: true, expectedPendingVersion: 3 });
  });

  it("cancel preserves the draft and never sends a discard request", async () => {
    save.mockResolvedValueOnce({ status: "confirmationRequired", pendingCount: 4, pendingVersion: 5 });
    useSettingsStore.getState().updateNotionDraft({ doneProperty: "完成" });
    await useSettingsStore.getState().saveNotion();
    useSettingsStore.getState().cancelNotionConfirmation();
    await useSettingsStore.getState().discardPendingAndSaveNotion();
    expect(useSettingsStore.getState().notion.doneProperty).toBe("完成");
    expect(useSettingsStore.getState().notionConfirmation).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("editing the draft invalidates previous discard consent", async () => {
    save.mockResolvedValueOnce({ status: "confirmationRequired", pendingCount: 1, pendingVersion: 2 });
    await useSettingsStore.getState().saveNotion();
    useSettingsStore.getState().updateNotionDraft({ statusDoneValue: "Finished" });
    await useSettingsStore.getState().discardPendingAndSaveNotion();
    expect(save).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState().notionConfirmation).toBeNull();
  });

  it("allows token-only saves without imposing a frontend confirmation", async () => {
    useSettingsStore.getState().updateNotionDraft({ token: "replacement-fixture-token" });
    await useSettingsStore.getState().saveNotion();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ token: "replacement-fixture-token" }), {});
    expect(useSettingsStore.getState().message).toBe("Notion 配置已保存");
  });

  it("captures save input and does not overwrite or acknowledge a newer draft", async () => {
    const pending = deferred<SaveNotionConfigResult>();
    save.mockReturnValueOnce(pending.promise);
    const request = useSettingsStore.getState().saveNotion();
    useSettingsStore.getState().updateNotionDraft({ titleProperty: "新标题" });
    expect(save).toHaveBeenCalledWith(config, {});
    pending.resolve({ status: "saved" });
    await request;
    expect(useSettingsStore.getState().notion.titleProperty).toBe("新标题");
    expect(useSettingsStore.getState().savedNotion.titleProperty).toBe("Name");
    expect(useSettingsStore.getState().message).toBeNull();
  });

  it("captures test input and suppresses a stale connection result", async () => {
    const pending = deferred<string>();
    testConnection.mockReturnValueOnce(pending.promise);
    const request = useSettingsStore.getState().testNotion();
    expect(useSettingsStore.getState().notionOperation).toBe("testing");
    useSettingsStore.getState().updateNotionDraft({ databaseId: "new-draft" });
    expect(testConnection).toHaveBeenCalledWith(config);
    pending.resolve("连接成功");
    await request;
    expect(useSettingsStore.getState().notion.databaseId).toBe("new-draft");
    expect(useSettingsStore.getState().message).toBeNull();
    expect(useSettingsStore.getState().notionOperation).toBeNull();
  });

  it("prevents save and test requests from overlapping in either direction", async () => {
    const saving = deferred<SaveNotionConfigResult>();
    save.mockReturnValueOnce(saving.promise);
    const saveRequest = useSettingsStore.getState().saveNotion();
    await useSettingsStore.getState().testNotion();
    await useSettingsStore.getState().saveNotion();
    expect(testConnection).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    saving.resolve({ status: "saved" });
    await saveRequest;
    const testing = deferred<string>();
    testConnection.mockReturnValueOnce(testing.promise);
    const testRequest = useSettingsStore.getState().testNotion();
    await useSettingsStore.getState().saveNotion();
    await useSettingsStore.getState().testNotion();
    expect(save).toHaveBeenCalledTimes(1);
    expect(testConnection).toHaveBeenCalledTimes(1);
    testing.resolve("连接成功");
    await testRequest;
  });

  it("preserves confirmation and draft on failure and redacts credentials in feedback", async () => {
    save.mockResolvedValueOnce({ status: "confirmationRequired", pendingCount: 1, pendingVersion: 4 });
    save.mockRejectedValueOnce(new Error(`无法保存 ${config.token}`));
    await useSettingsStore.getState().saveNotion();
    await useSettingsStore.getState().discardPendingAndSaveNotion();
    expect(useSettingsStore.getState().notion).toEqual(config);
    expect(useSettingsStore.getState().notionConfirmation).toEqual({ pendingCount: 1, pendingVersion: 4 });
    expect(useSettingsStore.getState().error).toBe("无法保存 [redacted]");
    expect(useSettingsStore.getState().message).toBeNull();
    expect(useSettingsStore.getState().notionOperation).toBeNull();
  });

  it("reports connection failures without changing the draft or saved configuration", async () => {
    testConnection.mockRejectedValueOnce(new Error("连接失败"));
    await useSettingsStore.getState().testNotion();
    expect(useSettingsStore.getState().error).toBe("连接失败");
    expect(useSettingsStore.getState().notion).toEqual(config);
    expect(useSettingsStore.getState().savedNotion).toEqual(config);
    expect(useSettingsStore.getState().notionOperation).toBeNull();
  });

  it("browser preview rejects real save and connection testing claims", async () => {
    const api = await vi.importActual<typeof TauriApi>("../services/tauriApi");
    await expect(api.apiSaveNotionConfig(config)).rejects.toThrow("浏览器预览无法保存");
    await expect(api.apiTestNotionConnection(config)).rejects.toThrow("浏览器预览无法测试");
  });
});
