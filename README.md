# Sticky Note

**English** · [简体中文](README.zh-CN.md) · [Download Windows Installer](https://github.com/AmadeusAN/notion_sticky_note/releases/latest)

An always-on-top Windows desktop sticky note and task manager with smooth edge docking, customizable themes & ambient effects, local task groups, and optional Notion database sync. Built with Tauri 2, React, and Rust.

## Screenshots

| Classic Paper | Dark Layered (`Ink Stack`) | Settings |
|---|---|---|
| ![Main panel in Classic Paper theme](docs/screenshots/main-en.png) | ![Main panel in Ink Stack dark theme](docs/screenshots/main-dark-en.png) | ![Settings panel](docs/screenshots/settings-en.png) |

[View Chinese screenshots](README.zh-CN.md#界面预览)

## Features

- **Always-on-top & Edge Docking:** Pin the note above other windows, drag it to any screen edge to tuck into a compact strip, and hover to slide out smoothly — synced natively to high-refresh-rate displays (60Hz / 144Hz / 180Hz+).
- **Local Tasks & Archive:** Works offline without Notion. Organize tasks into local groups, bulk-import multiple tasks separated by `;` or `；`, and move completed items to **Archive** (with one-click uncheck restore).
- **Optional Notion Sync:** Pull today's tasks and active multi-day tasks from a Notion database; checking items updates Notion immediately and queues offline retries automatically if disconnected.
- **15 Themes & 8 Edge Effects:** Choose separate Light and Dark themes (Paper, Glass, Notion, Claude, Google, layered cards, and animated motion themes) that follow your Windows mode, paired with edge effects like leaves, sakura, snow, rain, icicles, fireflies, ink, and vines.
- **Tray-Resident & Bilingual:** Closing (`×` / `Alt+F4`) hides to the system tray instead of quitting; supports English and Simplified Chinese (auto-detected from Windows or overridden in Settings) and optional **Start with Windows**.

## Install & Upgrade

1. Download the latest `*-setup.exe` installer from [Releases](https://github.com/AmadeusAN/notion_sticky_note/releases/latest) (Windows 10/11 x64; requires WebView2 Runtime, built into Windows 11).
2. Double-click to install for the current user (choose English or Simplified Chinese during setup).
3. **Upgrading:** Quit the running app from the tray icon menu first, then run the new `*-setup.exe`. The installer automatically detects your previous installation directory for an in-place update while preserving all local tasks, groups, themes, and Notion settings in SQLite (`AppData`).

> **Note:** Releases are currently unsigned, so Windows SmartScreen may show an "Unknown publisher" warning. Confirm the download comes from this repository and verify the hash against `SHA256SUMS.txt` on the release page before continuing.

## Connect Notion (Optional)

Sticky Note uses Notion's official **Internal Integration** API (no browser extensions or passwords required):

1. Create an integration at [Notion My Integrations](https://www.notion.so/my-integrations) with **Read content** (and **Update content** if you want checkbox sync-back), then copy its **Internal Integration Secret**.
2. Open your source database in Notion → `···` → **Connections** → add your integration.
3. Copy the 32-character **Database ID** from the database URL (`https://www.notion.so/<DATABASE_ID>?v=<VIEW_ID>` — ignore everything after `?v=`).
4. Paste the token, Database ID, and exact property names in **Settings**, then click **Test connection** and **Save**.

### Minimal Notion Database Schema

| Property | Notion Type | Purpose |
|---|---|---|
| `Name` | Title | Task title (required, read-only) |
| `done?` | Checkbox | Completion state (required, two-way sync) |
| `Date` | Date | Task date or range (required; tasks without a date are hidden) |
| `Status` | Status or Select | Optional linked status (`Not started` / `Done` by default; clear the field name if unused) |

<details>
<summary>Optional metadata properties &amp; sync details</summary>

- **Read-only metadata aliases:** Automatically displays `Progress` (`progress line` / `progress` / `Progress` / `进度`), `Remain` (`remain` / `Remain` / `剩余` / `Remaining`), and `Tags` (`tags` / `Tags` / `标签`).
- **Date window:** Syncs tasks covering today (local timezone) and incomplete multi-day tasks started within the past 60 days.
- **Sync cadence:** Polls ~2s after launch and ~30s after each completed cycle (even while hidden in the tray). Local groups, deletions, and Archive never create or delete pages in Notion.

</details>

## Build from Source

Requires Node.js 20+, Rust stable (MSVC), and Visual Studio Build Tools (Desktop development with C++):

```powershell
npm ci
npm run tauri:dev

# Run tests
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib

# Build NSIS installer -> src-tauri/target/release/bundle/nsis/
npm run tauri:build -- --bundles nsis -- --locked
```

## License

Code and icons are licensed under the [MIT License](LICENSE). Third-party dependencies, fonts, and runtime notices are listed in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt). Not affiliated with Notion.
