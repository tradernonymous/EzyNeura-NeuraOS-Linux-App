// xdg-desktop-portal on Linux (docs/MASTER_PLAN.md L8 and L9): what a
// Wayland session -- Mint 23's option -- no longer lets a plain X11 tool do,
// asked of the desktop through its portal instead.
//
//   * Screenshot: one frame of the screen, as a file the portal wrote. Used
//     first on every session type (the xapp and GTK backends serve X11 too),
//     with scrot & co. as the X11 fallback (desktop.rs).
//   * GlobalShortcuts: the Quick, selection, Voice Type and screen-ask chords,
//     bound through the portal when the session is Wayland, where the X11
//     grab the global-shortcut plugin does is silently ignored.
//   * RemoteDesktop (+ ScreenCast for absolute pointer positions): typing
//     and pointer input into other apps when xdotool cannot (Wayland). One
//     session per app run, opened on first use -- the desktop asks the person
//     once -- and reused, with the restore token kept so the next run does
//     not ask again.
//
// Everything here is async on ashpd's futures, driven either by Tauri's
// runtime (`tauri::async_runtime::spawn`) or, for the remote-desktop worker,
// by `block_on` on a thread of its own. Nothing in this file touches the
// webview.
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use ashpd::desktop::global_shortcuts::{GlobalShortcuts, NewShortcut};
use ashpd::desktop::remote_desktop::{Axis, DeviceType, KeyState, RemoteDesktop};
use ashpd::desktop::screencast::{CursorMode, Screencast, SourceType};
use ashpd::desktop::screenshot::Screenshot;
use ashpd::desktop::{PersistMode, Session};
use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};

/// Emitted to the page when the screen-ask chord fires (quick.rs sets the
/// same name for the X11 path).
pub const SCREEN_EVENT: &str = "screen-ask";

pub fn is_wayland() -> bool {
    crate::linux::dmabuf::session_type() == "wayland"
}

// ---- availability -----------------------------------------------------------

/// Which portals this desktop serves: each proxy constructor reads the
/// interface's `version` property, which fails when the backend has no such
/// interface (Cinnamon's xapp backend has Screenshot; GlobalShortcuts and
/// RemoteDesktop come with the GNOME and KDE backends).
pub async fn available() -> (bool, bool, bool) {
    let Ok(connection) = ashpd::zbus::Connection::session().await else {
        return (false, false, false);
    };
    let version = |interface: &'static str| {
        let connection = connection.clone();
        async move {
            let Ok(proxy) = ashpd::zbus::Proxy::new(&connection, "org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop", interface).await else {
                return false;
            };
            proxy.get_property::<u32>("version").await.is_ok()
        }
    };
    (
        version("org.freedesktop.portal.Screenshot").await,
        version("org.freedesktop.portal.GlobalShortcuts").await,
        version("org.freedesktop.portal.RemoteDesktop").await,
    )
}

/// `available()` from sync code, with a bound: a portal that never answers
/// (no xdg-desktop-portal running) must not hang Settings.
pub fn available_blocking(timeout: Duration) -> (bool, bool, bool) {
    run_with_timeout(available(), timeout).unwrap_or((false, false, false))
}

/// Run a future on Tauri's runtime and wait up to `timeout` for it.
fn run_with_timeout<T: Send + 'static>(fut: impl std::future::Future<Output = T> + Send + 'static, timeout: Duration) -> Option<T> {
    let (tx, rx) = mpsc::channel();
    let task = tauri::async_runtime::spawn(async move {
        let _ = tx.send(fut.await);
    });
    match rx.recv_timeout(timeout) {
        Ok(value) => Some(value),
        Err(_) => {
            task.abort();
            None
        }
    }
}

// ---- Screenshot -------------------------------------------------------------

/// One frame of the whole screen, non-interactive, as the path the portal
/// wrote the PNG to.
pub async fn screenshot() -> Result<PathBuf, String> {
    let request = Screenshot::request()
        .interactive(false)
        .modal(false)
        .send()
        .await
        .map_err(|e| format!("portal: {}", e))?;
    let shot = request.response().map_err(|e| format!("portal: {}", e))?;
    let uri = shot.uri().clone();
    uri.to_file_path().map_err(|_| format!("the portal answered with {}, not a file", uri))
}

pub fn screenshot_blocking(timeout: Duration) -> Result<PathBuf, String> {
    run_with_timeout(screenshot(), timeout).unwrap_or_else(|| Err("the screenshot portal did not answer in time".to_string()))
}

// ---- GlobalShortcuts --------------------------------------------------------

/// A chord as the app writes it ("ctrl+alt+space") in the portal's own
/// spelling ("CTRL+ALT+space"): modifiers upper-case, the key as an XKB
/// keysym name. Pure, tested.
pub fn portal_trigger(combo: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    for part in combo.split('+').map(str::trim).filter(|p| !p.is_empty()) {
        let lower = part.to_ascii_lowercase();
        let word = match lower.as_str() {
            "ctrl" | "control" | "commandorcontrol" => "CTRL".to_string(),
            "alt" | "option" => "ALT".to_string(),
            "shift" => "SHIFT".to_string(),
            "super" | "meta" | "cmd" | "command" | "logo" | "win" => "LOGO".to_string(),
            key => key.to_string(),
        };
        out.push(word);
    }
    out.join("+")
}

type ShortcutSession = Session<'static, GlobalShortcuts<'static>>;

struct Bound {
    task: tauri::async_runtime::JoinHandle<()>,
    session: Arc<ShortcutSession>,
}

fn bound() -> &'static Mutex<Option<Bound>> {
    static SLOT: OnceLock<Mutex<Option<Bound>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

/// What a shortcut id does when it fires. `pressed` is false on release,
/// which only Voice Type (hold to talk) cares about.
pub fn dispatch(app: &AppHandle, id: &str, pressed: bool) {
    match id {
        "voice" => {
            let _ = app.emit(crate::quick::VOICE_EVENT, serde_json::json!({ "state": if pressed { "start" } else { "stop" } }));
        }
        "quick" if pressed => crate::quick::toggle(app),
        "selection" if pressed => crate::selection::capture(app),
        "screen" if pressed => {
            let _ = app.emit(SCREEN_EVENT, ());
        }
        _ => {}
    }
}

/// Bind (id, description, chord) triples through the portal, replacing any
/// earlier binding: the old session is closed first, so a chord fires once.
/// Resolves once the desktop has answered the bind request.
pub async fn bind(app: AppHandle, shortcuts: Vec<(String, String, String)>) -> Result<usize, String> {
    if let Some(old) = bound().lock().ok().and_then(|mut slot| slot.take()) {
        old.task.abort();
        let _ = old.session.close().await;
    }
    if shortcuts.is_empty() {
        return Ok(0);
    }
    let portal = GlobalShortcuts::new().await.map_err(|e| format!("no GlobalShortcuts portal: {}", e))?;
    let session = Arc::new(portal.create_session().await.map_err(|e| format!("portal session: {}", e))?);
    let wanted: Vec<NewShortcut> = shortcuts
        .iter()
        .map(|(id, description, combo)| NewShortcut::new(id.clone(), description.clone()).preferred_trigger(Some(portal_trigger(combo).as_str())))
        .collect();
    let request = portal.bind_shortcuts(&session, &wanted, None).await.map_err(|e| format!("bind: {}", e))?;
    let answer = request.response().map_err(|e| format!("bind refused: {}", e))?;
    let count = answer.shortcuts().len();

    let activated = portal.receive_activated().await.map_err(|e| e.to_string())?;
    let deactivated = portal.receive_deactivated().await.map_err(|e| e.to_string())?;
    let handle = app.clone();
    let mut events = futures_util::stream::select(
        activated.map(|a| (a.shortcut_id().to_string(), true)),
        deactivated.map(|d| (d.shortcut_id().to_string(), false)),
    );
    let task = tauri::async_runtime::spawn(async move {
        // `portal` lives as long as the streams do.
        let _keep = portal;
        while let Some((id, pressed)) = events.next().await {
            dispatch(&handle, &id, pressed);
        }
    });
    if let Ok(mut slot) = bound().lock() {
        *slot = Some(Bound { task, session });
    }
    Ok(count)
}

// ---- RemoteDesktop: typing and pointer input on Wayland ----------------------

pub use crate::desktop::Act;

/// X11 keysym for one character (the Unicode keysym range for anything
/// printable), or the named key. Pure, tested.
pub fn keysym_for_char(ch: char) -> i32 {
    match ch {
        '\n' | '\r' => 0xff0d,
        '\t' => 0xff09,
        c if (c as u32) < 0x20 => 0,
        c if (c as u32) < 0x80 => c as i32,
        c => (0x0100_0000u32 | c as u32) as i32,
    }
}

pub fn keysym_for_name(name: &str) -> Option<i32> {
    let lower = name.to_ascii_lowercase();
    let sym = match lower.as_str() {
        "ctrl" | "control" => 0xffe3,
        "alt" => 0xffe9,
        "shift" => 0xffe1,
        "super" | "meta" | "logo" => 0xffeb,
        "enter" | "return" => 0xff0d,
        "tab" => 0xff09,
        "esc" | "escape" => 0xff1b,
        "space" => 0x20,
        "backspace" => 0xff08,
        "delete" | "del" => 0xffff,
        "up" => 0xff52,
        "down" => 0xff54,
        "left" => 0xff51,
        "right" => 0xff53,
        "home" => 0xff50,
        "end" => 0xff57,
        "pageup" | "prior" => 0xff55,
        "pagedown" | "next" => 0xff56,
        "insert" => 0xff63,
        _ => {
            if let Some(n) = lower.strip_prefix('f').and_then(|n| n.parse::<u32>().ok()) {
                if (1..=12).contains(&n) {
                    return Some((0xffbe + n - 1) as i32);
                }
                return None;
            }
            let mut chars = lower.chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) => keysym_for_char(c),
                _ => return None,
            }
        }
    };
    Some(sym)
}

/// evdev button codes the portal takes (linux/input-event-codes.h).
pub fn button_code(button: u8) -> i32 {
    match button {
        2 => 0x112, // BTN_MIDDLE
        3 => 0x111, // BTN_RIGHT
        _ => 0x110, // BTN_LEFT
    }
}

struct Remote {
    proxy: RemoteDesktop<'static>,
    session: Session<'static, RemoteDesktop<'static>>,
    /// The PipeWire node of the shared monitor, for absolute pointer moves.
    stream: Option<u32>,
}

fn token_file() -> Option<PathBuf> {
    crate::linux::dmabuf::mode_file().map(|p| p.with_file_name("remote-desktop-token"))
}

async fn open_remote() -> Result<Remote, String> {
    let proxy = RemoteDesktop::new().await.map_err(|e| format!("no RemoteDesktop portal: {}", e))?;
    let session = proxy.create_session().await.map_err(|e| format!("portal session: {}", e))?;
    let saved = token_file().and_then(|p| std::fs::read_to_string(p).ok()).map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
    proxy
        .select_devices(&session, DeviceType::Keyboard | DeviceType::Pointer, saved.as_deref(), PersistMode::ExplicitlyRevoked)
        .await
        .map_err(|e| format!("select devices: {}", e))?
        .response()
        .map_err(|e| format!("devices refused: {}", e))?;
    // A monitor stream in the same session gives absolute pointer positions;
    // without one, only typing and keys work, which is still worth having.
    if let Ok(cast) = Screencast::new().await {
        let _ = cast
            .select_sources(&session, CursorMode::Embedded, SourceType::Monitor.into(), false, None, PersistMode::DoNot)
            .await;
    }
    let started = proxy
        .start(&session, None)
        .await
        .map_err(|e| format!("start: {}", e))?
        .response()
        .map_err(|e| format!("the desktop did not allow NeuraOS to control it: {}", e))?;
    if let (Some(token), Some(path)) = (started.restore_token(), token_file()) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(path, token);
    }
    let stream = started.streams().and_then(|s| s.first().map(|s| s.pipe_wire_node_id()));
    Ok(Remote { proxy, session, stream })
}

async fn tap(remote: &Remote, keysym: i32) -> Result<(), String> {
    if keysym == 0 {
        return Ok(());
    }
    remote.proxy.notify_keyboard_keysym(&remote.session, keysym, KeyState::Pressed).await.map_err(|e| e.to_string())?;
    remote.proxy.notify_keyboard_keysym(&remote.session, keysym, KeyState::Released).await.map_err(|e| e.to_string())
}

async fn perform(remote: &Remote, act: Act) -> Result<(), String> {
    match act {
        Act::Type(text) => {
            for ch in text.chars() {
                tap(remote, keysym_for_char(ch)).await?;
            }
            Ok(())
        }
        Act::Key(combo) => {
            let syms: Vec<i32> = combo
                .split('+')
                .map(|part| keysym_for_name(part.trim()).ok_or_else(|| format!("{} is not a key this app knows", part)))
                .collect::<Result<_, _>>()?;
            for sym in &syms {
                remote.proxy.notify_keyboard_keysym(&remote.session, *sym, KeyState::Pressed).await.map_err(|e| e.to_string())?;
            }
            for sym in syms.iter().rev() {
                remote.proxy.notify_keyboard_keysym(&remote.session, *sym, KeyState::Released).await.map_err(|e| e.to_string())?;
            }
            Ok(())
        }
        Act::Move { x, y } => {
            let stream = remote.stream.ok_or("the desktop shared no screen, so the pointer cannot be placed (typing and keys still work)")?;
            remote.proxy.notify_pointer_motion_absolute(&remote.session, stream, x, y).await.map_err(|e| e.to_string())
        }
        Act::Click { x, y, button } => {
            let stream = remote.stream.ok_or("the desktop shared no screen, so the pointer cannot be placed (typing and keys still work)")?;
            remote.proxy.notify_pointer_motion_absolute(&remote.session, stream, x, y).await.map_err(|e| e.to_string())?;
            let code = button_code(button);
            remote.proxy.notify_pointer_button(&remote.session, code, KeyState::Pressed).await.map_err(|e| e.to_string())?;
            remote.proxy.notify_pointer_button(&remote.session, code, KeyState::Released).await.map_err(|e| e.to_string())
        }
        Act::Scroll { steps } => remote
            .proxy
            .notify_pointer_axis_discrete(&remote.session, Axis::Vertical, steps)
            .await
            .map_err(|e| e.to_string()),
    }
}

type Reply = mpsc::Sender<Result<(), String>>;
type Requests = mpsc::Sender<(Act, Reply)>;

fn worker() -> &'static Mutex<Option<Requests>> {
    static SLOT: OnceLock<Mutex<Option<Requests>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

/// Do one thing on the desktop through the portal. The first call opens the
/// session (the desktop asks the person); later calls reuse it. The work
/// runs on a thread of its own so a portal that waits on a dialog never
/// blocks the app's runtime.
pub fn act(action: Act) -> Result<(), String> {
    let sender = {
        let mut slot = worker().lock().map_err(|_| "the desktop worker is busy".to_string())?;
        if slot.is_none() {
            let (tx, rx) = mpsc::channel::<(Act, Reply)>();
            std::thread::Builder::new()
                .name("neuraos-remote-desktop".into())
                .spawn(move || {
                    tauri::async_runtime::block_on(async move {
                        let mut remote: Option<Remote> = None;
                        for (act, reply) in rx {
                            if remote.is_none() {
                                match open_remote().await {
                                    Ok(opened) => remote = Some(opened),
                                    Err(e) => {
                                        let _ = reply.send(Err(e));
                                        continue;
                                    }
                                }
                            }
                            let result = match remote.as_ref() {
                                Some(r) => perform(r, act).await,
                                None => Err("no session".to_string()),
                            };
                            // A session the desktop closed is dropped so the
                            // next request asks again instead of failing forever.
                            if result.is_err() {
                                remote = None;
                            }
                            let _ = reply.send(result);
                        }
                    });
                })
                .map_err(|e| format!("cannot start the desktop worker: {}", e))?;
            *slot = Some(tx);
        }
        slot.clone().ok_or("no desktop worker")?
    };
    let (reply_tx, reply_rx) = mpsc::channel();
    sender.send((action, reply_tx)).map_err(|_| "the desktop worker has stopped".to_string())?;
    reply_rx
        .recv_timeout(Duration::from_secs(120))
        .map_err(|_| "the desktop did not answer (a permission dialog may be waiting)".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chords_are_spelled_the_portals_way() {
        assert_eq!(portal_trigger("ctrl+alt+space"), "CTRL+ALT+space");
        assert_eq!(portal_trigger("Alt+Shift+Space"), "ALT+SHIFT+space");
        assert_eq!(portal_trigger("super+v"), "LOGO+v");
        assert_eq!(portal_trigger("CommandOrControl+Alt+S"), "CTRL+ALT+s");
        assert_eq!(portal_trigger(""), "");
    }

    #[test]
    fn characters_become_keysyms() {
        assert_eq!(keysym_for_char('a'), 0x61);
        assert_eq!(keysym_for_char(' '), 0x20);
        assert_eq!(keysym_for_char('\n'), 0xff0d);
        assert_eq!(keysym_for_char('\t'), 0xff09);
        assert_eq!(keysym_for_char('é'), 0x0100_00e9);
        assert_eq!(keysym_for_char('日'), (0x0100_0000u32 | 0x65e5) as i32);
        assert_eq!(keysym_for_char('\u{7}'), 0, "a control character is skipped");
    }

    #[test]
    fn named_keys_and_combos_resolve() {
        assert_eq!(keysym_for_name("ctrl"), Some(0xffe3));
        assert_eq!(keysym_for_name("Return"), Some(0xff0d));
        assert_eq!(keysym_for_name("F5"), Some(0xffc2));
        assert_eq!(keysym_for_name("f13"), None);
        assert_eq!(keysym_for_name("s"), Some(0x73));
        assert_eq!(keysym_for_name("nope"), None);
        assert_eq!(button_code(1), 0x110);
        assert_eq!(button_code(3), 0x111);
    }
}
