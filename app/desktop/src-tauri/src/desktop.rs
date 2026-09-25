// Linux desktop integration (docs/MASTER_PLAN.md section 6, phase L5):
// Nemo's right-click actions, typing dictated text into whatever app has
// focus (Voice Type), the tray icon's three states, and notifications with
// Approve / Reject buttons. Every command exists on every platform so the
// frontend has one API; off Linux they answer "not here" rather than fail
// to compile.
use std::path::PathBuf;

// ---- Nemo actions -----------------------------------------------------------

/// The three actions, as (file name, contents). `%F` is Nemo's "selected
/// files" placeholder; the app's launch path handling (launch.rs) takes a
/// folder to Code and a .gguf to the inspector.
pub fn nemo_actions(exec: &str) -> Vec<(&'static str, String)> {
    let common = "Active=true\nTerminal=false\nQuote=double\nSeparator= \n";
    vec![
        (
            "neuraos-open-folder.nemo_action",
            format!(
                "[Nemo Action]\nName=Open folder in NeuraOS Code\nComment=Work on this folder with NeuraOS\nExec={} %F\nIcon-Name=freeai4u-desktop\nSelection=s\nExtensions=dir;\n{}",
                exec, common
            ),
        ),
        (
            "neuraos-ask-file.nemo_action",
            format!(
                "[Nemo Action]\nName=Ask NeuraOS about this file\nComment=Open NeuraOS with this file\nExec={} %F\nIcon-Name=freeai4u-desktop\nSelection=s\nExtensions=any;\n{}",
                exec, common
            ),
        ),
        (
            "neuraos-inspect-gguf.nemo_action",
            format!(
                "[Nemo Action]\nName=Inspect model in NeuraOS\nComment=Open this GGUF in NeuraOS's model inspector\nExec={} %F\nIcon-Name=freeai4u-desktop\nSelection=s\nExtensions=gguf;\n{}",
                exec, common
            ),
        ),
    ]
}

fn nemo_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("no HOME")?;
    Ok(PathBuf::from(home).join(".local").join("share").join("nemo").join("actions"))
}

/// How to start this app from a .nemo_action: the AppImage when running as
/// one (APPIMAGE is set by the runtime), else the installed binary.
fn launcher() -> Result<String, String> {
    if let Some(appimage) = std::env::var_os("APPIMAGE") {
        return Ok(appimage.to_string_lossy().to_string());
    }
    std::env::current_exe()
        .map(|p| p.display().to_string())
        .map_err(|e| format!("could not find this app's own path: {}", e))
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn nemo_actions_status() -> serde_json::Value {
    let dir = nemo_dir().unwrap_or_default();
    let installed = nemo_actions("x").iter().all(|(name, _)| dir.join(name).is_file());
    let nemo = std::process::Command::new("sh").arg("-c").arg("command -v nemo").stdout(std::process::Stdio::null()).status().map(|s| s.success()).unwrap_or(false);
    serde_json::json!({ "available": true, "nemo": nemo, "installed": installed, "dir": dir.display().to_string() })
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn nemo_actions_status() -> serde_json::Value {
    serde_json::json!({ "available": false, "nemo": false, "installed": false, "dir": "" })
}

#[tauri::command]
pub fn nemo_actions_set(on: bool) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "linux")]
    {
        let dir = nemo_dir()?;
        if on {
            std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {}", dir.display(), e))?;
            let exec = launcher()?;
            for (name, body) in nemo_actions(&exec) {
                std::fs::write(dir.join(name), body).map_err(|e| format!("cannot write {}: {}", name, e))?;
            }
        } else {
            for (name, _) in nemo_actions("x") {
                let _ = std::fs::remove_file(dir.join(name));
            }
        }
        return Ok(nemo_actions_status());
    }
    #[allow(unreachable_code)]
    {
        let _ = on;
        Err("Nemo actions are a Linux Mint feature".to_string())
    }
}

// ---- Voice Type: type text into the focused app -----------------------------

/// The typing tool for this session: xdotool on X11, wtype on Wayland.
pub fn typing_tool(session: &str, has_xdotool: bool, has_wtype: bool) -> Option<&'static str> {
    if session == "wayland" {
        if has_wtype { Some("wtype") } else if has_xdotool { Some("xdotool") } else { None }
    } else if has_xdotool {
        Some("xdotool")
    } else if has_wtype {
        Some("wtype")
    } else {
        None
    }
}

#[tauri::command(async)]
pub fn voice_type_text(text: String) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "linux")]
    {
        let text: String = text.chars().take(4000).collect();
        if text.trim().is_empty() {
            return Ok(serde_json::json!({ "typed": 0 }));
        }
        let session = crate::linux::dmabuf::session_type();
        let wayland = session == "wayland";
        let tool = typing_tool(&session, tool_present("xdotool"), tool_present("wtype"));
        let typed = match tool {
            Some(tool) => {
                let mut cmd = std::process::Command::new(tool);
                if tool == "xdotool" {
                    // --clearmodifiers: the hotkey's own keys are still down.
                    cmd.args(["type", "--clearmodifiers", "--delay", "12", "--"]).arg(&text);
                } else {
                    cmd.arg("--").arg(&text);
                }
                let out = cmd.output().map_err(|e| format!("could not run {}: {}", tool, e))?;
                if out.status.success() {
                    Ok(tool.to_string())
                } else {
                    Err(format!("{} failed: {}", tool, String::from_utf8_lossy(&out.stderr).trim()))
                }
            }
            None if wayland => Err(String::new()),
            None => Err("Voice Type needs xdotool (X11) or wtype (Wayland): sudo apt install xdotool".to_string()),
        };
        // On Wayland a compositor without the virtual-keyboard protocol
        // (Cinnamon, GNOME) refuses wtype; the RemoteDesktop portal is the
        // way the desktop itself offers.
        let tool = match typed {
            Ok(tool) => tool,
            Err(e) if wayland => {
                crate::portal::act(Act::Type(text.clone())).map_err(|p| if e.is_empty() { p } else { format!("{}; portal: {}", e, p) })?;
                "portal".to_string()
            }
            Err(e) => return Err(e),
        };
        return Ok(serde_json::json!({ "typed": text.chars().count(), "tool": tool }));
    }
    #[allow(unreachable_code)]
    {
        let _ = text;
        Err("Voice Type is a Linux feature".to_string())
    }
}

// ---- Tray states ------------------------------------------------------------

/// A copy of `rgba` (w×h) with a filled dot of `color` in the bottom-right
/// quarter: the tray's "thinking" and "needs approval" badge. Pure, tested.
pub fn with_dot(rgba: &[u8], w: u32, h: u32, color: [u8; 4]) -> Vec<u8> {
    let mut out = rgba.to_vec();
    if out.len() != (w * h * 4) as usize || w < 8 || h < 8 {
        return out;
    }
    let r = (w.min(h) as f32) * 0.22;
    let cx = w as f32 - r - 1.0;
    let cy = h as f32 - r - 1.0;
    for y in 0..h {
        for x in 0..w {
            let dx = x as f32 + 0.5 - cx;
            let dy = y as f32 + 0.5 - cy;
            let d = (dx * dx + dy * dy).sqrt();
            if d <= r + 1.0 {
                let i = ((y * w + x) * 4) as usize;
                if d <= r - 0.5 {
                    out[i..i + 4].copy_from_slice(&color);
                } else {
                    // A one-pixel dark rim so the dot reads on any panel.
                    let rim = [16u8, 16, 20, 255];
                    out[i..i + 4].copy_from_slice(&rim);
                }
            }
        }
    }
    out
}

/// The dot colour per state; None means the plain icon.
pub fn dot_for(state: &str) -> Option<[u8; 4]> {
    match state {
        "thinking" => Some([56, 214, 255, 255]),   // the AI-activity cyan
        "approval" => Some([255, 176, 46, 255]),   // amber: a person is needed
        _ => None,
    }
}

#[tauri::command]
pub fn tray_state_set(app: tauri::AppHandle, state: String) -> bool {
    let Some(tray) = app.tray_by_id("main") else { return false };
    let Some(base) = app.default_window_icon() else { return false };
    let icon = match dot_for(&state) {
        Some(color) => {
            let buf = with_dot(base.rgba(), base.width(), base.height(), color);
            tauri::image::Image::new_owned(buf, base.width(), base.height())
        }
        None => base.clone().to_owned(),
    };
    let tooltip = match state.as_str() {
        "thinking" => "NeuraOS — working",
        "approval" => "NeuraOS — needs your OK",
        _ => "NeuraOS",
    };
    let _ = tray.set_tooltip(Some(tooltip));
    tray.set_icon(Some(icon)).is_ok()
}

// ---- Notifications with actions --------------------------------------------

/// A notification with Approve / Reject (or any labelled) buttons. The
/// pressed button comes back as a `notification-action` event carrying `id`.
/// On Linux this is libnotify's own action mechanism over D-Bus; elsewhere
/// it falls back to the plain notification and reports `actions: false`.
#[tauri::command(async)]
pub fn notify_with_actions(app: tauri::AppHandle, id: String, title: String, body: String, actions: Vec<(String, String)>) -> serde_json::Value {
    let title: String = title.chars().take(80).collect();
    let body: String = body.chars().take(240).collect();
    #[cfg(target_os = "linux")]
    {
        use tauri::Emitter;
        let mut n = notify_rust::Notification::new();
        n.appname("NeuraOS").summary(&title).body(&body).icon("freeai4u-desktop").timeout(notify_rust::Timeout::Never);
        for (key, label) in actions.iter().take(3) {
            n.action(key, label);
        }
        match n.show() {
            Ok(handle) => {
                let app2 = app.clone();
                let id2 = id.clone();
                std::thread::spawn(move || {
                    handle.wait_for_action(|action| {
                        let action = if action == "__closed" { "dismissed" } else { action };
                        let _ = app2.emit("notification-action", serde_json::json!({ "id": id2, "action": action }));
                    });
                });
                return serde_json::json!({ "shown": true, "actions": true });
            }
            Err(e) => {
                crate::crash::log(&format!("notification with actions: {}", e));
                // Fall through to the plain one.
            }
        }
    }
    let _ = (&app, &id, &actions);
    let shown = crate::quick::notify(app, title, body);
    serde_json::json!({ "shown": shown, "actions": false })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nemo_actions_name_the_launcher_and_the_right_extensions() {
        let actions = nemo_actions("/usr/bin/freeai4u-desktop");
        assert_eq!(actions.len(), 3);
        assert!(actions[0].1.contains("Exec=/usr/bin/freeai4u-desktop %F"));
        assert!(actions[0].1.contains("Extensions=dir;"));
        assert!(actions[2].1.contains("Extensions=gguf;"));
        assert!(actions.iter().all(|(name, _)| name.ends_with(".nemo_action")));
    }

    #[test]
    fn the_typing_tool_follows_the_session() {
        assert_eq!(typing_tool("x11", true, true), Some("xdotool"));
        assert_eq!(typing_tool("wayland", true, true), Some("wtype"));
        assert_eq!(typing_tool("wayland", true, false), Some("xdotool"));
        assert_eq!(typing_tool("x11", false, false), None);
    }

    #[test]
    fn the_dot_lands_bottom_right_and_leaves_the_rest_alone() {
        let w = 32;
        let h = 32;
        let base = vec![0u8; (w * h * 4) as usize];
        let out = with_dot(&base, w, h, [1, 2, 3, 255]);
        let px = |x: u32, y: u32| &out[((y * w + x) * 4) as usize..((y * w + x) * 4 + 4) as usize];
        assert_eq!(px(1, 1), &[0, 0, 0, 0]);
        assert_eq!(px(27, 27), &[1, 2, 3, 255]);
        // A wrong-sized buffer is returned untouched rather than panicking.
        assert_eq!(with_dot(&[0; 8], 32, 32, [1, 2, 3, 255]).len(), 8);
        assert!(dot_for("thinking").is_some());
        assert!(dot_for("idle").is_none());
    }
}

// ---- Renderer mode (Settings → Diagnostics) ---------------------------------

/// The WebKitGTK renderer mode this copy starts with (linux.rs dmabuf):
/// {"mode", "modes", "nvidia"}. Off Linux there is nothing to choose.
#[cfg(target_os = "linux")]
#[tauri::command]
pub fn renderer_mode_get() -> serde_json::Value {
    serde_json::json!({
        "available": true,
        "mode": crate::linux::dmabuf::read_mode(),
        "modes": crate::linux::dmabuf::MODES,
        "nvidia": crate::linux::dmabuf::nvidia_present(),
    })
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn renderer_mode_get() -> serde_json::Value {
    serde_json::json!({ "available": false, "mode": "", "modes": [], "nvidia": false })
}

/// Remember a renderer mode; it applies at the next start (app_relaunch).
#[tauri::command]
pub fn renderer_mode_set(mode: String) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "linux")]
    {
        crate::linux::dmabuf::write_mode(mode.trim())?;
        return Ok(renderer_mode_get());
    }
    #[allow(unreachable_code)]
    {
        let _ = mode;
        Err("the renderer mode is a Linux setting".to_string())
    }
}

// ---- Screenshots and desktop control (L9) -----------------------------------

/// `command -v` for a tool the desktop may or may not have.
pub fn tool_present(tool: &str) -> bool {
    std::process::Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {}", tool))
        .stdout(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// The command-line screenshot tools, in the order tried for a session type,
/// as (program, arguments before the output path). The portal is tried
/// before these on Wayland and after them on X11 (desktop_screenshot).
pub fn screenshot_tools(session: &str) -> &'static [(&'static str, &'static [&'static str])] {
    if session == "wayland" {
        &[("grim", &[]), ("gnome-screenshot", &["-f"]), ("spectacle", &["-b", "-n", "-o"])]
    } else {
        &[("gnome-screenshot", &["-f"]), ("scrot", &["-o"]), ("import", &["-window", "root"])]
    }
}

/// The first installed tool for this session, with the output path appended.
pub fn screenshot_command(session: &str, has: &dyn Fn(&str) -> bool, out: &str) -> Option<(String, Vec<String>)> {
    screenshot_tools(session).iter().find(|(program, _)| has(program)).map(|(program, args)| {
        let mut list: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        list.push(out.to_string());
        (program.to_string(), list)
    })
}

/// Width and height from a PNG's IHDR chunk. Pure, tested.
pub fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let w = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let h = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    Some((w, h))
}

/// A screenshot this app can attach to a chat is at most this big.
const MAX_SHOT_BYTES: usize = 12 * 1024 * 1024;

/// One frame of the screen into `dir`: (path, tool). Wayland: the portal
/// is the way, grim & co. after it; X11: the plain tools first (no dialog),
/// then the portal.
#[cfg(target_os = "linux")]
pub fn take_screenshot_into(dir: &std::path::Path) -> Result<(PathBuf, String), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {}", dir.display(), e))?;
    let out = dir.join(format!("shot-{}.png", chrono::Utc::now().format("%Y%m%d-%H%M%S%3f")));
    let session = crate::linux::dmabuf::session_type();
    let wayland = session == "wayland";

    let via_portal = || -> Result<String, String> {
        let path = crate::portal::screenshot_blocking(std::time::Duration::from_secs(15))?;
        std::fs::copy(&path, &out).map_err(|e| format!("cannot copy the portal's file: {}", e))?;
        // The portal's own copy is ours to remove only where it was a
        // scratch file, never under the person's Pictures folder.
        if path.starts_with("/tmp") || path.starts_with("/run/user") || path.starts_with("/var/tmp") {
            let _ = std::fs::remove_file(&path);
        }
        Ok("portal".to_string())
    };
    let via_tool = || -> Result<String, String> {
        let (program, args) = screenshot_command(&session, &tool_present, &out.display().to_string())
            .ok_or_else(|| "none of gnome-screenshot, scrot or import is installed (sudo apt install scrot)".to_string())?;
        let output = std::process::Command::new(&program)
            .args(&args)
            .output()
            .map_err(|e| format!("could not run {}: {}", program, e))?;
        if !output.status.success() || !out.is_file() {
            return Err(format!("{} failed: {}", program, String::from_utf8_lossy(&output.stderr).trim()));
        }
        Ok(program)
    };
    let tool = if wayland {
        via_portal().or_else(|first| via_tool().map_err(|second| format!("{}; {}", first, second)))?
    } else {
        via_tool().or_else(|first| via_portal().map_err(|second| format!("{}; {}", first, second)))?
    };
    Ok((out, tool))
}

/// One frame of the screen: {path, dataUrl, width, height, tool}. Linux
/// only; the page falls back to the browser's own picker elsewhere.
#[tauri::command(async)]
pub fn desktop_screenshot(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "linux")]
    {
        use tauri::Manager;
        let dir = app
            .path()
            .app_cache_dir()
            .map_err(|e| format!("no cache directory: {}", e))?
            .join("screenshots");
        let (out, tool) = take_screenshot_into(&dir)?;
        let bytes = std::fs::read(&out).map_err(|e| format!("cannot read the screenshot: {}", e))?;
        if bytes.len() > MAX_SHOT_BYTES {
            let _ = std::fs::remove_file(&out);
            return Err("the screenshot is larger than 12 MB".to_string());
        }
        let (width, height) = png_size(&bytes).unwrap_or((0, 0));
        use base64::Engine;
        let data_url = format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes));
        return Ok(serde_json::json!({
            "path": out.display().to_string(),
            "dataUrl": data_url,
            "width": width,
            "height": height,
            "tool": tool,
        }));
    }
    #[allow(unreachable_code)]
    {
        let _ = app;
        Err("screenshots through the shell are a Linux feature".to_string())
    }
}

/// One thing the desktop is asked to do, already checked (plan()).
#[derive(Debug, Clone, PartialEq)]
pub enum Act {
    Type(String),
    Key(String),
    Move { x: f64, y: f64 },
    Click { x: f64, y: f64, button: u8 },
    Scroll { steps: i32 },
}

/// What the page sends: {kind: type|key|move|click|scroll, ...}.
#[derive(Debug, Clone, serde::Deserialize, Default)]
pub struct Action {
    pub kind: String,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub button: Option<u8>,
    pub text: Option<String>,
    pub key: Option<String>,
    pub steps: Option<i32>,
}

const MAX_TYPE_CHARS: usize = 4000;
const MAX_COORD: f64 = 16384.0;

/// The checks between a model's tool call and the desktop: bounded text, a
/// key chord made of key names only, coordinates on a screen, a real mouse
/// button, a bounded scroll. Pure, tested.
pub fn plan(action: Action) -> Result<Act, String> {
    let coords = || -> Result<(f64, f64), String> {
        let x = action.x.ok_or("x is required")?;
        let y = action.y.ok_or("y is required")?;
        if !x.is_finite() || !y.is_finite() || !(0.0..=MAX_COORD).contains(&x) || !(0.0..=MAX_COORD).contains(&y) {
            return Err("x and y must be screen coordinates".to_string());
        }
        Ok((x.round(), y.round()))
    };
    match action.kind.as_str() {
        "type" => {
            let text = action.text.unwrap_or_default();
            if text.trim().is_empty() {
                return Err("text is required".to_string());
            }
            if text.chars().count() > MAX_TYPE_CHARS {
                return Err(format!("text is limited to {} characters per call", MAX_TYPE_CHARS));
            }
            Ok(Act::Type(text))
        }
        "key" => {
            let key = action.key.unwrap_or_default().trim().to_ascii_lowercase();
            if key.is_empty() || key.len() > 40 || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '_') {
                return Err("key is a chord like ctrl+s or alt+F4".to_string());
            }
            Ok(Act::Key(key))
        }
        "move" => {
            let (x, y) = coords()?;
            Ok(Act::Move { x, y })
        }
        "click" => {
            let (x, y) = coords()?;
            let button = action.button.unwrap_or(1);
            if !(1..=3).contains(&button) {
                return Err("button is 1 (left), 2 (middle) or 3 (right)".to_string());
            }
            Ok(Act::Click { x, y, button })
        }
        "scroll" => {
            let steps = action.steps.unwrap_or(3);
            if steps == 0 || !(-30..=30).contains(&steps) {
                return Err("steps is between -30 (up) and 30 (down), not 0".to_string());
            }
            Ok(Act::Scroll { steps })
        }
        other => Err(format!("{} is not a desktop action (type, key, move, click, scroll)", other)),
    }
}

/// The xdotool invocation for an action, as arguments. Pure, tested.
pub fn xdotool_args(act: &Act) -> Vec<String> {
    let s = |v: &str| v.to_string();
    match act {
        Act::Type(text) => vec![s("type"), s("--clearmodifiers"), s("--delay"), s("12"), s("--"), text.clone()],
        Act::Key(key) => vec![s("key"), s("--clearmodifiers"), s("--"), key.clone()],
        Act::Move { x, y } => vec![s("mousemove"), s("--sync"), format!("{}", x), format!("{}", y)],
        Act::Click { x, y, button } => vec![s("mousemove"), s("--sync"), format!("{}", x), format!("{}", y), s("click"), format!("{}", button)],
        Act::Scroll { steps } => vec![
            s("click"),
            s("--repeat"),
            format!("{}", steps.unsigned_abs()),
            s("--delay"),
            s("30"),
            s(if *steps < 0 { "4" } else { "5" }),
        ],
    }
}

/// Do one thing on the desktop (L9): xdotool on X11, the RemoteDesktop
/// portal on Wayland. The page asks the person before every call.
#[tauri::command(async)]
pub fn desktop_act(action: Action) -> Result<serde_json::Value, String> {
    let act = plan(action)?;
    #[cfg(target_os = "linux")]
    {
        let wayland = crate::linux::dmabuf::session_type() == "wayland";
        if !wayland && tool_present("xdotool") {
            let output = std::process::Command::new("xdotool")
                .args(xdotool_args(&act))
                .output()
                .map_err(|e| format!("could not run xdotool: {}", e))?;
            if !output.status.success() {
                return Err(format!("xdotool failed: {}", String::from_utf8_lossy(&output.stderr).trim()));
            }
            return Ok(serde_json::json!({ "ok": true, "via": "xdotool" }));
        }
        if !wayland {
            return Err("desktop control on X11 needs xdotool: sudo apt install xdotool".to_string());
        }
        crate::portal::act(act)?;
        return Ok(serde_json::json!({ "ok": true, "via": "portal" }));
    }
    #[allow(unreachable_code)]
    {
        let _ = act;
        Err("desktop control is a Linux feature".to_string())
    }
}

/// What this desktop can do for screenshots, typing, hotkeys and control,
/// for Settings → Desktop control.
#[cfg(target_os = "linux")]
#[tauri::command(async)]
pub fn desktop_capabilities() -> serde_json::Value {
    let session = crate::linux::dmabuf::session_type();
    let (portal_screenshot, portal_shortcuts, portal_remote) = crate::portal::available_blocking(std::time::Duration::from_secs(4));
    let xdotool = tool_present("xdotool");
    let wtype = tool_present("wtype");
    let screenshot_tool = screenshot_tools(&session).iter().find(|(p, _)| tool_present(p)).map(|(p, _)| p.to_string());
    let control = if session != "wayland" && xdotool { "xdotool" } else if session == "wayland" && portal_remote { "portal" } else { "none" };
    serde_json::json!({
        "available": true,
        "session": session,
        "xdotool": xdotool,
        "wtype": wtype,
        "wlPaste": tool_present("wl-paste"),
        "screenshotTool": screenshot_tool,
        "portalScreenshot": portal_screenshot,
        "portalShortcuts": portal_shortcuts,
        "portalRemoteDesktop": portal_remote,
        "control": control,
    })
}

#[cfg(not(target_os = "linux"))]
#[tauri::command(async)]
pub fn desktop_capabilities() -> serde_json::Value {
    serde_json::json!({ "available": false, "session": "", "control": "none" })
}

/// Bind the app's global chords through the GlobalShortcuts portal (Wayland
/// only; on X11 the global-shortcut plugin already has them). Empty combos
/// are skipped. Answers {bound, via}.
#[tauri::command]
pub async fn portal_shortcuts_bind(app: tauri::AppHandle, quick: String, selection: String, voice: String, screen: String) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "linux")]
    {
        if !crate::portal::is_wayland() {
            return Ok(serde_json::json!({ "bound": 0, "via": "x11" }));
        }
        let wanted: Vec<(String, String, String)> = [
            ("quick", "Open the NeuraOS Quick window", quick),
            ("selection", "Ask NeuraOS about the selected text", selection),
            ("voice", "NeuraOS Voice Type (hold to talk)", voice),
            ("screen", "Ask NeuraOS about the screen", screen),
        ]
        .into_iter()
        .filter(|(_, _, combo)| !combo.trim().is_empty())
        .map(|(id, description, combo)| (id.to_string(), description.to_string(), combo))
        .collect();
        let bound = crate::portal::bind(app, wanted).await?;
        return Ok(serde_json::json!({ "bound": bound, "via": "portal" }));
    }
    #[allow(unreachable_code)]
    {
        let _ = (app, quick, selection, voice, screen);
        Ok(serde_json::json!({ "bound": 0, "via": "none" }))
    }
}

#[cfg(test)]
mod control_tests {
    use super::*;

    fn act(kind: &str) -> Action {
        Action { kind: kind.to_string(), ..Default::default() }
    }

    #[test]
    fn a_plan_checks_every_number_and_string() {
        assert!(plan(act("type")).is_err(), "empty text");
        assert_eq!(plan(Action { text: Some("hi".into()), ..act("type") }).unwrap(), Act::Type("hi".into()));
        assert!(plan(Action { text: Some("x".repeat(4001)), ..act("type") }).is_err());
        assert_eq!(plan(Action { key: Some(" Ctrl+S ".into()), ..act("key") }).unwrap(), Act::Key("ctrl+s".into()));
        assert!(plan(Action { key: Some("ctrl+s; rm".into()), ..act("key") }).is_err(), "no shell characters");
        assert_eq!(plan(Action { x: Some(10.4), y: Some(20.6), ..act("click") }).unwrap(), Act::Click { x: 10.0, y: 21.0, button: 1 });
        assert!(plan(Action { x: Some(-1.0), y: Some(2.0), ..act("click") }).is_err());
        assert!(plan(Action { x: Some(1.0), y: Some(2.0), button: Some(4), ..act("click") }).is_err());
        assert!(plan(Action { x: Some(f64::NAN), y: Some(2.0), ..act("move") }).is_err());
        assert_eq!(plan(Action { steps: Some(-5), ..act("scroll") }).unwrap(), Act::Scroll { steps: -5 });
        assert!(plan(Action { steps: Some(0), ..act("scroll") }).is_err());
        assert!(plan(act("launch")).is_err());
    }

    #[test]
    fn xdotool_gets_arguments_not_a_command_line() {
        assert_eq!(xdotool_args(&Act::Type("a; rm -rf".into())), vec!["type", "--clearmodifiers", "--delay", "12", "--", "a; rm -rf"]);
        assert_eq!(xdotool_args(&Act::Click { x: 3.0, y: 4.0, button: 3 }), vec!["mousemove", "--sync", "3", "4", "click", "3"]);
        assert_eq!(xdotool_args(&Act::Scroll { steps: -2 }), vec!["click", "--repeat", "2", "--delay", "30", "4"]);
        assert_eq!(xdotool_args(&Act::Key("ctrl+s".into())), vec!["key", "--clearmodifiers", "--", "ctrl+s"]);
    }

    #[test]
    fn the_screenshot_tool_is_the_first_installed_one_for_the_session() {
        let has = |t: &str| t == "scrot" || t == "grim";
        assert_eq!(screenshot_command("x11", &has, "/tmp/a.png"), Some(("scrot".to_string(), vec!["-o".to_string(), "/tmp/a.png".to_string()])));
        assert_eq!(screenshot_command("wayland", &has, "/tmp/a.png"), Some(("grim".to_string(), vec!["/tmp/a.png".to_string()])));
        assert_eq!(screenshot_command("x11", &|_| false, "/tmp/a.png"), None);
    }

    /// Run by hand under a display: `xvfb-run -a cargo test -- --ignored
    /// a_real_screenshot`. Proves the X11 tool chain end to end (scrot on
    /// the CI image), not just the choice of command.
    #[cfg(target_os = "linux")]
    #[test]
    #[ignore]
    fn a_real_screenshot_is_a_png_of_the_display() {
        let dir = std::env::temp_dir().join(format!("neuraos-shot-{}", std::process::id()));
        let (path, tool) = take_screenshot_into(&dir).expect("a screenshot under the display");
        let bytes = std::fs::read(&path).unwrap();
        let (w, h) = png_size(&bytes).expect("a PNG");
        assert!(w > 0 && h > 0, "{} wrote a {}x{} image", tool, w, h);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn png_dimensions_come_from_the_header() {
        let mut png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR".to_vec();
        png.extend_from_slice(&1920u32.to_be_bytes());
        png.extend_from_slice(&1080u32.to_be_bytes());
        assert_eq!(png_size(&png), Some((1920, 1080)));
        assert_eq!(png_size(b"not a png"), None);
    }
}

// ---- NeuraOS as an MCP server -----------------------------------------------

/// The command another agent runs to use NeuraOS as an MCP server
/// (mcp_server.rs): this app's own launcher with `--mcp`. Off Linux the
/// mode does not exist yet.
#[cfg(target_os = "linux")]
#[tauri::command]
pub fn mcp_server_command() -> serde_json::Value {
    match launcher() {
        Ok(command) => serde_json::json!({ "available": true, "command": command, "args": ["--mcp"] }),
        Err(e) => serde_json::json!({ "available": false, "command": "", "args": [], "error": e }),
    }
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn mcp_server_command() -> serde_json::Value {
    serde_json::json!({ "available": false, "command": "", "args": [] })
}

/// Whether agents connected over MCP may see and act on the desktop
/// (docs/PC_UPGRADE_PLAN.md P6.2): a marker file the `--mcp` process
/// checks on every desktop call, since it has no window to ask from.
#[cfg(target_os = "linux")]
#[tauri::command]
pub fn desktop_mcp_get() -> serde_json::Value {
    serde_json::json!({ "on": crate::mcp_server::desktop_mcp_marker().is_file() })
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn desktop_mcp_set(on: bool) -> Result<serde_json::Value, String> {
    let marker = crate::mcp_server::desktop_mcp_marker();
    if on {
        if let Some(dir) = marker.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {}", dir.display(), e))?;
        }
        std::fs::write(&marker, b"on\n").map_err(|e| format!("cannot write {}: {}", marker.display(), e))?;
    } else if marker.exists() {
        std::fs::remove_file(&marker).map_err(|e| format!("cannot remove {}: {}", marker.display(), e))?;
    }
    Ok(serde_json::json!({ "on": on }))
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn desktop_mcp_get() -> serde_json::Value {
    serde_json::json!({ "on": false })
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn desktop_mcp_set(on: bool) -> Result<serde_json::Value, String> {
    let _ = on;
    Err("desktop control over MCP is a Linux feature".to_string())
}
