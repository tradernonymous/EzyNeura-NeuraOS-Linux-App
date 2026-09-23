// Linux-only shell helpers (docs/MASTER_PLAN.md, section 2 and section 6):
// the WebKitGTK/NVIDIA DMA-BUF guard, and XDG-aware paths in place of
// Windows' LOCALAPPDATA/APPDATA/USERPROFILE. Kept in one file, declared only
// under `#[cfg(target_os = "linux")]` in main.rs, so neither Windows nor
// macOS ever compiles it.

pub mod dmabuf {
    /// WebKitGTK's DMA-BUF renderer fails to allocate GBM buffers on the
    /// NVIDIA proprietary driver, and misbehaves on some Wayland
    /// compositors, leaving the window blank -- the single most common
    /// Tauri-on-Linux bug report. The fix is to fall back to shared-memory
    /// compositing, which this app asks for by setting the variable
    /// WebKitGTK reads at startup.
    ///
    /// This has to run before the first webview is created (main() calls it
    /// first thing, ahead of tauri::Builder), because WebKitGTK only reads
    /// the variable once, at its own startup.
    pub fn apply_guard_if_needed() {
        // An explicit value already in the environment -- including "0",
        // set by someone testing whether their machine still needs this --
        // is never overridden.
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some() {
            return;
        }
        if nvidia_present() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    /// Whether the NVIDIA proprietary driver is loaded. The kernel module
    /// creates this file only when it is; the open-source `nouveau` driver
    /// does not, and does not need the guard.
    pub fn nvidia_present() -> bool {
        std::path::Path::new("/proc/driver/nvidia/version").exists()
    }

    /// `XDG_SESSION_TYPE`, as Diagnostics reports it ("x11", "wayland", or
    /// "unknown" when the desktop does not set it -- some display managers
    /// don't).
    pub fn session_type() -> String {
        std::env::var("XDG_SESSION_TYPE")
            .ok()
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| "unknown".to_string())
    }
}

pub mod webkit {
    /// The installed WebKitGTK version, read the way the package itself is
    /// tracked on a Debian-family system (Mint included): the debian
    /// package's own version, not a library symbol -- there is no
    /// `WEBKIT_MAJOR_VERSION`-style query for `libwebkit2gtk-4.1-0`, and
    /// this is exactly the string Diagnostics needs to match against a bug
    /// report anyway.
    pub fn version() -> Option<String> {
        let out = std::process::Command::new("dpkg-query")
            .args(["-W", "-f=${Version}", "libwebkit2gtk-4.1-0"])
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if text.is_empty() {
            None
        } else {
            Some(format!("WebKitGTK {}", text))
        }
    }
}

pub mod paths {
    use std::ffi::OsString;
    use std::path::PathBuf;

    /// `$XDG_STATE_HOME` (the crash log: state that is neither config nor
    /// user data), falling back to `~/.local/state` the way every other
    /// XDG-aware app on this desktop does.
    pub fn state_dir(app: &str) -> PathBuf {
        resolve(std::env::var_os("XDG_STATE_HOME"), std::env::var_os("HOME"), ".local/state").join(app)
    }

    /// `$XDG_DATA_HOME` (the chat store, downloaded models -- what the
    /// Windows build keeps under `%APPDATA%`/`%LOCALAPPDATA%`).
    pub fn data_dir(app: &str) -> PathBuf {
        resolve(std::env::var_os("XDG_DATA_HOME"), std::env::var_os("HOME"), ".local/share").join(app)
    }

    /// Pure function behind both of the above, so it is unit-tested without
    /// touching the process environment -- `cargo test` runs tests from one
    /// process, and mutating `$HOME` in one would race every other test
    /// that reads it.
    fn resolve(xdg: Option<OsString>, home: Option<OsString>, fallback_under_home: &str) -> PathBuf {
        match xdg.filter(|v| !v.is_empty()) {
            Some(dir) => PathBuf::from(dir),
            None => home
                .map(PathBuf::from)
                .unwrap_or_else(std::env::temp_dir)
                .join(fallback_under_home),
        }
    }

    /// Folders other Linux AI tools keep GGUFs in, mirroring
    /// `models.rs::known_model_dirs()`'s Windows list. Only the ones that
    /// exist are shown, same rule as the Windows list.
    pub fn known_model_dirs(home: Option<&std::path::Path>) -> Vec<PathBuf> {
        let mut out = Vec::new();
        if let Some(home) = home {
            // Hugging Face's own cache, and llama.cpp/Unsloth's use of it --
            // the same paths models.rs already looks for under `$HOME` on
            // Windows via USERPROFILE.
            out.push(home.join(".cache").join("huggingface").join("hub"));
            out.push(home.join(".cache").join("llama.cpp"));
            out.push(home.join(".cache").join("unsloth"));
            out.push(home.join(".unsloth"));
            out.push(home.join("models"));
            // Ollama's own store, whether it was installed for this user or
            // system-wide.
            out.push(home.join(".ollama").join("models"));
            out.push(home.join(".lmstudio").join("models"));
        }
        out.push(PathBuf::from("/usr/share/ollama/.ollama/models"));
        out.push(PathBuf::from("/var/lib/ollama/models"));
        out
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn an_xdg_var_wins_over_the_home_fallback() {
            let got = resolve(
                Some(OsString::from("/custom/state")),
                Some(OsString::from("/home/x")),
                ".local/state",
            );
            assert_eq!(got, PathBuf::from("/custom/state"));
        }

        #[test]
        fn an_empty_xdg_var_falls_back_to_home() {
            let got = resolve(
                Some(OsString::from("")),
                Some(OsString::from("/home/tester")),
                ".local/state",
            );
            assert_eq!(got, PathBuf::from("/home/tester/.local/state"));
        }

        #[test]
        fn no_home_falls_back_to_the_temp_dir() {
            let got = resolve(None, None, ".local/state");
            assert_eq!(got, std::env::temp_dir().join(".local/state"));
        }

        #[test]
        fn known_model_dirs_always_offers_the_system_ollama_paths() {
            let out = known_model_dirs(None);
            assert!(out.contains(&PathBuf::from("/usr/share/ollama/.ollama/models")));
        }

        #[test]
        fn known_model_dirs_adds_the_home_ones_when_a_home_is_given() {
            let out = known_model_dirs(Some(std::path::Path::new("/home/tester")));
            assert!(out.contains(&PathBuf::from("/home/tester/.ollama/models")));
            assert!(out.contains(&PathBuf::from("/home/tester/.cache/huggingface/hub")));
        }
    }
}
