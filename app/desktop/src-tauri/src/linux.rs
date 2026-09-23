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

pub mod path_env {
    //! A GUI-launched process on Linux inherits the PATH the display manager
    //! gave the session -- `/usr/bin` and friends, none of what `.profile`
    //! or `.bashrc` adds (`~/.local/bin`, nvm, pyenv, cargo). Every "not
    //! found" bug the Windows build never sees comes from that. The fix
    //! everyone converges on (tauri-apps/fix-path-env-rs): ask the user's
    //! login shell for its PATH once, at startup, and adopt it for this
    //! process, so every later lookup and spawn sees what a terminal sees.
    use std::process::Command;

    /// The shell that owns the user's PATH lines: `$SHELL`, else bash.
    fn shell() -> String {
        std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/bash".to_string())
    }

    /// The login shell's PATH, or None if it could not be asked.
    fn login_path() -> Option<String> {
        let out = Command::new(shell()).arg("-lc").arg("echo -n \"$PATH\"").output().ok()?;
        if !out.status.success() {
            return None;
        }
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    /// The PATH to run with: the login shell's entries first, then any the
    /// current PATH had that the shell did not, so nothing is lost. Pure,
    /// so it is tested without a shell.
    pub fn merged(login: &str, current: &str) -> String {
        let mut seen: Vec<&str> = Vec::new();
        for entry in login.split(':').chain(current.split(':')) {
            if !entry.is_empty() && !seen.contains(&entry) {
                seen.push(entry);
            }
        }
        seen.join(":")
    }

    /// Adopt the login shell's PATH. Called once, before Tauri starts, so
    /// nothing that reads PATH runs before it. Silent when the shell can't
    /// answer: the session's PATH stands, as it always did.
    pub fn fix() {
        let Some(login) = login_path() else {
            return;
        };
        let current = std::env::var("PATH").unwrap_or_default();
        let merged = merged(&login, &current);
        if merged != current {
            std::env::set_var("PATH", merged);
        }
    }

    #[cfg(test)]
    mod tests {
        use super::merged;

        #[test]
        fn the_login_path_comes_first_and_nothing_is_dropped() {
            let got = merged("/home/t/.local/bin:/usr/bin", "/usr/bin:/opt/only-here");
            assert_eq!(got, "/home/t/.local/bin:/usr/bin:/opt/only-here");
        }

        #[test]
        fn empty_entries_and_duplicates_are_dropped() {
            assert_eq!(merged("/a::/a", ":/a:/b:"), "/a:/b");
        }
    }
}

pub mod dbus {
    //! tauri-plugin-single-instance talks over the session D-Bus on Linux
    //! and panics when there is none (a bare Xvfb, a TTY-launched AppImage,
    //! some SSH -X sessions). One process instead of one crash: check that
    //! a session bus is at least plausible before registering the plugin.
    use std::path::Path;

    /// Pure check over the two ways a session bus announces itself, so
    /// it is tested without touching the environment.
    pub fn plausible(address: Option<&str>, runtime_dir: Option<&str>) -> bool {
        if address.map(|a| !a.trim().is_empty()).unwrap_or(false) {
            return true;
        }
        runtime_dir
            .map(|dir| Path::new(dir).join("bus").exists())
            .unwrap_or(false)
    }

    pub fn session_reachable() -> bool {
        let address = std::env::var("DBUS_SESSION_BUS_ADDRESS").ok();
        let runtime = std::env::var("XDG_RUNTIME_DIR").ok();
        plausible(address.as_deref(), runtime.as_deref())
    }

    #[cfg(test)]
    mod tests {
        use super::plausible;

        #[test]
        fn an_address_is_enough() {
            assert!(plausible(Some("unix:path=/run/user/1000/bus"), None));
        }

        #[test]
        fn nothing_means_no_bus() {
            assert!(!plausible(None, None));
            assert!(!plausible(Some(""), Some("/definitely/not/a/dir")));
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

    /// Folders a locally installed model server (llama-server, whisper-cli,
    /// sd-server, ollama) usually lands in on Linux, but which a
    /// GUI-launched process's PATH usually does not carry: `~/.local/bin`
    /// only joins PATH from `.profile`, and an unzipped llama.cpp release is
    /// most often left in `~/llama.cpp` or `/opt/llama.cpp` and run from
    /// its `build/bin` directly (the `.so` files sit beside the binary).
    /// The plain PATH lookup comes first everywhere this is used; this only
    /// adds the places that lookup never sees.
    pub fn extra_bin_dirs(home: Option<&std::path::Path>) -> Vec<PathBuf> {
        let mut out = Vec::new();
        if let Some(home) = home {
            out.push(home.join(".local").join("bin"));
            out.push(home.join("bin"));
            out.push(home.join("llama.cpp").join("build").join("bin"));
            out.push(home.join("llama.cpp"));
            out.push(home.join("whisper.cpp").join("build").join("bin"));
            out.push(home.join("stable-diffusion.cpp").join("build").join("bin"));
        }
        out.push(PathBuf::from("/usr/local/bin"));
        out.push(PathBuf::from("/opt/llama.cpp/build/bin"));
        out.push(PathBuf::from("/opt/llama.cpp/bin"));
        out.push(PathBuf::from("/opt/llama.cpp"));
        out.push(PathBuf::from("/usr/local/lib/ollama"));
        out
    }

    /// `extra_bin_dirs` for this user, looking for one file name: the first
    /// directory that actually holds it.
    pub fn find_in_extra_bin_dirs(name: &str) -> Option<PathBuf> {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        extra_bin_dirs(home.as_deref())
            .into_iter()
            .map(|dir| dir.join(name))
            .find(|candidate| candidate.is_file())
    }

    /// The shared libraries a prebuilt llama.cpp / whisper.cpp / sd.cpp
    /// binary is linked against with `$ORIGIN` as its rpath: every
    /// `lib*.so*` next to it. Copying the binary anywhere without them
    /// gives "error while loading shared libraries: libllama.so", so a copy
    /// takes these along.
    pub fn sibling_shared_libs(binary: &std::path::Path) -> Vec<PathBuf> {
        let Some(dir) = binary.parent() else {
            return Vec::new();
        };
        let Ok(entries) = std::fs::read_dir(dir) else {
            return Vec::new();
        };
        let mut libs: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_file() && is_shared_lib_name(&p.file_name().unwrap_or_default().to_string_lossy()))
            .collect();
        libs.sort();
        libs
    }

    /// `libggml.so`, `libllama.so.0`, `libwhisper.so.1.7.5` -- but not
    /// `README.md`, `llama-server` or `libfoo.a`.
    pub fn is_shared_lib_name(name: &str) -> bool {
        name.starts_with("lib") && (name.ends_with(".so") || name.contains(".so."))
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

        #[test]
        fn extra_bin_dirs_cover_local_bin_and_an_unzipped_llama_cpp() {
            let out = extra_bin_dirs(Some(std::path::Path::new("/home/tester")));
            assert!(out.contains(&PathBuf::from("/home/tester/.local/bin")));
            assert!(out.contains(&PathBuf::from("/home/tester/llama.cpp/build/bin")));
            assert!(out.contains(&PathBuf::from("/usr/local/bin")));
            // And without a home the system-wide ones are still offered.
            assert!(extra_bin_dirs(None).contains(&PathBuf::from("/usr/local/bin")));
        }

        #[test]
        fn shared_lib_names_are_lib_dot_so_with_or_without_a_version() {
            assert!(is_shared_lib_name("libllama.so"));
            assert!(is_shared_lib_name("libggml-vulkan.so"));
            assert!(is_shared_lib_name("libwhisper.so.1.7.5"));
            assert!(!is_shared_lib_name("llama-server"));
            assert!(!is_shared_lib_name("libfoo.a"));
            assert!(!is_shared_lib_name("README.md"));
            assert!(!is_shared_lib_name("some.json"));
        }

        #[test]
        fn sibling_shared_libs_finds_the_so_files_beside_a_binary() {
            let dir = std::env::temp_dir().join(format!("neuraos-libs-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            for name in ["llama-server", "libllama.so", "libggml.so.0", "LICENSE"] {
                std::fs::write(dir.join(name), b"x").unwrap();
            }
            let libs = sibling_shared_libs(&dir.join("llama-server"));
            let names: Vec<String> = libs
                .iter()
                .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
                .collect();
            assert_eq!(names, vec!["libggml.so.0", "libllama.so"]);
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
}
