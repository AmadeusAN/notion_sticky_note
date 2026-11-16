# Debug 工作目录

用于随时启动**最新构建**的便签 exe，不用手动去翻 `src-tauri/target/`。

## 用法

```bat
:: 一步：同步最新 exe 并直接打开
debug\run_latest.bat

:: 只同步，不打开（刷新 debug\app\latest.exe 及历史副本）
debug\sync_latest.bat
```

- 同步来源：`src-tauri/target/release\*.exe`（无 release 构建时回退 `target/debug`），取其中最新一个。
- 同步目标：`debug\app\latest.exe`（每次覆盖为最新）；每次构建的副本另存到 `debug\app\history\`，可随时清理。

双击 `debug/edge_effects_preview.html` 可独立体验宽域玻璃流光与全高度纸页翻卷。预览和主程序共用 `src/materials/paper-peel.js`，不要只移动 HTML 文件；该页面不访问便签数据。

双击 `debug/icon_preview.html` 可查看应用图标、16 / 20 / 24px 等实际尺寸，以及明暗背景下的独立托盘图标。请保留相对于 `src-tauri/icons/` 的目录位置。


## 前置条件

- 先执行过 `npm run tauri build`（产出 `src-tauri/target/release/sticky-note.exe`）。
- 系统需装有 WebView2（Win11 通常已预装）。

## 说明

- exe 自包含前端资源（Tauri custom-protocol 已内嵌），拷到任何位置都能独立运行；设置/数据写在 `%APPDATA%`，与运行目录无关。
- 开机启动：从 `debug/app/latest.exe` 的设置页开启「开机自动启动」，登录后会直接运行这一固定路径。继续用 `run_latest.bat` 更新即可；移动目录或改用安装版后，需在新位置关闭再开启一次。
- 批量导入：主面板右上角导入图标可粘贴长文本，仅用 `；` / `;` 分隔，保留逗号、段内换行及重复内容；`Ctrl+Enter` 提交，输入法组合期间 Enter 不提交，失败保留草稿。支持已有／新建本地分组，完成的本地任务移入固定 Archive；Notion 同步任务不参与归档。
- 删除本地任务、分组或清空 Archive 均先确认，默认聚焦取消；Escape 取消并恢复入口焦点，执行中不重复提交。
- `.gitignore` 里 `*.exe` 已全局忽略，`app\` 下的构建产物不会进版本库；`sync_latest.bat` / `run_latest.bat` 本身会被跟踪。
- `run_latest.bat` 会先 `taskkill /f /im latest.exe` 释放 exe 文件锁，再同步并启动。**建议先从托盘正常退出，再执行 `sync_latest.bat`**；强杀不能保证尚未送达原生层或尚未完成保存的外观、窗口状态及未提交操作不丢失。
- 主面板右上角仅保留 **×**，点击它（或按 Alt+F4）隐藏到托盘，不结束进程；主窗与独立特效窗会一起离开前台。单击托盘图标或右键「显示便签」恢复，调试结束需从托盘菜单「退出」彻底结束程序。
- 贴边展开仅在鼠标进入露出的边条范围时触发，不再在附近提前展开；展开后的离开防抖与原动画保持不变。
- 正常退出先保存外观和有效窗口状态；保存失败可重试、取消退出，或明确选择不保存退出。关闭设置后仍可看到未保存状态并重试。
- 设置页使用独立浅色系统滚动条，深色便签下也不出现黑色轨道；强制颜色模式保留系统配色。原生最小尺寸仍为 100×100，窄／矮窗口通过换行与滚动访问内容。