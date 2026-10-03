// Opt-in, counts-only telemetry (U01).
//
// Default off, aggregate counters only: launches, Doctor runs, crashes,
// finished downloads, finished runs. Never prompts, keys, paths, model
// text, or anything that could identify a person or a project. There is no
// network in this module at all: the counts live in a JSON file next to the
// crash log, the Diagnostics card shows them, and "sharing" means the user
// copies the numbers into a bug report. A telemetry that phones home would
// need a destination, a policy and a consent flow this project has not
// designed; counts on disk need none of those and still answer "how often
// does the Doctor fail" for the first time.
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// The only events that can be counted. Anything else passed to
/// `telemetry_record` is ignored, so a new call site cannot silently invent
/// a new thing to count: adding an event means editing this list, in review.
pub const ALLOWED_EVENTS: &[&str] = &["launch", "doctor_run", "crash", "download_done", "run_done"];

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct Store {
    enabled: bool,
    counts: BTreeMap<String, u64>,
}

fn store_path() -> PathBuf {
    if let Ok(dir) = std::env::var("NEURAOS_STATE_DIR") {
        return Path::new(&dir).join("telemetry.json");
    }
    #[cfg(target_os = "linux")]
    {
        crate::linux::paths::state_dir("neuraos").join("telemetry.json")
    }
    #[cfg(not(target_os = "linux"))]
    {
        std::env::temp_dir().join("neuraos-telemetry.json")
    }
}

fn load(path: &Path) -> Store {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save(path: &Path, store: &Store) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

pub fn record_event(path: &Path, event: &str) -> bool {
    if !ALLOWED_EVENTS.contains(&event) {
        return false;
    }
    let mut store = load(path);
    if !store.enabled {
        return false;
    }
    *store.counts.entry(event.to_string()).or_insert(0) += 1;
    save(path, &store).is_ok()
}

#[derive(serde::Serialize)]
pub struct TelemetryState {
    pub enabled: bool,
    pub counts: BTreeMap<String, u64>,
}

#[tauri::command]
pub fn telemetry_get() -> TelemetryState {
    let store = load(&store_path());
    TelemetryState { enabled: store.enabled, counts: store.counts }
}

#[tauri::command]
pub fn telemetry_set(enabled: bool) -> TelemetryState {
    let path = store_path();
    let mut store = load(&path);
    store.enabled = enabled;
    if !enabled {
        store.counts.clear();
    }
    let _ = save(&path, &store);
    TelemetryState { enabled: store.enabled, counts: store.counts }
}

#[tauri::command]
pub fn telemetry_record(event: String) -> bool {
    record_event(&store_path(), &event)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("neuraos-telemetry-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        dir.join("telemetry.json")
    }

    #[test]
    fn disabled_counts_nothing_and_unknown_events_never_count() {
        let path = tmp();
        let _ = std::fs::remove_file(&path);
        assert!(!record_event(&path, "launch"), "off by default");
        assert!(!record_event(&path, "keystrokes"), "not allowlisted");
        assert!(!record_event(&path, "../../etc/passwd"), "not an event at all");
        assert!(!path.exists(), "counting nothing writes nothing");
    }

    #[test]
    fn enabling_counts_only_allowlisted_events_and_disabling_wipes() {
        let path = tmp();
        let _ = std::fs::remove_file(&path);
        let mut store = load(&path);
        store.enabled = true;
        save(&path, &store).unwrap();
        assert!(record_event(&path, "launch"));
        assert!(record_event(&path, "launch"));
        assert!(!record_event(&path, "chats_read"));
        let state = load(&path);
        assert_eq!(state.counts.get("launch"), Some(&2));
        assert!(!state.counts.contains_key("chats_read"));
        let mut off = load(&path);
        off.enabled = false;
        off.counts.clear();
        save(&path, &off).unwrap();
        let wiped = load(&path);
        assert!(wiped.counts.is_empty(), "opting out deletes the history");
        let _ = std::fs::remove_file(&path);
    }
}
