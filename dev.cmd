@echo off
rem Dev mode: Vite dev server + app window (frontend hot reload, Rust rebuild on change)
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

rem single-instance: a running release instance would block the dev instance
taskkill /F /IM workspacer.exe >nul 2>&1 && (echo closed the running workspacer instance & timeout /t 1 /nobreak >nul)

npm run tauri:dev
