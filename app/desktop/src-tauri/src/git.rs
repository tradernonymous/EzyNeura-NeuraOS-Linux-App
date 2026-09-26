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
    /// True when part of the change is in the index (staged): porcelain's
    /// first column. Unstaging only makes sense for these.
    pub staged: bool,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Status {
    pub repo: bool,
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    /// The `origin` URL as written (checked again before push/pull touch the
    /// network); '' when the folder has no origin.
    pub remote: String,
    /// False in a repository with no commits yet: nothing to amend or push.
    pub head: bool,
    pub changes: Vec<Change>,
}

/// `git status --porcelain=v1 -b` -> Status. The first line names the branch
/// (`## main...origin/main [ahead 1]`); every other line is `XY path`.
pub fn parse_status(text: &str) -> Status {
    let mut out = Status { repo: true, branch: String::new(), ahead: 0, behind: 0, remote: String::new(), head: false, changes: Vec::new() };
    for line in text.lines() {
        if let Some(head) = line.strip_prefix("## ") {
            let name = head.split("...").next().unwrap_or(head);
            // "No commits yet on main" is porcelain's unborn-HEAD line.
            out.head = !name.starts_with("No commits yet");
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
        // The first column of XY is the index: a letter there means part of
        // the change is staged ("M " fully, "MM" partly; "??" never is).
        let staged = xy.chars().next().map(|c| c != ' ' && c != '?').unwrap_or(false);
        out.changes.push(Change { path: path.trim_matches('"').to_string(), status: status.to_string(), staged });
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

/// The remote's URL, checked before any command reaches the network: the
/// same rules a clone URL must pass, plus local paths (no network, so
/// nothing to fake). The host is also shown to the person, so the push
/// button says where it will push to.
pub fn check_remote_url(url: &str) -> Result<String, String> {
    let u = url.trim();
    if u.starts_with('/') || u.starts_with("./") || u.starts_with("../") || u.starts_with("file://") {
        return Ok(u.to_string());
    }
    check_clone_url(u)
}

/// The host a remote URL names — `github.com` from either form — for the
/// button's tooltip and the toast. '' for a local path.
pub fn remote_host(url: &str) -> String {
    let u = url.trim();
    if let Some(rest) = u.strip_prefix("git@") {
        return rest.split(':').next().unwrap_or("").to_string();
    }
    for scheme in ["https://", "http://", "ssh://", "git://"] {
        if let Some(rest) = u.strip_prefix(scheme) {
            let authority = rest.split('/').next().unwrap_or("");
            let host = authority.rsplit('@').next().unwrap_or(authority);
            return host.split(':').next().unwrap_or(host).to_string();
        }
    }
    String::new()
}

/// `origin`'s URL, or the first remote's, or '' when the folder has none.
fn remote_url(root: &Path) -> String {
    for name in ["origin", "upstream"] {
        if let Ok(out) = git(root, &["remote", "get-url", name]) {
            if out.status.success() {
                let url = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !url.is_empty() {
                    return url;
                }
            }
        }
    }
    String::new()
}

fn remote_name(root: &Path) -> Result<String, String> {
    let out = git(root, &["remote"])?;
    // The lossy Cow outlives the iterator built from it.
    let text = String::from_utf8_lossy(&out.stdout);
    let mut names = text.lines().map(str::trim).filter(|l| !l.is_empty());
    let preferred = names.clone().find(|n| *n == "origin").map(str::to_string);
    preferred
        .or_else(|| names.next().map(str::to_string))
        .ok_or_else(|| "This folder has no remote to push to or pull from. Set one in a terminal: git remote add origin <url>".to_string())
}

/// HEAD exists? A repository with no commits cannot push, pull or amend.
fn has_head(root: &Path) -> Result<bool, String> {
    let out = git(root, &["rev-parse", "--verify", "--quiet", "HEAD"])?;
    Ok(out.status.success())
}

fn current_branch(root: &Path) -> Result<String, String> {
    let out = git(root, &["symbolic-ref", "--short", "HEAD"])?;
    if !out.status.success() {
        return Err("You are not on a branch (detached HEAD). Check out a branch first.".to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// git's own words for a failed push, said in this app's words instead.
pub fn push_error(stderr: &str) -> String {
    let lower = stderr.to_lowercase();
    if lower.contains("non-fast-forward") || lower.contains("fetch first") || lower.contains("rejected") {
        return "The remote has commits you do not have. Pull first, then push.".to_string();
    }
    if lower.contains("permission denied") || lower.contains("could not read username") || lower.contains("authentication failed") {
        return "The remote refused you (no credentials). Connect GitHub in the app, or push from a terminal.".to_string();
    }
    if lower.contains("could not resolve host") || lower.contains("unable to access") || lower.contains("network is unreachable") {
        return "The remote could not be reached — check the network, then try again.".to_string();
    }
    if lower.contains("no upstream branch") {
        return "This branch has no upstream yet — push again and one will be made.".to_string();
    }
    last_line(stderr, "git push failed")
}

/// git's own words for a failed pull, in this app's words.
pub fn pull_error(stderr: &str) -> String {
    let lower = stderr.to_lowercase();
    if lower.contains("not possible to fast-forward") || lower.contains("divergent") || lower.contains("merge strategy") {
        return "Your branch and the remote have diverged. Reconcile in a terminal (git pull --rebase), then pull again.".to_string();
    }
    if lower.contains("local changes") || lower.contains("would be overwritten") || lower.contains("unmerged files") {
        return "The pull would overwrite local changes. Commit or discard them first, then pull again.".to_string();
    }
    if lower.contains("could not resolve host") || lower.contains("unable to access") {
        return "The remote could not be reached — check the network, then try again.".to_string();
    }
    last_line(stderr, "git pull failed")
}

fn last_line(text: &str, fallback: &str) -> String {
    text.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or(fallback).trim().to_string()
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
        return Ok(Status { repo: false, branch: String::new(), ahead: 0, behind: 0, remote: String::new(), head: false, changes: Vec::new() });
    }
    let mut status = parse_status(&String::from_utf8_lossy(&out.stdout));
    status.remote = remote_url(&root_path);
    Ok(status)
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


/// Which paths a commit may take: relative, inside the folder, never an
/// option. Empty means "everything that changed".
pub fn check_commit_paths(paths: &[String]) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for p in paths {
        let t = p.trim();
        if t.is_empty() {
            continue;
        }
        if t.starts_with('-') || t.contains('\0') {
            return Err(format!("Refused: '{}' is not a file path.", t));
        }
        out.push(t.to_string());
    }
    Ok(out)
}

/// A commit message: trimmed, at most 2000 characters, never empty.
pub fn check_commit_message(message: &str) -> Result<String, String> {
    let m = message.trim();
    if m.is_empty() {
        return Err("Write a commit message first.".to_string());
    }
    Ok(m.chars().take(2000).collect())
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Committed {
    pub sha: String,
    pub files: usize,
}

/// Stage the given files (or every change) and commit them with the message.
/// Nothing is pushed. A missing identity is reported in words, with the two
/// commands that set it, instead of git's own note.
#[tauri::command(async)]
pub fn local_git_commit(root: String, paths: Vec<String>, message: String) -> Result<Committed, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("That folder is not there any more: {}", root));
    }
    let wanted = check_commit_paths(&paths)?;
    let text = check_commit_message(&message)?;
    for p in &wanted {
        crate::local::resolve_inside(&root_path, p)?;
    }
    let mut add: Vec<&str> = vec!["add", "-A", "--"];
    if wanted.is_empty() {
        add.push(".");
    } else {
        add.extend(wanted.iter().map(String::as_str));
    }
    let staged = git(&root_path, &add)?;
    if !staged.status.success() {
        return Err(String::from_utf8_lossy(&staged.stderr).lines().last().unwrap_or("git add failed").trim().to_string());
    }
    let out = git(&root_path, &["commit", "-m", &text, "--no-verify"])?;
    if !out.status.success() {
        let why = String::from_utf8_lossy(&out.stderr).to_string() + &String::from_utf8_lossy(&out.stdout);
        if why.contains("Please tell me who you are") || why.contains("user.email") {
            return Err("git does not know who you are yet. In a terminal: git config --global user.name \"Your Name\" and git config --global user.email \"you@example.com\", then commit again.".to_string());
        }
        if why.contains("nothing to commit") || why.contains("no changes added") {
            return Err("Nothing to commit: the files you picked have no changes.".to_string());
        }
        let line = why.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("git commit failed");
        return Err(line.trim().to_string());
    }
    let sha = git(&root_path, &["rev-parse", "--short", "HEAD"])
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    let count = git(&root_path, &["show", "--stat", "--format=", "HEAD"])
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().filter(|l| l.contains('|')).count())
        .unwrap_or(0);
    Ok(Committed { sha, files: count })
}

/// Amend the last commit: the given files are staged on top of it (all of
/// the index when none are given), and the message is replaced only when one
/// is written. History rewrite — the person clicks Amend with a confirm on
/// screen; the agent side still refuses --amend on its own.
#[tauri::command(async)]
pub fn local_git_amend(root: String, paths: Vec<String>, message: String) -> Result<Committed, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("That folder is not there any more: {}", root));
    }
    if !has_head(&root_path)? {
        return Err("There is no commit to amend yet: make the first commit first.".to_string());
    }
    let wanted = check_commit_paths(&paths)?;
    for p in &wanted {
        crate::local::resolve_inside(&root_path, p)?;
    }
    if !wanted.is_empty() {
        let mut add: Vec<&str> = vec!["add", "--"];
        add.extend(wanted.iter().map(String::as_str));
        let staged = git(&root_path, &add)?;
        if !staged.status.success() {
            return Err(last_line(&String::from_utf8_lossy(&staged.stderr), "git add failed"));
        }
    }
    let text = message.trim();
    let checked = if text.is_empty() { None } else { Some(check_commit_message(text)?) };
    let mut args: Vec<&str> = vec!["commit", "--amend", "--no-verify"];
    match &checked {
        None => args.push("--no-edit"),
        Some(m) => {
            args.push("-m");
            args.push(m.as_str());
        }
    }
    let out = git(&root_path, &args)?;
    if !out.status.success() {
        let why = String::from_utf8_lossy(&out.stderr).to_string() + &String::from_utf8_lossy(&out.stdout);
        if why.contains("Please tell me who you are") || why.contains("user.email") {
            return Err("git does not know who you are yet. In a terminal: git config --global user.name \"Your Name\" and git config --global user.email \"you@example.com\", then amend again.".to_string());
        }
        return Err(last_line(&why, "git commit --amend failed"));
    }
    let sha = git(&root_path, &["rev-parse", "--short", "HEAD"])
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    let count = git(&root_path, &["show", "--stat", "--format=", "HEAD"])
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().filter(|l| l.contains('|')).count())
        .unwrap_or(0);
    Ok(Committed { sha, files: count })
}

/// Take files back out of the index (staged -> working tree again). With no
/// paths, everything staged comes back out. Never touches the working tree.
#[tauri::command(async)]
pub fn local_git_unstage(root: String, paths: Vec<String>) -> Result<usize, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("That folder is not there any more: {}", root));
    }
    let wanted = check_commit_paths(&paths)?;
    for p in &wanted {
        crate::local::resolve_inside(&root_path, p)?;
    }
    if wanted.is_empty() {
        // `git reset` (mixed, no ref) works in a repository with no commits too.
        let out = git(&root_path, &["reset"])?;
        if !out.status.success() {
            return Err(last_line(&(String::from_utf8_lossy(&out.stderr).to_string() + &String::from_utf8_lossy(&out.stdout)), "git reset failed"));
        }
        return Ok(0);
    }
    let mut args: Vec<&str> = vec!["restore", "--staged", "--"];
    args.extend(wanted.iter().map(String::as_str));
    let out = git(&root_path, &args)?;
    if out.status.success() {
        return Ok(wanted.len());
    }
    // `git restore` needs a HEAD; on a repository with no commits, reset stages out.
    let mut reset_args: Vec<&str> = vec!["reset", "--"];
    reset_args.extend(wanted.iter().map(String::as_str));
    let fallback = git(&root_path, &reset_args)?;
    if fallback.status.success() {
        return Ok(wanted.len());
    }
    Err(last_line(&String::from_utf8_lossy(&out.stderr), "git restore --staged failed"))
}

/// Throw away a file's changes: staged and working-tree content both go back
/// to HEAD, and an untracked file is deleted. The caller must have asked the
/// person to confirm — this cannot be undone. Empty is refused: "discard
/// everything" is not a decision anyone means to make.
#[tauri::command(async)]
pub fn local_git_discard(root: String, paths: Vec<String>) -> Result<usize, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("That folder is not there any more: {}", root));
    }
    let wanted = check_commit_paths(&paths)?;
    if wanted.is_empty() {
        return Err("Pick at least one file to discard.".to_string());
    }
    for p in &wanted {
        crate::local::resolve_inside(&root_path, p)?;
    }
    let mut failed: Vec<String> = Vec::new();
    for p in &wanted {
        let probe = git(&root_path, &["status", "--porcelain=v1", "--", p])
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();
        let done = if probe.starts_with("??") {
            // Untracked: deletion is the only way to discard it. `-d` so a
            // whole untracked folder picked as `dir/` goes with it.
            git(&root_path, &["clean", "-fd", "--", p]).map(|o| o.status.success()).unwrap_or(false)
        } else if probe.is_empty() {
            // Nothing recorded: already at HEAD (or gone), so nothing to do.
            true
        } else {
            git(&root_path, &["restore", "--staged", "--worktree", "--", p]).map(|o| o.status.success()).unwrap_or(false)
        };
        if !done {
            failed.push(p.clone());
        }
    }
    if !failed.is_empty() {
        return Err(format!("Could not discard: {}", failed.join(", ")));
    }
    Ok(wanted.len())
}

/// Push the current branch: the remote's URL is checked (and its host known)
/// before git touches the network, and a branch with no upstream gets one.
#[tauri::command(async)]
pub fn local_git_push(root: String) -> Result<Synced, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("That folder is not there any more: {}", root));
    }
    let name = remote_name(&root_path)?;
    let url = remote_url(&root_path);
    check_remote_url(&url)?;
    if !has_head(&root_path)? {
        return Err("There is nothing to push yet: make a commit first.".to_string());
    }
    let branch = current_branch(&root_path)?;
    let upstream = git(&root_path, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
        .map(|o| o.status.success())
        .unwrap_or(false);
    let out = if upstream {
        git(&root_path, &["push"])
    } else {
        let target = format!("HEAD:refs/heads/{}", branch);
        git(&root_path, &["push", "-u", &name, &target])
    }?;
    if !out.status.success() {
        return Err(push_error(&String::from_utf8_lossy(&out.stderr)));
    }
    sync_report(&root_path, url, "Pushed.")
}

/// Pull with --ff-only: a fast-forward moves the branch, and anything else
/// (divergence, local edits in the way) is refused in words, never merged
/// behind the person's back.
#[tauri::command(async)]
pub fn local_git_pull(root: String) -> Result<Synced, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("That folder is not there any more: {}", root));
    }
    // Errors out with the "no remote" words when the folder has none.
    let _ = remote_name(&root_path)?;
    let url = remote_url(&root_path);
    check_remote_url(&url)?;
    if !has_head(&root_path)? {
        return Err("There are no commits in this folder yet; pull has nothing to fast-forward to.".to_string());
    }
    let out = git(&root_path, &["pull", "--ff-only"])?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(pull_error(&stderr));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    if stdout.contains("Already up to date") || stdout.contains("Already up-to-date") {
        return sync_report(&root_path, url, "Already up to date.");
    }
    sync_report(&root_path, url, "Pulled.")
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Synced {
    /// The remote's URL (checked).
    pub remote: String,
    /// Its host, for the toast: 'github.com', '' for a local path.
    pub host: String,
    pub ahead: u32,
    pub behind: u32,
    pub message: String,
}

/// The counts after a push or pull, so the panel redraws true.
fn sync_report(root: &Path, url: String, message: &str) -> Result<Synced, String> {
    let counts = git(root, &["status", "--porcelain=v1", "-b"])
        .map(|o| parse_status(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_else(|_| parse_status(""));
    Ok(Synced { host: remote_host(&url), remote: url, ahead: counts.ahead, behind: counts.behind, message: message.to_string() })
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
    fn commit_paths_and_message_are_checked_before_git_runs() {
        assert_eq!(check_commit_paths(&["a.ts".into(), " ".into(), "src/b.ts".into()]).unwrap(), vec!["a.ts".to_string(), "src/b.ts".to_string()]);
        assert!(check_commit_paths(&["--all".into()]).is_err());
        assert!(check_commit_paths(&[]).unwrap().is_empty());
        assert!(check_commit_message("   ").is_err());
        assert_eq!(check_commit_message("  Fix the thing  ").unwrap(), "Fix the thing");
        assert_eq!(check_commit_message(&"x".repeat(5000)).unwrap().len(), 2000);
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

    #[test]
    fn staged_and_unborn_are_read_from_the_porcelain_line() {
        let s = parse_status("## main\nM  staged.ts\n M worktree.ts\nMM both.ts\n?? new.md\n");
        assert!(s.head);
        let staged: Vec<(String, bool)> = s.changes.iter().map(|c| (c.path.clone(), c.staged)).collect();
        assert_eq!(staged, vec![
            ("staged.ts".into(), true),
            ("worktree.ts".into(), false),
            ("both.ts".into(), true),
            ("new.md".into(), false),
        ]);
        let unborn = parse_status("## No commits yet on main\n?? a\n");
        assert!(!unborn.head, "an unborn repository has nothing to amend or push");
        assert_eq!(unborn.branch, "main");
    }

    #[test]
    fn a_remote_url_is_checked_before_anything_touches_the_network() {
        assert!(check_remote_url("https://github.com/o/r.git").is_ok());
        assert!(check_remote_url("git@github.com:o/r.git").is_ok());
        assert!(check_remote_url("/srv/repos/r.git").is_ok(), "a local path is no network");
        assert!(check_remote_url("file:///srv/repos/r.git").is_ok());
        assert!(check_remote_url("ext::sh -c evil").is_err());
        assert!(check_remote_url("--upload-pack=evil https://x.y/z").is_err());
        assert!(check_remote_url("https://user:pw@github.com/o/r").is_err());
        assert!(check_remote_url("git@evil.example:o/r").is_err());
        assert!(check_remote_url("").is_err());
        assert_eq!(remote_host("https://github.com/o/r.git"), "github.com");
        assert_eq!(remote_host("git@github.com:o/r.git"), "github.com");
        assert_eq!(remote_host("ssh://git@host.example:2222/r.git"), "host.example");
        assert_eq!(remote_host("/srv/repos/r.git"), "");
    }

    #[test]
    fn push_and_pull_failures_are_said_in_this_app_s_words() {
        assert!(push_error("! [rejected] main -> main (fetch first)").contains("Pull first"));
        assert!(push_error("ERROR: Permission denied (publickey)").contains("credentials"));
        assert!(push_error("fatal: Could not resolve host: github.com").contains("network"));
        assert_eq!(push_error("fatal: surprise"), "fatal: surprise");
        assert!(pull_error("Not possible to fast-forward, aborting").contains("diverged"));
        assert!(pull_error("error: Your local changes to the following files would be overwritten").contains("Commit or discard"));
        assert_eq!(pull_error("fatal: surprise\nmore"), "more", "the last line is the one git meant");
    }
}
