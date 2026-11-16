export type Locale = "zh-CN" | "en";
export type LanguagePreference = "auto" | Locale;
export interface LanguageState { preference: LanguagePreference; effective: Locale }

const english = {
  "浅色主题": "Light themes",
  "深色主题": "Dark themes",
  "扁平": "Flat",
  "层级卡片": "Layered cards",
  "动效": "Animated",
  "当前系统": "Current system mode",
  "设置": "Settings",
  "关闭": "Close",
  "外观": "Appearance",
  "已按浅色 / 深色分类。默认浅色「Classic Paper」、深色「Dark OLED」； 实际显示会跟随系统外观自动切换。当前生效：": "Choose light and dark themes separately. Defaults: Classic Paper / Dark OLED. The active theme follows Windows appearance. Current: ",
  "字体": "Font",
  "预览：": "Preview: ",
  "今日待办 · Sticky Note": "Today’s tasks · Sticky Note",
  "贴边特效": "Edge effects",
  "生长：叶片 / 樱花 / 藤蔓 / 冰锥 / 墨迹；氛围：雨滴 / 雪花 / 萤火。": "Growing: leaves / sakura / vines / icicles / ink. Ambient: rain / snow / fireflies.",
  "特效强度": "Effect intensity",
  "控制粒子密度与整体可见度；浅色便签会自动略加强对比。": "Controls particle density and visibility; light themes receive a slight contrast boost.",
  "边缘高对比": "High-contrast edges",
  "只加强贴边 fringe / 近景粒子，避免整窗糊成雨幕。": "Boosts only edge fringes and nearby particles, keeping the note clear.",
  "贴边扶手": "Dock handle",
  "Notion 配置": "Notion configuration",
  "Notion Integration Token": "Notion Integration Token",
  "Database ID": "Database ID",
  "32-char database id": "32-character database ID",
  "完成属性名（checkbox）": "Completed property (Checkbox)",
  "Status 属性名（连带更新；留空跳过）": "Status property (also updated; leave blank to skip)",
  "完成时 Status 值": "Status value when completed",
  "取消完成时 Status 值": "Status value when reopened",
  "日期属性名": "Date property",
  "标题属性名": "Title property",
  "同步拉取：日期覆盖今天的任务。勾选时会写 checkbox（默认 done?），并连带更新 Status（默认 Done / Not started），对齐 Notion Button 自动化。": "Sync includes tasks starting today, plus incomplete date ranges covering today that started in the last 60 days. Checking updates the Checkbox (default: done?) and optional Status (Done / Not started). Test connection only checks database access.",
  "尚有 {count} 项未回写": {
    "one": "{count} change has not been sent",
    "other": "{count} changes have not been sent"
  },
  "切换配置会放弃这些本地待写意图。若数量发生变化，需要重新确认。": "Changing this configuration discards these pending local changes. You must confirm again if the queue changes.",
  "取消": "Cancel",
  "保存中…": "Saving…",
  "放弃待写并保存": "Discard pending changes and save",
  "保存": "Save",
  "测试中…": "Testing…",
  "测试连接": "Test connection",
  "请填写任务或新分组名称": "Enter a task or a new group name",
  "删除任务": "Delete task",
  "永久删除「{title}」？此操作无法撤销。": "Permanently delete “{title}”? This cannot be undone.",
  "永久删除": "Delete permanently",
  "清空归档": "Clear archive",
  "永久清空 {count} 条归档任务？此操作无法撤销，Notion 任务不受影响。": {
    "one": "Permanently clear {count} archived task? This cannot be undone. Notion tasks are unaffected.",
    "other": "Permanently clear {count} archived tasks? This cannot be undone. Notion tasks are unaffected."
  },
  "删除分组": "Delete group",
  "删除「{name}」及其中的 {count} 条任务？此操作无法撤销。属于此分组的已归档任务会保留，但之后无法恢复回此分组。": {
    "one": "Delete “{name}” and its {count} task? This cannot be undone. Archived tasks are kept, but can no longer be restored to this group.",
    "other": "Delete “{name}” and its {count} tasks? This cannot be undone. Archived tasks are kept, but can no longer be restored to this group."
  },
  "我的便签": "My sticky note",
  "便签操作": "Note actions",
  "新建内容": "Create content",
  "批量导入任务": "Import tasks",
  "同步": "Sync",
  "关闭窗口，保留在托盘": "Close window and keep running in the tray",
  "关闭到托盘": "Close to tray",
  "重试": "Retry",
  "关闭操作错误提示": "Dismiss operation error",
  "＋ 新建分组": "+ New group",
  "Notion 未配置": "Notion not configured",
  "同步中…": "Syncing…",
  "同步失败": "Sync failed",
  "尚未完成同步": "Not synced yet",
  "上次成功 {time}": "Last success {time}",
  " · {count} 项待回写": {
    "one": " · {count} pending change",
    "other": " · {count} pending changes"
  },
  "（{count} 项来源待确认）": {
    "one": " ({count} source unverified)",
    "other": " ({count} sources unverified)"
  },
  "{count} 待办": {
    "one": "{count} open",
    "other": "{count} open"
  },
  "{count} 组": {
    "one": "{count} group",
    "other": "{count} groups"
  },
  "{count} 任务": {
    "one": "{count} task",
    "other": "{count} tasks"
  },
  "配置 Notion 后即可同步今天的任务。": "Configure Notion to sync today’s tasks.",
  "正在从 Notion 同步…": "Syncing from Notion…",
  "同步失败；已有缓存未被替换，请重试。": "Sync failed. The existing cache is unchanged; please retry.",
  "尚未完成首次同步。": "The first sync has not completed.",
  "今天没有符合日期筛选的任务。": "No tasks match today’s date filter.",
  "在「{name}」新建": "Create in “{name}”",
  "新建任务": "New task",
  "清空 Archive 中的任务": "Clear archived tasks",
  "删除分组「{name}」": "Delete group “{name}”",
  "请先在设置中配置 Notion；已有缓存仍保留。": "Configure Notion in Settings first. Cached tasks are kept.",
  "已完成的本地任务会移到这里，由你决定何时清空。": "Completed local tasks move here. You decide when to clear them.",
  "还没有任务，点右上 ＋ 新建。": "No tasks yet. Use + above to create one.",
  "来自 Notion": "From Notion",
  "归档": "Archive",
  "例如：整理资料，记录要点；完成初稿;检查结果": "Example: Gather references, take notes;Write a draft;Review results",
  "批量任务文本": "Task import text",
  "仅按中英文分号（；;）拆分；逗号和段内换行保留。忽略空项，保留原顺序和重复任务。Ctrl+Enter 导入，Enter 换行。": "Split only at semicolons (； or ;). Commas and inner line breaks are kept. Empty entries are ignored; order and duplicates are preserved. Ctrl+Enter imports; Enter inserts a line break.",
  "首条任务（可选）": "First task (optional)",
  "写点什么…": "Write something…",
  "任务内容": "Task content",
  "＋ 新分组": "+ New group",
  "该分组正在处理其他操作或已删除，请选择其他分组；输入内容仍保留。": "This group is busy or has been deleted. Choose another group; your input is kept.",
  "新分组名称": "New group name",
  "分组名称": "Group name",
  "预览 · {count} 条任务": {
    "one": "Preview · {count} task",
    "other": "Preview · {count} tasks"
  },
  "导入任务预览": "Task import preview",
  "粘贴文本后，这里会显示将要导入的任务。": "Paste text to preview the tasks to import.",
  "正在导入任务…": "Importing tasks…",
  "正在保存…": "Saving…",
  "导入中…": "Importing…",
  "导入 {count} 条任务": {
    "one": "Import {count} task",
    "other": "Import {count} tasks"
  },
  "创建分组": "Create group",
  "添加": "Add",
  "设置读取失败：{error}": "Unable to load settings: {error}",
  "正在读取设置…": "Loading settings…",
  "未保存 · {error}": "Not saved · {error}",
  "外观设置保存失败": "Unable to save appearance settings",
  "外观设置保存中…": "Saving appearance settings…",
  "重试读取设置": "Retry loading settings",
  "重试保存": "Retry save",
  "打开设置": "Open Settings",
  "请先在设置中配置 Notion，再修改完成状态": "Configure Notion in Settings before changing completion",
  "请先配置 Notion，暂不能修改完成状态": "Configure Notion first; completion changes are unavailable",
  "正在删除任务": "Deleting task",
  "正在保存完成状态": "Saving completion",
  "标记未完成": "Mark incomplete",
  "标记完成": "Mark complete",
  "永久删除任务": "Permanently delete task",
  "删除任务「{title}」": "Delete task “{title}”",
  "处理中…": "Working…",
  "设置尚未保存，无法安全退出": "Settings are not saved",
  "保存失败。可以重试、取消退出，或明确放弃未保存的设置。": "Save failed. Retry, cancel exiting, or explicitly discard unsaved settings.",
  "保存并退出中…": "Saving and exiting…",
  "重试保存并退出": "Retry save and exit",
  "放弃未保存设置退出": "Discard settings and exit",
  "无法读取自启动状态：{error}": "Unable to read startup setting: {error}",
  "系统未应用自启动设置，请重试。": "Windows did not apply the startup setting. Please retry.",
  "无法更新自启动设置：{error}": "Unable to update startup setting: {error}",
  "开机自动启动": "Start with Windows",
  "仅桌面应用支持，浏览器预览不可设置。": "Available in the desktop app only; not in browser preview.",
  "正在读取或更新系统设置…": "Reading or updating Windows settings…",
  "暂时无法确认系统自启动状态。": "Unable to confirm the Windows startup setting.",
  "已开启：登录 Windows 后自动打开便签。": "Enabled: opens automatically when you sign in to Windows.",
  "已关闭：仅手动打开便签。开启后对当前 Windows 用户生效，无需管理员权限。": "Disabled: opens manually. Enabling applies to the current Windows user and needs no administrator permission.",
  "重新读取": "Read again",
  "语言": "Language",
  "自动（跟随 Windows）": "Auto (Windows language)",
  "自动（跟随浏览器）": "Auto (browser language)",
  "语言正在保存…": "Saving language…",
  "语言已保存": "Language saved",
  "语言读取失败：{error}": "Unable to load language: {error}",
  "语言保存失败：{error}": "Language was not saved: {error}",
  "浏览器预览：语言仅用于本次预览，不会保存到桌面应用。": "Browser preview: language applies to this preview only and is not saved to the desktop app.",
  "当前语言：{language}": "Current language: {language}",
  "操作失败，请重试。": "Operation failed. Please retry.",
  "应用加载失败，请重新启动。": "Unable to load the app. Please restart.",
  "手写便签": "Handwriting",
  "Noto Sans 中文": "Noto Sans SC",
  "Noto Serif 中文": "Noto Serif SC",
  "Caveat 手写": "Caveat handwriting",
  "站酷小薇": "ZCOOL XiaoWei",
  "胶囊": "Capsule",
  "贴边侧短胶囊，强调色实心": "Short dock-side capsule filled with the accent color",
  "纸感": "Paper",
  "面板底色短胶囊，描边带一点强调色": "Short capsule matching the note, with a subtle accent outline",
  "凹槽": "Grip",
  "面板底色短胶囊 + 中间细凹槽纹": "Note-colored capsule with a fine central grip",
  "叶片": "Leaves",
  "樱花": "Sakura",
  "藤蔓": "Vines",
  "冰锥": "Icicles",
  "雨滴": "Rain",
  "雪花": "Snow",
  "墨迹": "Ink",
  "萤火": "Fireflies",
  "Classic Paper": "Classic Paper",
  "Glass Mist": "Glass Mist",
  "Dark OLED": "Dark OLED",
  "Notion Dark": "Notion Dark",
  "Notion Card": "Notion Card",
  "Coral Deck": "Coral Deck",
  "Ink Stack": "Ink Stack",
  "Sky Board": "Sky Board",
  "Meadow Card": "Meadow Card",
  "Aurora Flow": "Aurora Flow",
  "Sunset Drift": "Sunset Drift",
  "Ink Pulse": "Ink Pulse",
  "请在桌面应用中隐藏窗口": "Hide the window from the desktop app.",
  "浏览器预览不支持创建分组": "Browser preview cannot create groups.",
  "浏览器预览不支持删除分组": "Browser preview cannot delete groups.",
  "浏览器预览不支持导入任务，请在桌面应用中使用": "Browser preview cannot import tasks. Use the desktop app.",
  "浏览器预览不支持删除任务": "Browser preview cannot delete tasks.",
  "请在桌面应用中清空归档": "Clear the archive in the desktop app.",
  "浏览器预览不修改 Notion，请使用桌面应用": "Browser preview does not modify Notion. Use the desktop app.",
  "浏览器仅预览，外观设置不会保存。": "Browser preview only: appearance settings are not saved.",
  "浏览器预览无法保存 Notion 配置，请使用桌面应用。": "Browser preview cannot save Notion configuration. Use the desktop app.",
  "浏览器预览不能保存设置或退出桌面应用。": "Browser preview cannot save settings or exit the desktop app.",
  "浏览器预览无法测试 Notion 连接，请使用桌面应用。": "Browser preview cannot test Notion connections. Use the desktop app.",
  "Notion 配置已保存": "Notion configuration saved",
  "Notion 数据库可访问；尚未验证全部属性与回写配置": "Notion database is accessible. Property mappings and write configuration have not all been verified.",
  "连接成功": "Connection successful",
  "连接失败": "Connection failed",
  "外观设置尚未送达，无法安全退出。": "Appearance settings have not reached the app. Unable to exit safely.",
  "分组正在删除，请等待操作完成": "This group is being deleted. Wait for the operation to finish.",
  "正在创建分组": "Creating group",
  "正在向该分组添加任务": "Adding tasks to this group",
  "分组有正在进行的操作": "This group has an operation in progress",
  "数据库工作线程未能完成操作": "The database worker could not complete the operation.",
  "数据库版本高于当前应用支持的版本": "This database was created by a newer app version.",
  "数据库版本记录损坏": "The database version record is invalid.",
  "数据库版本计数已满": "The database version counter is full.",
  "Notion 配置损坏": "The saved Notion configuration is invalid.",
  "动效强度无效": "The effect intensity is invalid.",
  "已保存的窗口状态损坏": "The saved window state is invalid.",
  "旧窗口几何数据损坏": "Legacy window geometry is invalid.",
  "旧贴边数据损坏": "Legacy docking data is invalid.",
  "旧窗口几何缺失": "Legacy window geometry is missing.",
  "旧贴边几何缺失": "Legacy docking geometry is missing.",
  "任务身份与现有分组冲突": "The task identity conflicts with an existing group.",
  "Notion 快照不能包含本地或归档任务": "A Notion snapshot cannot include local or archived tasks.",
  "Notion 快照缺少页面身份": "The Notion snapshot is missing a page identity.",
  "Notion 快照包含重复页面": "The Notion snapshot contains duplicate pages.",
  "Notion 快照包含重复任务身份": "The Notion snapshot contains duplicate task identities.",
  "任务不存在": "The task no longer exists.",
  "请先配置 Notion，再修改同步任务": "Configure Notion before changing synced tasks.",
  "任务缺少 Notion 页面身份": "The task is missing its Notion page identity.",
  "找不到任务的原分组": "The task’s original group could not be found.",
  "原分组已删除": "The original group has been deleted.",
  "原分组已删除，无法取消完成；任务仍保留在 Archive 中": "The original group was deleted, so this task cannot be reopened. It remains in Archive.",
  "任务分组不存在或不支持归档": "This group no longer exists or cannot archive tasks.",
  "分组名称不能为空": "Enter a group name.",
  "分组名称过长（最多 24 字）": "Group names must be 24 characters or fewer.",
  "Archive 分组不可删除，请使用清空归档": "Archive cannot be deleted. Use Clear archive.",
  "「来自 Notion」分组不可删除": "The Notion group cannot be deleted.",
  "分组不存在": "The group no longer exists.",
  "请至少提供一条非空任务，任务内容不能为空": "Enter at least one non-empty task.",
  "不能直接向 Archive 导入任务": "Tasks cannot be imported directly into Archive.",
  "Notion 分组内容由同步管理，请在本地分组中导入": "Notion tasks are managed by sync. Import into a local group.",
  "请选择一个已有分组，或填写新分组名称": "Select a group or enter a new group name.",
  "来自 Notion 的任务请在 Notion 中删除（同步后自动消失）": "Delete Notion tasks in Notion. They disappear here after syncing.",
  "Notion 请求超时": "The Notion request timed out.",
  "无法连接 Notion，请检查网络连接": "Unable to connect to Notion. Check your network.",
  "Notion 返回的数据结构不完整，本次未替换本地缓存": "Notion returned incomplete data. The local cache was not replaced.",
  "Notion 凭据无效，请更新 Integration Token": "Notion credentials are invalid. Update your Integration Token.",
  "Notion 权限不足，请检查数据库授权与回写权限": "Notion access denied. Check database access and write permissions.",
  "Notion 数据库或页面不可访问": "The Notion database or page is inaccessible.",
  "Notion 请求受限，将按服务端要求延后重试": "Notion rate limit reached. Retrying is delayed as requested by the server.",
  "Notion 属性类型或选项不匹配，请检查属性映射": "Notion property types or options do not match. Check property mappings.",
  "Notion 服务暂时不可用": "Notion is temporarily unavailable.",
  "Notion 请求失败": "Notion request failed.",
  "无法初始化 Notion HTTP 客户端": "Unable to initialize the Notion HTTP client.",
  "Notion Token 格式无效": "The Notion Token format is invalid.",
  "请先配置 Notion Token 与 Database ID": "Configure your Notion Token and Database ID first.",
  "同步已停止": "Sync has stopped.",
  "无法读取 Notion 配置": "Unable to read Notion configuration.",
  "无法读取待回写队列": "Unable to read pending changes.",
  "无法核对同步配置版本": "Unable to verify the sync configuration version.",
  "Notion 快照未能保存，旧缓存仍保留": "Unable to save the Notion snapshot. The old cache is kept.",
  "存在尚未验证来源的待回写记录，请检查原数据库配置": "Some pending changes have unverified sources. Check the original database configuration.",
  "待回写记录属于其他数据库，未发送到当前数据库": "Some pending changes belong to another database and were not sent to this one.",
  "无法保存待回写记录的来源验证": "Unable to save pending-change source verification.",
  "无法核对待回写记录的配置版本": "Unable to verify the configuration version for pending changes.",
  "远端已接收，但待回写确认未能落库；稍后将幂等重试": "Notion received the change, but local confirmation could not be saved. It will safely retry later.",
  "Notion 配置已变更，正在使用新配置重新同步": "Notion configuration changed. Syncing again with the new configuration.",
  "设置保存器已停止": "The settings writer has stopped.",
  "外观预览版本已过期，请重新读取设置": "The appearance preview is out of date. Load settings again.",
  "窗口设置版本计数已满": "The window settings version counter is full.",
  "设置保存器尚未启动": "The settings writer has not started.",
  "无法确认最后的窗口位置": "Unable to confirm the final window position.",
  "正在读取语言…": "Loading language…",
  "关闭特效": "Off",
  "待回写属性映射损坏": "The pending write property mapping is damaged.",
  "开机自动启动目前仅支持 Windows。": "Launch at startup is only supported on Windows.",
  "无法读取或更新 Windows 开机启动设置。": "Unable to read or update Windows startup settings.",
  "窗口恢复几何无效，未覆盖已保存的窗口位置": "Invalid window restore geometry. The saved position was not overwritten.",
  "窗口状态无效，未覆盖已保存的窗口位置": "Invalid window state. The saved position was not overwritten."
} as const;
export type MessageKey = keyof typeof english;
const chinese: Partial<Record<MessageKey, string>> = {
  "Classic Paper": "经典纸张",
  "Glass Mist": "雾面玻璃",
  "Dark OLED": "OLED 深黑",
  "Notion Dark": "Notion 深色",
  "Notion Card": "Notion 卡片",
  "Coral Deck": "珊瑚卡片",
  "Ink Stack": "墨色叠层",
  "Sky Board": "晴空面板",
  "Meadow Card": "草地卡片",
  "Aurora Flow": "极光流动",
  "Sunset Drift": "落日浮光",
  "Ink Pulse": "墨色脉动",
  "Notion Integration Token": "Notion 集成令牌",
  "Database ID": "数据库 ID",
  "32-char database id": "32 位数据库 ID",
  "同步拉取：日期覆盖今天的任务。勾选时会写 checkbox（默认 done?），并连带更新 Status（默认 Done / Not started），对齐 Notion Button 自动化。": "同步今天开始的任务，以及近 60 天内开始、未完成且日期范围覆盖今天的任务。勾选会回写 Checkbox（默认 done?）和可选 Status（默认 Done / Not started）。测试连接仅验证数据库访问。"
};
export type MessageParams = Readonly<Record<string, string | number>>;

export function resolvePreviewLocale(languages: readonly string[]): Locale {
  // The first valid browser preference wins, not any Chinese language later in the list.
  const language = languages.find((value) => value.trim().length > 0)?.trim();
  return language && /^zh(?:-|$)/i.test(language) ? "zh-CN" : "en";
}

export function translate(locale: Locale, key: MessageKey, params: MessageParams = {}): string {
  const entry = english[key];
  const template = locale === "zh-CN" ? chinese[key] ?? key
    : typeof entry === "string" ? entry : params.count === 1 ? entry.one : entry.other;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined ? placeholder : typeof value === "number"
      ? new Intl.NumberFormat(locale).format(value) : value;
  });
}

export function displayLabel(locale: Locale, value: string): string {
  return Object.prototype.hasOwnProperty.call(english, value) ? translate(locale, value as MessageKey) : value;
}

/** Translate known native messages while retaining safe HTTP status/code diagnostics. */
export function localizeError(locale: Locale, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (Object.prototype.hasOwnProperty.call(english, message)) return translate(locale, message as MessageKey);
  for (const [key, entry] of Object.entries(english)) {
    if (typeof entry === "string" && entry === message) return translate(locale, key as MessageKey);
  }
  const suffix = message.match(/^(.*?)(?:（(HTTP [^）]+)）| \(((?:HTTP|OS) [^)]+)\))$/);
  if (suffix) return localizeError(locale, suffix[1]) + ` (${suffix[2] ?? suffix[3]})`;
  const context = message.match(/^(无法读取自启动状态：|无法更新自启动设置：)(.*)$/);
  if (context) {
    return translate(locale, context[1] === "无法读取自启动状态："
      ? "无法读取自启动状态：{error}" : "无法更新自启动设置：{error}", { error: localizeError(locale, context[2]) });
  }
  // Unknown OS/SQLite errors are already diagnostic text; do not invent a success or hide them.
  return message;
}

export function formatTaskDate(locale: Locale, value: string): string {
  return value.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (original, year, month, day) => {
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(date.getTime()) ? original
      : new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(date);
  });
}
