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
