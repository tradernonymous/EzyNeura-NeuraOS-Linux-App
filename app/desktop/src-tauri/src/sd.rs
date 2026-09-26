// Local image generation: stable-diffusion.cpp's `sd-server`, run by this app,
// on this machine, with no account and no network.
//
// This is the image analogue of models.rs, and it copies its rules rather than
// inventing new ones:
//
//   * the binary is the user's. This app ships none and downloads none. They
//     build or download `sd-server` from stable-diffusion.cpp and point the
//     app at it with a native picker; the path is remembered in
//     <app data>/sd/binary.txt. It is run from where it is, never copied,
//     because the DLLs beside it are part of it (the same reason whisper.rs
//     keeps whisper-cli where it found it).
//   * the weights are the user's too. A .safetensors/.ckpt/.gguf the user
//     picked, remembered in <app data>/sd/model.txt. Nothing is fetched.
//   * the server is loopback only. There is no host setting anywhere in this
//     module: the base address is built here as http://127.0.0.1:<port> and
//     nothing a page sends can change the host. sd-server has no api-key of
//     its own, so binding it to 127.0.0.1 is the whole boundary -- which is
//     exactly why the address is not configurable.
//   * stopping is real. The child is killed and reaped by `sd_stop`, and
//     `shutdown()` does the same on app exit, so an image server never
//     outlives the window.
//
// THE API THIS TALKS TO (verified against stable-diffusion.cpp's own
// examples/server/api.md and examples/server/README.md, Sept 2026):
//
//   POST /sdcpp/v1/img_gen      -- submit a job; 202 with {"id", "status",
//                                  "poll_url"}. Body fields used here:
//                                  "prompt", "negative_prompt", "width",
//                                  "height", "seed", "batch_count" and the
//                                  nested "sample_params": {"sample_steps"}.
//                                  Editing a picture is the SAME endpoint --
//                                  sd.cpp serves no edit route of its own --
//                                  with "init_image" (a raw base64 string or a
//                                  data: URL) and "strength", the documented
//                                  image-to-image pair, plus "mask_image" when
//                                  the brush painted one: white may change,
//                                  black stays. sd.cpp reads it as one channel,
//                                  and the brush paints only black and white,
//                                  so every channel says the same thing.
//   GET  /sdcpp/v1/jobs/{id}    -- {"status": queued|generating|completed|
//                                  failed|cancelled, "queue_position", and on
//                                  completion "result": {"output_format",
//                                  "images": [{"index", "b64_json"}]}}.
//   POST /sdcpp/v1/jobs/{id}/cancel -- 200 when it took, 404/410 when the job
//                                  is already gone.
//   GET  /sdcpp/v1/capabilities -- answers once the model is loaded, so it is
//                                  the readiness probe (llama.cpp's /health).
//
// The async job API is the one used, not the OpenAI-shaped
// POST /v1/images/generations the same server also serves, for one reason:
// generation takes minutes, and only the job API can say "queued" vs
// "generating" and be cancelled. A blocking POST could only be abandoned.
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Manager;

/// sd-server's own documented default port (`--listen-port`).
pub const DEFAULT_PORT: u16 = 1234;
/// Where the user gets the binary: the release page, not an asset URL.
pub const RELEASES_URL: &str = "https://github.com/leejet/stable-diffusion.cpp/releases/latest";
/// Where a person finds weights sd.cpp can load.
pub const MODELS_URL: &str = "https://huggingface.co/models?library=gguf&other=stable-diffusion";
/// Loading a diffusion model off a cold disk is slow, but not endless.
pub const START_TIMEOUT_SECS: u64 = 300;
/// The longest source picture an edit may carry, in characters of base64.
/// Roughly 18 MB of image: enough for anything a person edits by hand, and a
/// ceiling so a page cannot hand this process an unbounded string.
const MAX_INIT_IMAGE_CHARS: usize = 24 * 1024 * 1024;
/// The file extensions sd.cpp loads as a model.
const MODEL_EXTENSIONS: [&str; 4] = ["safetensors", "ckpt", "gguf", "sft"];

fn binary_name() -> &'static str {
    if cfg!(windows) {
        "sd-server.exe"
    } else {
        "sd-server"
    }
}

struct Run {
    child: Child,
    binary: String,
    model: String,
    port: u16,
    started: Instant,
    /// Said once the server is up, from its own log: empty unless this card
    /// is known to draw a large model wrong.
    warning: String,
}

fn slot() -> &'static Mutex<Option<Run>> {
    static RUN: OnceLock<Mutex<Option<Run>>> = OnceLock::new();
    RUN.get_or_init(|| Mutex::new(None))
}

/// Kill whatever is running. `sd_stop` calls it, and so does app exit: an
/// image server left behind is a process the user cannot see and did not
/// ask for.
pub fn shutdown() {
    let mut guard = match slot().lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(mut run) = guard.take() {
        let _ = run.child.kill();
        let _ = run.child.wait();
    }
}

fn sd_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {}", e))?
        .join("sd");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {}", dir.display(), e))?;
    Ok(dir)
}

/// Where LoRAs live: <app data>/sd-loras, handed to sd-server as
/// --lora-model-dir. A job names a LoRA by its file name in here, because
/// sd-server takes "a relative path under the configured LoRA directory" and
/// never parses <lora:...> tags from a prompt (examples/server/api.md).
pub fn loras_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {}", e))?
        .join("sd-loras");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {}", dir.display(), e))?;
    Ok(dir)
}

/// A LoRA the page named, checked: a bare file name (no folder, no "..")
/// with a weights extension, that exists in `dir`. The multiplier is kept
/// to the range sd.cpp users actually work in.
pub fn valid_lora(dir: &Path, name: &str, multiplier: f64) -> Result<(String, f64), String> {
    let name = name.trim();
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.starts_with('.') {
        return Err(format!("{} is not a LoRA file name", name));
    }
    if !is_model_name(name) {
        return Err(format!("{} is not a .safetensors or .gguf LoRA", name));
    }
    if !dir.join(name).is_file() {
        return Err(format!("The LoRA {} is not in the LoRA folder any more.", name));
    }
    let multiplier = if multiplier.is_finite() { multiplier.clamp(-2.0, 2.0) } else { 1.0 };
    Ok((name.to_string(), multiplier))
}

/// The `lora` field of a job: [{path, multiplier}], absent when there are none.
pub fn with_loras(mut body: serde_json::Value, loras: &[(String, f64)]) -> serde_json::Value {
    if !loras.is_empty() {
        body["lora"] = serde_json::Value::Array(
            loras
                .iter()
                .map(|(path, multiplier)| serde_json::json!({ "path": path, "multiplier": multiplier }))
                .collect(),
        );
    }
    body
}

#[derive(serde::Serialize)]
pub struct SdLora {
    pub name: String,
    pub bytes: u64,
}

/// The LoRAs in the LoRA folder, by name.
#[tauri::command(async)]
pub fn sd_loras(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let dir = loras_dir(&app)?;
    let mut out: Vec<SdLora> = std::fs::read_dir(&dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| e.path().is_file())
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    is_model_name(&name).then(|| SdLora { name, bytes: e.metadata().map(|m| m.len()).unwrap_or(0) })
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by_key(|a| a.name.to_lowercase());
    Ok(serde_json::json!({ "dir": dir.display().to_string(), "loras": out }))
}

/// Move LoRA files the person picks into the LoRA folder (a rename on the
/// same disk is instant; across disks it copies, then removes the original).
#[tauri::command(async)]
pub fn sd_import_loras(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let dir = loras_dir(&app)?;
    let picked = rfd::FileDialog::new()
        .set_title("Choose LoRA files (.safetensors or .gguf)")
        .add_filter("LoRA", &["safetensors", "gguf"])
        .pick_files()
        .unwrap_or_default();
    let mut moved = Vec::new();
    for source in picked {
        let name = source.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if !is_model_name(&name) {
            continue;
        }
        let target = dir.join(&name);
        if target.exists() {
            return Err(format!("{} is already in the LoRA folder.", name));
        }
        if std::fs::rename(&source, &target).is_err() {
            std::fs::copy(&source, &target).map_err(|e| format!("could not copy {}: {}", name, e))?;
            let _ = std::fs::remove_file(&source);
        }
        moved.push(name);
    }
    Ok(serde_json::json!({ "moved": moved }))
}

/// Delete one LoRA from the LoRA folder.
#[tauri::command(async)]
pub fn sd_delete_lora(app: tauri::AppHandle, name: String) -> Result<serde_json::Value, String> {
    let dir = loras_dir(&app)?;
    let (name, _) = valid_lora(&dir, &name, 1.0)?;
    let path = dir.join(&name);
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    std::fs::remove_file(&path).map_err(|e| format!("could not delete {}: {}", name, e))?;
    Ok(serde_json::json!({ "name": name, "bytes": bytes }))
}

#[derive(serde::Deserialize)]
pub struct LoraPick {
    pub name: String,
    pub multiplier: Option<f64>,
}

/// Where weights are looked for: <app data>/sd-models.
pub fn models_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {}", e))?
        .join("sd-models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {}", dir.display(), e))?;
    Ok(dir)
}

fn binary_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(sd_dir(app)?.join("binary.txt"))
}

fn model_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(sd_dir(app)?.join("model.txt"))
}

fn remembered(path: Result<PathBuf, String>) -> Option<PathBuf> {
    let file = path.ok()?;
    let saved = std::fs::read_to_string(&file).ok()?;
    let trimmed = saved.trim();
    if trimmed.is_empty() {
        return None;
    }
    let candidate = PathBuf::from(trimmed);
    if candidate.is_file() {
        Some(candidate)
    } else {
        None
    }
}

/// The chosen model: a file, or a folder that still forms a set. Kept apart
/// from `remembered`, which the binary shares and where a folder is never
/// valid.
fn remembered_model(app: &tauri::AppHandle) -> Option<PathBuf> {
    remembered_model_at(model_file(app))
}

fn remembered_model_at(path: Result<PathBuf, String>) -> Option<PathBuf> {
    let file = path.ok()?;
    if let Some(found) = remembered(Ok(file.clone())) {
        return Some(found);
    }
    let saved = std::fs::read_to_string(&file).ok()?;
    let candidate = PathBuf::from(saved.trim());
    if candidate.is_dir() && set_in(&candidate).is_some() {
        Some(candidate)
    } else {
        None
    }
}

/// The saved binary first (the one the user chose), then PATH.
fn find_binary(app: &tauri::AppHandle) -> Option<(PathBuf, &'static str)> {
    if let Some(path) = remembered(binary_file(app)) {
        return Some((path, "saved"));
    }
    if let Some(path) = std::env::var_os("PATH") {
        for entry in std::env::split_paths(&path) {
            let candidate = entry.join(binary_name());
            if candidate.is_file() {
                return Some((candidate, "path"));
            }
        }
    }
    // Linux: `~/.local/bin` and a `~/stable-diffusion.cpp/build/bin` build
    // are not on a GUI-launched process's PATH.
    #[cfg(target_os = "linux")]
    if let Some(found) = crate::linux::paths::find_in_extra_bin_dirs(binary_name()) {
        return Some((found, "path"));
    }
    None
}

/// A model that is several files (NEURA-073): a diffusion model plus the
/// parts it needs beside it -- a VAE, and a text encoder, which sd-server takes
/// each under its own flag. Krea2, Flux, Qwen-Image and the rest ship this way,
/// and `-m <file>` alone cannot start any of them.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SetParts {
    pub diffusion: PathBuf,
    pub vae: Option<PathBuf>,
    pub llm: Option<PathBuf>,
    /// The text encoder's vision projector (`mmproj-...`). An edit model reads
    /// its reference picture through it; without it sd.cpp disables vision
    /// and the model edits a picture it cannot see.
    pub llm_vision: Option<PathBuf>,
    pub clip_l: Option<PathBuf>,
    pub t5xxl: Option<PathBuf>,
}

/// The role a weight file plays in a set, from its name. Names are the only
/// evidence on disk, and they hold in practice because every published set
/// names its parts this way ("..._vae", "Qwen3VL-4B-Instruct", "t5xxl",
/// "clip_l"). A multimodal projector (`mmproj-...`) is the encoder's vision,
/// which an edit model needs to see the picture it is changing.
fn role_of(name: &str) -> &'static str {
    let lower = name.to_lowercase();
    // FLUX ships its VAE as an autoencoder named for it: `ae.safetensors`
    // (FLUX.1) and `flux2_ae.safetensors` (FLUX.2), with no "vae" in the name.
    let stem = lower.rsplit_once('.').map(|(s, _)| s).unwrap_or(&lower);
    let autoencoder = stem == "ae" || stem.ends_with("_ae") || stem.ends_with("-ae");
    if lower.starts_with("mmproj") || lower.contains(".mmproj") {
        "llm_vision"
    } else if lower.contains("vae") || autoencoder {
        "vae"
    } else if lower.contains("clip_l") {
        "clip_l"
    } else if lower.contains("t5xxl") || lower.contains("umt5") || lower.starts_with("t5") {
        "t5xxl"
    } else if [
        "instruct",
        "text_encoder",
        "textencoder",
        "llm",
        "mistral",
        "gemma",
        "qwen3vl",
        "qwen3-vl",
        "qwen2.5-vl",
        "qwen2_5_vl",
        // FLUX.2 [klein]'s text encoder is a plain Qwen3 (`qwen_3_4b`,
        // `qwen_3_8b`, `Qwen3-8B-...`). A Qwen-Image DIFFUSION model is
        // "qwen-image"/"qwen_image", which none of these match.
        "qwen_3_",
        "qwen3_",
        "qwen3-",
        "qwen3.",
    ]
    .iter()
    .any(|k| lower.contains(k))
    {
        "llm"
    } else {
        "diffusion"
    }
}

/// Sort a folder's weight files into a set. The diffusion model is the
/// largest file no other role claimed; a folder with no diffusion model, or
/// with nothing beside it, is not a set -- a lone checkpoint still starts
/// with `-m` exactly as before.
pub fn set_roles(files: &[(PathBuf, u64)]) -> Option<SetParts> {
    let mut parts = SetParts::default();
    let mut diffusion: Option<(PathBuf, u64)> = None;
    for (path, bytes) in files {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if !is_model_name(&name) || is_fp4(&name) {
            continue;
        }
        match role_of(&name) {
            "vae" => {
                if parts.vae.is_none() {
                    parts.vae = Some(path.clone());
                }
            }
            "clip_l" => {
                if parts.clip_l.is_none() {
                    parts.clip_l = Some(path.clone());
                }
            }
            "t5xxl" => {
                if parts.t5xxl.is_none() {
                    parts.t5xxl = Some(path.clone());
                }
            }
            "llm" => {
                if parts.llm.is_none() {
                    parts.llm = Some(path.clone());
                }
            }
            "llm_vision" => {
                if parts.llm_vision.is_none() {
                    parts.llm_vision = Some(path.clone());
                }
            }
            "diffusion" => {
                let bigger = match &diffusion {
                    Some((_, b)) => *bytes > *b,
                    None => true,
                };
                if bigger {
                    diffusion = Some((path.clone(), *bytes));
                }
            }
            _ => {}
        }
    }
    let (path, _) = diffusion?;
    if parts.vae.is_none() && parts.llm.is_none() && parts.clip_l.is_none() && parts.t5xxl.is_none() {
        return None;
    }
    parts.diffusion = path;
    Some(parts)
}

/// The set a folder holds, if it holds one (not recursive).
pub fn set_in(dir: &Path) -> Option<SetParts> {
    let entries = std::fs::read_dir(dir).ok()?;
    let files: Vec<(PathBuf, u64)> = entries
        .flatten()
        .filter(|e| e.path().is_file())
        .map(|e| (e.path(), e.metadata().map(|m| m.len()).unwrap_or(0)))
        .collect();
    set_roles(&files)
}

/// FP4 weights (NVFP4, `fp4_flux2`) carry per-block scales stable-diffusion.cpp
/// does not read: loading one aborts sd-server (`GGML_ASSERT(scale_nelements
/// == 1 || scale_nelements == out_features)`). A set never uses one, so a folder
/// that also holds the bf16 or fp8 file of the same part picks that instead.
fn is_fp4(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.contains("nvfp4") || lower.contains("mxfp4") || lower.split(|c: char| !c.is_ascii_alphanumeric()).any(|w| w == "fp4")
}

/// Is this a file name sd.cpp would load as a model?
fn is_model_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    MODEL_EXTENSIONS.iter().any(|ext| lower.ends_with(&format!(".{}", ext)))
}

#[derive(serde::Serialize, Clone)]
pub struct SdModel {
    pub name: String,
    pub path: String,
    pub bytes: u64,
}

/// Weights in one folder (not recursive).
fn models_in(dir: &Path, out: &mut Vec<SdModel>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // A folder that forms a set is one model, listed under the
            // folder's name, so choosing it is one click like any other.
            if let Some(parts) = set_in(&path) {
                let shown = path.display().to_string();
                if out.iter().any(|m| m.path == shown) {
                    continue;
                }
                let count = 1 + [&parts.vae, &parts.llm, &parts.llm_vision, &parts.clip_l, &parts.t5xxl]
                    .iter()
                    .filter(|p| p.is_some())
                    .count();
                let bytes: u64 = std::fs::read_dir(&path)
                    .map(|d| d.flatten().filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum())
                    .unwrap_or(0);
                out.push(SdModel {
                    name: format!("{} (set of {} files)", entry.file_name().to_string_lossy(), count),
                    path: shown,
                    bytes,
                });
            }
            continue;
        }
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_model_name(&name) {
            continue;
        }
        let shown = path.display().to_string();
        if out.iter().any(|m| m.path == shown) {
            continue;
        }
        out.push(SdModel {
            name,
            path: shown,
            bytes: entry.metadata().map(|m| m.len()).unwrap_or(0),
        });
    }
}

#[derive(serde::Serialize)]
pub struct SdFacts {
    pub found: bool,
    pub binary: String,
    pub source: String,
    /// The model the user chose, empty when they have not chosen one.
    pub model: String,
    pub models: Vec<SdModel>,
    pub models_dir: String,
    pub expected_name: String,
    pub releases_url: String,
    pub models_url: String,
    pub default_port: u16,
}

#[tauri::command(async)]
pub fn sd_find(app: tauri::AppHandle) -> SdFacts {
    let found = find_binary(&app);
    let dir = models_dir(&app).ok();
    let mut models = Vec::new();
    if let Some(d) = &dir {
        models_in(d, &mut models);
    }
    if let Some((binary, _)) = &found {
        if let Some(parent) = binary.parent() {
            models_in(parent, &mut models);
            models_in(&parent.join("models"), &mut models);
        }
    }
    // The chosen model belongs in the list even when it lives somewhere else.
    // `remembered_model`, not `remembered`: a set is a folder, and `remembered`
    // refuses anything that is not a file.
    if let Some(chosen) = remembered_model(&app) {
        let shown = chosen.display().to_string();
        if !models.iter().any(|m| m.path == shown) {
            models.push(SdModel {
                name: chosen
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| shown.clone()),
                path: shown,
                bytes: std::fs::metadata(&chosen).map(|m| m.len()).unwrap_or(0),
            });
        }
    }
    models.sort_by(|a, b| a.name.cmp(&b.name));
    SdFacts {
        found: found.is_some(),
        binary: found.as_ref().map(|(p, _)| p.display().to_string()).unwrap_or_default(),
        source: found.as_ref().map(|(_, s)| s.to_string()).unwrap_or_default(),
        model: remembered_model(&app).map(|p| p.display().to_string()).unwrap_or_default(),
        models,
        models_dir: dir.map(|d| d.display().to_string()).unwrap_or_default(),
        expected_name: binary_name().to_string(),
        releases_url: RELEASES_URL.to_string(),
        models_url: MODELS_URL.to_string(),
        default_port: DEFAULT_PORT,
    }
}

/// Remember the binary the user pointed at. Refuses anything not named like
/// sd-server, so a mistyped path cannot become what this app runs.
///
/// Not a command: the only way to set it is the native picker below, so the
/// page cannot name a file this app then runs.
fn use_binary(app: &tauri::AppHandle, path: String) -> Result<serde_json::Value, String> {
    let source = PathBuf::from(&path);
    if source.is_dir() {
        if set_in(&source).is_none() {
            return Err(format!(
                "{} is a folder, but not a model set: it needs a diffusion model and at least a VAE or a text encoder beside it.",
                path
            ));
        }
        let file = model_file(app)?;
        std::fs::write(&file, source.display().to_string())
            .map_err(|e| format!("Could not save the path: {}", e))?;
        return Ok(serde_json::json!({ "path": source.display().to_string(), "set": true }));
    }
    if !source.is_file() {
        return Err(format!("No file at {}", path));
    }
    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if name != binary_name().to_lowercase() {
        return Err(format!(
            "That file is {}, not {}. Pick {} from the stable-diffusion.cpp build you downloaded.",
            name,
            binary_name(),
            binary_name()
        ));
    }
    let file = binary_file(app)?;
    std::fs::write(&file, source.display().to_string())
        .map_err(|e| format!("Could not save the path: {}", e))?;
    Ok(serde_json::json!({ "path": source.display().to_string() }))
}

/// The native picker for sd-server. None when the dialog was cancelled.
#[tauri::command(async)]
pub fn sd_pick_binary(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = rfd::FileDialog::new()
        .set_title("Choose sd-server (from the stable-diffusion.cpp build you downloaded)")
        .pick_file()
        .map(|p| p.display().to_string());
    match picked {
        None => Ok(None),
        Some(path) => {
            use_binary(&app, path.clone())?;
            Ok(Some(path))
        }
    }
}

/// Whether `target` may be deleted: a model file or a set folder directly
/// inside `root` (the app's own sd-models), never anything outside it or
/// the folder itself. Canonical paths, so `..` and links cannot reach out.
pub fn deletable_in(root: &Path, target: &Path) -> Result<PathBuf, String> {
    let root = root.canonicalize().map_err(|e| format!("no models folder: {}", e))?;
    let target = target
        .canonicalize()
        .map_err(|_| format!("{} is not there any more", target.display()))?;
    if target.parent() != Some(root.as_path()) {
        return Err("Only a model in this app's own sd-models folder is deleted from here; remove other files yourself.".to_string());
    }
    if target.is_dir() {
        if set_in(&target).is_none() {
            return Err(format!("{} is not a model set", target.display()));
        }
    } else {
        let name = target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if !is_model_name(&name) {
            return Err(format!("{} is not a model file", name));
        }
    }
    Ok(target)
}

/// Delete one image model (a file, or a set's whole folder) from sd-models.
/// Stops the server first when it has that model loaded, and forgets the
/// choice when it was the chosen one.
#[tauri::command(async)]
pub fn sd_delete_model(app: tauri::AppHandle, path: String) -> Result<serde_json::Value, String> {
    let root = models_dir(&app)?;
    let target = deletable_in(&root, Path::new(&path))?;
    let loaded = {
        let guard = match slot().lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        guard
            .as_ref()
            .map(|run| Path::new(&run.model).canonicalize().ok() == Some(target.clone()))
            .unwrap_or(false)
    };
    if loaded {
        shutdown();
    }
    let freed: u64 = if target.is_dir() {
        std::fs::read_dir(&target)
            .map(|d| d.flatten().filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum())
            .unwrap_or(0)
    } else {
        std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0)
    };
    if target.is_dir() {
        std::fs::remove_dir_all(&target)
    } else {
        std::fs::remove_file(&target)
    }
    .map_err(|e| format!("could not delete {}: {}", target.display(), e))?;
    if let Ok(file) = model_file(&app) {
        let chosen = std::fs::read_to_string(&file).unwrap_or_default();
        let chosen = Path::new(chosen.trim());
        if chosen.canonicalize().is_err() || chosen == target {
            let _ = std::fs::write(&file, "");
        }
    }
    Ok(serde_json::json!({ "path": target.display().to_string(), "bytes": freed, "stopped": loaded }))
}

/// Remember the weights the user pointed at.
#[tauri::command(async)]
pub fn sd_use_model(app: tauri::AppHandle, path: String) -> Result<serde_json::Value, String> {
    let source = PathBuf::from(&path);
    // A folder is a model when it forms a set (NEURA-073): the downloader
    // lands FLUX.2 and the like as one folder, and Start passes each part
    // under its own flag. A folder that is not a set is not a model.
    if source.is_dir() {
        if set_in(&source).is_none() {
            return Err(format!(
                "{} is not a model set: it needs a diffusion model with its VAE or text encoder beside it.",
                path
            ));
        }
        let file = model_file(&app)?;
        std::fs::write(&file, source.display().to_string())
            .map_err(|e| format!("Could not save the path: {}", e))?;
        return Ok(serde_json::json!({ "path": source.display().to_string(), "set": true }));
    }
    if !source.is_file() {
        return Err(format!("No file at {}", path));
    }
    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if !is_model_name(&name) {
        return Err(format!(
            "{} is not a model stable-diffusion.cpp loads (.{}).",
            name,
            MODEL_EXTENSIONS.join(", .")
        ));
    }
    let file = model_file(&app)?;
    std::fs::write(&file, source.display().to_string())
        .map_err(|e| format!("Could not save the path: {}", e))?;
    Ok(serde_json::json!({ "path": source.display().to_string() }))
}

/// The native picker for the weights.
#[tauri::command(async)]
pub fn sd_pick_model(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = rfd::FileDialog::new()
        .set_title("Choose a Stable Diffusion model file")
        .add_filter("Model", &MODEL_EXTENSIONS[..])
        .pick_file()
        .map(|p| p.display().to_string());
    match picked {
        None => Ok(None),
        Some(path) => {
            sd_use_model(app, path.clone())?;
            Ok(Some(path))
        }
    }
}

/// The folder a set of files becomes, named after its diffusion part with the
/// format, quant and precision taken off: `flux-2-klein-4b-Q4_K_M.gguf` ->
/// `flux-2-klein-4b`. Only what a folder name can safely be.
pub fn set_folder_name(files: &[(PathBuf, u64)]) -> Option<String> {
    let parts = set_roles(files)?;
    let stem = parts
        .diffusion
        .file_stem()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let lower = stem.to_lowercase();
    let mut cut = lower.len();
    for tail in ["-q", "_q", "-iq", "_iq", "-bf16", "_bf16", "-f16", "_f16", "-fp8", "_fp8", "-fp16", "_fp16"] {
        if let Some(at) = lower.rfind(tail) {
            if at > 0 && at < cut {
                cut = at;
            }
        }
    }
    let name: String = stem[..cut]
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let name = name.trim_matches('.').trim_matches('_').to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// Move one file, across disks when `rename` cannot (a download on another
/// drive): copy then remove, so a failed copy leaves the source where it was.
fn move_file(from: &Path, to: &Path) -> Result<(), String> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    std::fs::copy(from, to).map_err(|e| format!("Could not copy {} into place: {}", from.display(), e))?;
    std::fs::remove_file(from).map_err(|e| format!("Copied, but could not remove {}: {}", from.display(), e))?;
    Ok(())
}

/// Pick the files of a set (a diffusion model with its VAE and text encoder)
/// and move them into one folder under sd-models, which becomes the model.
/// The files are the user's own, chosen in the native picker; nothing is
/// fetched, and a set that does not form one is refused before anything moves.
#[tauri::command(async)]
pub fn sd_import_set(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let picked = rfd::FileDialog::new()
        .set_title("Choose the files of one model set (diffusion model, VAE, text encoder)")
        .add_filter("Model files", &MODEL_EXTENSIONS[..])
        .pick_files();
    let Some(paths) = picked else {
        return Ok(None);
    };
    let files: Vec<(PathBuf, u64)> = paths
        .iter()
        .filter(|p| p.is_file())
        .map(|p| (p.clone(), std::fs::metadata(p).map(|m| m.len()).unwrap_or(0)))
        .collect();
    let folder = set_folder_name(&files).ok_or_else(|| {
        "Those files do not form a set: pick the diffusion model together with its VAE and text encoder (for FLUX.2: the model, flux2_ae.safetensors and qwen_3_4b.safetensors).".to_string()
    })?;
    let dir = models_dir(&app)?.join(&folder);
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {}", dir.display(), e))?;
    let mut moved = Vec::new();
    for (from, _) in &files {
        let name = from.file_name().ok_or_else(|| format!("{} has no name", from.display()))?;
        let to = dir.join(name);
        if to == *from {
            continue;
        }
        if to.exists() {
            return Err(format!("{} is already in {}.", name.to_string_lossy(), dir.display()));
        }
        move_file(from, &to)?;
        moved.push(name.to_string_lossy().to_string());
    }
    if set_in(&dir).is_none() {
        return Err(format!("{} does not form a set after the move.", dir.display()));
    }
    let file = model_file(&app)?;
    std::fs::write(&file, dir.display().to_string())
        .map_err(|e| format!("Could not save the path: {}", e))?;
    Ok(Some(serde_json::json!({ "path": dir.display().to_string(), "folder": folder, "moved": moved })))
}

/// A port this app will bind sd-server to. Never a privileged one, never 0:
/// the address is built here, so the port is the only part a page can steer
/// and it is bounded.
pub fn valid_port(port: Option<u16>) -> Result<u16, String> {
    let port = port.unwrap_or(DEFAULT_PORT);
    if port < 1024 {
        return Err(format!("{} is not a port this app will use", port));
    }
    Ok(port)
}

/// The only address this module ever talks to. There is no host argument
/// anywhere: a local image server is for this machine.
pub fn base_url(port: u16) -> String {
    format!("http://127.0.0.1:{}", port)
}

/// A job id sd-server handed out: letters, digits, `_` and `-`. Anything else
/// is refused, so a job id cannot walk the URL into another endpoint.
pub fn valid_job_id(id: &str) -> Result<String, String> {
    let trimmed = id.trim();
    let ok = !trimmed.is_empty()
        && trimmed.len() <= 64
        && trimmed.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !ok {
        return Err(format!("{} is not a job id", trimmed));
    }
    Ok(trimmed.to_string())
}

/// The argv for one run: the model, and loopback. Kept in one place so it can
/// be asserted, exactly as models.rs does for llama-server.
pub fn args_for(model: &Path, port: u16, threads: Option<u32>) -> Vec<String> {
    let mut args = vec![
        "-m".to_string(),
        model.display().to_string(),
        // An image server is for this machine, not for the network it is on.
        "--listen-ip".to_string(),
        "127.0.0.1".to_string(),
        "--listen-port".to_string(),
        port.to_string(),
        // Encode and decode the picture in tiles: on the PC's 4 GB card an
        // SDXL edit at 832x1152 asked for 4.1 GB in one VAE pass and failed
        // ("failed to encode init image"). Sets already had it.
        "--vae-tiling".to_string(),
    ];
    if let Some(threads) = threads {
        args.push("-t".to_string());
        args.push(threads.to_string());
    }
    args.extend(model_args_for(model));
    args
}

fn client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(timeout)
        .build()
        .map_err(|e| format!("http client: {}", e))
}

/// Whether sd-server answers, and what it said. `/sdcpp/v1/capabilities` only
/// answers once the model is loaded, which is the difference between
/// "starting" and "ready" -- the thing a progress line has to be honest about.
async fn ready(port: u16) -> (bool, String) {
    let url = format!("{}/sdcpp/v1/capabilities", base_url(port));
    let client = match client(Duration::from_secs(5)) {
        Ok(c) => c,
        Err(e) => return (false, e),
    };
    match client.get(&url).send().await {
        Ok(response) => {
            let code = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            let short: String = body.chars().take(200).collect();
            (code == 200, if code == 200 { String::new() } else { format!("{} {}", code, short) })
        }
        Err(e) => (false, e.to_string()),
    }
}

#[derive(serde::Serialize)]
pub struct SdStatus {
    /// "stopped", "starting" or "ready".
    pub state: String,
    pub binary: String,
    pub model: String,
    pub port: u16,
    pub pid: u32,
    pub uptime_ms: u64,
    pub base_url: String,
    pub detail: String,
    /// Empty, or why this model may not draw properly on this machine.
    pub warning: String,
}

fn snapshot(run: &Option<Run>, is_ready: bool, detail: String) -> SdStatus {
    match run {
        Some(active) => SdStatus {
            state: if is_ready { "ready" } else { "starting" }.to_string(),
            binary: active.binary.clone(),
            model: active.model.clone(),
            port: active.port,
            pid: active.child.id(),
            uptime_ms: active.started.elapsed().as_millis() as u64,
            base_url: base_url(active.port),
            detail,
            warning: active.warning.clone(),
        },
        None => SdStatus {
            state: "stopped".to_string(),
            binary: String::new(),
            model: String::new(),
            port: 0,
            pid: 0,
            uptime_ms: 0,
            base_url: String::new(),
            detail,
            warning: String::new(),
        },
    }
}

#[tauri::command(async)]
pub async fn sd_status() -> SdStatus {
    let (running, port) = {
        let guard = match slot().lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        match guard.as_ref() {
            Some(run) => (true, run.port),
            None => (false, 0),
        }
    };
    if !running {
        return snapshot(&None, false, String::new());
    }
    let (ok, detail) = ready(port).await;
    let guard = match slot().lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    snapshot(&guard, ok, detail)
}

fn log_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_log_dir().ok()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("sd-server.log"))
}

/// What a failed start says, error lines first. The log opens with the
/// Vulkan device lines, and the screen shows the first line of a message, so
/// "Found 1 Vulkan devices" used to be all anyone saw of a model that would
/// not load. A known failure also gets the sentence that says what to do.
pub fn explain_tail(tail: &str) -> String {
    let errors: Vec<String> = tail
        .lines()
        .filter(|l| l.contains("[ERROR") || l.contains("GGML_ASSERT"))
        .map(|l| match l.rfind(" - ") {
            Some(i) if l.contains("[ERROR") => l[i + 3..].trim().to_string(),
            _ => l.trim().to_string(),
        })
        .collect();
    let mut out = if errors.is_empty() { tail.trim().to_string() } else { errors.join(" · ") };
    let lower = tail.to_ascii_lowercase();
    if tail.contains("get sd version from file failed") {
        if lower.contains("controlnet") {
            out.push_str(
                " -- this file is a ControlNet, an add-on that guides a model, not a model that draws on its own: pick a checkpoint (SD 1.5, SDXL, FLUX) instead.",
            );
        } else if lower.contains("lora") {
            out.push_str(
                " -- this file looks like a LoRA, an add-on for a model, not a model that draws on its own: pick a checkpoint (SD 1.5, SDXL, FLUX) instead.",
            );
        } else if ["pulid", "ip-adapter", "ip_adapter", "ipadapter", "instantid", "t2i-adapter", "t2i_adapter"]
            .iter()
            .any(|k| lower.contains(k))
        {
            out.push_str(
                " -- this file is an adapter (PuLID, IP-Adapter, InstantID and the like) that a ComfyUI workflow adds to a model; it does not draw on its own and stable-diffusion.cpp does not load it: pick a checkpoint (SD 1.5, SDXL, FLUX) instead.",
            );
        } else {
            out.push_str(
                " -- stable-diffusion.cpp does not recognise this file as a model. Most often it is a UNet-only GGUF made for ComfyUI: use the full .safetensors checkpoint instead, or add the file with its VAE and text encoders as a set.",
            );
        }
    } else if tail.contains("VAE tensor") && tail.contains("not in model metadata") {
        // Collapse the hundreds of per-tensor lines to the first one.
        let first = errors.first().cloned().unwrap_or_default();
        out = format!(
            "{} (and more) -- this checkpoint was published without its VAE. Download the VAE it was made for (sdxl_vae.safetensors from stabilityai/sdxl-vae for an SDXL model) and use \"Add files as a set\" with both files.",
            first
        );
    }
    out
}

fn log_tail(app: &tauri::AppHandle) -> String {
    let Some(path) = log_file(app) else {
        return String::new();
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return String::new();
    };
    let tail: String = text.chars().rev().take(1200).collect::<String>().chars().rev().collect();
    tail.trim().to_string()
}

/// The argv for a set: each part under its own flag, then what a multi-file
/// model needs on an ordinary machine. `--offload-to-cpu` keeps the weights in
/// RAM and moves each piece to the GPU only while it runs -- Krea2's three
/// parts are ~10 GB against a 4 GB card. `--vae-tiling` decodes the finished
/// picture in tiles: without it, sampling ran to the end on a 4 GB card and
/// the very last step failed out of GPU memory, leaving a blank file after
/// six minutes of work.
/// On a small card the VAE runs on the CPU. Even tiled, FLUX.2's VAE asked
/// the PC's 4 GB GTX 1050 Ti for 3.3 GB against a 2.8 GB budget to encode the
/// picture an edit starts from ("failed to encode reference image 0"). The VAE
/// is small; on the CPU it costs seconds, not the edit. `--vae-on-cpu` rather
/// than `--backend vae=cpu`: the same thing in sd.cpp, without naming a device.
pub fn small_card_args(vram_mb: Option<u64>) -> Vec<String> {
    match vram_mb {
        Some(mb) if mb > 0 && mb <= 6 * 1024 => vec!["--vae-on-cpu".to_string()],
        _ => Vec::new(),
    }
}

pub fn args_for_set(parts: &SetParts, port: u16, threads: Option<u32>) -> Vec<String> {
    let mut args = vec!["--diffusion-model".to_string(), parts.diffusion.display().to_string()];
    for (flag, part) in [
        ("--vae", &parts.vae),
        ("--llm", &parts.llm),
        ("--llm_vision", &parts.llm_vision),
        ("--clip_l", &parts.clip_l),
        ("--t5xxl", &parts.t5xxl),
    ] {
        if let Some(path) = part {
            args.push(flag.to_string());
            args.push(path.display().to_string());
        }
    }
    for flag in [
        "--offload-to-cpu",
        "--diffusion-fa",
        "--vae-tiling",
        // An image server is for this machine, not for the network it is on.
        "--listen-ip",
        "127.0.0.1",
        "--listen-port",
    ] {
        args.push(flag.to_string());
    }
    args.push(port.to_string());
    if let Some(threads) = threads {
        args.push("-t".to_string());
        args.push(threads.to_string());
    }
    args.extend(model_args_for(&parts.diffusion));
    args
}

/// Start sd-server and wait for it to answer. Failure says what went wrong --
/// no binary, no model, or the server's own last words -- rather than hanging.
#[tauri::command(async)]
pub async fn sd_start(
    app: tauri::AppHandle,
    port: Option<u16>,
    threads: Option<u32>,
) -> Result<SdStatus, String> {
    let (binary, _) = find_binary(&app).ok_or_else(|| {
        format!(
            "{} is not set up: choose it under Images, \"On this PC\". Get it from {}.",
            binary_name(),
            RELEASES_URL
        )
    })?;
    let model = remembered_model(&app).ok_or_else(|| {
        "No model chosen: pick a .safetensors, .ckpt or .gguf under Images, \"On this PC\".".to_string()
    })?;
    let port = valid_port(port)?;
    // One server at a time, and the old one goes first: two of these would
    // fight over the port and over the machine's memory.
    shutdown();

    let mut command = Command::new(&binary);
    // A folder is a set, and a set starts with each part under its own flag.
    let mut argv = match set_in(&model) {
        Some(parts) if model.is_dir() => args_for_set(&parts, port, threads),
        _ => args_for(&model, port, threads),
    };
    argv.extend(small_card_args(crate::models::vram_mb()));
    if let Ok(dir) = loras_dir(&app) {
        argv.push("--lora-model-dir".to_string());
        argv.push(dir.display().to_string());
    }
    command.args(argv);
    command.stdin(Stdio::null());
    // The server's own log is the only place a load failure explains itself.
    if let Some(log) = log_file(&app) {
        if let Ok(handle) = std::fs::File::create(&log) {
            if let Ok(clone) = handle.try_clone() {
                command.stdout(Stdio::from(clone));
            }
            command.stderr(Stdio::from(handle));
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let child = command
        .spawn()
        .map_err(|e| format!("Could not start {}: {}", binary.display(), e))?;
    {
        let mut guard = match slot().lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        *guard = Some(Run {
            child,
            binary: binary.display().to_string(),
            model: model.display().to_string(),
            port,
            started: Instant::now(),
            warning: String::new(),
        });
    }

    let deadline = Instant::now() + Duration::from_secs(START_TIMEOUT_SECS);
    loop {
        let exited = {
            let mut guard = match slot().lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match guard.as_mut() {
                Some(run) => match run.child.try_wait() {
                    Ok(Some(status)) => Some(format!("sd-server exited with {}", status)),
                    Ok(None) => None,
                    Err(e) => Some(e.to_string()),
                },
                None => Some("stopped".to_string()),
            }
        };
        if let Some(reason) = exited {
            let tail = explain_tail(&log_tail(&app));
            shutdown();
            return Err(format!("{}: {}", reason, tail));
        }
        let (ok, detail) = ready(port).await;
        if ok {
            // The device line is at the top of the log, so the whole file is
            // read, not the tail an error shows.
            let text = log_file(&app)
                .and_then(|path| std::fs::read_to_string(path).ok())
                .unwrap_or_default();
            let warning = gpu_warning(&text, model.is_dir());
            let mut guard = match slot().lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            if let Some(run) = guard.as_mut() {
                run.warning = warning;
            }
            return Ok(snapshot(&guard, true, detail));
        }
        if Instant::now() >= deadline {
            let tail = explain_tail(&log_tail(&app));
            shutdown();
            return Err(format!(
                "sd-server did not become ready within {} s. {}",
                START_TIMEOUT_SECS, tail
            ));
        }
        std::thread::sleep(Duration::from_millis(750));
    }
}

#[tauri::command(async)]
pub fn sd_stop() -> serde_json::Value {
    let was = {
        let guard = match slot().lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        guard.is_some()
    };
    shutdown();
    serde_json::json!({ "stopped": was })
}

/// The body for `POST /sdcpp/v1/img_gen`, in one place so it can be asserted.
/// Only the documented fields, and only the ones actually asked for.
pub fn job_body(
    prompt: &str,
    negative_prompt: &str,
    width: u32,
    height: u32,
    steps: Option<u32>,
    seed: Option<i64>,
    init_image: Option<&str>,
    strength: Option<f64>,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "prompt": prompt,
        "negative_prompt": negative_prompt,
        "width": width,
        "height": height,
        "batch_count": 1,
    });
    if let Some(steps) = steps {
        body["sample_params"] = serde_json::json!({ "sample_steps": steps });
    }
    if let Some(seed) = seed {
        body["seed"] = serde_json::json!(seed);
    }
    // A strength without a picture to apply it to would be a field about
    // nothing, so the pair travels together or not at all.
    if let Some(image) = init_image {
        body["init_image"] = serde_json::json!(image);
        body["strength"] =
            serde_json::json!(strength.unwrap_or(DEFAULT_EDIT_STRENGTH).clamp(0.0, 1.0));
    }
    body
}

/// The name that says what a model is: the file's, or for a set, its
/// diffusion part's. Lower-cased, because every rule below reads it that way.
fn model_name_of(model: &Path) -> String {
    let named = |path: &Path| {
        path.file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default()
    };
    if model.is_dir() {
        if let Some(parts) = set_in(model) {
            return named(&parts.diffusion);
        }
    }
    named(model)
}

/// An instruction-edit model -- Krea2 edit, Qwen-Image-Edit, Flux Kontext,
/// and every FLUX.2 (dev and klein edit and draw with the same weights) -- is
/// named for it, in the file or, for a set, in its diffusion part. Those
/// models read the picture as a reference and follow the words; image-to-image
/// would instead start from the picture's pixels and mostly restyle them.
pub fn edits_by_reference(model: &Path) -> bool {
    let name = model_name_of(model);
    if name.is_empty() {
        return false;
    }
    name.contains("edit") || name.contains("kontext") || is_flux2(&name)
}

/// FLUX.2 in any of its spellings: "flux2-dev", "flux-2-klein-4b", "FLUX.2".
fn is_flux2(name: &str) -> bool {
    name.contains("flux2") || name.contains("flux-2") || name.contains("flux.2") || name.contains("klein")
}

/// What a model family draws best with, when the caller does not say
/// (docs/flux2.md and docs/flux.md in stable-diffusion.cpp, Sept 2026). A
/// distilled FLUX.2 [klein] is a four-step model at cfg 1.0: sd-server's own
/// defaults (20 steps, cfg 7) would take five times as long and wash it out.
/// The base klein and FLUX.2-dev keep 20 steps; dev is guidance-distilled at
/// cfg 1.0 too, the base variants take real cfg (4.0).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Family {
    pub label: &'static str,
    pub cfg: f64,
    pub steps: u32,
    /// The sampling method the family draws best with (api.md's
    /// `sample_method`); None leaves sd-server's own default.
    pub sampler: Option<&'static str>,
    /// The flow shift (api.md's `flow_shift`): Qwen-Image wants 3.
    pub shift: Option<f64>,
}

/// Z-Image in the spellings its files use (z_image_turbo, Z-Image-Turbo).
fn is_z_image(name: &str) -> bool {
    name.contains("z_image") || name.contains("z-image") || name.contains("zimage")
}

pub fn family_of(model: &Path) -> Option<Family> {
    let name = model_name_of(model);
    let klein = name.contains("klein");
    let base = name.contains("base");
    let flux1 = name.contains("flux1") || name.contains("flux-1") || name.contains("flux.1");
    if is_qwen_image(&name) {
        // stable-diffusion.cpp's own docs/qwen_image.md example: --cfg-scale
        // 2.5, --sampling-method euler, --flow-shift 3. The 20 steps are its
        // default, written down here so the number is chosen, not assumed.
        Some(Family { label: "Qwen-Image", cfg: 2.5, steps: 20, sampler: Some("euler"), shift: Some(3.0) })
    } else if klein && base {
        Some(Family { label: "FLUX.2 [klein] base", cfg: 4.0, steps: 20, sampler: None, shift: None })
    } else if klein {
        Some(Family { label: "FLUX.2 [klein]", cfg: 1.0, steps: 4, sampler: None, shift: None })
    } else if is_flux2(&name) {
        Some(Family { label: "FLUX.2 [dev]", cfg: 1.0, steps: 20, sampler: None, shift: None })
    } else if is_z_image(&name) && name.contains("turbo") {
        // Z-Image Turbo is distilled for ~8 steps with no guidance; sd.cpp's
        // defaults (20 steps, cfg 7) wash it out.
        Some(Family { label: "Z-Image Turbo", cfg: 1.0, steps: 8, sampler: None, shift: None })
    } else if flux1 && name.contains("schnell") {
        Some(Family { label: "FLUX.1 [schnell]", cfg: 1.0, steps: 4, sampler: None, shift: None })
    } else if flux1 {
        Some(Family { label: "FLUX.1", cfg: 1.0, steps: 20, sampler: None, shift: None })
    } else {
        None
    }
}

/// Qwen-Image in any spelling: "qwen_image_fp8", "qwen-image-2512",
/// "qwen_image_edit_2511". Its Qwen2.5-VL encoder (qwen_2.5_vl) does not
/// match, and for a set model_name_of reads the diffusion part, never the
/// encoder beside it.
fn is_qwen_image(name: &str) -> bool {
    name.contains("qwen-image") || name.contains("qwen_image")
}

/// `--model-args qwen_image_zero_cond_t=true`, which stable-diffusion.cpp's
/// docs/qwen_image_edit.md says Qwen-Image-Edit-2511 needs or editing comes
/// out wrong. Named by the weights themselves: 2509 predates the mode and
/// 2512 changed the convention, so neither takes it, and nothing else does.
pub fn model_args_for(model: &Path) -> Vec<String> {
    let name = model_name_of(model);
    if name.contains("qwen") && name.contains("edit") && name.contains("2511") {
        vec!["--model-args".to_string(), "qwen_image_zero_cond_t=true".to_string()]
    } else {
        Vec::new()
    }
}

/// The job with the family's own numbers where the caller left them out:
/// `sample_params.sample_steps` and, for a family that names them,
/// `sample_method` and `flow_shift` (only if absent) — plus
/// `guidance.txt_cfg` (api.md's name for the classifier-free guidance
/// scale), which the family always states. A model with no known family
/// gets sd-server's defaults, exactly as before.
pub fn with_family(mut body: serde_json::Value, family: Option<Family>) -> serde_json::Value {
    let Some(family) = family else {
        return body;
    };
    if body.get("sample_params").is_none() {
        body["sample_params"] = serde_json::json!({});
    }
    if body["sample_params"].get("sample_steps").is_none() {
        body["sample_params"]["sample_steps"] = serde_json::json!(family.steps);
    }
    body["sample_params"]["guidance"] = serde_json::json!({ "txt_cfg": family.cfg });
    if let Some(sampler) = family.sampler {
        if body["sample_params"].get("sample_method").is_none() {
            body["sample_params"]["sample_method"] = serde_json::json!(sampler);
        }
    }
    if let Some(shift) = family.shift {
        if body["sample_params"].get("flow_shift").is_none() {
            body["sample_params"]["flow_shift"] = serde_json::json!(shift);
        }
    }
    body
}

/// The same job with the picture moved to where an edit model reads it:
/// `ref_images`, documented as an array of base64 strings or data: URLs.
/// `strength` goes with `init_image`, because it only means something to
/// image-to-image. A body with no picture is returned untouched.
pub fn by_reference(mut body: serde_json::Value) -> serde_json::Value {
    if let Some(map) = body.as_object_mut() {
        if let Some(image) = map.remove("init_image") {
            map.remove("strength");
            // A reference is read whole; a region of it means nothing here.
            map.remove("mask_image");
            map.insert("ref_images".to_string(), serde_json::json!([image]));
        }
    }
    body
}

/// The painted mask beside the picture it belongs to. A mask with no picture
/// would mark regions of nothing, so it is added only when `init_image` is
/// there -- and an empty one is no mask at all.
pub fn with_mask(mut body: serde_json::Value, mask: Option<&str>) -> serde_json::Value {
    let Some(mask) = mask.map(str::trim).filter(|m| !m.is_empty()) else {
        return body;
    };
    if body.get("init_image").is_some() {
        body["mask_image"] = serde_json::json!(mask);
    }
    body
}

/// What sd-server's own log says about the card, for a large (multi-file)
/// model. ggml's Vulkan backend prints one line per device, e.g.
/// `ggml_vulkan: 0 = NVIDIA GeForce GTX 1050 Ti (NVIDIA) | uma: 0 | fp16: 0 |`.
/// On that exact card Krea2 decoded pure white whatever the cfg, flash
/// attention or VAE placement, so a card reporting `fp16: 0` is named before
/// someone waits minutes for a white square. A single-file checkpoint is left
/// alone: SD 1.5 drew correctly on the same card.
pub fn gpu_warning(log: &str, is_set: bool) -> String {
    if !is_set {
        return String::new();
    }
    let weak = log
        .lines()
        .find(|line| line.contains("ggml_vulkan:") && line.contains(" = ") && line.contains("fp16: 0"));
    match weak {
        Some(line) => {
            let card = line
                .split(" = ")
                .nth(1)
                .and_then(|rest| rest.split(" |").next())
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .unwrap_or("This graphics card");
            format!(
                "{} has no fp16 support. A large model like this one has been seen to come out as a plain white picture on such a card; if yours does, this model cannot draw on this PC. A Stable Diffusion 1.5 checkpoint can.",
                card
            )
        }
        None => String::new(),
    }
}

/// How much of the source an edit is allowed to leave behind when the caller
/// does not say. sd.cpp's own example uses 0.75; this asks for less, because
/// the request is "change this picture" rather than "start from it".
const DEFAULT_EDIT_STRENGTH: f64 = 0.6;

/// The source picture for an edit. sd.cpp accepts a raw base64 string or a
/// data: URL and nothing else -- in particular not a path, because a path
/// would be this process reading whatever file a page named.
fn valid_init_image(raw: &str) -> Result<String, String> {
    let text = raw.trim();
    if text.is_empty() {
        return Err("The picture to change arrived empty.".to_string());
    }
    if text.len() > MAX_INIT_IMAGE_CHARS {
        return Err("That picture is too large to edit here.".to_string());
    }
    let payload = match text.strip_prefix("data:") {
        Some(rest) => match rest.split_once(";base64,") {
            Some((kind, data)) if kind.starts_with("image/") => data,
            _ => {
                return Err(
                    "The picture must be base64 image bytes, or a data: URL carrying them."
                        .to_string(),
                )
            }
        },
        None => text,
    };
    let letters = payload.as_bytes();
    let looks_base64 = letters.iter().any(|b| b.is_ascii_alphanumeric())
        && letters.iter().all(|b| {
            b.is_ascii_alphanumeric()
                || *b == b'+'
                || *b == b'/'
                || *b == b'='
                || b.is_ascii_whitespace()
        });
    if !looks_base64 {
        return Err(
            "The picture must be base64 image bytes, or a data: URL carrying them.".to_string(),
        );
    }
    Ok(text.to_string())
}

/// The size sd.cpp will draw: a multiple of 64, and nothing absurd. A page
/// that asks for 40000 pixels is asking the machine to die.
fn valid_side(side: u32, what: &str) -> Result<u32, String> {
    if !(64..=2048).contains(&side) {
        return Err(format!("{} must be between 64 and 2048 pixels", what));
    }
    if side % 64 != 0 {
        return Err(format!("{} must be a multiple of 64", what));
    }
    Ok(side)
}

/// The running server's port, or the error that says nothing is running.
fn running_port() -> Option<u16> {
    let guard = match slot().lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    guard.as_ref().map(|run| run.port)
}

/// What the running server was started with: a file, or a set's folder.
fn running_model() -> Option<PathBuf> {
    let guard = match slot().lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    guard.as_ref().map(|run| PathBuf::from(&run.model))
}

/// Submit one job. Returns sd-server's own answer ({"id", "status", ...}); the
/// page then polls `sd_job` and can `sd_cancel`, so nothing blocks for the
/// minutes an image takes.
#[tauri::command(async)]
pub async fn sd_generate(
    app: tauri::AppHandle,
    prompt: String,
    negative_prompt: Option<String>,
    width: u32,
    height: u32,
    steps: Option<u32>,
    seed: Option<i64>,
    // An edit is the same job with the picture being changed attached. Absent,
    // this is the draw it has always been.
    init_image: Option<String>,
    strength: Option<f64>,
    // White where the picture may change. Checked exactly like the picture.
    mask_image: Option<String>,
    // LoRAs from the LoRA folder, each with its strength.
    loras: Option<Vec<LoraPick>>,
) -> Result<serde_json::Value, String> {
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("An image needs a prompt.".to_string());
    }
    let width = valid_side(width, "width")?;
    let height = valid_side(height, "height")?;
    let port = running_port()
        .ok_or_else(|| "The local image server is not running: start it first.".to_string())?;
    let init = match init_image {
        Some(raw) => Some(valid_init_image(&raw)?),
        None => None,
    };
    let mask = match mask_image {
        Some(raw) => Some(valid_init_image(&raw)?),
        None => None,
    };
    let mut body = job_body(
        &prompt,
        negative_prompt.unwrap_or_default().trim(),
        width,
        height,
        steps,
        seed,
        init.as_deref(),
        strength,
    );
    body = with_mask(body, mask.as_deref());
    let picks = loras.unwrap_or_default();
    if !picks.is_empty() {
        let dir = loras_dir(&app)?;
        let checked = picks
            .iter()
            .map(|p| valid_lora(&dir, &p.name, p.multiplier.unwrap_or(1.0)))
            .collect::<Result<Vec<_>, _>>()?;
        body = with_loras(body, &checked);
    }
    let model = running_model().unwrap_or_default();
    if edits_by_reference(&model) {
        body = by_reference(body);
    }
    body = with_family(body, family_of(&model));
    let body = body.to_string();
    let url = format!("{}/sdcpp/v1/img_gen", base_url(port));
    let response = client(Duration::from_secs(30))?
        .post(&url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("The local image server did not take the job: {}", e))?;
    let code = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    if !(200..300).contains(&code) {
        return Err(format!(
            "sd-server answered {}: {}",
            code,
            text.chars().take(200).collect::<String>()
        ));
    }
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("sd-server did not answer JSON: {}", e))?;
    // A submission without an id is not a job, and pretending otherwise would
    // leave the page polling something that never existed.
    if valid_job_id(value.get("id").and_then(|v| v.as_str()).unwrap_or("")).is_err() {
        return Err("sd-server accepted the job without giving it an id.".to_string());
    }
    Ok(value)
}

/// One poll of one job, passed through as sd-server wrote it: status,
/// queue_position, and on completion result.images[].b64_json.
#[tauri::command(async)]
pub async fn sd_job(id: String) -> Result<serde_json::Value, String> {
    let id = valid_job_id(&id)?;
    let port = running_port()
        .ok_or_else(|| "The local image server is not running.".to_string())?;
    let url = format!("{}/sdcpp/v1/jobs/{}", base_url(port), id);
    let response = client(Duration::from_secs(15))?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Lost the local image server: {}", e))?;
    let code = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    if code == 404 || code == 410 {
        return Ok(serde_json::json!({ "id": id, "status": "cancelled", "detail": "the job is gone" }));
    }
    if !(200..300).contains(&code) {
        return Err(format!(
            "sd-server answered {}: {}",
            code,
            text.chars().take(200).collect::<String>()
        ));
    }
    serde_json::from_str(&text).map_err(|e| format!("sd-server did not answer JSON: {}", e))
}

/// Cancel a job. A job that is already gone (404/410) counts as cancelled:
/// the user asked for it to stop, and it has.
#[tauri::command(async)]
pub async fn sd_cancel(id: String) -> Result<serde_json::Value, String> {
    let id = valid_job_id(&id)?;
    let Some(port) = running_port() else {
        return Ok(serde_json::json!({ "cancelled": true, "detail": "nothing is running" }));
    };
    let url = format!("{}/sdcpp/v1/jobs/{}/cancel", base_url(port), id);
    let response = client(Duration::from_secs(15))?
        .post(&url)
        .send()
        .await
        .map_err(|e| format!("Could not reach the local image server: {}", e))?;
    let code = response.status().as_u16();
    Ok(serde_json::json!({
        "cancelled": (200..300).contains(&code) || code == 404 || code == 410,
        "status": code,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_lora_travels_by_name_from_the_lora_folder_only() {
        let dir = std::env::temp_dir().join(format!("neuraos-loras-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("style.safetensors"), b"x").unwrap();
        assert_eq!(valid_lora(&dir, "style.safetensors", 0.8).unwrap(), ("style.safetensors".to_string(), 0.8));
        assert_eq!(valid_lora(&dir, "style.safetensors", 9.0).unwrap().1, 2.0, "strength kept in range");
        assert_eq!(valid_lora(&dir, "style.safetensors", f64::NAN).unwrap().1, 1.0);
        assert!(valid_lora(&dir, "../style.safetensors", 1.0).is_err(), "no climbing out");
        assert!(valid_lora(&dir, "/etc/passwd", 1.0).is_err());
        assert!(valid_lora(&dir, "notes.txt", 1.0).is_err());
        assert!(valid_lora(&dir, "gone.safetensors", 1.0).is_err());
        let body = with_loras(job_body("a cat", "", 512, 512, None, None, None, None), &[("style.safetensors".to_string(), 0.8)]);
        assert_eq!(body["lora"], serde_json::json!([{ "path": "style.safetensors", "multiplier": 0.8 }]));
        assert!(!body["prompt"].as_str().unwrap().contains("<lora"), "sd-server does not read prompt tags");
        let plain = with_loras(job_body("a cat", "", 512, 512, None, None, None, None), &[]);
        assert!(plain.get("lora").is_none(), "no LoRA, no field");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn z_image_turbo_draws_in_eight_steps_without_guidance() {
        for name in ["z_image_turbo_bf16.safetensors", "Z-Image-Turbo-Q4_K.gguf"] {
            let fam = family_of(Path::new(name)).expect(name);
            assert_eq!(fam.label, "Z-Image Turbo");
            assert_eq!(fam.steps, 8);
            assert_eq!(fam.cfg, 1.0);
        }
        // Its set: the FLUX.1 autoencoder and a Qwen3-4B encoder beside it.
        let files = vec![
            (PathBuf::from("z/z_image_turbo_bf16.safetensors"), 12_300_000_000),
            (PathBuf::from("z/qwen_3_4b.safetensors"), 8_044_982_048),
            (PathBuf::from("z/ae.safetensors"), 335_000_000),
        ];
        let parts = set_roles(&files).expect("a set");
        assert_eq!(parts.diffusion, PathBuf::from("z/z_image_turbo_bf16.safetensors"));
        assert_eq!(parts.vae, Some(PathBuf::from("z/ae.safetensors")));
        assert_eq!(parts.llm, Some(PathBuf::from("z/qwen_3_4b.safetensors")));
    }

    #[test]
    fn a_small_card_encodes_on_the_cpu() {
        assert_eq!(small_card_args(Some(4096)), vec!["--vae-on-cpu"], "the PC's GTX 1050 Ti");
        assert_eq!(small_card_args(Some(6144)), vec!["--vae-on-cpu"]);
        assert!(small_card_args(Some(8192)).is_empty(), "a bigger card keeps the VAE on the GPU");
        assert!(small_card_args(None).is_empty(), "unknown: leave sd.cpp's own choice");
        assert!(small_card_args(Some(0)).is_empty());
    }

    #[test]
    fn only_a_model_inside_sd_models_can_be_deleted() {
        let root = std::env::temp_dir().join(format!("neuraos-sd-del-{}", std::process::id()));
        let models = root.join("sd-models");
        let set = models.join("flux-2-klein-4b");
        std::fs::create_dir_all(&set).unwrap();
        std::fs::write(set.join("flux-2-klein-4b.safetensors"), vec![0u8; 8]).unwrap();
        std::fs::write(set.join("flux2-vae.safetensors"), vec![0u8; 2]).unwrap();
        std::fs::write(models.join("FlammenSDXL1-q4_1.gguf"), vec![0u8; 4]).unwrap();
        std::fs::write(models.join("notes.txt"), b"x").unwrap();
        std::fs::write(root.join("outside.gguf"), b"x").unwrap();

        assert!(deletable_in(&models, &models.join("FlammenSDXL1-q4_1.gguf")).is_ok());
        assert!(deletable_in(&models, &set).is_ok(), "a set folder is one model");
        assert!(deletable_in(&models, &set.join("flux2-vae.safetensors")).is_err(), "not a part of a set on its own");
        assert!(deletable_in(&models, &models.join("notes.txt")).is_err(), "not a model file");
        assert!(deletable_in(&models, &root.join("outside.gguf")).is_err(), "outside sd-models");
        assert!(deletable_in(&models, &models.join("..").join("outside.gguf")).is_err(), "no climbing out");
        assert!(deletable_in(&models, &models).is_err(), "never the folder itself");
        assert!(deletable_in(&models, &models.join("gone.gguf")).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_failed_start_leads_with_the_error_not_the_vulkan_banner() {
        // The PC's log for a ComfyUI-style SDXL GGUF.
        let tail = "ggml_vulkan: Found 1 Vulkan devices:\nggml_vulkan: 0 = NVIDIA GeForce GTX 1050 Ti (NVIDIA) | uma: 0\n[INFO   ] model_loader.cpp:215  - load x.gguf using gguf format\n[ERROR  ] diffusion_engine.cpp:974  - get sd version from file failed: 'x.gguf'\n[ERROR  ] main.cpp:93   - new_sd_ctx_t failed";
        let said = explain_tail(tail);
        assert!(said.starts_with("get sd version from file failed"), "{}", said);
        assert!(said.contains("new_sd_ctx_t failed"));
        assert!(!said.contains("Vulkan devices"));
        assert!(said.contains("UNet-only GGUF made for ComfyUI"));
        // The PC's two next tries: a ControlNet, and a checkpoint without its VAE.
        let cn = "[INFO   ] model_loader.cpp:221  - load /m/TTPLANET_Controlnet_Tile_realistic_v2_rank256.safetensors using safetensors format\n[ERROR  ] diffusion_engine.cpp:974  - get sd version from file failed: '/m/TTPLANET_Controlnet_Tile_realistic_v2_rank256.safetensors'";
        assert!(explain_tail(cn).contains("is a ControlNet"));
        let pulid = "[INFO   ] model_loader.cpp:221  - load /m/pulid_flux_v0.9.1.safetensors using safetensors format\n[ERROR  ] diffusion_engine.cpp:974  - get sd version from file failed: '/m/pulid_flux_v0.9.1.safetensors'";
        assert!(explain_tail(pulid).contains("is an adapter (PuLID"));
        let novae = "[ERROR  ] model_manager.cpp:761  - VAE tensor 'first_stage_model.encoder.norm_out.bias' not in model metadata\n[ERROR  ] model_manager.cpp:761  - VAE tensor 'first_stage_model.encoder.norm_out.weight' not in model metadata\n[ERROR  ] diffusion_engine.cpp:1247 - model metadata validation failed";
        let said = explain_tail(novae);
        assert!(said.contains("published without its VAE"), "{}", said);
        assert!(said.contains("Add files as a set"));
        assert_eq!(said.matches("not in model metadata").count(), 1, "one line, not hundreds");
        // No error lines: the tail as it was.
        assert_eq!(explain_tail("  just info\n"), "just info");
        // An assert is an error too (the FP4 crash).
        assert!(explain_tail("x\n/src/ggml_block.hpp:173: GGML_ASSERT(scale_nelements == 1) failed\n").starts_with("/src/ggml_block.hpp:173: GGML_ASSERT"));
    }

    #[test]
    fn a_set_never_takes_an_fp4_part() {
        // The PC's folder: both encoders from Comfy-Org/flux2-klein-4B.
        let files = vec![
            (PathBuf::from("k/flux-2-klein-4b.safetensors"), 7_751_105_712),
            (PathBuf::from("k/qwen_3_4b_fp4_flux2.safetensors"), 3_848_213_998),
            (PathBuf::from("k/qwen_3_4b.safetensors"), 8_044_982_048),
            (PathBuf::from("k/flux2-vae.safetensors"), 336_211_292),
        ];
        let parts = set_roles(&files).expect("a set");
        assert_eq!(parts.llm, Some(PathBuf::from("k/qwen_3_4b.safetensors")), "the bf16 encoder, whatever the listing order");
        assert_eq!(parts.diffusion, PathBuf::from("k/flux-2-klein-4b.safetensors"));
        // An NVFP4 diffusion model is not a model this server can load.
        let nvfp4 = vec![
            (PathBuf::from("q/qwen_image_nvfp4.safetensors"), 19_769_000_000),
            (PathBuf::from("q/qwen_2.5_vl_7b_nvfp4.safetensors"), 6_114_000_000),
            (PathBuf::from("q/qwen_image_vae.safetensors"), 253_000_000),
        ];
        assert!(set_roles(&nvfp4).is_none());
        assert!(is_fp4("x_fp4.safetensors") && is_fp4("x-NVFP4.gguf") && !is_fp4("qwen_2.5_vl_7b_fp8_scaled.safetensors"));
    }

    #[test]
    fn a_chosen_set_folder_is_remembered_as_the_model() {
        let root = std::env::temp_dir().join(format!("neuraos-sd-set-{}", std::process::id()));
        let set = root.join("flux-2-klein-4b");
        std::fs::create_dir_all(&set).unwrap();
        for (name, bytes) in [("flux-2-klein-4b.safetensors", 8usize), ("qwen_3_4b.safetensors", 4), ("flux2-vae.safetensors", 2)] {
            std::fs::write(set.join(name), vec![0u8; bytes]).unwrap();
        }
        let saved = root.join("model.txt");
        std::fs::write(&saved, set.display().to_string()).unwrap();
        assert_eq!(remembered(Ok(saved.clone())), None, "the binary's reader never takes a folder");
        assert_eq!(remembered_model_at(Ok(saved.clone())), Some(set.clone()), "a set folder is the chosen model");
        std::fs::remove_file(set.join("flux2-vae.safetensors")).unwrap();
        std::fs::remove_file(set.join("qwen_3_4b.safetensors")).unwrap();
        assert_eq!(remembered_model_at(Ok(saved)), None, "a folder that is no longer a set is not a model");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn krea2s_three_files_are_one_set_by_role() {
        let files = vec![
            (PathBuf::from("k/Krea2_turbo_edit-Q4_K_M.gguf"), 7_216_993_344),
            (PathBuf::from("k/Qwen3VL-4B-Instruct-Q4_K_M.gguf"), 2_497_281_664),
            (PathBuf::from("k/wan_2.1_vae.safetensors"), 253_815_318),
            (PathBuf::from("k/mmproj-Qwen3VL-4B-Instruct-F16.gguf"), 780_000_000),
            (PathBuf::from("k/README.md"), 4_000),
        ];
        let parts = set_roles(&files).expect("a diffusion model with a VAE and an encoder is a set");
        assert_eq!(parts.diffusion, PathBuf::from("k/Krea2_turbo_edit-Q4_K_M.gguf"));
        assert_eq!(parts.llm, Some(PathBuf::from("k/Qwen3VL-4B-Instruct-Q4_K_M.gguf")));
        assert_eq!(parts.vae, Some(PathBuf::from("k/wan_2.1_vae.safetensors")));
        assert_eq!(
            parts.llm_vision,
            Some(PathBuf::from("k/mmproj-Qwen3VL-4B-Instruct-F16.gguf")),
            "the projector is the encoder's eyes, not the encoder"
        );
        assert_eq!(parts.clip_l, None);
    }

    #[test]
    fn flux2_kleins_three_files_are_one_set_and_the_encoder_is_not_the_model() {
        // Comfy-Org/flux2-klein-4B: the diffusion model and the Qwen3 text
        // encoder are the same size in bf16, so "the largest file" alone
        // would pick either. The encoder is known by its name.
        let files = vec![
            (PathBuf::from("k/flux-2-klein-4b.safetensors"), 8_000_000_000),
            (PathBuf::from("k/qwen_3_4b.safetensors"), 8_100_000_000),
            (PathBuf::from("k/flux2-vae.safetensors"), 330_000_000),
        ];
        let parts = set_roles(&files).expect("a set");
        assert_eq!(parts.diffusion, PathBuf::from("k/flux-2-klein-4b.safetensors"));
        assert_eq!(parts.llm, Some(PathBuf::from("k/qwen_3_4b.safetensors")));
        assert_eq!(parts.vae, Some(PathBuf::from("k/flux2-vae.safetensors")));
        // The other spelling of the same set, from the sd.cpp docs.
        let gguf = vec![
            (PathBuf::from("d/flux2-dev-Q4_K_S.gguf"), 18_000_000_000),
            (PathBuf::from("d/flux2_ae.safetensors"), 330_000_000),
            (PathBuf::from("d/Mistral-Small-3.2-24B-Instruct-2506-Q4_K_M.gguf"), 14_000_000_000),
        ];
        let parts = set_roles(&gguf).expect("a set");
        assert_eq!(parts.diffusion, PathBuf::from("d/flux2-dev-Q4_K_S.gguf"));
        assert_eq!(parts.vae, Some(PathBuf::from("d/flux2_ae.safetensors")), "flux's autoencoder is its VAE");
        assert_eq!(parts.llm, Some(PathBuf::from("d/Mistral-Small-3.2-24B-Instruct-2506-Q4_K_M.gguf")));
        assert_eq!(role_of("ae.safetensors"), "vae");
        assert_eq!(role_of("qwen-image-2512-Q4_K_M.gguf"), "diffusion", "Qwen-Image is not a Qwen3 encoder");
        assert_eq!(role_of("Qwen3-8B-Q4_K_M.gguf"), "llm");
    }

    #[test]
    fn an_imported_set_is_named_after_its_model_without_the_quant() {
        let files = vec![
            (PathBuf::from("/dl/flux-2-klein-4b-Q4_K_M.gguf"), 2_500_000_000),
            (PathBuf::from("/dl/flux2_ae.safetensors"), 330_000_000),
            (PathBuf::from("/dl/qwen_3_4b.safetensors"), 8_100_000_000),
        ];
        assert_eq!(set_folder_name(&files).as_deref(), Some("flux-2-klein-4b"));
        let bf16 = vec![
            (PathBuf::from("/dl/flux-2-klein-9b.safetensors"), 18_000_000_000),
            (PathBuf::from("/dl/flux2-vae.safetensors"), 330_000_000),
            (PathBuf::from("/dl/Qwen3-8B-Q8_0.gguf"), 8_700_000_000),
        ];
        assert_eq!(set_folder_name(&bf16).as_deref(), Some("flux-2-klein-9b"));
        let alone = vec![(PathBuf::from("/dl/v1-5-pruned-emaonly.safetensors"), 4_000_000_000)];
        assert_eq!(set_folder_name(&alone), None, "one file is not a set to import");
    }

    #[test]
    fn a_lone_checkpoint_is_not_a_set() {
        let files = vec![(PathBuf::from("m/v1-5-pruned-emaonly.safetensors"), 4_000_000_000)];
        assert!(set_roles(&files).is_none(), "one file keeps starting with -m");
        let no_diffusion = vec![(PathBuf::from("m/wan_vae.safetensors"), 250_000_000)];
        assert!(set_roles(&no_diffusion).is_none(), "a VAE alone is not a model");
    }

    #[test]
    fn a_qwen_image_diffusion_model_is_not_mistaken_for_its_encoder() {
        let files = vec![
            (PathBuf::from("q/qwen-image-edit-2511-Q4_K_M.gguf"), 12_000_000_000),
            (PathBuf::from("q/Qwen2.5-VL-7B-Instruct-q4_0.gguf"), 4_400_000_000),
            (PathBuf::from("q/qwen_image_vae.safetensors"), 250_000_000),
        ];
        let parts = set_roles(&files).expect("a set");
        assert_eq!(parts.diffusion, PathBuf::from("q/qwen-image-edit-2511-Q4_K_M.gguf"));
        assert_eq!(parts.llm, Some(PathBuf::from("q/Qwen2.5-VL-7B-Instruct-q4_0.gguf")));
    }

    #[test]
    fn a_set_starts_with_each_part_under_its_flag_and_stays_on_loopback() {
        let parts = SetParts {
            diffusion: PathBuf::from("d.gguf"),
            vae: Some(PathBuf::from("v.safetensors")),
            llm: Some(PathBuf::from("l.gguf")),
            llm_vision: Some(PathBuf::from("mmproj-l.gguf")),
            clip_l: None,
            t5xxl: None,
        };
        let args = args_for_set(&parts, 18431, None);
        let joined = args.join(" ");
        assert!(joined.starts_with("--diffusion-model d.gguf"));
        assert!(joined.contains("--vae v.safetensors"));
        assert!(joined.contains("--llm l.gguf"));
        assert!(joined.contains("--llm_vision mmproj-l.gguf"));
        assert!(!joined.contains("--clip_l"), "an absent part is not passed");
        assert!(joined.contains("--offload-to-cpu"));
        assert!(joined.contains("--vae-tiling"), "the decode that ran out of GPU memory");
        assert!(joined.contains("--listen-ip 127.0.0.1"));
        assert!(!args.iter().any(|a| a == "-m"), "a set is never started with -m");
    }

    #[test]
    fn the_binary_has_one_expected_name_per_platform() {
        assert!(binary_name() == "sd-server.exe" || binary_name() == "sd-server");
        assert!(is_model_name("sd_v1.5-q8_0.gguf"));
        assert!(is_model_name("SDXL.safetensors"));
        assert!(!is_model_name("llama-server.exe"));
        assert!(!is_model_name("notes.txt"));
    }

    #[test]
    fn the_server_is_loopback_only_and_takes_only_the_knobs_given() {
        let args = args_for(Path::new("m.safetensors"), 1234, None);
        assert_eq!(
            args,
            vec!["-m", "m.safetensors", "--listen-ip", "127.0.0.1", "--listen-port", "1234", "--vae-tiling"]
        );
        assert!(!args.iter().any(|a| a == "-t"));
        let threaded = args_for(Path::new("m.safetensors"), 1234, Some(4));
        assert_eq!(threaded[threaded.len() - 2..], ["-t".to_string(), "4".to_string()]);
        // Every address this module builds is this machine.
        assert_eq!(base_url(1234), "http://127.0.0.1:1234");
    }

    #[test]
    fn ports_are_bounded_and_default_to_sd_servers_own() {
        assert_eq!(valid_port(None).unwrap(), DEFAULT_PORT);
        assert_eq!(valid_port(Some(7860)).unwrap(), 7860);
        assert!(valid_port(Some(80)).is_err());
        assert!(valid_port(Some(0)).is_err());
    }

    #[test]
    fn a_job_id_cannot_walk_the_url() {
        assert_eq!(valid_job_id(" job_01HTXYZABC ").unwrap(), "job_01HTXYZABC");
        assert!(valid_job_id("../capabilities").is_err());
        assert!(valid_job_id("a/b").is_err());
        assert!(valid_job_id("").is_err());
        assert!(valid_job_id(&"x".repeat(65)).is_err());
    }

    #[test]
    fn the_job_body_is_the_documented_one() {
        let body = job_body("a cat", "", 512, 768, Some(20), Some(7), None, None);
        assert_eq!(body["prompt"], "a cat");
        assert_eq!(body["negative_prompt"], "");
        assert_eq!(body["width"], 512);
        assert_eq!(body["height"], 768);
        assert_eq!(body["batch_count"], 1);
        assert_eq!(body["sample_params"]["sample_steps"], 20);
        assert_eq!(body["seed"], 7);
        // Nothing is invented when nothing was asked for.
        let bare = job_body("a cat", "", 512, 512, None, None, None, None);
        assert!(bare.get("sample_params").is_none());
        assert!(bare.get("seed").is_none());
        // A draw never carries the edit pair.
        assert!(bare.get("init_image").is_none());
        assert!(bare.get("strength").is_none());
    }

    #[test]
    fn an_edit_is_the_same_job_with_the_picture_attached() {
        let edit = job_body("bluer", "", 512, 512, None, None, Some("QUJD"), None);
        assert_eq!(edit["init_image"], "QUJD");
        assert_eq!(edit["strength"], DEFAULT_EDIT_STRENGTH);
        // The body alone carries no mask; `with_mask` adds a painted one.
        assert!(edit.get("mask_image").is_none());
        // A strength nobody could mean is clamped rather than refused upstream.
        let strong = job_body("bluer", "", 512, 512, None, None, Some("QUJD"), Some(9.0));
        assert_eq!(strong["strength"], 1.0);
    }

    #[test]
    fn a_source_picture_is_base64_or_it_is_refused() {
        assert_eq!(valid_init_image(" QUJD ").unwrap(), "QUJD");
        let url = "data:image/png;base64,QUJD";
        assert_eq!(valid_init_image(url).unwrap(), url);
        // Not a picture, not a path, not a link this process would go and read.
        assert!(valid_init_image("data:text/plain;base64,QUJD").is_err());
        assert!(valid_init_image("C:\\Users\\me\\secret.png").is_err());
        assert!(valid_init_image("example.com/holiday.png").is_err());
        assert!(valid_init_image("   ").is_err());
        assert!(valid_init_image(&"A".repeat(MAX_INIT_IMAGE_CHARS + 1)).is_err());
    }

    #[test]
    fn a_size_the_machine_cannot_draw_is_refused() {
        assert_eq!(valid_side(512, "width").unwrap(), 512);
        assert!(valid_side(500, "width").is_err(), "not a multiple of 64");
        assert!(valid_side(40000, "width").is_err());
        assert!(valid_side(0, "width").is_err());
    }

    #[test]
    fn an_edit_model_is_known_by_its_name_or_its_sets_diffusion_part() {
        assert!(edits_by_reference(Path::new("m/Qwen-Image-Edit-2509-Q4_K_M.gguf")));
        assert!(edits_by_reference(Path::new("m/flux1-kontext-dev-Q4_0.gguf")));
        assert!(!edits_by_reference(Path::new("m/v1-5-pruned-emaonly.safetensors")));
        assert!(!edits_by_reference(Path::new("")), "no server, no edit route");
        // FLUX.2 draws and edits with one set of weights: a reference, never img2img.
        assert!(edits_by_reference(Path::new("m/flux-2-klein-4b.safetensors")));
        assert!(edits_by_reference(Path::new("m/flux2-dev-Q4_K_S.gguf")));
        assert!(!edits_by_reference(Path::new("m/flux1-schnell-Q4_0.gguf")), "FLUX.1 schnell only draws");
    }

    #[test]
    fn a_flux_family_brings_its_own_steps_and_cfg_and_nothing_else_is_touched() {
        let klein = family_of(Path::new("m/flux-2-klein-4b-Q8_0.gguf")).unwrap();
        assert_eq!((klein.cfg, klein.steps), (1.0, 4));
        let base = family_of(Path::new("m/flux-2-klein-base-9b.safetensors")).unwrap();
        assert_eq!((base.cfg, base.steps), (4.0, 20));
        let dev = family_of(Path::new("m/flux2-dev-Q4_K_S.gguf")).unwrap();
        assert_eq!((dev.cfg, dev.steps), (1.0, 20));
        let schnell = family_of(Path::new("m/flux1-schnell-Q4_0.gguf")).unwrap();
        assert_eq!((schnell.cfg, schnell.steps), (1.0, 4));
        assert!(family_of(Path::new("m/v1-5-pruned-emaonly.safetensors")).is_none());

        // The caller's steps win; the family fills the gap and sets the cfg.
        let asked = with_family(job_body("a cat", "", 512, 512, Some(12), None, None, None), Some(klein));
        assert_eq!(asked["sample_params"]["sample_steps"], 12);
        assert_eq!(asked["sample_params"]["guidance"]["txt_cfg"], 1.0);
        let bare = with_family(job_body("a cat", "", 512, 512, None, None, None, None), Some(klein));
        assert_eq!(bare["sample_params"]["sample_steps"], 4);
        let plain = job_body("a cat", "", 512, 512, None, None, None, None);
        assert_eq!(with_family(plain.clone(), None), plain, "an unknown model keeps sd-server's defaults");
    }

    #[test]
    fn qwen_image_brings_its_own_numbers_and_only_edit_2511_gets_model_args() {
        let q = family_of(Path::new("m/qwen_image_fp8_e4m3fn.safetensors")).unwrap();
        assert_eq!(q.label, "Qwen-Image");
        assert_eq!((q.cfg, q.steps), (2.5, 20));
        assert_eq!(q.sampler, Some("euler"));
        assert_eq!(q.shift, Some(3.0));
        assert!(family_of(Path::new("m/Qwen2.5-VL-7B-Instruct-q4_0.gguf")).is_none(), "the encoder is not a family");

        let body = with_family(job_body("a cat", "", 512, 512, None, None, None, None), Some(q));
        assert_eq!(body["sample_params"]["sample_method"], "euler");
        assert_eq!(body["sample_params"]["flow_shift"], 3.0);
        assert_eq!(body["sample_params"]["guidance"]["txt_cfg"], 2.5);
        assert_eq!(body["sample_params"]["sample_steps"], 20);
        // The caller's own numbers still win.
        let asked = with_family(job_body("a cat", "", 512, 512, Some(40), None, None, None), Some(q));
        assert_eq!(asked["sample_params"]["sample_steps"], 40);

        assert_eq!(
            model_args_for(Path::new("m/q/qwen_image_edit_2511_fp8_e4m3fn.safetensors")),
            vec!["--model-args".to_string(), "qwen_image_zero_cond_t=true".to_string()]
        );
        assert!(model_args_for(Path::new("m/q/qwen_image_edit_2509_fp8.safetensors")).is_empty());
        assert!(model_args_for(Path::new("m/q/qwen_image_2512_fp8.safetensors")).is_empty(), "2512 changed the convention");
        assert!(model_args_for(Path::new("m/flux-2-klein-4b.safetensors")).is_empty());
        let args = args_for_set(
            &SetParts {
                diffusion: PathBuf::from("q/qwen_image_edit_2511_fp8.safetensors"),
                vae: None,
                llm: None,
                llm_vision: None,
                clip_l: None,
                t5xxl: None,
            },
            1234,
            None,
        );
        assert!(args.windows(2).any(|w| w[0] == "--model-args" && w[1] == "qwen_image_zero_cond_t=true"));
    }

    #[test]
    fn an_edit_model_gets_the_picture_as_a_reference_not_a_starting_point() {
        let pixels = job_body("make it red", "", 512, 512, None, None, Some("QUJD"), Some(0.6));
        let moved = by_reference(pixels);
        assert_eq!(moved["ref_images"], serde_json::json!(["QUJD"]));
        assert!(moved.get("init_image").is_none(), "one route, not both");
        assert!(moved.get("strength").is_none(), "strength belongs to image-to-image");
        assert_eq!(moved["prompt"], "make it red", "the rest of the job is untouched");

        let draw = job_body("a cat", "", 512, 512, None, None, None, None);
        assert_eq!(by_reference(draw.clone()), draw, "a plain draw has nothing to move");
    }

    #[test]
    fn a_mask_rides_only_beside_the_picture_it_marks() {
        let edit = job_body("a red cube", "", 384, 384, None, None, Some("SRC"), Some(1.0));
        let masked = with_mask(edit.clone(), Some("MASK"));
        assert_eq!(masked["mask_image"], "MASK");
        assert_eq!(masked["init_image"], "SRC", "the picture is still the one being changed");
        assert_eq!(with_mask(edit.clone(), None), edit, "no mask, no field");
        assert_eq!(with_mask(edit.clone(), Some("  ")), edit, "an empty mask is no mask");

        let draw = job_body("a cat", "", 512, 512, None, None, None, None);
        assert!(with_mask(draw, Some("MASK")).get("mask_image").is_none(), "a mask of nothing is dropped");

        // An edit model reads the picture whole, so the mask goes with init_image.
        let moved = by_reference(masked);
        assert!(moved.get("mask_image").is_none());
        assert_eq!(moved["ref_images"], serde_json::json!(["SRC"]));
    }

    #[test]
    fn a_card_without_fp16_is_named_for_a_large_model_only() {
        let weak = "load_backend: loaded Vulkan backend\nggml_vulkan: 0 = NVIDIA GeForce GTX 1050 Ti (NVIDIA) | uma: 0 | fp16: 0 | bf16: 0 | warp size: 32\n";
        let said = gpu_warning(weak, true);
        assert!(said.starts_with("NVIDIA GeForce GTX 1050 Ti (NVIDIA) has no fp16"), "{}", said);
        assert!(said.contains("Stable Diffusion 1.5"), "and what does work");
        assert_eq!(gpu_warning(weak, false), "", "a single checkpoint drew fine on it");

        let strong = "ggml_vulkan: 0 = AMD Radeon RX 7600 (AMD) | uma: 0 | fp16: 1 | bf16: 1\n";
        assert_eq!(gpu_warning(strong, true), "");
        assert_eq!(gpu_warning("", true), "", "a CPU-only log says nothing about a card");
    }

    #[test]
    fn the_links_are_pages_on_allowed_hosts() {
        assert!(RELEASES_URL.starts_with("https://github.com/"));
        assert!(MODELS_URL.starts_with("https://huggingface.co/"));
    }
}
