use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::time::Duration;

pub fn home() -> std::path::PathBuf {
    std::env::var_os("CODEX_HOME").map(std::path::PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".codex"))
}

/// Ask Codex itself to resolve user/profile/trusted-project config. Do not
/// reimplement its precedence rules or silently discard existing instructions.
pub fn developer_instructions(cwd: &str) -> Result<String, String> {
    let mut child = Command::new("cmd.exe")
        .args(["/d", "/c", "codex", "app-server"])
        .current_dir(cwd)
        .creation_flags(0x0800_0000)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Cannot read Codex config: {e}"))?;
    let mut input = child.stdin.take().unwrap();
    let output = child.stdout.take().unwrap();
    let cwd = cwd.to_string();
    let (send, recv) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let result = (|| -> Result<String, String> {
            writeln!(input, "{}", json!({
                "id": 0, "method": "initialize",
                "params": {"clientInfo": {"name": "workspacer", "version": "0.1.0"}}
            })).map_err(|e| e.to_string())?;
            for line in BufReader::new(output).lines() {
                let reply: Value = serde_json::from_str(&line.map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
                let Some(id) = reply["id"].as_u64() else { continue };
                if let Some(error) = reply.get("error") {
                    return Err(format!("Cannot read Codex config: {error}"));
                }
                if id == 0 {
                    writeln!(input, "{}", json!({"method": "initialized"})).map_err(|e| e.to_string())?;
                    writeln!(input, "{}", json!({
                        "id": 1, "method": "config/read",
                        "params": {"cwd": cwd, "includeLayers": false}
                    })).map_err(|e| e.to_string())?;
                } else if id == 1 {
                    let config = reply["result"]["config"].as_object().ok_or("Missing Codex config")?;
                    return match config.get("developer_instructions") {
                        None | Some(Value::Null) => Ok(String::new()),
                        Some(Value::String(s)) => Ok(s.clone()),
                        _ => Err("Invalid Codex developer_instructions".into()),
                    };
                }
            }
            Err("Codex exited before returning its config".into())
        })();
        // Drop stdin so this private app-server exits without touching sessions.
        drop(input);
        let _ = send.send(result);
    });
    let result = recv.recv_timeout(Duration::from_secs(10))
        .map_err(|_| "Timed out reading Codex config; existing instructions were not overwritten".to_string())
        .and_then(|r| r);
    // A .cmd shim has descendants; terminate only our private helper on timeout.
    for _ in 0..20 {
        if child.try_wait().ok().flatten().is_some() {
            return result;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let _ = Command::new("taskkill.exe")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .creation_flags(0x0800_0000)
        .output();
    let _ = child.kill();
    let _ = child.wait();
    result
}

/// TOML basic string inside a Windows argv string. Encode shell metacharacters
/// as TOML Unicode escapes instead of changing the actual instruction text.
pub fn config_arg(existing: &str, context: &str) -> String {
    let text = if existing.is_empty() {
        context.to_string()
    } else {
        format!("{existing}\n\n{context}")
    };
    let mut value = String::new();
    for c in text.chars() {
        match c {
            // Encoding backslashes also avoids the Windows argv trailing-
            // backslash-before-quote rule at the end of the TOML string.
            c if c.is_control() || "\\\"&|<>^%!".contains(c) => {
                value.push_str(&format!("\\u{:04X}", c as u32));
            }
            c => value.push(c),
        }
    }
    format!("\"developer_instructions=\\\"{value}\\\"\"")
}
