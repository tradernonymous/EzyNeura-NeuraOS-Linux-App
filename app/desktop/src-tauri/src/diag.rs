// The facts behind the app's own "Copy diagnostics" button.
//
// This module gathers; it does not format. The sentence a user copies is built
// by src/diagnostics.js, which node:test exercises directly -- including the
// part that matters most, redacting anything that looks like a credential.
//
// A diagnostics bundle is only useful if it is safe to paste into an issue, so
// nothing here touches the engine session, a provider key or a chat's contents.
use tauri::Manager;

#[derive(serde::Serialize)]
pub struct Facts {
    pub version: String,
    pub os: String,
    pub arch: String,
    /// The webview runtime: the WebView2 version on Windows, "WebKitGTK
    /// <version> (dmabuf guard: on/off)" on Linux.
    pub runtime: String,
    /// Linux only: "x11", "wayland", or "unknown"; empty elsewhere.
    pub session: String,
    pub log_path: String,
    pub log_bytes: u64,
    pub log_tail: String,
    pub data_dir: String,
    pub cache_dir: String,
}

fn path_or_empty(result: Result<std::path::PathBuf, tauri::Error>) -> String {
    result.map(|p| p.display().to_string()).unwrap_or_default()
}

#[cfg(windows)]
fn runtime_facts() -> (String, String) {
    (crate::webview2::version().unwrap_or_else(|| "missing".to_string()), String::new())
}

#[cfg(target_os = "linux")]
fn runtime_facts() -> (String, String) {
    let guard = if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some() {
        "dmabuf guard: on"
    } else {
        "dmabuf guard: off"
    };
    let version = crate::linux::webkit::version().unwrap_or_else(|| "WebKitGTK (version unknown)".to_string());
    (format!("{} ({})", version, guard), crate::linux::dmabuf::session_type())
}

#[cfg(not(any(windows, target_os = "linux")))]
fn runtime_facts() -> (String, String) {
    (String::new(), String::new())
}

#[tauri::command]
pub fn diagnostics(app: tauri::AppHandle) -> Facts {
    let (runtime, session) = runtime_facts();
    Facts {
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        runtime,
        session,
        log_path: crate::crash::hint(),
        log_bytes: crate::crash::bytes(),
        log_tail: crate::crash::tail(6000),
        data_dir: path_or_empty(app.path().app_data_dir()),
        cache_dir: path_or_empty(app.path().app_cache_dir()),
    }
}
