// The bundled NeuraOS engine (server.js): the same zero-runtime-dependency
// Node server the web and Android apps talk to, run on THIS machine instead
// of Railway (docs/MASTER_PLAN.md section 5, "Local mode"). It has no npm
// dependencies of its own -- only Node's own built-ins -- so bundling it is
// just its files (see `bundle.resources` in tauri.conf.json, and
// `engine/` next to this crate); running it needs a Node this machine
// already has, found on PATH, because shipping a whole Node runtime is a
// separate, later step (docs/BACKLOG.md).
//
// Loopback only, like every other local server this app starts
// (models.rs, sd.rs, ollama.rs): the port is picked by the OS, bound to
// 127.0.0.1, and never exposed to the network.
use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Manager;

/// The engine's own package.json says `"node": ">=24"`; this is the same
/// number so the two can never quietly disagree about what "new enough"
/// means.
pub const MIN_NODE_MAJOR: u32 = 24;

struct Run {
    child: Child,
    port: u16,
}

fn slot() -> &'static Mutex<Option<Run>> {
    static RUN: OnceLock<Mutex<Option<Run>>> = OnceLock::new();
    RUN.get_or_init(|| Mutex::new(None))
}

/// Stop the engine, if one is running. Called by `engine_stop` and on app
/// exit (main.rs, next to models::shutdown and sd::shutdown) -- a local
/// engine left running after the window closes is a process the user
/// cannot see and did not ask for, the same reasoning every other local
/// server here follows.
pub fn shutdown() {
    let mut guard = match slot().lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(mut run) = guard.take() {
        #[cfg(unix)]
        {
            let group = format!("-{}", run.child.id());
            let _ = Command::new("kill").args(["-TERM", &group]).status();
        }
        let _ = run.child.kill();
        let _ = run.child.wait();
    }
}

/// Parse `node --version`'s `v24.2.0` into `24`. `None` for anything that
/// is not that shape, which is also what a missing `node` looks like once
/// the command itself fails to run.
fn node_major(version_output: &str) -> Option<u32> {
    version_output.trim().trim_start_matches('v').split('.').next()?.parse().ok()
}

/// Runs `<program> --version` and parses a Node-shaped answer, or `None`
/// for anything that does not run or does not look like one (a program by
/// that name that answers, but isn't node, is not silently accepted).
fn probe_node(mut command: Command) -> Option<u32> {
    let out = command.arg("--version").output().ok()?;
    if !out.status.success() {
        return None;
    }
    node_major(&String::from_utf8_lossy(&out.stdout))
}

/// `~/.nvm/versions/node/v22.4.0/bin/node`-shaped paths, newest version
/// first: the same layout nvm has used for years, checked directly because
/// a GUI-launched process's PATH usually has none of nvm's shell-rc
/// additions on it at all (below), and this needs no shell.
fn nvm_candidates() -> Vec<PathBuf> {
    let home = match std::env::var_os("HOME") {
        Some(h) => PathBuf::from(h),
        None => return Vec::new(),
    };
    let versions_dir = home.join(".nvm").join("versions").join("node");
    let versions: Vec<_> = match std::fs::read_dir(&versions_dir) {
        Ok(entries) => entries.filter_map(|e| e.ok()).map(|e| e.path()).collect(),
        Err(_) => return Vec::new(),
    };
    newest_first(versions).into_iter().map(|v| v.join("bin").join("node")).filter(|p| p.is_file()).collect()
}

/// Sorts `vMAJOR.MINOR.PATCH`-named paths newest first, numerically: a
/// plain string sort already orders "v9.0.0" after "v10.0.0". Pulled out
/// of `nvm_candidates()` so it is tested without touching the filesystem.
fn newest_first(mut versions: Vec<PathBuf>) -> Vec<PathBuf> {
    versions.sort_by_key(|p| {
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let parts: Vec<u32> = name.trim_start_matches('v').split('.').filter_map(|s| s.parse().ok()).collect();
        std::cmp::Reverse((
            parts.first().copied().unwrap_or(0),
            parts.get(1).copied().unwrap_or(0),
            parts.get(2).copied().unwrap_or(0),
        ))
    });
    versions
}

/// Where a working `node` was found -- not just its version, but *how* to
/// run it, so a later spawn resolves it the identical way rather than
/// re-trying a plain PATH lookup that already failed once.
pub enum NodeLocation {
    /// Runnable directly: the plain PATH, or an nvm path found by walking
    /// its directory layout.
    Direct(PathBuf),
    /// Only reachable by re-entering a login shell (a `.profile`-based
    /// version manager whose PATH line the plain PATH lookup never saw).
    ViaLoginShell,
}

impl NodeLocation {
    fn display(&self) -> String {
        match self {
            NodeLocation::Direct(p) => p.display().to_string(),
            NodeLocation::ViaLoginShell => "node (via login shell)".to_string(),
        }
    }

    /// A `Command` that runs `node <args>` the same way this location was
    /// found to work, with `dir` as its working directory.
    fn command(&self, args: &[&str], dir: &std::path::Path) -> Command {
        match self {
            NodeLocation::Direct(node) => {
                let mut cmd = Command::new(node);
                cmd.args(args).current_dir(dir);
                cmd
            }
            #[cfg(unix)]
            NodeLocation::ViaLoginShell => {
                let mut cmd = Command::new(crate::local::login_shell());
                // `cd` first: the login shell is a new process with its own
                // idea of "here", so `.current_dir()` on the Command would
                // set the shell's cwd, not necessarily what a profile script
                // leaves it at, and node needs to be started from `dir` to
                // find `server.js` by its bare relative name.
                let line = format!("cd {} && node {}", shell_quote(dir), args.join(" "));
                cmd.arg("-lc").arg(line);
                cmd
            }
            #[cfg(not(unix))]
            NodeLocation::ViaLoginShell => unreachable!("Windows never returns ViaLoginShell"),
        }
    }
}

#[cfg(unix)]
fn shell_quote(path: &std::path::Path) -> String {
    format!("'{}'", path.display().to_string().replace('\'', r"'\''"))
}

/// A `node` new enough to run the bundled engine, wherever it actually is.
///
/// A GUI-launched process's PATH is whatever the desktop session set at
/// login, which on Linux is usually just `/usr/bin` and friends -- none of
/// nvm's, fnm's or pyenv's per-shell PATH lines, which live in `.bashrc`
/// and only take effect in an interactive terminal. Three tries, in order:
/// the plain PATH (covers a system package or a version manager that does
/// modify the session-wide PATH, e.g. via `/etc/profile.d`), a login shell
/// (covers `.profile`-based setups), then nvm's own well-known directory
/// layout directly (covers the common case where neither shell trick
/// sources `.bashrc`). The first that answers wins.
pub fn find_node() -> Option<(NodeLocation, u32)> {
    if let Some(major) = probe_node(Command::new("node")) {
        return Some((NodeLocation::Direct(PathBuf::from("node")), major));
    }
    #[cfg(unix)]
    {
        let shell = crate::local::login_shell();
        let mut via_shell = Command::new(&shell);
        via_shell.arg("-lc").arg("node --version");
        if let Some(major) = probe_node(via_shell) {
            return Some((NodeLocation::ViaLoginShell, major));
        }
        for candidate in nvm_candidates() {
            if let Some(major) = probe_node(Command::new(&candidate)) {
                return Some((NodeLocation::Direct(candidate), major));
            }
        }
    }
    None
}

/// Settings' own "is Node available" card: found/not, new enough or not,
/// in one call so the frontend never has to reimplement the version rule.
#[tauri::command]
pub fn engine_find_node() -> serde_json::Value {
    match find_node() {
        Some((loc, major)) if major >= MIN_NODE_MAJOR => serde_json::json!({
            "found": true,
            "ok": true,
            "path": loc.display(),
            "major": major,
        }),
        Some((loc, major)) => serde_json::json!({
            "found": true,
            "ok": false,
            "path": loc.display(),
            "major": major,
            "reason": format!("Node {} is on PATH, but the engine needs {}+.", major, MIN_NODE_MAJOR),
        }),
        None => serde_json::json!({
            "found": false,
            "ok": false,
            "reason": format!("No `node` found. Install Node {}+ (nvm, or your distro's NodeSource repository) to run the engine on this machine.", MIN_NODE_MAJOR),
        }),
    }
}

fn engine_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .resolve("engine", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("could not find the bundled engine: {}", e))?;
    if !dir.join("server.js").is_file() {
        return Err(format!("the bundled engine is missing server.js at {}", dir.display()));
    }
    Ok(dir)
}

/// A free loopback port: bind to port 0, read back what the kernel gave
/// it, then release it before `node` binds the same number. The small
/// race (something else grabs it first) is the same one every "find a
/// free port" trick has; a failed start can simply be retried.
fn free_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    listener.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
}

/// Whether the port is answering TCP connections yet -- not a full
/// `/api/health` round trip (this crate does not add an HTTP client
/// dependency just for this), but for a server this process just spawned
/// itself, "accepts a connection" and "is listening" are the same fact:
/// `server.js` only logs "Serving on port N" from inside the `listen`
/// callback, so nothing accepts a connection before that fires.
fn port_is_up(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(200),
    )
    .is_ok()
}

#[tauri::command]
pub fn engine_status() -> serde_json::Value {
    let guard = match slot().lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    match guard.as_ref() {
        Some(run) => serde_json::json!({
            "running": true,
            "port": run.port,
            "url": format!("http://127.0.0.1:{}", run.port),
        }),
        None => serde_json::json!({ "running": false }),
    }
}

/// Start the bundled engine, or report the one already running. Blocks
/// briefly (an async command, like `mcp_stdio_start`) while it comes up,
/// so the caller does not have to poll separately.
#[tauri::command(async)]
pub fn engine_start(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    {
        let guard = match slot().lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(run) = guard.as_ref() {
            return Ok(serde_json::json!({
                "port": run.port,
                "url": format!("http://127.0.0.1:{}", run.port),
                "already_running": true,
            }));
        }
    }
    let (location, major) = find_node().ok_or_else(|| {
        format!("No `node` found. Install Node {}+ (nvm, or your distro's NodeSource repository) to run the engine on this machine.", MIN_NODE_MAJOR)
    })?;
    if major < MIN_NODE_MAJOR {
        return Err(format!(
            "Node {} is on PATH, but the engine needs {}+. Install a newer Node (nvm, or your distro's NodeSource repository) and try again.",
            major, MIN_NODE_MAJOR
        ));
    }
    let dir = engine_dir(&app)?;
    let port = free_port()?;

    let mut command = location.command(&["server.js"], &dir);
    command
        .env("PORT", port.to_string())
        // Deliberately absent, not defaulted to "1": the bundled engine
        // never runs a command or touches a git repo on this machine
        // unless the person turns Build's workspace on later themselves
        // (docs/MASTER_PLAN.md section 5).
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().map_err(|e| format!("could not start node: {}", e))?;

    let deadline = Instant::now() + Duration::from_secs(10);
    let healthy = loop {
        if port_is_up(port) {
            break true;
        }
        if let Ok(Some(status)) = child.try_wait() {
            let mut stderr = String::new();
            if let Some(mut s) = child.stderr.take() {
                let _ = s.read_to_string(&mut stderr);
            }
            return Err(format!("the engine exited immediately ({}): {}", status, stderr.trim()));
        }
        if Instant::now() >= deadline {
            break false;
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    if !healthy {
        let _ = child.kill();
        let _ = child.wait();
        return Err("the engine did not start listening within 10s".to_string());
    }

    {
        let mut guard = match slot().lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        *guard = Some(Run { child, port });
    }
    Ok(serde_json::json!({
        "port": port,
        "url": format!("http://127.0.0.1:{}", port),
        "already_running": false,
    }))
}

#[tauri::command]
pub fn engine_stop() -> serde_json::Value {
    shutdown();
    serde_json::json!({ "running": false })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_major_reads_the_v_prefixed_version() {
        assert_eq!(node_major("v24.2.0\n"), Some(24));
        assert_eq!(node_major("v8.11.3"), Some(8));
        assert_eq!(node_major("v24"), Some(24));
    }

    #[test]
    fn node_major_rejects_garbage() {
        assert_eq!(node_major(""), None);
        assert_eq!(node_major("not a version"), None);
    }

    #[test]
    fn a_free_port_is_actually_free() {
        let port = free_port().expect("a free port");
        assert!(port > 0);
        assert!(!port_is_up(port), "nothing should be listening on a port just released");
    }

    #[test]
    fn version_dirs_sort_newest_first_numerically() {
        let got = newest_first(vec![
            PathBuf::from("v9.0.0"),
            PathBuf::from("v22.4.0"),
            PathBuf::from("v10.0.0"),
            PathBuf::from("v22.10.0"),
        ]);
        let names: Vec<_> = got.iter().map(|p| p.to_str().unwrap()).collect();
        assert_eq!(names, ["v22.10.0", "v22.4.0", "v10.0.0", "v9.0.0"], "a string sort would put v9 last, not first");
    }

    #[cfg(unix)]
    #[test]
    fn shell_quote_survives_a_single_quote_in_the_path() {
        let quoted = shell_quote(std::path::Path::new("/home/o'brien/app"));
        assert_eq!(quoted, r"'/home/o'\''brien/app'");
    }
}
