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
        let has = |tool: &str| std::process::Command::new("sh").arg("-c").arg(format!("command -v {}", tool)).stdout(std::process::Stdio::null()).status().map(|s| s.success()).unwrap_or(false);
        let session = crate::linux::dmabuf::session_type();
        let tool = typing_tool(&session, has("xdotool"), has("wtype"))
            .ok_or("Voice Type needs xdotool (X11) or wtype (Wayland): sudo apt install xdotool")?;
        let mut cmd = std::process::Command::new(tool);
        if tool == "xdotool" {
            // --clearmodifiers: the hotkey's own keys are still down.
            cmd.args(["type", "--clearmodifiers", "--delay", "12", "--"]).arg(&text);
        } else {
            cmd.arg("--").arg(&text);
        }
        let out = cmd.output().map_err(|e| format!("could not run {}: {}", tool, e))?;
        if !out.status.success() {
            return Err(format!("{} failed: {}", tool, String::from_utf8_lossy(&out.stderr).trim()));
        }
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
