# workspacer

Tauri 2 桌面应用：多 root workspace 的 coding agent 启动器（cursor / agent / codex / claude / opencode / pi）。

- 前端：`index.html` + `src/main.ts`（vanilla TS，无框架）
- 后端：`src-tauri/src/main.rs`（Tauri commands）
- 数据：`dirs::config_dir()/workspacer/*.json`

## UI 约定

- 弹窗一律用应用内组件：确认/输入用 `modal()`，右键菜单用 `showCtxMenu()`（都在 `src/main.ts`）。原生 `window.alert/confirm/prompt` 不吃主题，不要用。
- 颜色一律走 CSS 变量（`index.html` 的 `:root`：`--bg`、`--bg-raised`、`--accent`、`--danger` 等）。后续会支持切换主题，主题 = 换一组 `:root` 变量值；新增 UI 硬编码色值会在换主题时漏改。需要 hover 变体时用 `filter: brightness()` 派生，不新增硬编码色。
- 文案走 `src/main.ts` 的 `DICT` i18n，新增文案 zh / en 两条都要加。

## 构建

- `npx tauri build --no-bundle`（需要 `%USERPROFILE%\.cargo\bin` 在 PATH 里）
- 产物 `src-tauri/target/release/workspacer.exe` 即运行版本，任务栏 pin 直接指向它。重新构建前先关闭运行中的实例，否则 exe 被锁、链接失败。

## 平台

- Windows 与 macOS 都支持；分叉只在 exec 层（`main.rs` 顶部的 platform shims）：
  Windows 经 `cmd.exe`（npm 装出来的 agent 是 `.cmd` shim）并带 Win32 creation
  flags，unix 直接 exec 二进制。数据模型、会话发现、PTY 管道完全共用。
- 平台相关处一律走 `#[cfg(windows)]` / `#[cfg(not(windows))]`，改 Windows 行为时
  注意别动 unix 分支（反之亦然）。`cargo test` 里的平台专属测试同样按 cfg 分。
- 启动线（`build_agent` 产出的 `args`）是 Windows 命令行字符串：Windows 原样交给
  `cmd /c`，unix 用 `split_win_line()` 拆回 argv（含 `\"` → `"`）。改 args 拼装时两边都要想一遍。
- macOS 本地构建命令：`./dev.command` / `./build.command`（等价 dev.cmd / build.cmd）。
