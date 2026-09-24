// Git, read-only and one clone: what the project chip, the Changes panel and
// the new-chat picker need. Every command runs `git` itself (nothing here
// rewrites history or touches a remote except `clone`), with
// GIT_TERMINAL_PROMPT=0 so a clone that wants a password fails at once
// instead of hanging the app on a prompt nobody can see.
//
// The parsing and the URL check are pure functions with tests; the commands
// only run git and hand the text to them.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

/// A diff larger than this is cut, with a line saying so: the panel is for
/// reading a change, not for paging a generated file.
const MAX_DIFF_BYTES: usize = 200 * 1024;
const CLONE_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Change {
    pub path: String,
    /// `M` modified, `A` added, `D` deleted, `R` renamed, `?` untracked, `C` conflict.
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Status {
    pub repo: bool,
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub changes: Vec<Change>,
}

/// `git status --porcelain=v1 -b` -> Status. The first line names the branch
/// (`## main...origin/main [ahead 1]`); every other line is `XY path`.
pub fn parse_status(text: &str) -> Status {
    let mut out = Status { repo: true, branch: String::new(), ahead: 0, behind: 0, changes: Vec::new() };
    for line in text.lines() {
        if let Some(head) = line.strip_prefix("## ") {
            let name = head.split("...").next().unwrap_or(head);
            out.branch = name
                .strip_prefix("No commits yet on ")
                .unwrap_or(name)
                .trim()
                .to_string();
            if let Some(bracket) = head.find('[') {
                let inside = &head[bracket + 1..head.len().saturating_sub(1)];
                for part in inside.split(',') {
                    let part = part.trim();
                    if let Some(n) = part.strip_prefix("ahead ") {
                        out.ahead = n.trim().parse().unwrap_or(0);
                    } else if let Some(n) = part.strip_prefix("behind ") {
                        out.behind = n.trim().parse().unwrap_or(0);
                    }
                }
            }
            continue;
        }
        if line.len() < 4 {
            continue;
        }
        let (xy, rest) = line.split_at(2);
        let path = rest.trim_start();
        // A rename reads `R  old -> new`; the new name is the one that exists.
        let path = path.rsplit(" -> ").next().unwrap_or(path);
        let status = match xy {
            "??" => "?",
            "!!" => continue,
            s if s.contains('U') || s == "AA" || s == "DD" => "C",
            s if s.starts_with('R') || s.ends_with('R') => "R",
            s if s.starts_with('A') || s.ends_with('A') => "A",
            s if s.starts_with('D') || s.ends_with('D') => "D",
            _ => "M",
        };
        out.changes.push(Change { path: path.trim_matches('"').to_string(), status: status.to_string() });
    }
    out
}

/// The name a clone lands under: the last path segment, without `.git`.
pub fn repo_name(url: &str) -> Option<String> {
    let trimmed = url.trim().trim_end_matches('/');
    let last = trimmed.rsplit(['/', ':']).next()?;
    let name = last.strip_suffix(".git").unwrap_or(last);
    let clean: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')).collect();
    if clean.is_empty() || clean == "." || clean == ".." {
        None
    } else {
        Some(clean)
    }
}

/// Only an https URL, or GitHub's ssh form, is cloned: anything that could
/// be read by git as an option (`-`), a local path, or a scheme git would
/// run a helper for (`ext::`) is refused before git sees it.
pub fn check_clone_url(url: &str) -> Result<String, String> {
    let u = url.trim();
    if u.is_empty() {
        return Err("Paste the repository's URL first.".to_string());
    }
    if u.starts_with('-') || u.contains(char::is_whitespace) {
        return Err("That does not look like a repository URL.".to_string());
    }
    if let Some(rest) = u.strip_prefix("https://") {
        let host = rest.split('/').next().unwrap_or("");
        if host.is_empty() || host.contains('@') || !host.contains('.') {
            return Err("An https URL needs a host name, without a password in it.".to_string());
        }
        return Ok(u.to_string());
    }
    if let Some(rest) = u.strip_prefix("git@") {
        if rest.starts_with("github.com:") || rest.starts_with("gitlab.com:") || rest.starts_with("codeberg.org:") {
            return Ok(u.to_string());
        }
        return Err("Only git@github.com, git@gitlab.com and git@codeberg.org are accepted in the ssh form; use https for others.".to_string());
    }
    Err("Only https:// (or git@github.com:…) repository URLs are cloned.".to_string())
}

fn git(root: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|e| format!("git is not available: {e}"))
}

/// The folder's branch and its uncommitted changes; `repo: false` when the
/// folder is not inside a git repository (not an error: most folders are not).
#[tauri::command(async)]
pub fn local_git_status(root: String) -> Result<Status, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("That folder is not there any more: {}", root));
    }
    let out = git(&root_path, &["status", "--porcelain=v1", "-b", "--untracked-files=normal"])?;
    if !out.status.success() {
        return Ok(Status { repo: false, branch: String::new(), ahead: 0, behind: 0, changes: Vec::new() });
    }
    Ok(parse_status(&String::from_utf8_lossy(&out.stdout)))
}

/// The uncommitted diff of one file (or of everything, with no path), as
/// text. An untracked file shows as its whole content added.
#[tauri::command(async)]
pub fn local_git_diff(root: String, path: Option<String>) -> Result<String, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("That folder is not there any more: {}", root));
    }
    let mut args: Vec<String> = vec!["diff".into(), "--no-color".into(), "--no-ext-diff".into(), "HEAD".into(), "--".into()];
    let rel = path.unwrap_or_default();
    if !rel.trim().is_empty() {
        crate::local::resolve_inside(&root_path, &rel)?;
        args.push(rel.trim().to_string());
    }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = git(&root_path, &refs)?;
    let mut text = String::from_utf8_lossy(&out.stdout).to_string();
    if text.trim().is_empty() && !rel.trim().is_empty() {
        // Not in HEAD yet: show the file as all-new, through git's own diff.
        let untracked = git(&root_path, &["diff", "--no-color", "--no-index", "--", "/dev/null", rel.trim()])?;
        text = String::from_utf8_lossy(&untracked.stdout).to_string();
    }
    if text.len() > MAX_DIFF_BYTES {
        let mut cut = text[..MAX_DIFF_BYTES].to_string();
        cut.push_str("\n… (the diff is longer than 200 KB and was cut here)\n");
        text = cut;
    }
    Ok(text)
}

/// `git clone <url>` into `<parent>/<repo name>`; refuses to overwrite.
/// Returns the new folder. Runs with no prompt and a ten-minute cap.
#[tauri::command(async)]
pub fn local_git_clone(url: String, parent: String) -> Result<String, String> {
    let clean = check_clone_url(&url)?;
    let name = repo_name(&clean).ok_or_else(|| "Could not tell the repository's name from that URL.".to_string())?;
    let parent_path = PathBuf::from(&parent);
    std::fs::create_dir_all(&parent_path).map_err(|e| format!("could not make {}: {e}", parent_path.display()))?;
    let dest = parent_path.join(&name);
    if dest.exists() {
        return Err(format!("{} already exists — open it instead.", dest.display()));
    }
    let mut child = Command::new("git")
        .arg("clone")
        .arg("--")
        .arg(&clean)
        .arg(&dest)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("git is not available: {e}"))?;
    let stderr = child.stderr.take();
    let started = std::time::Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if started.elapsed() > CLONE_TIMEOUT {
                    let _ = child.kill();
                    let _ = std::fs::remove_dir_all(&dest);
                    return Err("The clone took longer than ten minutes and was stopped.".to_string());
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(format!("git clone failed: {e}")),
        }
    };
    if !status.success() {
        let mut why = String::new();
        if let Some(mut s) = stderr {
            use std::io::Read;
            let _ = s.read_to_string(&mut why);
        }
        let _ = std::fs::remove_dir_all(&dest);
        let line = why.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("git clone failed");
        return Err(line.trim().to_string());
    }
    Ok(dest.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn porcelain_status_reads_the_branch_the_counts_and_every_kind_of_change() {
        let text = "## feature...origin/feature [ahead 2, behind 1]\n M src/a.ts\nA  src/b.ts\n D src/c.ts\nR  old.ts -> new.ts\n?? notes.md\n!! build/\nUU merge.ts\n";
        let s = parse_status(text);
        assert_eq!(s.branch, "feature");
        assert_eq!((s.ahead, s.behind), (2, 1));
        let rows: Vec<(String, String)> = s.changes.iter().map(|c| (c.path.clone(), c.status.clone())).collect();
        assert_eq!(rows, vec![
            ("src/a.ts".into(), "M".into()),
            ("src/b.ts".into(), "A".into()),
            ("src/c.ts".into(), "D".into()),
            ("new.ts".into(), "R".into()),
            ("notes.md".into(), "?".into()),
            ("merge.ts".into(), "C".into()),
        ]);
        let fresh = parse_status("## No commits yet on main\n?? a\n");
        assert_eq!(fresh.branch, "main");
        assert_eq!(parse_status("").branch, "");
    }

    #[test]
    fn a_clone_url_is_https_or_a_known_ssh_host_and_never_an_option() {
        assert!(check_clone_url("https://github.com/o/r.git").is_ok());
        assert!(check_clone_url("git@github.com:o/r.git").is_ok());
        assert!(check_clone_url("--upload-pack=evil https://x.y/z").is_err());
        assert!(check_clone_url("ext::sh -c evil").is_err());
        assert!(check_clone_url("/home/me/repo").is_err());
        assert!(check_clone_url("https://user:pw@github.com/o/r").is_err());
        assert!(check_clone_url("git@evil.example:o/r").is_err());
        assert!(check_clone_url("").is_err());
        assert_eq!(repo_name("https://github.com/o/My-Repo.git").as_deref(), Some("My-Repo"));
        assert_eq!(repo_name("git@github.com:o/r").as_deref(), Some("r"));
        assert_eq!(repo_name("https://github.com/o/r/").as_deref(), Some("r"));
        assert_eq!(repo_name("https://x.y/..").as_deref(), None);
    }
}
