# workspacer

A tiny, fast launcher for running coding agents against multi-root workspaces.

Create a workspace (a named set of project directories), pick a coding agent,
and launch it in a fresh terminal rooted at that workspace — no more retyping
`cd` + agent flags every time.

## Why

Coding agents each take their working directory and extra directories
differently (`--workspace`, `-C`, `--add-dir`, positional args...). workspacer
remembers your folder sets and builds the right command for each agent.

## Supported agents

| Agent | Primary dir | Extra dirs |
|-------|-------------|------------|
| Cursor CLI | `--workspace` | `--add-dir` |
| Codex CLI | `-C` | `--add-dir` |
| Claude Code | cwd | `--add-dir` |
| OpenCode | positional | single-dir only |
| pi | cwd | single-dir only |

> OpenCode and pi only support a single directory; extra folders are ignored.

## Tech stack

- **Frontend**: TypeScript + Vite (no framework)
- **Backend / shell**: Rust + [Tauri 2](https://tauri.app) (system WebView2)
- Result: ~4 MB binary, ~0.5 s cold start (vs ~70 MB / seconds for Electron)

## Development

Prerequisites: [Node.js](https://nodejs.org), [Rust](https://rustup.rs),
and the WebView2 Runtime (preinstalled on Windows 11).

```bash
npm install
npm run tauri:dev    # run in dev mode with hot reload
```

## Build

```bash
npm run tauri:build  # produces NSIS + MSI installers under src-tauri/target/release/bundle
```

## Data

Workspaces are stored as JSON at `%APPDATA%/workspacer/workspaces.json`.

## License

[MIT](LICENSE)
