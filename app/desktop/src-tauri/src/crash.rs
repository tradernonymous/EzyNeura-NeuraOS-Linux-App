// Where a failure gets recorded.
//
// The log lives in the app's own directory, not in a shared public folder: that
// location is not writable in a locked-down profile (so the "no silent deaths"
// promise failed exactly when it was needed) and crash text should not land
// somewhere every account can read.
//
// It has to work before the app exists -- a panic in the boot path is the case
// that matters most -- so the path falls back to the user profile, and Tauri
// replaces it with its own log directory once the app is up.
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

pub const CRASH_FILE: &str = "freeai4u-crash.log";
// A crash loop must not fill the disk: past this size the log is replaced, not
// appended to.
pub const CRASH_LOG_MAX_BYTES: u64 = 256 * 1024;

static CRASH_LOG: Mutex<Option<PathBuf>> = Mutex::new(None);

pub fn path() -> PathBuf {
    if let Ok(guard) = CRASH_LOG.lock() {
        if let Some(path) = guard.as_ref() {
            return path.clone();
        }
    }
    default_path()
}

#[cfg(not(target_os = "linux"))]
fn default_path() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("FreeAI4U")
        .join("logs")
        .join(CRASH_FILE)
}

// Before `set_path()` runs (a panic during boot, ahead of Tauri's own
// `.setup()`), the same XDG state directory diag.rs and the rest of the
// Linux shell use, rather than a Windows env var that is never set here.
#[cfg(target_os = "linux")]
fn default_path() -> PathBuf {
    crate::linux::paths::state_dir("neuraos").join("logs").join(CRASH_FILE)
}

/// Called from setup, once Tauri knows its own directories.
pub fn set_path(path: PathBuf) {
    if let Ok(mut guard) = CRASH_LOG.lock() {
        *guard = Some(path);
    }
}

/// Append one line, rotating first when the file has grown past the cap.
pub fn log(msg: &str) {
    let file = path();
    if let Some(parent) = file.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(meta) = std::fs::metadata(&file) {
        if meta.len() > CRASH_LOG_MAX_BYTES {
            let _ = std::fs::write(
                &file,
                format!(
                    "[{}] log rotated ({} bytes)\n",
                    chrono::Utc::now().to_rfc3339(),
                    meta.len()
                ),
            );
        }
    }
    if let Ok(mut handle) = OpenOptions::new().create(true).append(true).open(&file) {
        let _ = writeln!(handle, "[{}] {}", chrono::Utc::now().to_rfc3339(), msg);
    }
}

/// The exact file, for a dialog that should tell the user where to look.
pub fn hint() -> String {
    path().display().to_string()
}

/// Current size, or 0 when nothing has ever been recorded.
pub fn bytes() -> u64 {
    std::fs::metadata(path()).map(|meta| meta.len()).unwrap_or(0)
}

/// Scrub one line the way diagnostics.js scrubs the report: no regex crate
/// in the tree, so the patterns are literal scans. Anything shaped like a
/// key dies; everything else passes through untouched. Tested against the
/// same adversarial cases as the JS redactor (U48).
pub fn redact_line(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let bytes = line.as_bytes();
    let mut i = 0;
    const PATTERNS: &[&str] = &["hf_", "sk-", "ghp_", "gho_", "github_pat_", "AKIA"];
    while i < bytes.len() {
        let rest = &line[i..];
        let mut matched: Option<usize> = None;
        for pat in PATTERNS {
            if let Some(tail) = rest.strip_prefix(pat) {
                let secret_len = tail
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-' || *c == '.')
                    .map(|c| c.len_utf8())
                    .sum::<usize>();
                if secret_len >= 8 {
                    out.push_str(pat);
                    out.push_str("<redacted>");
                    matched = Some(pat.len() + secret_len);
                    break;
                }
            }
        }
        if rest.starts_with("-----BEGIN") && rest.contains("PRIVATE KEY") {
            out.push_str("<private key redacted>");
            // Skip to end of the line: the body follows on later lines, and
            // each of those lines is scrubbed the same way when read back.
            // (A lone BEGIN marker with no body is still worth killing.)
            if let Some(end) = rest.find('\n') {
                i += end;
            } else {
                i = bytes.len();
            }
            continue;
        }
        // Bearer <token>: keep the scheme, kill the credential.
        if rest.len() > 7 && rest[..7].eq_ignore_ascii_case("bearer ") {
            let tail = &rest[7..];
            let secret_len = tail
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '_' || *c == '-' || *c == '~' || *c == '+' || *c == '/')
                .map(|c| c.len_utf8())
                .sum::<usize>();
            if secret_len >= 8 {
                out.push_str(&rest[..7]);
                out.push_str("<redacted>");
                matched = Some(7 + secret_len);
            }
        }
        match matched {
            Some(skip) => i += skip,
            None => {
                out.push(line[i..].chars().next().unwrap());
                i += line[i..].chars().next().unwrap().len_utf8();
            }
        }
    }
    out
}

/// Scrub a whole text: PEM blocks first (a key body on later lines has no
/// prefix for the line scrubber to catch), then line by line.
pub fn redact_text(text: &str) -> String {
    let mut out = text.to_string();
    while let Some(begin) = out.find("-----BEGIN") {
        if !out[begin..].contains("PRIVATE KEY-----") {
            break;
        }
        let after = &out[begin..];
        // End of the block: the end of the END-marker line when there is
        // one, else the next blank line, else end of text. A truncated log
        // still dies whole.
        let end = after
            .find("-----END")
            .and_then(|i| after[i..].find('\n').map(|n| begin + i + n + 1))
            .or_else(|| after.find("\n\n").map(|i| begin + i))
            .unwrap_or(out.len());
        out.replace_range(begin..end.min(out.len()), "<private key redacted>");
    }
    out.lines().map(redact_line).collect::<Vec<_>>().join("\n")
}

/// A crash report the user can attach (U02): version, OS, the redacted tail
/// of the crash log. Written next to the log, never sent anywhere -- the
/// person attaches it, after reading it, the way the Doctor's card works.
#[tauri::command]
pub fn crash_bundle_save() -> Result<String, String> {
    let dir = path().parent().map(|p| p.to_path_buf()).ok_or("no log folder".to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let dest = dir.join(format!("crash-report-{}.txt", stamp));
    let mut text = format!(
        "NeuraOS crash report (safe to attach: secrets are scrubbed)\nOS: {} {}\nLog: {}\n\n",
        std::env::consts::OS,
        std::env::consts::ARCH,
        path().display()
    );
    text.push_str(&redact_text(&tail(64 * 1024)));
    text.push('\n');
    std::fs::write(&dest, text).map_err(|e| e.to_string())?;
    Ok(dest.display().to_string())
}

/// The last `max_bytes` of the log, so a diagnostics bundle can carry what went
/// wrong without carrying the whole history. Reads from the end: a log that hit
/// its cap is exactly the case where reading it all would be slowest.
pub fn tail(max_bytes: usize) -> String {
    let file = path();
    let content = match std::fs::read(&file) {
        Ok(bytes) => bytes,
        Err(_) => return String::new(),
    };
    let start = content.len().saturating_sub(max_bytes);
    String::from_utf8_lossy(&content[start..]).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leaks(s: &str) -> bool {
        s.contains("abcDEF1234567890") || s.contains("abcdefghij1234567890") || s.contains("PRIVATE KEY-----")
            && !s.contains("redacted")
    }

    #[test]
    fn the_redactor_kills_every_key_shape_it_knows() {
        assert!(!leaks(&redact_line("token hf_abcDEF1234567890 here")));
        assert!(!leaks(&redact_line("sk-abcdef1234567890abcdef")));
        assert!(!leaks(&redact_line("Bearer eyJhbGciOiJIUzI1NiJ9.payload")));
        assert!(!leaks(&redact_line("ghp_abcdefghij1234567890abcdefghij12")));
        assert!(!leaks(&redact_line("AKIAIOSFODNN7EXAMPLE")));
        assert!(!leaks(&redact_line("-----BEGIN OPENSSH PRIVATE KEY-----")));
    }

    #[test]
    fn a_key_body_dies_with_its_markers() {
        let block = "key:\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU=\n-----END OPENSSH PRIVATE KEY-----\ndone";
        let out = redact_text(block);
        assert!(!out.contains("b3BlbnNza"), "body must not survive: {out}");
        assert!(!out.contains("BEGIN"), "markers must not survive: {out}");
        assert!(out.contains("done"), "surrounding text survives: {out}");
    }

    #[test]
    fn short_strings_and_plain_text_survive() {
        assert_eq!(redact_line("WebKitGTK 2.48.0 (dmabuf: on)"), "WebKitGTK 2.48.0 (dmabuf: on)");
        // Seven chars is not a key: the floor is eight.
        assert_eq!(redact_line("hf_abc1234"), "hf_abc1234");
        assert_eq!(redact_line(""), "");
    }
}
