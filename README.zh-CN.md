<div align="center">
  <img src="src-tauri/icons/icon.png" alt="WorkSpacer logo" width="128" />
  <h1>WorkSpacer</h1>
  <p>一个小巧快速的桌面启动器：在多 root workspace 上运行 coding agent。</p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
    <img src="https://img.shields.io/badge/platform-Windows-0078D6.svg" alt="Platform: Windows" />
    <a href="https://tauri.app"><img src="https://img.shields.io/badge/built%20with-Tauri%202-FFC131.svg" alt="Built with Tauri 2" /></a>
  </p>
  <p><a href="README.md">English</a> | <b>中文</b></p>
</div>

---

## 💡 为什么

Coding agent 最好的形态就是它本来的样子 —— 跑在真正终端里的原生
CLI。而厂商给的替代方案，往往是整个 IDE 套壳或笨重的桌面应用，你
并不需要。裸 CLI 一旦跨多个 repo 就很繁琐：每个 agent 接收目录的
方式都不一样
（`--workspace`、`-C`、`--add-dir`、位置参数……），恢复会话还得自己
翻 session ID。

WorkSpacer 保留原生 CLI 的体验，补上缺失的便利：命名的多 root
workspace、为每个 agent 拼好正确的命令、一键恢复会话。

## 🎯 设计理念

- **原生 CLI 优先** —— WorkSpacer 为喜欢原生 CLI 的人设计。它不把
  agent 包进 GUI，只消除外围的摩擦（目录参数、session ID、上下文注入），
  然后让开。
- **列表里的会话都不需要重启** —— 关闭的对话直接不保存；每一条要么
  正在运行，要么一键恢复。列表永远聚焦在你真正能回到的现场，没有需要
  清理的死记录。

## ✨ 功能

- 🗂️ **多 root workspace** —— 一组命名的项目目录 + 默认 agent + 描述
  文本，启动时作为上下文注入给 agent。
- 🖥️ **内嵌终端** —— agent 在应用内运行（xterm.js + PTY），完整支持
  TUI，两级标签页（workspace × 终端）。更喜欢真实控制台？也可以启动
  到独立的 cmd / PowerShell 窗口。
- 🔁 **会话恢复** —— 自动发现磁盘上已有的 agent 会话并用正确的参数
  重新接入；会话在应用重启后依然保留。
- 💬 **对话栏** —— 按终端记录你发出的每条 prompt，点击即可跳转到滚动
  历史中对应的位置。
- 🖱️ **拖放** —— 文件夹拖到侧栏创建 workspace，拖到 workspace 详情页
  添加项目，拖到终端直接粘贴路径。拖拽即可排序。

## 🤖 支持的 agent

| Agent | 命令 | 主目录参数 | 附加目录 | 会话恢复 |
|-------|------|-----------|----------|----------|
| Cursor CLI | `agent` | `--workspace` | `--add-dir` | `--continue` |
| Codex CLI | `codex` | `-C` | `--add-dir` | `resume --last` |
| Claude Code | `claude` | 工作目录 | `--add-dir` | `--resume <id>` |
| OpenCode | `opencode` | 位置参数 | 仅单目录 | `--continue` |
| PI Agent | `pi` | 工作目录 | 仅单目录 | `--session-id <id>` |

主目录 = workspace 的第一个项目文件夹；没有目录参数的 agent（Claude
Code、pi）直接以它为工作目录启动。workspace 没有任何目录时，则在用户
主目录下启动。

> [!NOTE]
> OpenCode 和 pi 只支持单个目录，多余的文件夹会被忽略。

## 📦 安装

从 [Releases](https://github.com/scoluou/workspacer/releases) 下载安装包
（NSIS / MSI），或按下文从源码构建。需要 Windows 10/11 和 WebView2
运行时（Windows 11 自带），以及你要启动的 agent CLI。

## 🛠️ 开发

前置依赖：[Node.js](https://nodejs.org)、[Rust](https://rustup.rs)。

```bash
npm install
npm run tauri:dev    # 开发模式运行，支持热更新
```

## 🏗️ 构建

```bash
npm run tauri:build         # 生成 NSIS + MSI 安装包，位于 src-tauri/target/release/bundle
npx tauri build --no-bundle # 只生成 exe：src-tauri/target/release/workspacer.exe
```

## 🧰 技术栈

- **前端**：TypeScript + Vite（无框架）、[xterm.js](https://xtermjs.org)
- **后端**：Rust + [Tauri 2](https://tauri.app)（系统 WebView2）、
  [portable-pty](https://crates.io/crates/portable-pty)

## 💾 数据

所有数据以 JSON 存放在 `%APPDATA%\workspacer\`（`workspaces.json`、
`settings.json`、界面状态）。设置页提供导出 / 导入，导入前自动备份
当前文件为 `.bak`。

## 📄 License

[MIT](LICENSE)
