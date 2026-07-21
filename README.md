# Sticky Note

Windows 写实便签桌面应用：置顶悬浮、多主题、与 Notion Database 双向同步。基于 **Tauri 2 + React + Rust**，目标常驻内存 &lt;200MB。

## 功能

- 无边框置顶便签窗口，可拖动、缩放
- Classic Paper / Glass / Dark 三种主题
- 拖动时弹簧倾斜回弹视觉效果
- Glass 主题启用 Windows Acrylic 毛玻璃
- Notion Integration Token 连接 Database
- 本地 SQLite 缓存；勾选任务即时回写 Notion `done`
- 系统托盘：显示 / 隐藏 / 退出
- 边缘吸附（类早期 QQ）：拖到屏幕边缘松手后收成细条，鼠标靠近弹出；拖离边缘恢复正常

## 环境要求

- Windows 10/11
- [Node.js](https://nodejs.org/) 20+（或 fnm）
- [Rust](https://rustup.rs/) stable
- WebView2（Win11 通常已预装）
- Visual Studio Build Tools（含 C++ 工作负载，供 Rust MSVC 链接）

## 开发

```bash
# 安装前端依赖
npm install

# 开发模式（热更新）
npm run tauri dev

# 仅构建前端
npm run build

# 生产打包（生成 NSIS 安装包）
npm run tauri build
```

安装包输出目录：`src-tauri/target/release/bundle/nsis/`（本仓库也可查看 `releases/` 下已复制的安装包）。

## 连接 Notion

1. 打开 [Notion My Integrations](https://www.notion.so/my-integrations)，创建 **Internal Integration**。
2. 复制 Integration Secret（Token）。
3. 打开目标 Database → `···` → Connections → 添加该 Integration。
4. 从 Database 页面 URL 复制 32 位 Database ID（`notion.so/` 与 `?v=` 之间的一段）。
5. 在便签中点 ⚙ 设置，粘贴 Token 与 Database ID。
6. 如属性名不是默认的 `done?` / `Name` / `Date`，在设置里改「完成属性名」「标题属性名」「日期属性名」。
7. 点「测试连接」→「保存」。约 30 秒内**仅今天 Date 的任务**会同步到便签。

勾选便签任务后，会 PATCH Notion 对应页面的 checkbox（默认 `done?`）；失败时写入本地待同步队列，下次轮询重试。

> 同步过滤：Notion query 使用 `Date equals 今天`（本地时区），不会再拉历史计划里的上百条旧任务。

## 项目结构

```
src/                 React UI、主题、物理弹簧
src-tauri/src/       Rust：窗口、SQLite、Notion、同步引擎
```

## 性能说明

- 空闲轮询间隔 30s；未配置 Notion 时使用本地 mock，不发起网络请求。
- 动画仅使用 `transform` / `opacity`。
- Glass 主题在部分远程桌面 / 旧 GPU 上 Acrylic 可能失败，会自动降级为半透明样式。
