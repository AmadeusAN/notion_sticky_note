# Sticky Note

[English](README.md) · **简体中文** · [下载 Windows 安装包](https://github.com/AmadeusAN/notion_sticky_note/releases/latest)

轻量级 Windows 桌面置顶便签与待办工具：支持高刷屏幕丝滑贴边收起、丰富的主题与边缘特效、本地分组归档，以及可选的 Notion 数据库双向同步。基于 Tauri 2、React 和 Rust 构建。

## 界面预览

| 经典纸张主题（中文） | 深色卡片主题（Ink Stack） | 设置面板（中文） |
|---|---|---|
| ![中文主面板](docs/screenshots/main-zh.png) | ![深色卡片主题主面板](docs/screenshots/main-dark-en.png) | ![中文设置面板](docs/screenshots/settings-zh.png) |

## 核心功能

- **桌面置顶与高刷贴边收起：** 窗口可始终置顶，拖到屏幕边缘自动贴边收成细条，鼠标悬停即丝滑滑出——原生适配 60Hz / 144Hz / 180Hz 等高刷新率显示器。
- **本地任务、批量导入与归档：** 无需连接 Notion 也可独立使用。支持自定义本地分组、使用 `;` 或 `；` 批量分隔导入任务，已完成任务自动收入 **Archive（归档）**（取消勾选即可放回原组）。
- **可选 Notion 数据库同步：** 自动拉取今日及跨日进行中的 Notion 任务；勾选完成可即时更新本地并异步回写远端（断网时自动保留队列并在恢复后重试）。
- **15 套主题与 8 种边缘特效：** 浅色与深色主题独立配置并随 Windows 系统外观自动切换（纸张、玻璃、Notion/Claude 风格、分层卡片、动态流光），搭配落叶、樱花、飘雪、雨滴、冰棱、萤火虫、墨迹、藤蔓边缘特效。
- **托盘常驻与双语界面：** 点击关闭（`×` / `Alt+F4`）隐藏到系统托盘而不退出；支持跟随系统语言自动切换简中/英文，并可选开机自动启动。

## 安装与升级

1. 从 [Releases](https://github.com/AmadeusAN/notion_sticky_note/releases/latest) 下载最新的 `*-setup.exe` 安装包（支持 Windows 10/11 x64；需 WebView2 Runtime，Win11 通常已内置）。
2. 双击运行即可按当前用户安装（安装向导支持简体中文与英文）。
3. **版本升级：** 升级前先右键系统托盘图标选择退出，再直接运行新版 `*-setup.exe`。安装程序会自动识别之前的安装目录完成原位更新，并完整保留保存在 SQLite（`AppData`）中的所有本地任务、分组、主题与 Notion 配置。

> **提示：** 安装包目前为未签名构建，Windows SmartScreen 可能会提示“未知发布者”。请确认下载来源为本仓库，并在核对 Release 页面附带的 `SHA256SUMS.txt` 后再继续运行。

## 连接 Notion（可选）

使用 Notion 官方 **Internal Integration（内部集成）** 接口，无需浏览器插件，也无需提供账号密码：

1. 前往 [Notion My Integrations](https://www.notion.so/my-integrations) 新建内部集成，勾选 **Read content**（如需勾选回写任务状态，还需勾选 **Update content**），复制生成的 **Secret / Token**。
2. 在 Notion 中打开源数据库 → 右上角 `···` → **Connections（连接）** → 添加刚才创建的集成。
3. 从源数据库链接中提取 32 位 **Database ID**（格式如 `https://www.notion.so/<DATABASE_ID>?v=<VIEW_ID>`，忽略 `?v=` 后的视图参数）。
4. 在应用**设置**中填入 Token、Database ID 及对应的属性名称，点击**测试连接**并**保存**。

### 最小 Notion 数据库结构

| 属性名 | Notion 类型 | 说明 |
|---|---|---|
| `Name` | Title | 任务标题（必需，只读） |
| `done?` | Checkbox | 完成状态（必需，支持勾选回写） |
| `Date` | Date | 任务日期或起止区间（必需，无日期的任务不显示） |
| `Status` | Status 或 Select | 可选联动状态（默认 `Not started` / `Done`，无此列请清空设置项） |

<details>
<summary>更多可选字段别名与同步规则</summary>

- **只读辅助字段：** 自动识别 `Progress`（`progress line` / `progress` / `Progress` / `进度`）、`Remain`（`remain` / `Remain` / `剩余` / `Remaining`）以及 `Tags`（`tags` / `Tags` / `标签`）。
- **日期窗口：** 按本机时区拉取覆盖今天的任务，以及过去 60 天内开始且未完成的跨日任务，避免拉取整库造成冗余。
- **同步节奏：** 启动约 2 秒后首次拉取，之后每轮完成约 30 秒刷新一次（隐藏到托盘仍持续同步）。本地创建、分组、删除和归档均不会创建或删除 Notion 页面。

</details>

## 从源码构建

开发环境需安装 Node.js 20+、Rust stable（MSVC）及 Visual Studio C++ 桌面开发工具链：

```powershell
npm ci
npm run tauri:dev

# 运行测试
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib

# 构建 NSIS 安装包 -> src-tauri/target/release/bundle/nsis/
npm run tauri:build -- --bundles nsis -- --locked
```

## 开源许可

项目原创代码与图标基于 [MIT License](LICENSE) 开源；第三方依赖与字体许可详见 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。本项目与 Notion 官方无隶属或背书关系。
