// NeuraOS as an MCP server (docs/MASTER_PLAN.md L6): `freeai4u-desktop --mcp`
// speaks MCP over stdio -- no window, no D-Bus, no tray -- so Claude Code,
// Gemini CLI, Codex or any MCP client can use what this machine has through
// NeuraOS: the local models (the llama-server the app started, Ollama), the
// image server, the GPU facts, the GGUF files on disk, and NeuraOS itself
// (open a folder or a file in the running app).
//
//   claude mcp add neuraos -- /usr/bin/freeai4u-desktop --mcp
//
// One process per client, started by the client, gone when the client
// closes its stdin. It is a separate process from the app, so it learns
// what the app is running from the small state file the app writes when it
// starts a model server (models.rs, `local-model.json` in the app's data
// folder) and by probing the loopback ports; it never starts a model
// itself. Every request is one JSON line in, one JSON line out (mcp.rs
// documents the framing from the other side).
//
// The pure part -- `handle(request) -> response` -- is what the tests drive.
use std::io::{BufRead, Write};
use std::path::PathBuf;

pub const PROTOCOL_VERSION: &str = "2025-06-18";
pub const SERVER_NAME: &str = "NeuraOS";
/// Ollama's own default, the same one ollama.rs talks to.
const OLLAMA_BASE: &str = "http://127.0.0.1:11434";
/// A chat through a local model may take a while on a CPU.
const CHAT_TIMEOUT_SECS: u64 = 300;
const IMAGE_TIMEOUT_SECS: u64 = 600;
const MAX_PROMPT_CHARS: usize = 60_000;

// ---- what the app left behind -----------------------------------------------

/// What the app writes when it starts llama-server (models.rs), read here.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
pub struct LocalModelState {
    pub port: u16,
    pub api_key: String,
    pub file: String,
    pub repo: String,
    pub quant: String,
    pub pid: u32,
}

pub const STATE_FILE: &str = "local-model.json";

fn state_path() -> Option<PathBuf> {
    Some(crate::linux::paths::app_data_dir().join(STATE_FILE))
}

fn read_state() -> Option<LocalModelState> {
    let text = std::fs::read_to_string(state_path()?).ok()?;
    serde_json::from_str(&text).ok()
}

// ---- the tools --------------------------------------------------------------

fn tool(name: &str, description: &str, properties: serde_json::Value, required: &[&str]) -> serde_json::Value {
    serde_json::json!({
        "name": name,
        "description": description,
        "inputSchema": { "type": "object", "properties": properties, "required": required },
    })
}

pub fn tools() -> Vec<serde_json::Value> {
    vec![
        tool("neuraos_status", "What NeuraOS has on this machine right now: the local model server, Ollama, the image server, the GPU and its memory.", serde_json::json!({}), &[]),
        tool("neuraos_models", "The GGUF model files on this machine (NeuraOS's folder and the usual caches) and the models Ollama has.", serde_json::json!({}), &[]),
        tool(
            "neuraos_chat",
            "Ask a model running on this machine: the llama-server NeuraOS started, else Ollama. Returns the answer as text. Free and private: nothing leaves the PC.",
            serde_json::json!({
                "prompt": { "type": "string", "description": "What to ask" },
                "system": { "type": "string", "description": "An optional system prompt" },
                "model": { "type": "string", "description": "An Ollama model name to use instead of the running llama-server" },
                "max_tokens": { "type": "integer", "description": "Cap on the answer length (default 1024)" }
            }),
            &["prompt"],
        ),
        tool(
            "neuraos_image",
            "Draw a picture with the image server NeuraOS runs (stable-diffusion.cpp). Returns the PNG file's path.",
            serde_json::json!({
                "prompt": { "type": "string" },
                "width": { "type": "integer", "description": "Pixels, default 512" },
                "height": { "type": "integer", "description": "Pixels, default 512" }
            }),
            &["prompt"],
        ),
        tool(
            "neuraos_open",
            "Open a folder (in NeuraOS Code) or a file (a .gguf goes to the model inspector) in the NeuraOS app, starting it if needed.",
            serde_json::json!({ "path": { "type": "string", "description": "An absolute path on this machine" } }),
            &["path"],
        ),
    ]
}

fn text_result(text: impl Into<String>, is_error: bool) -> serde_json::Value {
    serde_json::json!({ "content": [{ "type": "text", "text": text.into() }], "isError": is_error })
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(CHAT_TIMEOUT_SECS))
        .build()
        .map_err(|e| e.to_string())
}

async fn get_json(url: &str, secs: u64) -> Result<serde_json::Value, String> {
    let response = client()?
        .get(url)
        .timeout(std::time::Duration::from_secs(secs))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("{} answered HTTP {}", url, response.status().as_u16()));
    }
    let text = response.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("{} did not answer JSON: {}", url, e))
}

/// POST a JSON body and parse a JSON answer (reqwest is built without its
/// `json` feature here, the same as the rest of the shell).
async fn post_json(url: &str, body: &serde_json::Value, bearer: Option<&str>, secs: u64) -> Result<serde_json::Value, String> {
    let mut request = client()?
        .post(url)
        .timeout(std::time::Duration::from_secs(secs))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body.to_string());
    if let Some(key) = bearer.filter(|k| !k.is_empty()) {
        request = request.bearer_auth(key);
    }
    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) {
        return Err(format!("{} answered HTTP {}: {}", url, status, text.chars().take(300).collect::<String>()));
    }
    serde_json::from_str(&text).map_err(|e| format!("{} did not answer JSON: {}", url, e))
}

async fn port_answers(url: &str) -> bool {
    get_json(url, 3).await.is_ok()
}

/// The llama-server the app started, if it is still answering.
async fn live_state() -> Option<LocalModelState> {
    let state = read_state()?;
    if state.port == 0 {
        return None;
    }
    let mut request = client().ok()?.get(format!("http://127.0.0.1:{}/health", state.port)).timeout(std::time::Duration::from_secs(3));
    if !state.api_key.is_empty() {
        request = request.bearer_auth(&state.api_key);
    }
    match request.send().await {
        Ok(r) if r.status().is_success() => Some(state),
        _ => None,
    }
}

async fn status() -> serde_json::Value {
    let llama = live_state().await;
    let ollama = get_json(&format!("{}/api/tags", OLLAMA_BASE), 3).await.ok();
    let image = port_answers(&format!("http://127.0.0.1:{}/sdcpp/v1/capabilities", crate::sd::DEFAULT_PORT)).await;
    serde_json::json!({
        "localModelServer": llama.as_ref().map(|s| serde_json::json!({
            "port": s.port,
            "model": if s.file.is_empty() { format!("{}:{}", s.repo, s.quant) } else { s.file.clone() },
        })),
        "ollama": ollama.as_ref().map(|tags| {
            tags.get("models").and_then(|m| m.as_array()).map(|list| list.iter().filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(str::to_string)).collect::<Vec<_>>()).unwrap_or_default()
        }),
        "imageServer": if image { serde_json::json!({ "port": crate::sd::DEFAULT_PORT }) } else { serde_json::Value::Null },
        "gpu": crate::linux::gpu::facts(),
    })
}

fn models_on_disk() -> Vec<serde_json::Value> {
    let mut dirs = vec![crate::linux::paths::app_data_dir().join("models")];
    dirs.extend(crate::models::known_model_dirs());
    let mut out = Vec::new();
    for dir in dirs {
        let found = crate::models::local_models_scan(Some(vec![dir.display().to_string()]));
        if let Some(files) = found.get("files").and_then(|f| f.as_array()) {
            for file in files {
                if file.get("partial").and_then(|p| p.as_bool()).unwrap_or(false) {
                    continue;
                }
                out.push(serde_json::json!({ "path": file.get("path"), "bytes": file.get("bytes") }));
            }
        }
    }
    out
}

async fn chat(args: &serde_json::Value) -> Result<String, String> {
    let prompt = args.get("prompt").and_then(|p| p.as_str()).map(str::trim).unwrap_or("");
    if prompt.is_empty() {
        return Err("prompt is required".to_string());
    }
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err(format!("the prompt is limited to {} characters", MAX_PROMPT_CHARS));
    }
    let system = args.get("system").and_then(|s| s.as_str()).unwrap_or("").trim();
    let max_tokens = args.get("max_tokens").and_then(|m| m.as_u64()).unwrap_or(1024).clamp(16, 32_768);
    let mut messages = Vec::new();
    if !system.is_empty() {
        messages.push(serde_json::json!({ "role": "system", "content": system }));
    }
    messages.push(serde_json::json!({ "role": "user", "content": prompt }));
    let wanted_model = args.get("model").and_then(|m| m.as_str()).unwrap_or("").trim();

    if wanted_model.is_empty() {
        if let Some(state) = live_state().await {
            let answer = post_json(
                &format!("http://127.0.0.1:{}/v1/chat/completions", state.port),
                &serde_json::json!({ "messages": messages, "max_tokens": max_tokens, "stream": false }),
                Some(&state.api_key),
                CHAT_TIMEOUT_SECS,
            )
            .await?;
            return answer
                .pointer("/choices/0/message/content")
                .and_then(|c| c.as_str())
                .map(str::to_string)
                .ok_or_else(|| format!("llama-server answered without a message: {}", answer));
        }
    }
    let tags = get_json(&format!("{}/api/tags", OLLAMA_BASE), 3)
        .await
        .map_err(|_| "no model is running: start one in NeuraOS (Settings → Local models) or install Ollama".to_string())?;
    let model = if !wanted_model.is_empty() {
        wanted_model.to_string()
    } else {
        tags.pointer("/models/0/name")
            .and_then(|n| n.as_str())
            .map(str::to_string)
            .ok_or("Ollama is running but has no models: ollama pull gemma3")?
    };
    let answer = post_json(
        &format!("{}/api/chat", OLLAMA_BASE),
        &serde_json::json!({ "model": model, "messages": messages, "stream": false, "options": { "num_predict": max_tokens } }),
        None,
        CHAT_TIMEOUT_SECS,
    )
    .await?;
    answer
        .pointer("/message/content")
        .and_then(|c| c.as_str())
        .map(str::to_string)
        .ok_or_else(|| format!("Ollama answered without a message: {}", answer))
}

async fn image(args: &serde_json::Value) -> Result<String, String> {
    let prompt = args.get("prompt").and_then(|p| p.as_str()).map(str::trim).unwrap_or("");
    if prompt.is_empty() {
        return Err("prompt is required".to_string());
    }
    let side = |key: &str| args.get(key).and_then(|v| v.as_u64()).unwrap_or(512).clamp(64, 2048);
    let (width, height) = (side("width"), side("height"));
    let base = crate::sd::base_url(crate::sd::DEFAULT_PORT);
    if !port_answers(&format!("{}/sdcpp/v1/capabilities", base)).await {
        return Err("the image server is not running: start it in NeuraOS (Settings → Local images)".to_string());
    }
    let answer = post_json(
        &format!("{}/v1/images/generations", base),
        &serde_json::json!({ "prompt": prompt, "n": 1, "size": format!("{}x{}", width, height), "response_format": "b64_json" }),
        None,
        IMAGE_TIMEOUT_SECS,
    )
    .await?;
    let b64 = answer
        .pointer("/data/0/b64_json")
        .and_then(|b| b.as_str())
        .ok_or_else(|| format!("the image server answered without a picture: {}", answer))?;
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
    let dir = crate::linux::paths::app_data_dir().join("mcp-images");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("image-{}.png", chrono::Utc::now().format("%Y%m%d-%H%M%S")));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

fn open_in_app(args: &serde_json::Value) -> Result<String, String> {
    let raw = args.get("path").and_then(|p| p.as_str()).map(str::trim).unwrap_or("");
    let path = PathBuf::from(raw);
    if raw.is_empty() || !path.is_absolute() {
        return Err("path must be absolute".to_string());
    }
    if !path.exists() {
        return Err(format!("{} does not exist", raw));
    }
    let launcher = std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .or_else(|| std::env::current_exe().ok())
        .ok_or("cannot find NeuraOS's own path")?;
    std::process::Command::new(launcher)
        .arg(&path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("could not start NeuraOS: {}", e))?;
    Ok(format!("Opened {} in NeuraOS.", path.display()))
}

async fn call(name: &str, args: &serde_json::Value) -> serde_json::Value {
    let text = match name {
        "neuraos_status" => Ok(status().await.to_string()),
        "neuraos_models" => {
            let ollama = get_json(&format!("{}/api/tags", OLLAMA_BASE), 3).await.ok().and_then(|t| t.get("models").cloned());
            Ok(serde_json::json!({ "gguf": models_on_disk(), "ollama": ollama }).to_string())
        }
        "neuraos_chat" => chat(args).await,
        "neuraos_image" => image(args).await,
        "neuraos_open" => open_in_app(args),
        other => Err(format!("NeuraOS has no tool named {}", other)),
    };
    match text {
        Ok(text) => text_result(text, false),
        Err(e) => text_result(e, true),
    }
}

// ---- JSON-RPC ---------------------------------------------------------------

fn error(id: &serde_json::Value, code: i64, message: impl Into<String>) -> serde_json::Value {
    serde_json::json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message.into() } })
}

fn result(id: &serde_json::Value, value: serde_json::Value) -> serde_json::Value {
    serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": value })
}

/// One request in, one response out; None for a notification (nothing to
/// send). Tool calls do their network work here, so the caller drives one
/// request at a time -- what stdio MCP clients do.
pub async fn handle(request: &serde_json::Value) -> Option<serde_json::Value> {
    let method = request.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let id = request.get("id").cloned().unwrap_or(serde_json::Value::Null);
    let params = request.get("params").cloned().unwrap_or(serde_json::json!({}));
    if id.is_null() {
        // notifications/initialized, notifications/cancelled: acknowledged by silence.
        return None;
    }
    Some(match method {
        "initialize" => result(
            &id,
            serde_json::json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": SERVER_NAME, "version": env!("CARGO_PKG_VERSION") },
                "instructions": "NeuraOS runs models on this machine. neuraos_chat answers with a local model (free, private); neuraos_status says what is running first.",
            }),
        ),
        "ping" => result(&id, serde_json::json!({})),
        "tools/list" => result(&id, serde_json::json!({ "tools": tools() })),
        "tools/call" => {
            let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(serde_json::json!({}));
            if name.is_empty() {
                error(&id, -32602, "tools/call needs a name")
            } else {
                result(&id, call(name, &args).await)
            }
        }
        "resources/list" => result(&id, serde_json::json!({ "resources": [] })),
        "prompts/list" => result(&id, serde_json::json!({ "prompts": [] })),
        "" => error(&id, -32600, "a request needs a method"),
        other => error(&id, -32601, format!("NeuraOS does not support {}", other)),
    })
}

/// Serve stdin/stdout until the client closes stdin. Never returns early on
/// a bad line: a parse error is answered, and the loop goes on.
pub fn serve_stdio() {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<serde_json::Value>(&line) {
            Ok(request) => tauri::async_runtime::block_on(handle(&request)),
            Err(e) => Some(error(&serde_json::Value::Null, -32700, format!("not JSON: {}", e))),
        };
        if let Some(reply) = reply {
            let mut text = reply.to_string();
            text.push('\n');
            let mut out = stdout.lock();
            if out.write_all(text.as_bytes()).and_then(|_| out.flush()).is_err() {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(request: serde_json::Value) -> Option<serde_json::Value> {
        tauri::async_runtime::block_on(handle(&request))
    }

    #[test]
    fn initialize_names_the_server_and_its_tools() {
        let reply = run(serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18" } })).unwrap();
        assert_eq!(reply["id"], 1);
        assert_eq!(reply["result"]["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(reply["result"]["serverInfo"]["name"], "NeuraOS");
        let list = run(serde_json::json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })).unwrap();
        let names: Vec<&str> = list["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["neuraos_status", "neuraos_models", "neuraos_chat", "neuraos_image", "neuraos_open"]);
        for tool in list["result"]["tools"].as_array().unwrap() {
            assert_eq!(tool["inputSchema"]["type"], "object", "{} has an object schema", tool["name"]);
        }
    }

    #[test]
    fn notifications_are_silent_and_unknown_methods_are_errors() {
        assert!(run(serde_json::json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).is_none());
        let reply = run(serde_json::json!({ "jsonrpc": "2.0", "id": 3, "method": "resources/read" })).unwrap();
        assert_eq!(reply["error"]["code"], -32601);
        let reply = run(serde_json::json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {} })).unwrap();
        assert_eq!(reply["error"]["code"], -32602);
        assert_eq!(run(serde_json::json!({ "jsonrpc": "2.0", "id": 5, "method": "ping" })).unwrap()["result"], serde_json::json!({}));
    }

    #[test]
    fn a_tool_error_is_a_result_the_model_can_read_not_a_protocol_error() {
        let reply = run(serde_json::json!({ "jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": { "name": "neuraos_chat", "arguments": {} } })).unwrap();
        assert_eq!(reply["result"]["isError"], true);
        assert!(reply["result"]["content"][0]["text"].as_str().unwrap().contains("prompt is required"));
        let reply = run(serde_json::json!({ "jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": { "name": "neuraos_open", "arguments": { "path": "relative/thing" } } })).unwrap();
        assert_eq!(reply["result"]["isError"], true);
        let reply = run(serde_json::json!({ "jsonrpc": "2.0", "id": 8, "method": "tools/call", "params": { "name": "nope", "arguments": {} } })).unwrap();
        assert!(reply["result"]["content"][0]["text"].as_str().unwrap().contains("no tool named nope"));
    }

    #[test]
    fn the_state_file_round_trips() {
        let state = LocalModelState { port: 8080, api_key: "k".into(), file: "/m/a.gguf".into(), repo: String::new(), quant: String::new(), pid: 7 };
        let text = serde_json::to_string(&state).unwrap();
        assert_eq!(serde_json::from_str::<LocalModelState>(&text).unwrap(), state);
    }
}
