// An ACP client (docs/MASTER_PLAN.md section 3 and phase L6): NeuraOS runs a
// coding agent that speaks the Agent Client Protocol -- Gemini CLI
// (`gemini --experimental-acp`), Claude Code (`claude-code-acp`), Codex
// (`codex-acp`), Goose, OpenCode -- as a child over stdio, and puts every
// one of its file edits and commands behind NeuraOS's own approval cards.
//
// ACP is JSON-RPC 2.0, newline-framed, in BOTH directions: this app sends
// `initialize`, `session/new`, `session/prompt`, `session/cancel`; the agent
// streams `session/update` notifications and sends REQUESTS back --
// `session/request_permission`, `fs/read_text_file`, `fs/write_text_file`
// -- that only the page can answer well (it owns the folder confinement and
// the approval cards). So the split is:
//
//   * this file: the process, the pipes, request/response matching, and a
//     one-way stream of everything the agent says (`acp-message` events);
//   * the page: answers the agent's requests through `acp_respond`, and
//     renders the transcript.
//
// The transport is mcp.rs's, re-implemented rather than shared because ACP
// needs the reverse direction that the MCP host deliberately refuses.
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::Duration;
use tauri::Emitter;

/// The ACP protocol version this client speaks (an integer in ACP).
pub const PROTOCOL_VERSION: u64 = 1;
pub const EVENT: &str = "acp-message";
const MAX_AGENTS: usize = 4;
const INIT_TIMEOUT: Duration = Duration::from_secs(60);
/// A prompt turn can run for a long time (the agent edits, runs tests).
const PROMPT_TIMEOUT: Duration = Duration::from_secs(60 * 30);

type Pending = Arc<Mutex<HashMap<u64, mpsc::Sender<serde_json::Value>>>>;
type Input = Arc<Mutex<Option<ChildStdin>>>;

struct Agent {
    child: Child,
    stdin: Input,
    pending: Pending,
    alive: Arc<AtomicBool>,
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn agents() -> &'static Mutex<HashMap<String, Agent>> {
    static MAP: OnceLock<Mutex<HashMap<String, Agent>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    match m.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// An agent id the page chose: short, [a-z0-9-], so it can be a key and an
/// event field without escaping.
pub fn safe_id(raw: &str) -> Result<String, String> {
    let id = raw.trim().to_ascii_lowercase();
    if id.is_empty() || id.len() > 40 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("An agent id is 1-40 letters, digits or dashes.".to_string());
    }
    Ok(id)
}

fn write_line(stdin: &Input, message: &serde_json::Value) -> Result<(), String> {
    let mut text = serde_json::to_string(message).map_err(|e| e.to_string())?;
    text.push('\n');
    let mut guard = lock(stdin);
    match guard.as_mut() {
        Some(pipe) => pipe
            .write_all(text.as_bytes())
            .and_then(|_| pipe.flush())
            .map_err(|e| format!("The agent's input is closed: {}", e)),
        None => Err("The agent has been stopped.".to_string()),
    }
}

/// Where a line from the agent goes: a response to whoever waits for its id;
/// anything else (a notification, or a request the page must answer) to the
/// page as an `acp-message` event.
fn route(app: &tauri::AppHandle, agent: &str, message: &serde_json::Value, pending: &Pending) {
    let is_response = message.get("method").is_none() && message.get("id").is_some();
    if is_response {
        if let Some(n) = message.get("id").and_then(|i| i.as_u64()) {
            if let Some(tx) = lock(pending).remove(&n) {
                let _ = tx.send(message.clone());
                return;
            }
        }
    }
    let _ = app.emit(EVENT, serde_json::json!({ "agent": agent, "message": message }));
}

fn read_stdout<R: Read + Send + 'static>(app: tauri::AppHandle, agent: String, stream: R, pending: Pending, alive: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stream);
        let mut line = Vec::new();
        loop {
            line.clear();
            match reader.read_until(b'\n', &mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let text = String::from_utf8_lossy(&line);
            let trimmed = text.trim();
            if trimmed.is_empty() {
                continue;
            }
            match serde_json::from_str::<serde_json::Value>(trimmed) {
                Ok(v) => route(&app, &agent, &v, &pending),
                // A banner or a stray console.log: shown, not parsed.
                Err(_) => {
                    let _ = app.emit(EVENT, serde_json::json!({ "agent": agent, "stderr": trimmed.chars().take(400).collect::<String>() }));
                }
            }
        }
        alive.store(false, Ordering::SeqCst);
        lock(&pending).clear();
        let _ = app.emit(EVENT, serde_json::json!({ "agent": agent, "exited": true }));
    });
}

fn read_stderr<R: Read + Send + 'static>(app: tauri::AppHandle, agent: String, stream: R) {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stream);
        let mut line = Vec::new();
        loop {
            line.clear();
            match reader.read_until(b'\n', &mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let text: String = String::from_utf8_lossy(&line).trim_end().chars().take(400).collect();
            if !text.is_empty() {
                let _ = app.emit(EVENT, serde_json::json!({ "agent": agent, "stderr": text }));
            }
        }
    });
}

fn request(agent: &str, method: &str, params: serde_json::Value, timeout: Duration) -> Result<serde_json::Value, String> {
    let (stdin, pending, alive) = {
        let map = lock(agents());
        let a = map.get(agent).ok_or_else(|| format!("The agent '{}' is not running.", agent))?;
        (a.stdin.clone(), a.pending.clone(), a.alive.clone())
    };
    let rpc_id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = mpsc::channel();
    lock(&pending).insert(rpc_id, tx);
    if !alive.load(Ordering::SeqCst) {
        lock(&pending).remove(&rpc_id);
        return Err(format!("The agent '{}' has exited.", agent));
    }
    let mut message = serde_json::json!({ "jsonrpc": "2.0", "id": rpc_id, "method": method });
    if !params.is_null() {
        message["params"] = params;
    }
    if let Err(e) = write_line(&stdin, &message) {
        lock(&pending).remove(&rpc_id);
        return Err(e);
    }
    let reply = match rx.recv_timeout(timeout) {
        Ok(v) => v,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            lock(&pending).remove(&rpc_id);
            return Err(format!("{} got no answer from '{}' within {} s.", method, agent, timeout.as_secs()));
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            return Err(format!("The agent '{}' exited before answering {}.", agent, method));
        }
    };
    if let Some(error) = reply.get("error") {
        let text = error.get("message").and_then(|m| m.as_str()).unwrap_or("unknown error");
        return Err(format!("{}: {}", method, text));
    }
    Ok(reply.get("result").cloned().unwrap_or(serde_json::Value::Null))
}

fn kill_tree(child: &mut Child) {
    #[cfg(unix)]
    {
        let group = format!("-{}", child.id());
        let _ = Command::new("kill").args(["-TERM", &group]).status();
        std::thread::sleep(Duration::from_millis(300));
        let _ = Command::new("kill").args(["-KILL", &group]).status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn stop_agent(id: &str) -> bool {
    let removed = lock(agents()).remove(id);
    match removed {
        Some(mut a) => {
            *lock(&a.stdin) = None;
            kill_tree(&mut a.child);
            true
        }
        None => false,
    }
}

/// Stop every agent: called on Quit beside the other child servers.
pub fn shutdown() {
    let ids: Vec<String> = lock(agents()).keys().cloned().collect();
    for id in ids {
        stop_agent(&id);
    }
}

/// The `initialize` params: what this client can do for the agent.
pub fn initialize_params() -> serde_json::Value {
    serde_json::json!({
        "protocolVersion": PROTOCOL_VERSION,
        "clientCapabilities": {
            "fs": { "readTextFile": true, "writeTextFile": true },
            "terminal": false
        },
        "clientInfo": { "name": "NeuraOS", "version": env!("CARGO_PKG_VERSION") }
    })
}

/// Start an agent and open a session in `cwd`. Answers with the session id
/// and what the agent said about itself.
#[tauri::command(async)]
pub fn acp_start(
    app: tauri::AppHandle,
    id: String,
    command: String,
    args: Option<Vec<String>>,
    cwd: String,
) -> Result<serde_json::Value, String> {
    let id = safe_id(&id)?;
    let program = command.trim();
    if program.is_empty() || program.contains('\0') {
        return Err("An agent needs a command to run.".to_string());
    }
    let folder = std::path::PathBuf::from(cwd.trim());
    if !folder.is_dir() {
        return Err(format!("Open a folder first; the agent works in it. ({} is not a folder)", cwd));
    }
    stop_agent(&id);
    if lock(agents()).len() >= MAX_AGENTS {
        return Err(format!("At most {} agents can run at once; stop one first.", MAX_AGENTS));
    }
    let mut builder = Command::new(program);
    builder
        .args(args.unwrap_or_default())
        .current_dir(&folder)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        builder.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        builder.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = builder.spawn().map_err(|e| format!("Could not start {}: {}", program, e))?;
    let (stdin, stdout, stderr) = match (child.stdin.take(), child.stdout.take(), child.stderr.take()) {
        (Some(a), Some(b), Some(c)) => (a, b, c),
        _ => {
            kill_tree(&mut child);
            return Err("The agent started without its pipes.".to_string());
        }
    };
    let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
    let alive = Arc::new(AtomicBool::new(true));
    let input: Input = Arc::new(Mutex::new(Some(stdin)));
    read_stdout(app.clone(), id.clone(), stdout, pending.clone(), alive.clone());
    read_stderr(app.clone(), id.clone(), stderr);
    let pid = child.id();
    lock(agents()).insert(id.clone(), Agent { child, stdin: input, pending, alive });

    let init = match request(&id, "initialize", initialize_params(), INIT_TIMEOUT) {
        Ok(r) => r,
        Err(e) => {
            stop_agent(&id);
            return Err(e);
        }
    };
    let session = match request(
        &id,
        "session/new",
        serde_json::json!({ "cwd": folder.display().to_string(), "mcpServers": [] }),
        INIT_TIMEOUT,
    ) {
        Ok(r) => r,
        Err(e) => {
            stop_agent(&id);
            return Err(e);
        }
    };
    Ok(serde_json::json!({
        "id": id,
        "pid": pid,
        "sessionId": session.get("sessionId").cloned().unwrap_or(serde_json::Value::Null),
        "agentInfo": init.get("agentInfo").cloned().unwrap_or(serde_json::Value::Null),
        "agentCapabilities": init.get("agentCapabilities").cloned().unwrap_or(serde_json::Value::Null),
        "authMethods": init.get("authMethods").cloned().unwrap_or(serde_json::Value::Null),
    }))
}

/// One prompt turn. Blocks until the agent reports its stop reason; the
/// turn's updates arrive as `acp-message` events meanwhile.
#[tauri::command(async)]
pub fn acp_prompt(id: String, session_id: String, text: String) -> Result<serde_json::Value, String> {
    let id = safe_id(&id)?;
    let text: String = text.chars().take(200_000).collect();
    request(
        &id,
        "session/prompt",
        serde_json::json!({ "sessionId": session_id, "prompt": [{ "type": "text", "text": text }] }),
        PROMPT_TIMEOUT,
    )
}

/// `session/cancel`: a notification, so it needs no answer.
#[tauri::command]
pub fn acp_cancel(id: String, session_id: String) -> Result<(), String> {
    let id = safe_id(&id)?;
    let stdin = lock(agents()).get(&id).map(|a| a.stdin.clone()).ok_or("not running")?;
    write_line(&stdin, &serde_json::json!({ "jsonrpc": "2.0", "method": "session/cancel", "params": { "sessionId": session_id } }))
}

/// The page's answer to a request the agent made (permission, fs read,
/// fs write): the result, or an error message.
#[tauri::command]
pub fn acp_respond(id: String, request_id: serde_json::Value, result: Option<serde_json::Value>, error: Option<String>) -> Result<(), String> {
    let id = safe_id(&id)?;
    let stdin = lock(agents()).get(&id).map(|a| a.stdin.clone()).ok_or("not running")?;
    let message = match error {
        Some(text) => serde_json::json!({ "jsonrpc": "2.0", "id": request_id, "error": { "code": -32000, "message": text } }),
        None => serde_json::json!({ "jsonrpc": "2.0", "id": request_id, "result": result.unwrap_or(serde_json::json!({})) }),
    };
    write_line(&stdin, &message)
}

#[tauri::command(async)]
pub fn acp_stop(id: String) -> serde_json::Value {
    let stopped = safe_id(&id).map(|key| stop_agent(&key)).unwrap_or(false);
    serde_json::json!({ "stopped": stopped })
}

#[tauri::command]
pub fn acp_list() -> Vec<String> {
    let mut map = lock(agents());
    let mut ids = Vec::new();
    for (key, a) in map.iter_mut() {
        if a.alive.load(Ordering::SeqCst) && matches!(a.child.try_wait(), Ok(None)) {
            ids.push(key.clone());
        }
    }
    ids.sort();
    ids
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_short_and_plain() {
        assert_eq!(safe_id(" Gemini-1 ").unwrap(), "gemini-1");
        assert!(safe_id("").is_err());
        assert!(safe_id("a b").is_err());
        assert!(safe_id("x/../y").is_err());
    }

    #[test]
    fn initialize_declares_the_fs_capabilities_the_page_answers() {
        let p = initialize_params();
        assert_eq!(p["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(p["clientCapabilities"]["fs"]["readTextFile"], true);
        assert_eq!(p["clientCapabilities"]["fs"]["writeTextFile"], true);
        assert_eq!(p["clientInfo"]["name"], "NeuraOS");
    }

    #[test]
    fn a_stopped_agent_is_not_listed_and_stopping_twice_is_false() {
        assert!(acp_list().is_empty());
        assert!(!stop_agent("nobody"));
    }
}
