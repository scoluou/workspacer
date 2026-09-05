#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

// ---------- undo/redo ----------
/// Snapshot-based undo for the workspace list: every mutating command records
/// the pre-mutation list here. Session-scoped (in-memory), capped at 100.
#[derive(Default)]
struct UndoStacks {
    undo: Vec<Vec<Workspace>>,
    redo: Vec<Vec<Workspace>>,
}

impl UndoStacks {
    fn record(&mut self, current: Vec<Workspace>) {
        self.undo.push(current);
        if self.undo.len() > 100 {
            self.undo.remove(0);
        }
        self.redo.clear(); // a fresh mutation kills the redo future
    }
    fn undo(&mut self, current: Vec<Workspace>) -> Option<Vec<Workspace>> {
        let prev = self.undo.pop()?;
        self.redo.push(current);
        Some(prev)
    }
    fn redo(&mut self, current: Vec<Workspace>) -> Option<Vec<Workspace>> {
        let next = self.redo.pop()?;
        self.undo.push(current);
        Some(next)
    }
}

// ---------- data model ----------
#[derive(Serialize, Deserialize, Clone, Default)]
struct Project {
    path: String,
    #[serde(default)]
    description: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct Workspace {
    id: String,
    name: String,
    #[serde(default)]
    description: String,
    /// per-workspace agent override; None = use global default
    #[serde(default)]
    agent: Option<String>,
    #[serde(default)]
    projects: Vec<Project>,
    /// attached files (any path, in or outside projects); context-only
    #[serde(default)]
    files: Vec<Project>,
    /// attached links (url + description); context-only
    #[serde(default)]
    links: Vec<Project>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct Settings {
    default_agent: Option<String>,
    font_family: Option<String>,
    font_size: Option<u32>,
    font_weight: Option<u32>,
    language: Option<String>,
    sidebar_width: Option<u32>,
    theme: Option<String>,
    /// "minimize" (default) | "exit" — what the window close button does
    close_action: Option<String>,
    /// None/"embedded" (default) | "cmd" | "powershell" — how agents launch
    launch_mode: Option<String>,
}

#[derive(Serialize)]
struct AgentInfo {
    key: String,
    label: String,
}

// ---------- persistence ----------
fn data_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("workspacer")
}

fn load<T: for<'de> Deserialize<'de> + Default>(file: &str) -> T {
    fs::read_to_string(data_dir().join(file))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save<T: Serialize>(file: &str, val: &T) -> Result<(), String> {
    fs::create_dir_all(data_dir()).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(val).map_err(|e| e.to_string())?;
    fs::write(data_dir().join(file), json).map_err(|e| e.to_string())
}

fn load_workspaces() -> Vec<Workspace> {
    load("workspaces.json")
}

// ---------- agent launch ----------
fn quote(s: &str) -> String {
    format!("\"{}\"", s)
}

/// Make free text safe to embed in a quoted argument on a `cmd /c` command
/// line. cmd has no escape for `"` inside quotes, and its /c parser splits on
/// shell metacharacters even inside quotes, so map them to full-width forms
/// (the context is agent prompt text, where this is lossless in practice).
/// ponytail: project PATHS are not sanitized (they must stay exact); a folder
/// whose name contains & or % can still break the launch line — rare enough
/// that we accept the ceiling rather than switch launch mechanism.
fn cmd_safe(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '"' => '\'',
            '&' => '＆',
            '|' => '｜',
            '<' => '＜',
            '>' => '＞',
            '^' => '＾',
            '%' => '％',
            '!' => '！',
            _ => c,
        })
        .collect()
}

/// Raw context summary lines (workspace desc, described projects, all files).
/// `label` distinguishes sessions of the same workspace in resume pickers.
fn context_parts(ws: &Workspace, label: &str) -> Vec<String> {
    let mut parts = Vec::new();
    if !ws.description.trim().is_empty() || !label.is_empty() {
        let mut first = format!("Workspace \"{}\"", ws.name);
        if !label.is_empty() {
            first.push_str(&format!(" [{label}]"));
        }
        if !ws.description.trim().is_empty() {
            first.push_str(&format!(": {}", ws.description.trim()));
        }
        parts.push(first);
    }
    let described: Vec<&Project> = ws.projects.iter().filter(|p| !p.description.trim().is_empty()).collect();
    if !described.is_empty() {
        let items: Vec<String> = described
            .iter()
            .map(|p| format!("{} ({})", p.path, p.description.trim()))
            .collect();
        parts.push(format!("Projects in this workspace: {}", items.join("; ")));
    }
    // uniform rule for files and links: no description → not injected
    let described_files: Vec<&Project> = ws.files.iter().filter(|f| !f.description.trim().is_empty()).collect();
    if !described_files.is_empty() {
        let items: Vec<String> = described_files
            .iter()
            .map(|f| format!("{} ({})", f.path, f.description.trim()))
            .collect();
        parts.push(format!("Workspace files: {}", items.join("; ")));
    }
    let described_links: Vec<&Project> = ws.links.iter().filter(|l| !l.description.trim().is_empty()).collect();
    if !described_links.is_empty() {
        let items: Vec<String> = described_links
            .iter()
            .map(|l| format!("{} ({})", l.path, l.description.trim()))
            .collect();
        parts.push(format!("Workspace links: {}", items.join("; ")));
    }
    parts
}

/// One-line, cmd-safe context for the command line (a raw newline would split
/// the command and make the agent exit immediately).
fn build_context(ws: &Workspace, label: &str) -> String {
    cmd_safe(&context_parts(ws, label).join(". ")).replace('\n', " ").replace('\r', "")
}

/// Content of a file worth inlining into the context doc: exists, <= 8 KiB,
/// valid UTF-8. Bigger/binary files stay path-only.
fn read_inlineable_file(path: &str) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    if bytes.len() > 8192 {
        return None;
    }
    String::from_utf8(bytes).ok()
}

/// Multi-line context document for file-based delivery: the summary lines plus
/// inlined contents of small text files.
fn build_context_doc(ws: &Workspace, label: &str) -> String {
    let mut doc = context_parts(ws, label).join("\n");
    // only described files are injected (uniform rule), so only they get inlined
    for f in ws.files.iter().filter(|f| !f.description.trim().is_empty()) {
        if let Some(content) = read_inlineable_file(&f.path) {
            doc.push_str(&format!("\n\n--- {}", f.path));
            if !f.description.trim().is_empty() {
                doc.push_str(&format!(" ({})", f.description.trim()));
            }
            doc.push_str(&format!(" ---\n{content}"));
        }
    }
    doc
}

/// Everything needed to launch an agent.
struct LaunchSpec {
    prog: String,
    args: String,
    cwd: String,
    /// the prompt injected as the first user message (prompt-channel agents
    /// only; None for system-prompt agents and on resume)
    initial_prompt: Option<String>,
}

/// Build the launch spec for a given agent over the workspace.
/// Description injection: claude/pi use --append-system-prompt, codex/agent/
/// opencode take it as the initial prompt.
fn build_agent(agent: &str, ws: &Workspace, session_id: &str, resume: bool, label: &str) -> Result<LaunchSpec, String> {
    let folders: Vec<&String> = ws.projects.iter().map(|p| &p.path).collect();
    // empty workspace: fall back to the user's home dir as cwd
    let primary = folders
        .first()
        .map(|p| p.to_string())
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).to_string_lossy().into_owned());
    let add_dirs: String = folders
        .iter()
        .skip(1)
        .map(|f| format!(" --add-dir {}", quote(f)))
        .collect();

    if resume {
        // resume an earlier session; context is NOT re-injected (the session
        // already has it). The stored id wins whenever it's real (captured at
        // launch or picked by the user); else fall back to the dir's most
        // recent session, then to the agent's latest-session flag.
        let args = match agent {
            "claude" => format!("--resume {}{}", quote(session_id), add_dirs),
            "pi" => format!("--session-id {}", quote(session_id)),
            "codex" => {
                let pick = if !session_id.is_empty() && codex_session_exists(session_id) {
                    Some(session_id.to_string())
                } else {
                    codex_latest_session(&primary)
                };
                match pick {
                    Some(id) => format!("-C {} resume {}", quote(&primary), quote(&id)),
                    None => format!("-C {} resume --last", quote(&primary)),
                }
            }
            "opencode" => {
                let sessions = opencode_sessions(&primary);
                let pick = if !session_id.is_empty() && sessions.iter().any(|s| s.id == session_id) {
                    Some(session_id.to_string())
                } else {
                    sessions.first().map(|s| s.id.clone())
                };
                match pick {
                    Some(id) => format!("{} --session {}", quote(&primary), quote(&id)),
                    None => format!("{} --continue", quote(&primary)),
                }
            }
            "agent" => {
                // deterministic resume when the chat exists on disk; the id may
                // be a never-persisted placeholder → fall back to --continue
                let chat = dirs::home_dir().unwrap_or_default().join(".cursor").join("chats")
                    .join(cursor_chat_dir_name(&primary)).join(session_id);
                let mode = if !session_id.is_empty() && chat.is_dir() {
                    format!("--resume {}", quote(session_id))
                } else {
                    "--continue".into()
                };
                format!("--trust --workspace {}{} {}", quote(&primary), add_dirs, mode)
            }
            other => return Err(format!("unknown agent: {other}")),
        };
        return Ok(LaunchSpec { prog: agent.into(), args: args.trim().to_string(), cwd: primary, initial_prompt: None });
    }

    let context = build_context(ws, label);
    let has_ctx = !context.is_empty();
    // claude/pi let us assign the session id at launch → deterministic resume.
    // Only the embedded terminal path passes a real id; external windows are
    // fire-and-forget and must not pollute the agent's session list.
    let sid = match agent {
        "claude" | "pi" if !session_id.is_empty() => format!("--session-id {} ", quote(session_id)),
        _ => String::new(),
    };
    // Files attached → full context document in a temp file (multi-line, small
    // file contents inlined). Delivery: claude has --append-system-prompt-file,
    // pi auto-reads an existing path passed to --append-system-prompt, the
    // initial-prompt agents get a pointer prompt.
    let doc = if ws.files.iter().any(|f| !f.description.trim().is_empty()) {
        let path = std::env::temp_dir().join(format!("workspacer-ctx-{}.md", ws.id));
        fs::write(&path, build_context_doc(ws, label)).map_err(|e| e.to_string())?;
        Some(path)
    } else {
        None
    };
    // the pointer doubles as the session's first message — lead with the
    // workspace name so session lists (resume pickers) can tell them apart.
    // single quotes only: the pointer travels quoted through cmd
    let pointer = doc.as_ref().map(|d| {
        let label_part = if label.is_empty() { String::new() } else { format!(" [{}]", cmd_safe(label)) };
        format!(
            "Workspace '{}{}': context file at {}. Read it first for project descriptions and attached file contents.",
            cmd_safe(&ws.name),
            label_part,
            d.display()
        )
    });

    let res = match agent {
        "agent" => {
            let mut args = format!("--trust --workspace {}{}", quote(&primary), add_dirs);
            let mut initial = None;
            if let Some(p) = &pointer {
                args.push_str(&format!(" {}", quote(p))); // initial prompt
                initial = Some(p.clone());
            } else if has_ctx {
                args.push_str(&format!(" {}", quote(&context)));
                initial = Some(context.clone());
            }
            ("agent".into(), args, primary, initial)
        }
        "codex" => {
            let mut args = format!("-C {}{}", quote(&primary), add_dirs);
            let mut initial = None;
            if let Some(p) = &pointer {
                args.push_str(&format!(" {}", quote(p))); // initial prompt
                initial = Some(p.clone());
            } else if has_ctx {
                args.push_str(&format!(" {}", quote(&context)));
                initial = Some(context.clone());
            }
            ("codex".into(), args, primary, initial)
        }
        "claude" => {
            let mut args = format!("{}{}", sid, add_dirs.trim_start());
            if let Some(d) = &doc {
                if !args.is_empty() { args.push(' '); }
                args.push_str(&format!("--append-system-prompt-file {}", quote(&d.display().to_string())));
            } else if has_ctx {
                if !args.is_empty() { args.push(' '); }
                args.push_str(&format!("--append-system-prompt {}", quote(&context)));
            }
            ("claude".into(), args, primary, None)
        }
        "opencode" => {
            let mut args = quote(&primary);
            let mut initial = None;
            if let Some(p) = &pointer {
                args.push_str(&format!(" --prompt {}", quote(p)));
                initial = Some(p.clone());
            } else if has_ctx {
                args.push_str(&format!(" --prompt {}", quote(&context)));
                initial = Some(context.clone());
            }
            ("opencode".into(), args, primary, initial)
        }
        "pi" => {
            // --name makes the session recognizable in pi's resume picker
            let display_name = if label.is_empty() {
                cmd_safe(&ws.name)
            } else {
                format!("{} · {}", cmd_safe(&ws.name), cmd_safe(label))
            };
            let mut args = format!("{}--name {} ", sid, quote(&display_name));
            if let Some(d) = &doc {
                // pi reads the file when the value is an existing path
                args.push_str(&format!("--append-system-prompt {}", quote(&d.display().to_string())));
            } else if has_ctx {
                args.push_str(&format!("--append-system-prompt {}", quote(&context)));
            }
            ("pi".into(), args, primary, None)
        }
        other => return Err(format!("unknown agent: {other}")),
    };
    let (prog, args, cwd, initial_prompt) = res;
    Ok(LaunchSpec { prog, args: args.trim().to_string(), cwd, initial_prompt })
}

/// Is `prog` resolvable on PATH (PATHEXT-aware)? Used to fail fast with a
/// clean error instead of a console window flashing "'x' is not recognized".
fn on_path(prog: &str) -> bool {
    // bare names only count via PATHEXT (cmd can't execute extensionless files)
    let has_ext = std::path::Path::new(prog).extension().is_some();
    let exts: Vec<String> = std::env::var("PATHEXT")
        .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
        .split(';')
        .map(|s| s.trim().to_string())
        .collect();
    let found_in = |dir: &std::path::Path| {
        if has_ext {
            dir.join(prog).is_file()
        } else {
            exts.iter().any(|e| dir.join(format!("{prog}{e}")).is_file())
        }
    };
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).any(|d| found_in(&d)))
        .unwrap_or(false)
}

// ---------- embedded terminal (PROTOTYPE — experiment/embedded-terminal) ----------
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use tauri::Emitter;
use tauri::Manager;

struct PtySession {
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    master: Box<dyn MasterPty + Send>,
}

type PtyMap = Mutex<std::collections::HashMap<u32, PtySession>>;

/// Split our pre-quoted arg string into argv (quotes only wrap, never embedded —
/// cmd_safe guarantees that for context, and paths can't contain `"`).
/// PROTOTYPE: exists because build_agent predates the PTY path.
fn split_args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_q = false;
    for c in s.chars() {
        match c {
            '"' => in_q = !in_q,
            ' ' if !in_q => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

#[tauri::command]
fn term_write(sessions: tauri::State<PtyMap>, id: u32, data: String) -> Result<(), String> {
    let mut map = sessions.lock().unwrap();
    let s = map.get_mut(&id).ok_or("no such terminal")?;
    s.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn term_resize(sessions: tauri::State<PtyMap>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    // ConPTY kills the hosted process on a 0x0 resize — refuse it
    if cols == 0 || rows == 0 {
        return Ok(());
    }
    let map = sessions.lock().unwrap();
    let s = map.get(&id).ok_or("no such terminal")?;
    s.master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn term_kill(sessions: tauri::State<PtyMap>, id: u32) -> Result<(), String> {
    let mut map = sessions.lock().unwrap();
    if let Some(mut s) = map.remove(&id) {
        let _ = s.child.kill();
    }
    Ok(())
}

#[derive(Serialize)]
struct LaunchInfo {
    prog: String,
    /// the prompt injected as the first user message (prompt-channel agents only)
    initial_prompt: Option<String>,
}

#[tauri::command]
fn launch_agent_embedded(
    app: tauri::AppHandle,
    sessions: tauri::State<PtyMap>,
    workspace_id: String,
    agent_override: Option<String>,
    term_id: u32,
    cols: u16,
    rows: u16,
    session_id: String,
    resume: bool,
    session_label: String,
) -> Result<LaunchInfo, String> {
    let spec = resolve_launch(&workspace_id, agent_override, &session_id, resume, &session_label)?;
    // snapshot the agent's sessions before spawn so we can bind the freshly
    // created one to THIS terminal afterwards (per-terminal identity)
    let bind_before = if !resume && matches!(spec.prog.as_str(), "agent" | "opencode" | "codex") {
        Some(snapshot_session_ids(&spec.prog, &spec.cwd))
    } else {
        None
    };
    // agents are .cmd shims → must run under cmd. portable-pty MSVC-quotes
    // every argv element (cmdbuilder.rs append_quoted), so `cmd /c <our
    // pre-quoted line>` gets re-quoted and the inner quotes break (codex:
    // "unexpected argument ''x''"); a temp .bat parses in the system ANSI
    // codepage and mangles non-ASCII text. Instead hand the line to cmd via
    // an env var — the env block is UTF-16 (lossless) and %VAR% expansion
    // yields the exact line for cmd to parse, quotes and CJK intact.
    let cmdline = if spec.args.is_empty() { spec.prog.clone() } else { format!("{} {}", spec.prog, spec.args) };
    let pty = native_pty_system();
    // spawn at the terminal's real size — starting at 80x24 and resizing after
    // would make the agent draw two frames (the "duplicate display" artifact)
    let pair = pty
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new("cmd.exe");
    cmd.env("WORKSPACER_LAUNCH", &cmdline);
    cmd.args(["/c", "%WORKSPACER_LAUNCH%"]);
    cmd.cwd(&spec.cwd);
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // bind the freshly created session to this terminal (async: the agent may
    // take a moment to create it)
    if let Some(before) = bind_before {
        let app2 = app.clone();
        let agent_key = spec.prog.clone();
        let cwd = spec.cwd.clone();
        std::thread::spawn(move || {
            for wait in [1u64, 2, 3, 5, 8, 13] {
                std::thread::sleep(std::time::Duration::from_secs(wait));
                if let Some(id) = find_new_session_id(&agent_key, &cwd, &before) {
                    let _ = app2.emit(&format!("term-bind-{term_id}"), id);
                    return;
                }
            }
        });
    }
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let data_event = format!("term-data-{term_id}");
    let exit_event = format!("term-exit-{term_id}");
    std::thread::spawn(move || {
        let mut buf = [0u8; 16384];
        let mut read_failures = 0u32;
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    // ConPTY read can end while the child is alive (e.g. an
                    // agent that reattaches to a shared daemon). Only declare
                    // exit when the child is really gone.
                    let really_exited = {
                        let map = app.state::<PtyMap>();
                        let mut g = map.lock().unwrap();
                        match g.get_mut(&term_id) {
                            Some(s) => matches!(s.child.try_wait(), Ok(Some(_)) | Err(_)),
                            None => true, // killed via term_kill
                        }
                    };
                    if really_exited {
                        break;
                    }
                    read_failures += 1;
                    if read_failures > 50 {
                        break; // PTY truly broken; give up
                    }
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                Ok(n) => {
                    read_failures = 0;
                    let _ = app.emit(&data_event, String::from_utf8_lossy(&buf[..n]).into_owned());
                }
            }
        }
        let _ = app.emit(&exit_event, ());
    });
    sessions.lock().unwrap().insert(term_id, PtySession { writer, child, master: pair.master });
    Ok(LaunchInfo { prog: spec.prog, initial_prompt: spec.initial_prompt })
}

// ---------- Tauri commands ----------
#[tauri::command]
fn list_workspaces() -> Vec<Workspace> {
    load_workspaces()
}

/// Names are display-only (the id is the real key), so collisions get a
/// counter suffix: untitled -> untitled2 -> untitled3.
fn unique_name(list: &[Workspace], name: &str) -> String {
    if !list.iter().any(|w| w.name == name) {
        return name.to_string();
    }
    for n in 2.. {
        let candidate = format!("{name}{n}");
        if !list.iter().any(|w| w.name == candidate) {
            return candidate;
        }
    }
    unreachable!()
}

#[tauri::command]
fn create_workspace(state: tauri::State<Mutex<UndoStacks>>, name: String, description: String, agent: Option<String>, projects: Vec<Project>) -> Result<Workspace, String> {
    let mut list = load_workspaces();
    state.lock().unwrap().record(list.clone());
    let name = unique_name(&list, &name);
    let ws = Workspace {
        id: format!("{:x}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis()),
        name,
        description,
        agent,
        projects,
        files: vec![],
        links: vec![],
    };
    list.push(ws.clone());
    save("workspaces.json", &list)?;
    Ok(ws)
}

#[tauri::command]
fn update_workspace(state: tauri::State<Mutex<UndoStacks>>, ws: Workspace) -> Result<Vec<Workspace>, String> {
    let mut list = load_workspaces();
    state.lock().unwrap().record(list.clone());
    if let Some(existing) = list.iter_mut().find(|w| w.id == ws.id) {
        *existing = ws;
    }
    save("workspaces.json", &list)?;
    Ok(list)
}

#[tauri::command]
fn delete_workspace(state: tauri::State<Mutex<UndoStacks>>, id: String) -> Result<Vec<Workspace>, String> {
    let list = load_workspaces();
    state.lock().unwrap().record(list.clone());
    let list: Vec<Workspace> = list.into_iter().filter(|w| w.id != id).collect();
    save("workspaces.json", &list)?;
    Ok(list)
}

/// Split dropped paths into (existing dirs, existing files); nonexistent paths
/// are dropped. Sidebar drops use dirs only; workspace-detail drops use both.
#[tauri::command]
fn classify_paths(paths: Vec<String>) -> (Vec<String>, Vec<String>) {
    paths
        .into_iter()
        .filter(|p| PathBuf::from(p).exists())
        .partition(|p| PathBuf::from(p).is_dir())
}

/// Darken the Windows title bar / frame to match the app theme (DWM immersive
/// dark mode). Called by the frontend on startup and every theme switch.
#[tauri::command]
fn set_titlebar_dark(win: tauri::Window, dark: bool) {
    #[cfg(windows)]
    {
        #[link(name = "dwmapi")]
        extern "C" {
            fn DwmSetWindowAttribute(hwnd: *mut std::ffi::c_void, attr: u32, value: *const i32, size: u32) -> i32;
        }
        const DWMWA_USE_IMMERSIVE_DARK_MODE: u32 = 20;
        if let Ok(hwnd) = win.hwnd() {
            let val: i32 = if dark { 1 } else { 0 };
            unsafe {
                DwmSetWindowAttribute(hwnd.0 as *mut std::ffi::c_void, DWMWA_USE_IMMERSIVE_DARK_MODE, &val, 4);
            }
        }
    }
}

/// Open a URL in the default browser. rundll32 takes it as a plain argv entry,
/// so no shell parsing is involved (& in URLs is safe).
/// claude stores sessions at ~/.claude/projects/<cwd with non-alnum → '-'>
fn claude_project_dir_name(cwd: &str) -> String {
    cwd.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}
/// pi stores sessions at ~/.pi/agent/sessions/--<cwd with / \ : → '-'>--
fn pi_session_dir_name(cwd: &str) -> String {
    format!("--{}--", cwd.trim_start_matches(['/', '\\']).replace(['/', '\\', ':'], "-"))
}
/// cursor stores chats at ~/.cursor/chats/<md5 of backslash-normalized cwd>/<chatId>/
fn cursor_chat_dir_name(cwd: &str) -> String {
    format!("{:x}", md5::compute(cwd.replace('/', "\\").as_bytes()))
}

/// path comparison on Windows: unify slashes and case
fn norm_path(s: &str) -> String {
    s.replace('/', "\\").to_lowercase()
}

/// one opencode session entry
struct OcSession {
    id: String,
    title: String,
    updated: i64,
}

/// Parse `opencode session list --format json` output, most recent first.
/// Pure (testable). No directory filtering here: the CLI itself scopes the
/// list to the project of the subprocess's cwd (git-root aware), which is
/// exactly what the TUI's own session picker shows.
fn parse_opencode_sessions(json: &str) -> Vec<OcSession> {
    let mut v: Vec<OcSession> = serde_json::from_str::<serde_json::Value>(json)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|s| {
            Some(OcSession {
                id: s.get("id")?.as_str()?.to_string(),
                title: s.get("title").and_then(|t| t.as_str()).unwrap_or_default().to_string(),
                updated: s.get("updated").and_then(|u| u.as_i64()).unwrap_or(0),
            })
        })
        .collect();
    v.sort_by_key(|s| std::cmp::Reverse(s.updated));
    v
}

/// opencode sessions for a directory, most recently updated first.
fn opencode_sessions(cwd: &str) -> Vec<OcSession> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    // via cmd so the .cmd shim resolves (CreateProcess alone only finds .exe);
    // `session list` is scoped to the CURRENT directory's project, so the
    // subprocess must run with the target dir as its cwd
    let out = std::process::Command::new("cmd.exe")
        .args(["/c", "opencode", "session", "list", "--format", "json"])
        .current_dir(cwd)
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    match out {
        Ok(o) => parse_opencode_sessions(&String::from_utf8_lossy(&o.stdout)),
        Err(_) => Vec::new(),
    }
}

/// Parse a codex rollout file's first line into (session_id, cwd).
/// Pure (testable).
fn codex_rollout_meta(first_line: &str) -> Option<(String, String)> {
    let v: serde_json::Value = serde_json::from_str(first_line).ok()?;
    if v.get("type")?.as_str()? != "session_meta" {
        return None;
    }
    let p = v.get("payload")?;
    Some((p.get("session_id")?.as_str()?.to_string(), p.get("cwd")?.as_str()?.to_string()))
}

/// all codex rollout files under ~/.codex/sessions (date-partitioned dirs)
fn codex_rollout_files() -> Vec<std::path::PathBuf> {
    fn walk(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
        for e in fs::read_dir(dir).into_iter().flatten().filter_map(|e| e.ok()) {
            let p = e.path();
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().is_some_and(|x| x == "jsonl") {
                out.push(p);
            }
        }
    }
    let mut files = Vec::new();
    if let Some(home) = dirs::home_dir() {
        walk(&home.join(".codex").join("sessions"), &mut files);
    }
    files
}

/// a codex session id exists if some rollout filename embeds it
fn codex_session_exists(id: &str) -> bool {
    codex_rollout_files().iter().any(|p| p.file_name().is_some_and(|n| n.to_string_lossy().contains(id)))
}

/// codex's `resume --last` doesn't follow in-TUI session switches; find the
/// newest rollout file whose session_meta cwd is this directory instead.
fn codex_latest_session(cwd: &str) -> Option<String> {
    let mut files = codex_rollout_files();
    // newest file first; the first cwd match is the latest session for it
    files.sort_by_key(|p| std::cmp::Reverse(fs::metadata(p).and_then(|m| m.modified()).ok()));
    files.iter().find_map(|p| {
        // rollouts can be megabytes — read only the first line
        let line = std::io::BufRead::lines(std::io::BufReader::new(fs::File::open(p).ok()?)).next()?.ok()?;
        let (id, c) = codex_rollout_meta(&line)?;
        (norm_path(&c) == norm_path(cwd)).then_some(id)
    })
}

/// Re-resolve the live session id for claude/pi/cursor terminals: the user may
/// have /resume-switched inside the agent, and the newest session by mtime is
/// the one currently loaded. ponytail: with several terminals on the same cwd
/// this picks the same session for all of them — accepted, that's rare.
fn live_session_id(agent: &str, cwd: &str, assigned: &str) -> String {
    let dir = match agent {
        "claude" => dirs::home_dir().unwrap_or_default().join(".claude").join("projects").join(claude_project_dir_name(cwd)),
        "pi" => dirs::home_dir().unwrap_or_default().join(".pi").join("agent").join("sessions").join(pi_session_dir_name(cwd)),
        "agent" => dirs::home_dir().unwrap_or_default().join(".cursor").join("chats").join(cursor_chat_dir_name(cwd)),
        _ => return assigned.to_string(),
    };
    let is_cursor = agent == "agent";
    fs::read_dir(&dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        // claude/pi: sessions are <id>.jsonl files; cursor: <chatId> directories
        .filter(|e| if is_cursor { e.path().is_dir() } else { e.path().extension().is_some_and(|x| x == "jsonl") })
        .max_by_key(|e| {
            let p = e.path();
            let self_mt = e.metadata().and_then(|m| m.modified()).ok();
            // a dir's own mtime doesn't track writes to files inside it
            let inner_mt = if p.is_dir() {
                fs::read_dir(&p).ok().into_iter().flatten().filter_map(|f| f.ok())
                    .filter_map(|f| f.metadata().and_then(|m| m.modified()).ok())
                    .max()
            } else {
                None
            };
            [self_mt, inner_mt].into_iter().flatten().max()
        })
        .and_then(|e| {
            let p = e.path();
            let name = if is_cursor { p.file_name() } else { p.file_stem() };
            name.map(|s| s.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| assigned.to_string())
}

/// Session ids currently on disk for an agent+cwd. Used to bind a freshly
/// created session to its terminal: without a real per-terminal id, every
/// terminal on the same dir would resolve to the same "latest" session.
fn snapshot_session_ids(agent: &str, cwd: &str) -> std::collections::HashSet<String> {
    match agent {
        // cursor: chat dirs under ~/.cursor/chats/<md5(cwd)>/
        "agent" => fs::read_dir(dirs::home_dir().unwrap_or_default().join(".cursor").join("chats").join(cursor_chat_dir_name(cwd)))
            .ok()
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .filter_map(|e| e.file_name().to_str().map(str::to_string))
            .collect(),
        // codex: rollout filenames embed the session id
        "codex" => codex_rollout_files()
            .iter()
            .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
            .collect(),
        "opencode" => opencode_sessions(cwd).into_iter().map(|s| s.id).collect(),
        _ => Default::default(),
    }
}

/// first session id present now but absent from the pre-launch snapshot
fn find_new_session_id(agent: &str, cwd: &str, before: &std::collections::HashSet<String>) -> Option<String> {
    let mut new: Vec<String> = snapshot_session_ids(agent, cwd).into_iter().filter(|id| !before.contains(id)).collect();
    // ponytail: two terminals launched in the same second may cross-bind —
    // rare, and self-corrects once each session gets used
    new.sort();
    new.pop()
}

/// Save a clipboard image to a temp file and return its path — agents receive
/// images as file paths (claude/codex/cursor all read them that way).
#[tauri::command]
fn save_clipboard_image(b64: &str, ext: &str) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
    // ext comes from the clipboard MIME type; keep it a plain file extension
    let ext = if !ext.is_empty() && ext.chars().all(|c| c.is_ascii_alphanumeric()) { ext } else { "png" };
    let millis = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let path = std::env::temp_dir().join(format!("workspacer-paste-{millis}.{ext}"));
    fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// a session entry for the switcher UI
#[derive(Serialize)]
struct SessionChoice {
    id: String,
    title: String,
    updated: i64, // epoch ms
}

/// cursor chats for a cwd: ~/.cursor/chats/<md5(cwd)>/<chatId>/meta.json
/// holds title + updatedAtMs
fn cursor_sessions(cwd: &str) -> Vec<SessionChoice> {
    let dir = dirs::home_dir().unwrap_or_default().join(".cursor").join("chats").join(cursor_chat_dir_name(cwd));
    fs::read_dir(&dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let meta: serde_json::Value = serde_json::from_str(&fs::read_to_string(e.path().join("meta.json")).ok()?).ok()?;
            Some(SessionChoice {
                id: e.file_name().to_string_lossy().into_owned(),
                title: meta.get("title")?.as_str()?.to_string(),
                updated: meta.get("updatedAtMs")?.as_i64()?,
            })
        })
        .collect()
}

/// codex sessions for a cwd: rollout files carry id+cwd in their first line,
/// titles live in ~/.codex/session_index.jsonl keyed by id
fn codex_sessions(cwd: &str) -> Vec<SessionChoice> {
    let titles: std::collections::HashMap<String, String> = dirs::home_dir()
        .and_then(|h| fs::read_to_string(h.join(".codex").join("session_index.jsonl")).ok())
        .map(|s| {
            s.lines()
                .filter_map(|l| {
                    let v: serde_json::Value = serde_json::from_str(l).ok()?;
                    Some((v.get("id")?.as_str()?.to_string(), v.get("thread_name")?.as_str()?.to_string()))
                })
                .collect()
        })
        .unwrap_or_default();
    let mut files = codex_rollout_files();
    files.sort_by_key(|p| std::cmp::Reverse(fs::metadata(p).and_then(|m| m.modified()).ok()));
    files
        .iter()
        .filter_map(|p| {
            let line = std::io::BufRead::lines(std::io::BufReader::new(fs::File::open(p).ok()?)).next()?.ok()?;
            let (id, c) = codex_rollout_meta(&line)?;
            if norm_path(&c) != norm_path(cwd) {
                return None;
            }
            let updated = fs::metadata(p).and_then(|m| m.modified()).ok()?
                .duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as i64;
            Some(SessionChoice { title: titles.get(&id).cloned().unwrap_or_else(|| id.clone()), updated, id })
        })
        .take(20)
        .collect()
}

/// Sessions of one agent for one workspace, for the switcher menu.
#[tauri::command]
fn list_agent_sessions(agent: &str, workspace_id: &str) -> Result<Vec<SessionChoice>, String> {
    let ws = load_workspaces().into_iter().find(|w| w.id == workspace_id).ok_or("workspace not found")?;
    let cwd = ws
        .projects
        .first()
        .map(|p| p.path.clone())
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().to_string_lossy().into_owned());
    let mut v = match agent {
        "opencode" => opencode_sessions(&cwd).into_iter().map(|s| SessionChoice { id: s.id, title: s.title, updated: s.updated }).collect(),
        "agent" => cursor_sessions(&cwd),
        "codex" => codex_sessions(&cwd),
        _ => Vec::new(), // claude/pi: no cheap title source yet
    };
    v.sort_by_key(|s| std::cmp::Reverse(s.updated));
    v.truncate(20);
    Ok(v)
}

/// UI session state (open tabs, pins, active view) as opaque JSON.
/// Terminal session ids are re-resolved on the way in: the user may have
/// /resume-switched inside the agent, and the file on disk is the truth.
#[tauri::command]
fn save_ui_state(state: serde_json::Value) -> Result<(), String> {
    let mut state = state;
    if let Some(terms) = state.get_mut("terms").and_then(|t| t.as_array_mut()) {
        let workspaces = load_workspaces();
        // re-resolution is only unambiguous when the dir has a single terminal
        // of that agent; with several, each keeps its captured/assigned id
        let mut counts: std::collections::HashMap<(String, String), usize> = Default::default();
        for term in terms.iter() {
            let key = (
                term.get("agentKey").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                term.get("wsId").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            );
            *counts.entry(key).or_default() += 1;
        }
        for term in terms.iter_mut() {
            let agent = term.get("agentKey").and_then(|v| v.as_str()).unwrap_or("");
            if !matches!(agent, "claude" | "pi") {
                continue; // claude/pi assign ids at launch and re-resolve on save;
                          // cursor/opencode/codex keep their captured/picked id
            }
            let ws_id = term.get("wsId").and_then(|v| v.as_str()).unwrap_or("");
            if counts.get(&(agent.to_string(), ws_id.to_string())).copied().unwrap_or(0) > 1 {
                continue;
            }
            let cwd = workspaces
                .iter()
                .find(|w| w.id == ws_id)
                .and_then(|w| w.projects.first().map(|p| p.path.clone()))
                .unwrap_or_default();
            if cwd.is_empty() {
                continue;
            }
            let assigned = term.get("sessionId").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let live = live_session_id(agent, &cwd, &assigned);
            if live != assigned {
                term["sessionId"] = serde_json::Value::String(live);
            }
        }
    }
    save("ui-state.json", &state)
}

#[tauri::command]
fn load_ui_state() -> Option<serde_json::Value> {
    let s = fs::read_to_string(data_dir().join("ui-state.json")).ok()?;
    serde_json::from_str(&s).ok()
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_data_dir() -> Result<(), String> {
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Command::new("explorer").arg(&dir).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn export_workspaces(path: String) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&load_workspaces()).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn import_workspaces(state: tauri::State<Mutex<UndoStacks>>, path: String) -> Result<Vec<Workspace>, String> {
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    // validate before touching the real file
    let list: Vec<Workspace> = serde_json::from_str(&text).map_err(|e| format!("invalid workspaces file: {e}"))?;
    state.lock().unwrap().record(load_workspaces());
    let cur = data_dir().join("workspaces.json");
    if cur.exists() {
        fs::copy(&cur, data_dir().join("workspaces.json.bak")).map_err(|e| e.to_string())?;
    }
    save("workspaces.json", &list)?;
    Ok(list)
}

#[tauri::command]
fn reorder_workspaces(state: tauri::State<Mutex<UndoStacks>>, ordered_ids: Vec<String>) -> Result<Vec<Workspace>, String> {
    let mut list = load_workspaces();
    state.lock().unwrap().record(list.clone());
    let pos: std::collections::HashMap<&String, usize> =
        ordered_ids.iter().enumerate().map(|(i, id)| (id, i)).collect();
    // stable sort: ids missing from ordered_ids keep their relative order at the end
    list.sort_by_key(|w| pos.get(&w.id).copied().unwrap_or(usize::MAX));
    save("workspaces.json", &list)?;
    Ok(list)
}

#[tauri::command]
fn undo_workspaces(state: tauri::State<Mutex<UndoStacks>>) -> Result<Option<Vec<Workspace>>, String> {
    let prev = state.lock().unwrap().undo(load_workspaces());
    if let Some(list) = &prev {
        save("workspaces.json", list)?;
    }
    Ok(prev)
}

#[tauri::command]
fn redo_workspaces(state: tauri::State<Mutex<UndoStacks>>) -> Result<Option<Vec<Workspace>>, String> {
    let next = state.lock().unwrap().redo(load_workspaces());
    if let Some(list) = &next {
        save("workspaces.json", list)?;
    }
    Ok(next)
}

#[tauri::command]
fn get_settings() -> Settings {
    load("settings.json")
}

#[tauri::command]
fn save_settings(settings: Settings) -> Result<(), String> {
    save("settings.json", &settings)
}

#[tauri::command]
fn list_agents() -> Vec<AgentInfo> {
    [
        ("agent", "Cursor CLI"),
        ("codex", "Codex CLI"),
        ("claude", "Claude Code"),
        ("opencode", "OpenCode"),
        ("pi", "PI Agent"),
    ]
    .iter()
    .map(|(k, l)| AgentInfo { key: k.to_string(), label: l.to_string() })
    .collect()
}

/// Shared launch resolution: workspace → agent key → (prog, args, cwd), with
/// an installed check so a missing agent fails cleanly instead of flashing a
/// console.
fn resolve_launch(workspace_id: &str, agent_override: Option<String>, session_id: &str, resume: bool, label: &str) -> Result<LaunchSpec, String> {
    let ws = load_workspaces()
        .into_iter()
        .find(|w| w.id == workspace_id)
        .ok_or("workspace not found")?;
    // resolve agent: explicit override > workspace default > global default
    let settings: Settings = load("settings.json");
    let agent_key = agent_override
        .or(ws.agent.clone())
        .or(settings.default_agent)
        .ok_or("no agent selected and no default configured")?;
    let spec = build_agent(&agent_key, &ws, session_id, resume, label)?;
    if !on_path(&spec.prog) {
        return Err(format!("agent '{}' is not installed (not found on PATH)", spec.prog));
    }
    Ok(spec)
}

#[tauri::command]
fn launch_agent(workspace_id: String, agent_override: Option<String>) -> Result<String, String> {
    // external console: no session id, no label (fire-and-forget)
    let spec = resolve_launch(&workspace_id, agent_override, "", false, "")?;
    let (prog, args, cwd) = (spec.prog, spec.args, spec.cwd);
    // Build ONE command line and hand it to `cmd /c` verbatim. `Command::args`
    // would MSVC-quote the line (inner `"` become `\"`), and cmd's /c parser
    // then mangles it — raw_arg appends the line unquoted, which is exactly
    // what cmd expects.
    let cmdline = if args.is_empty() {
        format!("start \"agent:{prog}\" /D {} {prog}", quote(&cwd))
    } else {
        format!("start \"agent:{prog}\" /D {} {prog} {args}", quote(&cwd))
    };
    // Detach from our process group and any inherited job object, so the agent
    // terminal outlives workspacer (e.g. when workspacer itself was started
    // from a dev terminal or an agent shell). NOTE: no CREATE_NO_WINDOW /
    // DETACHED_PROCESS here — a console-less cmd makes `start` headless too
    // (verified empirically).
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    let mut launcher = Command::new("cmd.exe");
    launcher
        .raw_arg("/c")
        .raw_arg(&cmdline)
        .creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB);
    if launcher.spawn().is_err() {
        // some job objects forbid breakaway (access denied): retry without it
        Command::new("cmd.exe")
            .raw_arg("/c")
            .raw_arg(&cmdline)
            .creation_flags(CREATE_NEW_PROCESS_GROUP)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(prog)
}

/// Launch via a new PowerShell console. The command goes into a temp .ps1 so
/// nothing passes through two shell parsers (PS quoting: single quotes with ''
/// doubling — cmd_safe already folded `"` to `'` in context text).
#[tauri::command]
fn launch_agent_ps(workspace_id: String, agent_override: Option<String>) -> Result<String, String> {
    let spec = resolve_launch(&workspace_id, agent_override, "", false, "")?;
    let (prog, args, cwd) = (spec.prog, spec.args, spec.cwd);
    fn psq(s: &str) -> String {
        format!("'{}'", s.replace('\'', "''"))
    }
    let mut script = format!("Set-Location -LiteralPath {}\r\n& {}", psq(&cwd), psq(&prog));
    for a in split_args(&args) {
        script.push_str(&format!(" {}", psq(&a)));
    }
    let tmp = std::env::temp_dir().join(format!("workspacer-launch-{}.ps1", workspace_id));
    fs::write(&tmp, &script).map_err(|e| e.to_string())?;
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    let script_path = tmp.to_string_lossy().into_owned();
    let mut c = Command::new("powershell.exe");
    c.args(["-NoExit", "-File", &script_path])
        .creation_flags(CREATE_NEW_CONSOLE | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB);
    if c.spawn().is_err() {
        // job objects may forbid breakaway: retry without it
        Command::new("powershell.exe")
            .args(["-NoExit", "-File", &script_path])
            .creation_flags(CREATE_NEW_CONSOLE | CREATE_NEW_PROCESS_GROUP)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(prog)
}

fn main() {
    use tauri::Manager;
    tauri::Builder::default()
        .manage(Mutex::new(std::collections::HashMap::<u32, PtySession>::new()))
        // single instance first: a second launch just shows the existing window
        // (tray-resident apps must not run twice — both would write workspaces.json)
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .manage(Mutex::new(UndoStacks::default()))
        .setup(|app| {
            use tauri::WindowEvent;
            let win = app.get_webview_window("main").unwrap();
            let win2 = win.clone();
            win.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    let s: Settings = load("settings.json");
                    if s.close_action.as_deref() == Some("exit") {
                        return; // let it close
                    }
                    // default: hide to the system tray; a close request while
                    // already minimized (taskbar right-click) really quits
                    if win2.is_minimized().unwrap_or(false) {
                        return;
                    }
                    api.prevent_close();
                    // hiding isn't an app exit, so the plugin's save-on-exit
                    // never fires here — persist geometry explicitly
                    use tauri_plugin_window_state::{AppHandleExt, StateFlags};
                    let _ = win2.app_handle().save_window_state(
                        StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED,
                    );
                    let _ = win2.hide();
                }
            });
            // system tray: left click shows the window, menu has Show/Quit
            let s: Settings = load("settings.json");
            let (show_label, quit_label) = if s.language.as_deref() == Some("en") { ("Show", "Quit") } else { ("显示", "退出") };
            let show_item = tauri::menu::MenuItem::with_id(app, "show", show_label, true, None::<&str>)?;
            let quit_item = tauri::menu::MenuItem::with_id(app, "quit", quit_label, true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&show_item, &quit_item])?;
            tauri::tray::TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("workspacer")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        // deterministic save; don't rely on RunEvent::Exit timing
                        use tauri_plugin_window_state::{AppHandleExt, StateFlags};
                        let _ = app.save_window_state(
                            StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED,
                        );
                        app.exit(0);
                    }
                    _ => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;
            // window starts hidden (config) so the window-state plugin can
            // restore geometry without a visible jump; show it now
            let _ = win.show();
            let _ = win.set_focus();
            Ok(())
        })
        // don't track visibility: quitting from the tray while hidden would
        // otherwise restore the window hidden next launch
        .plugin(tauri_plugin_window_state::Builder::new()
            .with_state_flags(
                tauri_plugin_window_state::StateFlags::SIZE
                    | tauri_plugin_window_state::StateFlags::POSITION
                    | tauri_plugin_window_state::StateFlags::MAXIMIZED,
            )
            .build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_workspaces,
            create_workspace,
            update_workspace,
            delete_workspace,
            reorder_workspaces,
            undo_workspaces,
            redo_workspaces,
            classify_paths,
            open_url,
            set_titlebar_dark,
            save_ui_state,
            load_ui_state,
            open_data_dir,
            export_workspaces,
            import_workspaces,
            get_settings,
            save_settings,
            list_agents,
            list_agent_sessions,
            save_clipboard_image,
            launch_agent,
            launch_agent_embedded,
            launch_agent_ps,
            term_write,
            term_resize,
            term_kill
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ws(name: &str, desc: &str) -> Workspace {
        Workspace {
            id: "t1".into(),
            name: name.into(),
            description: desc.into(),
            agent: None,
            projects: vec![],
            files: vec![],
            links: vec![],
        }
    }

    #[test]
    fn context_strips_cmd_metachars() {
        // a description like this used to break the cmd /c launch line entirely
        let c = build_context(&ws("my \"ws\"", "a & b | c <d> ^ 100% !x!"), "");
        for ch in ['"', '&', '|', '<', '>', '^', '%', '!'] {
            assert!(!c.contains(ch), "context contains cmd-special {ch:?}: {c}");
        }
        assert!(c.contains("my 'ws'"), "keeps readable text: {c}");
    }

    #[test]
    fn agent_args_have_balanced_quotes() {
        let w = ws("n", "d");
        for agent in ["agent", "codex", "claude", "opencode", "pi"] {
            let args = build_agent(agent, &w, "test-id", false, "").unwrap().args;
            assert_eq!(args.matches('"').count() % 2, 0, "{agent}: unbalanced quotes: {args}");
        }
    }

    #[test]
    fn empty_context_adds_no_prompt_flag() {
        let w = ws("n", "");
        let args = build_agent("claude", &w, "test-id", false, "").unwrap().args;
        assert!(!args.contains("--append-system-prompt"), "no ctx arg: {args}");
    }

    #[test]
    fn session_id_assigned_at_launch_and_used_at_resume() {
        let w = ws("n", "d");
        let fresh = build_agent("claude", &w, "my-id", false, "").unwrap().args;
        assert!(fresh.contains("--session-id \"my-id\""), "fresh assigns id: {fresh}");
        let res = build_agent("claude", &w, "my-id", true, "").unwrap().args;
        assert!(res.contains("--resume \"my-id\""), "resume uses id: {res}");
        assert!(!res.contains("--append-system-prompt"), "resume skips context: {res}");
        // pi uses the same flag for both
        let pi_fresh = build_agent("pi", &w, "my-id", false, "").unwrap().args;
        assert!(pi_fresh.contains("--session-id \"my-id\""), "pi fresh: {pi_fresh}");
        // external launches pass an empty id → no session assignment
        let ext = build_agent("claude", &w, "", false, "").unwrap().args;
        assert!(!ext.contains("--session-id"), "external: {ext}");
    }

    #[test]
    fn cursor_resume_by_id_when_chat_exists_else_continue() {
        let w = ws("n", "d");
        // unknown id → fall back to latest-session continue
        let missing = build_agent("agent", &w, "no-such-chat-id", true, "").unwrap().args;
        assert!(missing.contains("--continue") && !missing.contains("--resume"), "fallback: {missing}");
        // existing chat dir → deterministic resume by id (empty projects →
        // primary = home dir, so the chat lands in home's cursor chat dir)
        let cwd = dirs::home_dir().unwrap();
        let chat = cwd.join(".cursor").join("chats").join(cursor_chat_dir_name(&cwd.to_string_lossy())).join("ws-test-chat");
        fs::create_dir_all(&chat).unwrap();
        let args = build_agent("agent", &w, "ws-test-chat", true, "").unwrap().args;
        fs::remove_dir_all(&chat).ok();
        assert!(args.contains("--resume \"ws-test-chat\""), "resume by id: {args}");
    }

    #[test]
    fn codex_rollout_meta_parses_session_line() {
        let line = r#"{"timestamp":"2026-09-05T14:29:42.999Z","type":"session_meta","payload":{"session_id":"01a071f9-a477","cwd":"E:\\xu.lu_MGAStream\\Client"}}"#;
        assert_eq!(
            codex_rollout_meta(line),
            Some(("01a071f9-a477".to_string(), "E:\\xu.lu_MGAStream\\Client".to_string()))
        );
        assert_eq!(codex_rollout_meta(r#"{"type":"response_item"}"#), None);
        assert_eq!(codex_rollout_meta("garbage"), None);
    }

    #[test]
    fn opencode_picks_latest_session_for_dir() {
        let json = r#"[
            {"id":"ses_old","title":"old one","updated":100,"directory":"E:\\workspacer"},
            {"id":"ses_new","title":"new one","updated":200,"directory":"E:\\workspacer"},
            {"id":"ses_other","title":"other dir","updated":300,"directory":"E:\\other"}
        ]"#;
        // sorted most-recent-first (scoping is the CLI's job, via its cwd)
        let v = parse_opencode_sessions(json);
        let ids: Vec<&str> = v.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["ses_other", "ses_new", "ses_old"]);
        assert_eq!(v[1].title, "new one");
        assert!(parse_opencode_sessions("not json").is_empty());
    }

    #[test]
    fn prompts_lead_with_workspace_name() {
        // a described file triggers the pointer-prompt path
        let mut w = ws("my-ws", "");
        w.files = vec![Project { path: "E:/spec.md".into(), description: "d".into() }];
        let args = build_agent("codex", &w, "id", false, "codex 1").unwrap().args;
        assert!(args.contains("Workspace 'my-ws [codex 1]':"), "pointer leads with name+label: {args}");
        // pi gets a real session name including the label
        let pi_args = build_agent("pi", &w, "id", false, "claude 2").unwrap().args;
        assert!(pi_args.contains("--name \"my-ws") && pi_args.contains("claude 2\""), "pi named with label: {pi_args}");
    }

    #[test]
    fn unknown_agent_errors() {
        assert!(build_agent("nope", &ws("n", ""), "x", false, "").is_err());
    }

    #[test]
    fn on_path_resolves_via_patext() {
        assert!(on_path("cmd")); // System32\cmd.exe is always on PATH
        assert!(!on_path("definitely-not-a-real-program-xyz"));
    }

    #[test]
    fn session_dir_encodings() {
        assert_eq!(claude_project_dir_name("E:\\workspacer"), "E--workspacer");
        assert_eq!(claude_project_dir_name("C:\\Users\\xu.lu"), "C--Users-xu-lu");
        assert_eq!(pi_session_dir_name("E:\\workspacer"), "--E--workspacer--");
    }

    #[test]
    fn context_doc_inlines_small_text_files_only() {
        let dir = std::env::temp_dir();
        let tag = format!("ws-ctx-test-{}", std::process::id());
        let small = dir.join(format!("{tag}-small.txt"));
        let big = dir.join(format!("{tag}-big.txt"));
        let bin = dir.join(format!("{tag}-bin.dat"));
        fs::write(&small, "hello 内容").unwrap();
        fs::write(&big, "x".repeat(9000)).unwrap();
        fs::write(&bin, [0u8, 159, 146, 150]).unwrap(); // invalid UTF-8
        let mut w = ws("n", "d");
        w.files = vec![
            Project { path: small.to_string_lossy().into(), description: "s".into() },
            Project { path: big.to_string_lossy().into(), description: "b".into() },
            Project { path: bin.to_string_lossy().into(), description: "x".into() },
        ];
        let doc = build_context_doc(&w, "");
        assert!(doc.contains("hello 内容"), "small file inlined");
        assert!(doc.contains(&format!("--- {} (s) ---", small.to_string_lossy())), "section header: {doc}");
        assert!(!doc.contains(&"x".repeat(9000)), "big file content not inlined");
        assert!(!doc.contains(&format!("--- {}", big.to_string_lossy())), "big file gets no section");
        assert!(!doc.contains(&format!("--- {}", bin.to_string_lossy())), "binary gets no section");
        let _ = fs::remove_file(&small);
        let _ = fs::remove_file(&big);
        let _ = fs::remove_file(&bin);
    }

    #[test]
    fn duplicate_names_get_numbered() {
        let mut list = vec![ws("untitled", "")];
        assert_eq!(unique_name(&list, "untitled"), "untitled2");
        list.push(ws("untitled2", ""));
        assert_eq!(unique_name(&list, "untitled"), "untitled3");
        assert_eq!(unique_name(&list, "fresh"), "fresh");
    }

    #[test]
    fn undo_redo_roundtrip() {
        let mut st = UndoStacks::default();
        assert!(st.undo(vec![]).is_none(), "empty stack: nothing to undo");
        st.record(vec![]); // snapshot before a mutation
        // mutation happened: current is now [a]
        assert_eq!(st.undo(vec![ws("a", "")]).map(|v| v.len()), Some(0));
        assert_eq!(st.redo(vec![]).map(|v| v.len()), Some(1));
        // a fresh mutation clears the redo future
        st.record(vec![ws("a", "")]);
        assert!(st.redo(vec![]).is_none());
    }

    #[test]
    fn context_is_single_line_without_flatten_artifacts() {
        let w = Workspace {
            id: "t".into(),
            name: "n".into(),
            description: "d".into(),
            agent: None,
            projects: vec![Project { path: "E:/a".into(), description: "da".into() }],
            files: vec![
                Project { path: "E:/spec.md".into(), description: "doc".into() },
                Project { path: "E:/notes.txt".into(), description: "".into() },
            ],
            links: vec![
                Project { path: "https://example.com".into(), description: "docs".into() },
                Project { path: "https://nodesc.com".into(), description: "".into() },
            ],
        };
        let c = build_context(&w, "");
        assert!(!c.contains('\n'), "single line: {c}");
        assert!(!c.contains(":;"), "no header/item seam: {c}");
        assert!(c.contains("Projects in this workspace: E:/a (da)"), "format: {c}");
        // uniform rule: no description → not injected
        assert!(c.contains("Workspace files: E:/spec.md (doc)"), "files: {c}");
        assert!(!c.contains("notes.txt"), "undescribed file skipped: {c}");
        assert!(c.contains("Workspace links: https://example.com (docs)"), "links: {c}");
        assert!(!c.contains("nodesc.com"), "undescribed link skipped: {c}");
    }
}
