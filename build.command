#!/bin/sh
# Build workspacer → src-tauri/target/release/workspacer
#   build.command           just the binary (fast)
#   build.command -Bundle   binary + .app / .dmg
# macOS counterpart of build.cmd.
cd "$(dirname "$0")" || exit 1

# a running instance holds the binary and fails the link step
pkill -x workspacer 2>/dev/null && { echo "closed the running workspacer instance"; sleep 1; }

if [ "$1" = "-Bundle" ]; then
  exec npx tauri build
else
  exec npx tauri build --no-bundle
fi
