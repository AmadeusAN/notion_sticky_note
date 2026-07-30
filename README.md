# Sticky Note

Windows 写实便签桌面应用：置顶悬浮、多主题、与 Notion Database 双向同步。基于 **Tauri 2 + React + Rust**，目标常驻内存 &lt;200MB。

## 功能

- 无边框置顶便签窗口，可拖动、缩放
- 多套浅色 / 深色便签主题（跟随系统自动切换）
- 拖动时弹簧倾斜回弹视觉效果
- Glass 等主题可启用 Windows Acrylic 毛玻璃（失败则降级半透明）
- Notion Integration Token 连接 Database
- 本地 SQLite 缓存；勾选任务即时回写 Notion `done` / Status
- 系统托盘：显示 / 隐藏 / 退出
- 边缘吸附（类早期 QQ）：拖到屏幕边缘松手后收成细条，鼠标靠近弹出（果冻滑动）；拖离边缘恢复正常
- 边缘贴边氛围特效：叶片 / 樱花 / 藤蔓 / 冰锥 / **墨迹**（贴边生长）；雨滴 / 雪花 / **萤火**（Canvas 氛围场）；可关闭
- 特效随便签底色做对比自适应；设置里可调**特效强度**与**边缘高对比**
- 独立透明特效窗绘制（主窗零粒子 DOM）
- 贴边扶手样式可选（胶囊 / 纸感 / 凹槽）

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
6. 如属性名不是默认的 `done?` / `Name` / `Date`，在设置里改「完成属性名」「标题属性名」「日期属性名」；Status 字段可按需配置。
7. 点「测试连接」→「保存」。约 30 秒内**仅今天 Date 的任务**会同步到便签。

勾选便签任务后，会 PATCH Notion 对应页面的 checkbox（默认 `done?`）以及 Status（若已配置）；失败时写入本地待同步队列，下次轮询重试。

> 同步过滤：Notion query 使用 `Date equals 今天`（本地时区），不会再拉历史计划里的上百条旧任务。

## 项目结构

```
src/
  App.tsx / components/   主窗 UI（便签、设置、任务列表）；主题色 sync 到 fx 窗
  fx/                     特效子系统（主窗零粒子 DOM）
    FxHost.tsx            fx 透明窗入口（按设置切换主题 + 外观 CSS 变量）
    appearance.ts         明度 / 对比档案 / 强度与边缘增益
    appearanceStore.ts    模块级外观状态（供 Canvas sim 读取）
    themes.ts             特效 id：leaf / sakura / vine / icicle / ink / rain / snow / firefly / none
    types.ts              事件契约（含 fx-appearance-changed）
    weather/              Canvas 天气运行时（池、sprite、WeatherCanvas）
    useFxAmbientPulse.ts  主窗定时 pulse（避免 fx 窗定时器被节流）
    theme/leaf|sakura|vine|icicle|ink/   贴边 fringe（墨迹另有 bleed canvas）
    theme/rain|snow|firefly/             Canvas 氛围场（无 fringe）
src-tauri/src/
  edge_dock.rs            边缘吸附相位与滑动动画
  fx_window.rs            特效窗几何 / 显隐 / 置顶层级 / emit（不关心画什么）
  notion.rs / sync.rs     Notion 同步
  database.rs             SQLite（含 fx_theme / fx_intensity / fx_edge_boost / note_* 色）
  window.rs               置顶、Acrylic、防 Aero Snap 等
```

### 特效架构（换皮肤）

- **主窗**只跟踪 dock 相位，并通过 `useFxAmbientPulse` / Rust 发语义事件；不渲染粒子。换便签主题时 `sync_fx_palette` 把底色推给 fx 窗。
- **fx 窗**（`label=fx`）铺在便签面板外扩一圈：鼠标穿透；Windows 下会保持在主窗之上，避免粒子被便签 HWND 挡住。
- 设置里「贴边特效」可选叶片 / 樱花 / 藤蔓 / 冰锥 / 墨迹 / 雨滴 / 雪花 / 萤火 / 关闭；并可调特效强度与边缘高对比。写入 SQLite 后通过 `fx-theme-changed` / `fx-appearance-changed` 同步到 fx 窗。
- **生长类**（叶 / 樱 / 藤 / 冰锥 / 墨迹）挂贴边 fringe；**氛围类**（雨 / 雪 / 萤火）只有散布与环境场，**不**画 fringe。浅色底自动加深/加浓粒子，深色底提亮。
- 换一套完整氛围：新增 `src/fx/theme/<name>/`，在 `FxHost.tsx` / `themes.ts` 注册，并在 Rust `set_fx_theme` **allowlist** 里加上 id。

事件：

| 事件 | 含义 |
|------|------|
| `fx-scatter` | 探出 / 探回散布 |
| `fx-sync` | 特效窗对齐面板 / 显隐 |
| `fx-ambient` | 时不时的飘落等环境特效 |
| `fx-theme-changed` | 设置切换特效主题 |
| `fx-appearance-changed` | 强度 / 边缘高对比 / 便签色板同步 |
| `edge-dock-changed` | 贴边相位变化（fringe 时机） |

命令：`pulse_fx_ambient`（主窗定时调用）、`set_fx_theme`、`set_fx_intensity`、`set_fx_edge_boost`、`sync_fx_palette`（主窗主题色 → fx）。

## 性能说明

- 空闲轮询间隔 30s；未配置 Notion 时使用本地 mock，不发起网络请求。
- 动画仅使用 `transform` / `opacity`。
- 探出/探回散布与环境场由当前主题决定；强度滑条与便签底色对比会影响密度/透明度。特效关闭时不 pulse。
- Glass 主题在部分远程桌面 / 旧 GPU 上 Acrylic 可能失败，会自动降级为半透明样式。
