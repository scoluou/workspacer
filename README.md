<div align="center">
  <img src="src-tauri/icons/icon.png" alt="WorkSpacer logo" width="128" />
  <h1>WorkSpacer</h1>
  <p>A tiny, fast desktop launcher for running coding agents across multi-root workspaces.</p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
    <img src="https://img.shields.io/badge/platform-Windows-0078D6.svg" alt="Platform: Windows" />
    <a href="https://tauri.app"><img src="https://img.shields.io/badge/built%20with-Tauri%202-FFC131.svg" alt="Built with Tauri 2" /></a>
  </p>
  <p><b>English</b> | <a href="README.zh-CN.md">中文</a></p>
</div>

---

## 💡 Why

Coding agents are at their best as what they are — native CLIs in a real
terminal. The vendor alternatives trade that for a full-blown IDE fork or a
heavyweight desktop app you don't need. The bare CLI, on the other hand,
gets tedious once you work
across multiple repos: every agent takes its directories differently
(`--workspace`, `-C`, `--add-dir`, positional args...), and resuming a
session means hunting down session IDs by hand.

WorkSpacer keeps the native CLI experience and adds the missing convenience:
named multi-root workspaces, the right command built for each agent, and
one-click session resume.

## 🎯 Design principles

- **Native CLI first** — WorkSpacer is built for people who prefer coding
  agents as native CLIs. It doesn't wrap the agent in a GUI; it removes the
  friction around it (directory flags, session IDs, context injection) and
  gets out of the way.
- **The sessions on the list are the ones you never restart** — closed
  conversations are simply not saved. Every entry is running right now or
  resumes in one click, so the list stays focused on what you can actually
  return to — nothing dead to scroll past.

## ✨ Features

- 🗂️ **Multi-root workspaces** — a named set of project folders + default
  agent + a description injected into the agent as context on launch.
- 🖥️ **Embedded terminal** — agents run inside the app (xterm.js + PTY) with
  full TUI support and two-level tabs (workspaces × terminals). Prefer a
  real console? Launch into a standalone cmd / PowerShell window instead.
- 🔁 **Session resume** — discovers existing agent sessions on disk and
  re-attaches with the right flags; sessions survive app restarts.
- 💬 **Conversation bar** — your prompts are recorded per terminal; click an
  entry to jump the scrollback to that point.
- 🖱️ **Drag & drop** — drop folders on the sidebar to create a workspace, on
  a workspace to add projects, on a terminal to paste the path. Drag items
  to reorder.

## 🤖 Supported agents

| Agent | CLI | Primary dir | Extra dirs | Session resume |
|-------|-----|-------------|------------|----------------|
| Cursor CLI | `agent` | `--workspace` | `--add-dir` | `--continue` |
| Codex CLI | `codex` | `-C` | `--add-dir` | `resume --last` |
| Claude Code | `claude` | working dir | `--add-dir` | `--resume <id>` |
| OpenCode | `opencode` | positional | single-dir only | `--continue` |
| PI Agent | `pi` | working dir | single-dir only | `--session-id <id>` |

The primary directory is the workspace's first project folder; agents
without a directory flag (Claude Code, pi) are simply launched with it as
the working directory. A workspace with no folders starts the agent in your
home directory.

> [!NOTE]
> OpenCode and pi only support a single directory; extra folders are ignored.

## 📦 Installation

Download the installer (NSIS / MSI) from
[Releases](https://github.com/scoluou/workspacer/releases), or build from
source below. Requires Windows 10/11 with the WebView2 Runtime
(preinstalled on Windows 11) and whichever agent CLIs you want to launch.

## 🛠️ Development

Prerequisites: [Node.js](https://nodejs.org), [Rust](https://rustup.rs).

```bash
npm install
npm run tauri:dev    # run in dev mode with hot reload
```

## 🏗️ Building

```bash
npm run tauri:build         # NSIS + MSI installers under src-tauri/target/release/bundle
npx tauri build --no-bundle # just the exe: src-tauri/target/release/workspacer.exe
```

## 🧰 Tech stack

- **Frontend**: TypeScript + Vite (no framework), [xterm.js](https://xtermjs.org)
- **Backend**: Rust + [Tauri 2](https://tauri.app) (system WebView2),
  [portable-pty](https://crates.io/crates/portable-pty)

## 💾 Data

Everything is stored as JSON under `%APPDATA%\workspacer\`
(`workspaces.json`, `settings.json`, UI state). Export/import with automatic
`.bak` backup is available in Settings.

## 📄 License

[MIT](LICENSE)
