import { expect, it } from "vitest";
import { displayLabel, formatTaskDate, localizeError, resolvePreviewLocale, translate } from "./i18n";

it("uses the first browser language only for preview and recognizes Chinese variants", () => {
  expect(resolvePreviewLocale(["zh-TW", "en-US"])).toBe("zh-CN");
  expect(resolvePreviewLocale(["zh-Hans-CN"])).toBe("zh-CN");
  expect(resolvePreviewLocale(["en-GB", "zh-CN"])).toBe("en");
  expect(resolvePreviewLocale(["", "fr-FR"])).toBe("en");
  expect(resolvePreviewLocale([])).toBe("en");
  expect(resolvePreviewLocale(["zhang"])).toBe("en");
});

it("formats plural counts, dates and labels without interpreting user content", () => {
  expect(translate("en", "导入 {count} 条任务", { count: 1 })).toBe("Import 1 task");
  expect(translate("en", "导入 {count} 条任务", { count: 2 })).toBe("Import 2 tasks");
  expect(translate("zh-CN", "导入 {count} 条任务", { count: 2 })).toBe("导入 2 条任务");
  expect(displayLabel("en", "樱花")).toBe("Sakura");
  expect(displayLabel("zh-CN", "Classic Paper")).toBe("经典纸张");
  expect(displayLabel("en", "My custom content")).toBe("My custom content");
  expect(translate("en", "永久删除「{title}」？此操作无法撤销。", { title: "{count}，中文;User task" }))
    .toBe("Permanently delete “{count}，中文;User task”? This cannot be undone.");
  expect(formatTaskDate("en", "2026-12-01 → 2026-12-31")).toBe("Dec 1, 2026 → Dec 31, 2026");
  expect(formatTaskDate("zh-CN", "2026-12-01")).toBe("2026年12月1日");
});

it("localizes native error contracts while retaining safe HTTP and OS diagnostics", () => {
  expect(localizeError("en", "原分组已删除，无法取消完成；任务仍保留在 Archive 中"))
    .toBe("The original group was deleted, so this task cannot be reopened. It remains in Archive.");
  expect(localizeError("en", "Notion 凭据无效，请更新 Integration Token（HTTP 401 · unauthorized）"))
    .toBe("Notion credentials are invalid. Update your Integration Token. (HTTP 401 · unauthorized)");
  expect(localizeError("zh-CN", "Notion request failed. (HTTP 500)"))
    .toBe("Notion 请求失败 (HTTP 500)");
  expect(localizeError("en", "无法读取自启动状态：无法读取或更新 Windows 开机启动设置。 (OS 5)"))
    .toBe("Unable to read startup setting: Unable to read or update Windows startup settings. (OS 5)");
  expect(localizeError("en", "SQLITE_BUSY")).toBe("SQLITE_BUSY");
});
