@echo off
rem Build workspacer → src-tauri\target\release\workspacer.exe
rem   build.cmd           just the exe (fast)
rem   build.cmd -Bundle   exe + NSIS/MSI installers (for releases)
cd /d "%~dp0"

rem cargo must be on PATH
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

rem a running instance locks the exe and fails the link step
taskkill /F /IM workspacer.exe >nul 2>&1 && (echo closed the running workspacer instance & timeout /t 1 /nobreak >nul)

if /i "%~1"=="-Bundle" (npx tauri build) else (npx tauri build --no-bundle)
