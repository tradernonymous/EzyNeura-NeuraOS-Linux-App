// One-click runtimes (docs/MASTER_PLAN.md L3/L4): the things a local
// NeuraOS needs that Mint's apt does not carry new enough or at all --
// Node 24 for the bundled engine, and a llama.cpp build for local models
// -- fetched from their official release channels into the app's own data
// folder. No sudo, no apt, nothing outside `~/.local/share`.
//
// What is and is not verified, said plainly on every result:
//   * Node: nodejs.org publishes SHASUMS256.txt per version; the tarball
//     is checked against it and refused on a mismatch.
//   * llama.cpp: GitHub releases publish no digest, so the download is
//     TLS-authenticated only; the sha256 we computed is recorded beside the
//     install so a later run can tell whether the file changed, and the
//     result says `verified: false` rather than pretending.
//
// Extraction shells out to the system's `tar` and `unzip` (both on every
// Mint) instead of adding archive crates to the build.
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use tauri::{Emitter, Manager};

pub const NODE_DIST: &str = "https://nodejs.org/dist/latest-v24.x/";
pub const LLAMA_LATEST_API: &str = "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest";
pub const PROGRESS_EVENT: &str = "runtime-download";

/// Where the managed runtimes live: `<app data>/runtimes`. Set once in
/// setup so engine.rs can ask for the managed node without an AppHandle.
static DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn init(app: &tauri::AppHandle) {
    if let Ok(data) = app.path().app_data_dir() {
        let _ = DIR.set(data.join("runtimes"));
    }
}

fn dir() -> Result<PathBuf, String> {
    let dir = DIR.get().cloned().ok_or("the runtimes folder is not known yet")?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {}", dir.display(), e))?;
    Ok(dir)
}

/// The Node this app installed, if any: `<runtimes>/node/bin/node`.
pub fn managed_node() -> Option<PathBuf> {
    let node = DIR.get()?.join("node").join("bin").join("node");
    node.is_file().then_some(node)
}

// ---- pure helpers, unit-tested ------------------------------------------

/// The line of a SHASUMS256.txt that names the Linux x64 tarball:
/// `(sha256, file name)`.
pub fn node_tarball_from_shasums(shasums: &str) -> Option<(String, String)> {
    shasums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let sha = parts.next()?;
        let name = parts.next()?;
        (name.ends_with("-linux-x64.tar.xz") && sha.len() == 64).then(|| (sha.to_string(), name.to_string()))
    })
}

/// `node-v24.9.0-linux-x64.tar.xz` -> `node-v24.9.0-linux-x64` (the folder
/// the tarball unpacks to).
pub fn node_dir_name(tarball: &str) -> String {
    tarball.trim_end_matches(".tar.xz").to_string()
}

/// Which llama.cpp release asset to take. The Vulkan build is the GPU route
/// for every vendor; the plain build is the CPU one. Matched by substring
/// so a rename of the prefix does not break it.
pub fn pick_llama_asset(names: &[String], vulkan: bool) -> Option<&String> {
    let want = if vulkan { "ubuntu-vulkan-x64" } else { "ubuntu-x64" };
    names.iter().find(|n| n.contains(want) && n.ends_with(".zip") && !n.contains("cuda"))
}

// ---- download with progress ----------------------------------------------

#[derive(serde::Serialize, Clone)]
struct Progress {
    kind: String,
    phase: String,
    received: u64,
    total: u64,
    done: bool,
    error: String,
}

fn emit(app: &tauri::AppHandle, kind: &str, phase: &str, received: u64, total: u64, done: bool, error: &str) {
    let _ = app.emit(PROGRESS_EVENT, Progress {
        kind: kind.to_string(),
        phase: phase.to_string(),
        received,
        total,
        done,
        error: error.to_string(),
    });
}

/// Stream `url` into `dest`, hashing as it goes. Returns the sha256.
async fn download(app: &tauri::AppHandle, kind: &str, url: &str, dest: &Path, extra_hosts: &[String]) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Write;
    let mut response = crate::net::get_following(url, extra_hosts).await?;
    if !response.status().is_success() {
        return Err(format!("download failed with HTTP {}", response.status().as_u16()));
    }
    let total = response.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(dest).map_err(|e| format!("cannot write {}: {}", dest.display(), e))?;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    let mut last = std::time::Instant::now();
    emit(app, kind, "download", 0, total, false, "");
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        hasher.update(&chunk);
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        if last.elapsed().as_millis() > 250 {
            emit(app, kind, "download", received, total, false, "");
            last = std::time::Instant::now();
        }
    }
    emit(app, kind, "download", received, total, false, "");
    Ok(hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect())
}

fn run(cmd: &mut Command) -> Result<(), String> {
    let out = cmd.stdin(Stdio::null()).output().map_err(|e| format!("could not run {:?}: {}", cmd.get_program(), e))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("{:?} failed: {}", cmd.get_program(), String::from_utf8_lossy(&out.stderr).trim()))
    }
}

// ---- Node 24 ---------------------------------------------------------------

async fn install_node(app: &tauri::AppHandle) -> Result<serde_json::Value, String> {
    let kind = "node";
    let hosts = vec!["nodejs.org".to_string()];
    emit(app, kind, "resolve", 0, 0, false, "");
    let shasums_url = format!("{}SHASUMS256.txt", NODE_DIST);
    let response = crate::net::get_following(&shasums_url, &hosts).await?;
    let shasums = response.text().await.map_err(|e| e.to_string())?;
    let (expected, tarball) = node_tarball_from_shasums(&shasums)
        .ok_or("nodejs.org's SHASUMS256.txt names no linux-x64 tarball")?;
    let base = dir()?;
    let archive = base.join(&tarball);
    let digest = download(app, kind, &format!("{}{}", NODE_DIST, tarball), &archive, &hosts).await?;
    if digest != expected {
        let _ = std::fs::remove_file(&archive);
        return Err(format!("sha256 mismatch: downloaded {} but nodejs.org publishes {}", digest, expected));
    }
    emit(app, kind, "extract", 0, 0, false, "");
    let unpacked = base.join(node_dir_name(&tarball));
    let _ = std::fs::remove_dir_all(&unpacked);
    run(Command::new("tar").arg("-xJf").arg(&archive).arg("-C").arg(&base))?;
    let target = base.join("node");
    let _ = std::fs::remove_dir_all(&target);
    std::fs::rename(&unpacked, &target).map_err(|e| format!("could not move {}: {}", unpacked.display(), e))?;
    let _ = std::fs::remove_file(&archive);
    let node = target.join("bin").join("node");
    let version = Command::new(&node).arg("--version").output().ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    emit(app, kind, "done", 0, 0, true, "");
    Ok(serde_json::json!({
        "kind": kind,
        "path": node.display().to_string(),
        "version": version,
        "sha256": digest,
        "verified": true,
    }))
}

// ---- llama.cpp -------------------------------------------------------------

async fn install_llama(app: &tauri::AppHandle, vulkan: bool) -> Result<serde_json::Value, String> {
    let kind = if vulkan { "llama-vulkan" } else { "llama-cpu" };
    emit(app, kind, "resolve", 0, 0, false, "");
    let response = crate::net::get_following(LLAMA_LATEST_API, &[]).await?;
    let body = response.text().await.map_err(|e| e.to_string())?;
    let release: serde_json::Value = serde_json::from_str(&body).map_err(|e| format!("GitHub answered something that is not JSON: {}", e))?;
    let tag = release["tag_name"].as_str().unwrap_or("").to_string();
    let assets: Vec<(String, String)> = release["assets"].as_array().map(|list| {
        list.iter().filter_map(|a| {
            Some((a["name"].as_str()?.to_string(), a["browser_download_url"].as_str()?.to_string()))
        }).collect()
    }).unwrap_or_default();
    let names: Vec<String> = assets.iter().map(|(n, _)| n.clone()).collect();
    let picked = pick_llama_asset(&names, vulkan)
        .ok_or_else(|| format!("release {} has no {} Linux build among {} assets", tag, if vulkan { "Vulkan" } else { "CPU" }, names.len()))?
        .clone();
    let url = assets.iter().find(|(n, _)| *n == picked).map(|(_, u)| u.clone()).unwrap();
    let base = dir()?;
    let archive = base.join(&picked);
    let digest = download(app, kind, &url, &archive, &[]).await?;
    emit(app, kind, "extract", 0, 0, false, "");
    let extract = base.join("llama-extract");
    let _ = std::fs::remove_dir_all(&extract);
    std::fs::create_dir_all(&extract).map_err(|e| e.to_string())?;
    run(Command::new("unzip").arg("-o").arg("-q").arg(&archive).arg("-d").arg(&extract))?;
    let server = find_file(&extract, "llama-server").ok_or("the zip holds no llama-server")?;
    // Into the folder models.rs looks in first, with the .so files beside it.
    let target = crate::models::llama_dir(app)?;
    let mut copied = 0;
    for entry in std::fs::read_dir(server.parent().unwrap()).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "llama-server" || crate::linux::paths::is_shared_lib_name(&name) {
            std::fs::copy(&path, target.join(&name)).map_err(|e| format!("could not copy {}: {}", name, e))?;
            copied += 1;
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(target.join("llama-server"), std::fs::Permissions::from_mode(0o755));
    }
    let _ = std::fs::remove_dir_all(&extract);
    let _ = std::fs::remove_file(&archive);
    let record = serde_json::json!({ "tag": tag, "asset": picked, "sha256": digest, "vulkan": vulkan, "files": copied });
    let _ = std::fs::write(base.join("llama.json"), record.to_string());
    emit(app, kind, "done", 0, 0, true, "");
    Ok(serde_json::json!({
        "kind": kind,
        "path": target.join("llama-server").display().to_string(),
        "tag": tag,
        "asset": picked,
        "sha256": digest,
        // GitHub publishes no digest for these; TLS is the only check.
        "verified": false,
        "files": copied,
    }))
}

fn find_file(root: &Path, name: &str) -> Option<PathBuf> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).ok()?.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if entry.file_name() == name {
                return Some(path);
            }
        }
    }
    None
}

// ---- commands --------------------------------------------------------------

#[tauri::command]
pub async fn runtime_install(app: tauri::AppHandle, kind: String) -> Result<serde_json::Value, String> {
    let result = match kind.as_str() {
        "node" => install_node(&app).await,
        "llama-vulkan" => install_llama(&app, true).await,
        "llama-cpu" => install_llama(&app, false).await,
        other => Err(format!("{} is not a runtime this app installs", other)),
    };
    if let Err(e) = &result {
        emit(&app, &kind, "error", 0, 0, true, e);
        crate::crash::log(&format!("runtime {}: {}", kind, e));
    }
    result
}

/// What is installed, what the machine has, and what the tools can do.
#[tauri::command]
pub fn runtime_facts(app: tauri::AppHandle) -> serde_json::Value {
    let base = DIR.get().cloned().unwrap_or_default();
    let node = managed_node().map(|p| {
        let version = Command::new(&p).arg("--version").output().ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();
        serde_json::json!({ "path": p.display().to_string(), "version": version })
    });
    let llama = std::fs::read_to_string(base.join("llama.json")).ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .filter(|_| crate::models::llama_dir(&app).map(|d| d.join("llama-server").is_file()).unwrap_or(false));
    #[cfg(target_os = "linux")]
    let gpu = crate::linux::gpu::facts();
    #[cfg(not(target_os = "linux"))]
    let gpu = serde_json::Value::Null;
    let has = |tool: &str| Command::new("sh").arg("-c").arg(format!("command -v {}", tool)).stdout(Stdio::null()).status().map(|s| s.success()).unwrap_or(false);
    serde_json::json!({
        "dir": base.display().to_string(),
        "node": node,
        "llama": llama,
        "gpu": gpu,
        "tools": { "tar": has("tar"), "unzip": has("unzip") },
        "min_node_major": crate::engine::MIN_NODE_MAJOR,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_linux_x64_tarball_is_picked_out_of_shasums() {
        let text = "abc  node-v24.9.0-darwin-arm64.tar.gz\n\
                    0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  node-v24.9.0-linux-x64.tar.xz\n\
                    def  node-v24.9.0-linux-x64.tar.gz\n";
        let (sha, name) = node_tarball_from_shasums(text).unwrap();
        assert_eq!(name, "node-v24.9.0-linux-x64.tar.xz");
        assert_eq!(sha.len(), 64);
        assert_eq!(node_dir_name(&name), "node-v24.9.0-linux-x64");
        assert!(node_tarball_from_shasums("nothing here").is_none());
    }

    #[test]
    fn the_vulkan_and_cpu_assets_are_told_apart() {
        let names: Vec<String> = [
            "llama-b7000-bin-ubuntu-x64.zip",
            "llama-b7000-bin-ubuntu-vulkan-x64.zip",
            "llama-b7000-bin-win-cuda-12.4-x64.zip",
            "llama-b7000-bin-ubuntu-x64.zip.sha256",
        ].iter().map(|s| s.to_string()).collect();
        assert_eq!(pick_llama_asset(&names, true).unwrap(), "llama-b7000-bin-ubuntu-vulkan-x64.zip");
        assert_eq!(pick_llama_asset(&names, false).unwrap(), "llama-b7000-bin-ubuntu-x64.zip");
        assert!(pick_llama_asset(&[], true).is_none());
    }
}
