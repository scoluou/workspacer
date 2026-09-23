#!/bin/sh
# Dev mode: Vite dev server + app window (frontend hot reload, Rust rebuild on change)
# macOS counterpart of dev.cmd — double-clickable, or run ./dev.command
cd "$(dirname "$0")" || exit 1

# single-instance: a running release instance would block the dev instance
pkill -x workspacer 2>/dev/null && { echo "closed the running workspacer instance"; sleep 1; }

exec npm run tauri:dev
