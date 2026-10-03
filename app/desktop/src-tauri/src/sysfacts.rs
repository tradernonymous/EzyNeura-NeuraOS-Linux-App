// Machine facts the guards share (U04 disk, U06 log vacuum, U07 power and
// metered link, U35 driver sanity).
//
// Everything here is read-only and dependency-free: sysfs reads and a few
// well-known commands, the same sources the Doctor's shell probe uses. The
// parsing is pure and unit-tested; only the last inch shells out, and every
// shell-out degrades to "unknown" (None/false) instead of an error, because
// a missing nmcli is not a fact about the machine.
use std::path::Path;

#[derive(serde::Serialize, Default)]
pub struct SysFacts {
    /// Free bytes on the filesystem holding `path`, if it could be read.
    pub disk_free_bytes: Option<u64>,
    pub disk_path: String,
    /// Some(true) discharging, Some(false) on AC, None when there is no
    /// battery to ask (a desktop) or sysfs could not be read.
    pub on_battery: Option<bool>,
    /// Some(true) when NetworkManager reports a metered default connection.
    pub metered: Option<bool>,
    /// nvidia-smi answered: the proprietary driver is present.
    pub nvidia_driver: bool,
    /// The nouveau module is loaded (open driver in use).
    pub nouveau_loaded: bool,
    /// A Vulkan ICD manifest exists (what the Vulkan llama.cpp build needs).
    pub vulkan_icd: bool,
}

/// Bytes for a human sentence ("Only 41 GB free on …"). Shared with the
/// download guard so the refusal and the Doctor name the same number.
pub fn bytes_label(bytes: u64) -> String {
    const GB: u64 = 1024 * 1024 * 1024;
    const MB: u64 = 1024 * 1024;
    if bytes >= 10 * GB {
        format!("{} GB", bytes / GB)
    } else if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else {
        format!("{} MB", bytes / MB)
    }
}

/// `df -k --output=avail <path>` ends in a banner line and a number of
/// kibibytes. Anything else (an error, a different df) is not a fact.
pub fn parse_df_avail_kb(stdout: &str) -> Option<u64> {
    let last = stdout.lines().rev().map(str::trim).find(|l| !l.is_empty())?;
    if !last.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    last.parse::<u64>().ok()?.checked_mul(1024)
}

fn disk_free_bytes(path: &Path) -> Option<u64> {
    #[cfg(target_os = "linux")]
    {
        let out = std::process::Command::new("df")
            .args(["-k", "--output=avail"])
            .arg(path)
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        parse_df_avail_kb(&String::from_utf8_lossy(&out.stdout))
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = path;
        None
    }
}

/// sysfs power supplies: a Battery that is not Discharging/Charging/Full
/// means the machine runs on battery power right now.
fn battery_state() -> Option<bool> {
    #[cfg(target_os = "linux")]
    {
        let mut saw_battery = false;
        let mut discharging = false;
        let dir = std::fs::read_dir("/sys/class/power_supply").ok()?;
        for entry in dir.flatten() {
            let base = entry.path();
            let kind = std::fs::read_to_string(base.join("type")).unwrap_or_default();
            if kind.trim() != "Battery" {
                continue;
            }
            saw_battery = true;
            let status = std::fs::read_to_string(base.join("status")).unwrap_or_default();
            if status.trim() == "Discharging" {
                discharging = true;
            }
        }
        if saw_battery {
            Some(discharging)
        } else {
            None
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

/// `nmcli -t -f GENERAL.METERED dev show` prints lines like
/// `GENERAL.METERED:yes (guessed)` for the default connection. Absent
/// NetworkManager (or absent nmcli) is None, not "unmetered": guessing
/// wrong here pauses downloads the user wanted.
fn metered_state() -> Option<bool> {
    #[cfg(target_os = "linux")]
    {
        let out = std::process::Command::new("nmcli")
            .args(["-t", "-f", "GENERAL.METERED", "dev", "show"])
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        parse_nmcli_metered(&String::from_utf8_lossy(&out.stdout))
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

pub fn parse_nmcli_metered(stdout: &str) -> Option<bool> {
    let mut saw = false;
    let mut metered = false;
    for line in stdout.lines() {
        let value = line.split(':').nth(1).unwrap_or("").trim().to_lowercase();
        if value.starts_with("yes") {
            saw = true;
            metered = true;
        } else if value.starts_with("no") {
            saw = true;
        }
    }
    if saw {
        Some(metered)
    } else {
        None
    }
}

fn nvidia_driver_present() -> bool {
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("nvidia-smi")
            .arg("-L")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

fn nouveau_loaded() -> bool {
    #[cfg(target_os = "linux")]
    {
        Path::new("/sys/module/nouveau").is_dir()
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

#[tauri::command]
pub fn sysfacts(path: String) -> SysFacts {
    SysFacts {
        disk_free_bytes: disk_free_bytes(Path::new(&path)),
        disk_path: path,
        on_battery: battery_state(),
        metered: metered_state(),
        nvidia_driver: nvidia_driver_present(),
        nouveau_loaded: nouveau_loaded(),
        vulkan_icd: crate::linux::gpu::vulkan_icd_present(),
    }
}

/// The journalctl invocation behind `engine_log_vacuum`, split out so the
/// exact argv is unit-tested: vacuuming the wrong journal would be silent
/// data loss, so the unit name is a constant, never an argument.
pub fn vacuum_argv() -> Vec<String> {
    vec![
        "journalctl".to_string(),
        "--user".to_string(),
        "--vacuum-size=200M".to_string(),
        "--vacuum-time=30d".to_string(),
    ]
}

/// Shrink the engine's systemd-journal logs (U06). Best-effort by design:
/// a machine without user journals (or without journalctl) gets an
/// explanation, not an error string the UI has to decode.
#[tauri::command]
pub fn engine_log_vacuum() -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        let argv = vacuum_argv();
        let out = std::process::Command::new(&argv[0])
            .args(&argv[1..])
            .output()
            .map_err(|e| format!("journalctl is not available ({})", e))?;
        let detail = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if out.status.success() {
            Ok(if detail.is_empty() {
                "Journal vacuumed to 200M / 30 days.".to_string()
            } else {
                detail
            })
        } else {
            Err(if detail.is_empty() {
                "journalctl refused the vacuum (is this a systemd user session?)".to_string()
            } else {
                detail
            })
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        Err("log vacuuming is a Linux systemd feature".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn df_parses_the_avail_line_and_nothing_else() {
        assert_eq!(parse_df_avail_kb("Avail\n123456\n"), Some(123456 * 1024));
        assert_eq!(parse_df_avail_kb("Avail\n"), None);
        assert_eq!(parse_df_avail_kb("df: /nope: No such file"), None);
        assert_eq!(parse_df_avail_kb(""), None);
    }

    #[test]
    fn df_overflow_cannot_wrap_to_a_small_number() {
        assert_eq!(parse_df_avail_kb("Avail\n18014398509481983\n"), Some(18014398509481983 * 1024));
        assert_eq!(parse_df_avail_kb("Avail\n18014398509481984\n"), None);
    }

    #[test]
    fn nmcli_yes_wins_over_no_and_garbage_is_unknown() {
        assert_eq!(parse_nmcli_metered("GENERAL.METERED:no\n"), Some(false));
        assert_eq!(parse_nmcli_metered("GENERAL.METERED:yes (guessed)\nGENERAL.METERED:no\n"), Some(true));
        assert_eq!(parse_nmcli_metered(""), None);
        assert_eq!(parse_nmcli_metered("GENERAL.METERED:unknown\n"), None);
    }

    #[test]
    fn bytes_reads_like_a_sentence() {
        assert_eq!(bytes_label(41 * 1024 * 1024 * 1024), "41 GB");
        assert_eq!(bytes_label(1_610_612_736), "1.5 GB");
        assert_eq!(bytes_label(41 * 1024 * 1024), "41 MB");
    }

    #[test]
    fn the_vacuum_names_journalctl_with_a_fixed_policy() {
        let argv = vacuum_argv();
        assert_eq!(argv[0], "journalctl");
        assert!(argv.contains(&"--user".to_string()));
        assert!(argv.iter().any(|a| a.starts_with("--vacuum-size=")));
        assert!(argv.iter().any(|a| a.starts_with("--vacuum-time=")));
        // No unit name travels here: vacuuming runs over the user's own
        // journals, never a unit passed in from the page.
        assert!(!argv.iter().any(|a| a.ends_with(".service")));
    }
}
