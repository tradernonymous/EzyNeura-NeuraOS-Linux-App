// C10: the credential broker (upgrade plan, wave 3):
// "A tool that needs a key or an SSH login calls a named operation in the
// Rust shell; the shell reads the secret and returns only the output, so the
// model never holds it."
//
// Two named operations behind one command:
//
//   * `ssh_run(target, command)` — a saved host, `ssh.<name>` in the OS
//     keyring: user, host, port and an optional private key. When a key is
//     stored it is written to a 0600 file for the length of the call and
//     deleted again; what comes back is the remote command's output, never
//     the login. Arguments are passed to ssh directly (no local shell), so
//     nothing in a profile or a command can be re-parsed as shell syntax.
//
//   * `http_auth(name, path, ...)` — a saved address, `api.<name>` in the
//     keyring: a base URL plus the header and secret to attach. The request
//     goes to the address STORED WITH the credential, so a model cannot aim
//     a secret at a server of its own choosing, and every redirect hop must
//     stay on that host (the same rule as net.rs's hand-followed redirects).
//
// The profiles arrive from the OS keyring, but a keyring entry is not proof
// of good intentions: everything below is validated against fixed rules
// before a process is spawned or a request is sent.
use serde::Deserialize;
use std::time::{Duration, Instant};

/// One operation's output: enough to read, never a log file.
const MAX_OUT: usize = 8_000;
const MAX_ERR: usize = 2_000;
const MAX_BODY: usize = 12_000;
const MAX_REDIRECTS: usize = 5;
const DEFAULT_TIMEOUT_MS: u64 = 120_000;

/// The ids `ssh.<name>` and `api.<name>` accept — the same shape byok.js
/// makes (secrets.rs enforces it on the way in; this is the same rule for
/// the names the tools pass).
pub fn is_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && !s.contains("..")
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_' || c == '.')
}

/// A host as the form writes it: a name or an address, nothing that could
/// start an option (`-L`) or carry whitespace into the argv.
fn is_safe_host(h: &str) -> bool {
    !h.is_empty()
        && h.len() <= 253
        && !h.starts_with('-')
        && h.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ':')
}

/// A login name: no `@` (that would be a second host), no whitespace.
fn is_safe_user(u: &str) -> bool {
    !u.is_empty()
        && u.len() <= 64
        && u.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

fn clip(text: &str, max: usize) -> String {
    let t = text.trim();
    if t.len() <= max {
        return t.to_string();
    }
    let mut cut = max;
    while cut > 0 && !t.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}… [truncated]", &t[..cut])
}

// ---- ssh_run ---------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct SshProfile {
    pub user: String,
    pub host: String,
    pub port: Option<u16>,
    pub identity: Option<String>,
}

/// A stored `ssh.<name>` entry -> a profile that is safe to hand to ssh.
pub fn parse_ssh(json: &str) -> Result<SshProfile, String> {
    let p: SshProfile =
        serde_json::from_str(json).map_err(|e| format!("the saved host is malformed: {}", e))?;
    if !is_safe_user(&p.user) {
        return Err("the saved host's user name has characters that do not belong".into());
    }
    if !is_safe_host(&p.host) {
        return Err("the saved host's address has characters that do not belong".into());
    }
    if let Some(key) = &p.identity {
        if key.len() > 32_768 || key.contains('\0') {
            return Err("the saved private key is not usable".into());
        }
    }
    Ok(p)
}

/// ssh's argv, built as a list: no shell ever sees these strings.
fn ssh_args(p: &SshProfile, command: &str, key_file: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "StrictHostKeyChecking=accept-new".into(),
        "-o".into(),
        "ConnectTimeout=10".into(),
    ];
    if let Some(k) = key_file {
        args.push("-i".into());
        args.push(k.to_string());
    }
    if let Some(port) = p.port {
        args.push("-p".into());
        args.push(port.to_string());
    }
    args.push(format!("{}@{}", p.user, p.host));
    args.push(command.to_string());
    args
}

struct Ran {
    code: Option<i32>,
    out: String,
    err: String,
    timed_out: bool,
}

/// Run ssh with the given argv, killing it at the deadline. stdout and
/// stderr are drained on their own threads so a chatty remote cannot fill
/// a pipe and deadlock the wait.
fn run_argv(program: &str, args: &[String], timeout: Duration) -> Result<Ran, String> {
    use std::io::Read;
    use std::process::{Command, Stdio};

    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                format!("{} is not installed on this PC", program)
            } else {
                format!("{}: {}", program, e)
            }
        })?;
    let mut stdout = child.stdout.take().ok_or("no stdout pipe")?;
    let mut stderr = child.stderr.take().ok_or("no stderr pipe")?;
    let out_thread = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = stdout.read_to_end(&mut b);
        b
    });
    let err_thread = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = stderr.read_to_end(&mut b);
        b
    });

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("waiting for {}: {}", program, e)),
        }
    };
    let out = out_thread.join().unwrap_or_default();
    let err = err_thread.join().unwrap_or_default();
    Ok(Ran {
        code: status.and_then(|s| s.code()),
        out: String::from_utf8_lossy(&out).to_string(),
        err: String::from_utf8_lossy(&err).to_string(),
        timed_out: status.is_none(),
    })
}

/// The `ssh_run` operation: only the remote command's output comes back.
/// Synchronous (it waits on the network), so credential_op runs it on a
/// blocking thread.
fn op_ssh_run(target: &str, command: &str, timeout_ms: u64) -> Result<String, String> {
    if !is_id(target) {
        return Err(format!("{} is not a saved host's name", target));
    }
    let command = command.trim();
    if command.is_empty() || command.len() > 4_096 || command.contains('\0') {
        return Err("the command is empty or too long".into());
    }
    let json = secrets::read(&format!("{}{}", secrets::SSH_PREFIX, target))?
        .ok_or_else(|| format!("no saved host named {} (Settings → Credentials)", target))?;
    let profile = parse_ssh(&json)?;

    // A stored key exists for exactly as long as this call: a 0600 file in
    // a private temp folder, removed on every path out.
    let mut key_path: Option<std::path::PathBuf> = None;
    if let Some(identity) = profile.identity.clone() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!("neuraos-ssh-{}-{}", std::process::id(), stamp));
        write_key(&path, &identity)?;
        key_path = Some(path);
    }
    let args = ssh_args(&profile, command, key_path.as_ref().map(|p| p.to_string_lossy().to_string()));
    let timeout = Duration::from_millis(timeout_ms.clamp(1_000, 300_000));
    let ran = run_argv("ssh", &args, timeout).await;
    if let Some(path) = &key_path {
        let _ = std::fs::remove_file(path);
    }
    let ran = ran?;

    let where_ = format!("{}@{}", profile.user, profile.host);
    if ran.timed_out {
        return Err(format!(
            "the command timed out after {}s on {}",
            timeout.as_secs(),
            where_
        ));
    }
    let mut text = format!(
        "exit {} on {}:\n{}",
        ran.code.map(|c| c.to_string()).unwrap_or_else(|| "?".into()),
        where_,
        clip(&ran.out, MAX_OUT)
    );
    if !ran.err.trim().is_empty() {
        text.push_str(&format!("\n[stderr]\n{}", clip(&ran.err, MAX_ERR)));
    }
    Ok(text)
}

/// The private key file, 0600, and only where the platform can say so.
#[cfg(unix)]
fn write_key(path: &std::path::Path, identity: &str) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| format!("could not prepare the key: {}", e))?;
    // ssh refuses a key file with no trailing newline.
    let mut body = identity.to_string();
    if !body.ends_with('\n') {
        body.push('\n');
    }
    file.write_all(body.as_bytes())
        .map_err(|e| format!("could not prepare the key: {}", e))?;
    Ok(())
}

#[cfg(not(unix))]
fn write_key(path: &std::path::Path, identity: &str) -> Result<(), String> {
    use std::io::Write;
    let mut file = std::fs::File::create(path).map_err(|e| format!("could not prepare the key: {}", e))?;
    let mut body = identity.to_string();
    if !body.ends_with('\n') {
        body.push('\n');
    }
    file.write_all(body.as_bytes())
        .map_err(|e| format!("could not prepare the key: {}", e))?;
    Ok(())
}

// ---- http_auth -------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ApiProfile {
    pub base: String,
    pub header: Option<String>,
    pub prefix: Option<String>,
    pub secret: String,
}

/// A stored `api.<name>` entry -> a request that can only go to its base.
pub fn parse_api(json: &str) -> Result<ApiProfile, String> {
    let mut p: ApiProfile =
        serde_json::from_str(json).map_err(|e| format!("the saved address is malformed: {}", e))?;
    let base = reqwest::Url::parse(p.base.trim())
        .map_err(|e| format!("the saved address is not a URL: {}", e))?;
    if base.scheme() != "http" && base.scheme() != "https" {
        return Err("the saved address must be http or https".into());
    }
    if !base.username().is_empty() || base.password().is_some() {
        return Err("the saved address must not contain a login".into());
    }
    if base.host_str().is_none() {
        return Err("the saved address has no host".into());
    }
    let header = p.header.take().unwrap_or_else(|| "Authorization".into());
    if !header
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
        || header.is_empty()
    {
        return Err("the saved header name is not a header name".into());
    }
    p.header = Some(header);
    p.prefix = Some(p.prefix.unwrap_or_else(|| "Bearer ".into()));
    if p.prefix.len() > 64 || p.prefix.contains('\0') || p.prefix.contains(['\r', '\n']) {
        return Err("the saved prefix does not belong in a header".into());
    }
    if p.secret.is_empty() || p.secret.len() > 16_384 || p.secret.contains('\0') {
        return Err("the saved secret is not usable".into());
    }
    Ok(p)
}

/// base + path -> the one URL this credential may reach. The result is
/// re-parsed and must still be the base's own origin, so no trick in the
/// path (`//host`, `@`, `..`) can move the request off it.
pub fn request_url(base: &str, path: &str) -> Result<String, String> {
    let path = path.trim();
    if !path.starts_with('/') {
        return Err("the path must start with /".into());
    }
    if path.starts_with("//") || path.len() > 2_048 {
        return Err("that path does not stay on the saved address".into());
    }
    if path.contains(['#', '\\', '\0']) || path.chars().any(char::is_whitespace) {
        return Err("that path does not belong in a URL path".into());
    }
    let b = reqwest::Url::parse(base.trim()).map_err(|e| format!("bad base: {}", e))?;
    let joined = format!(
        "{}/{}",
        base.trim_end_matches('/'),
        path.trim_start_matches('/')
    );
    let j = reqwest::Url::parse(&joined).map_err(|e| format!("bad path: {}", e))?;
    let same = j.scheme() == b.scheme()
        && j.host_str() == b.host_str()
        && j.port_or_known_default() == b.port_or_known_default()
        && j.username().is_empty()
        && j.password().is_none();
    if !same {
        return Err("that path does not stay on the saved address".into());
    }
    Ok(joined)
}

/// The `http_auth` operation: the request carries the secret, the answer
/// does not.
async fn op_http_auth(
    name: &str,
    path: &str,
    method: &str,
    body: Option<&str>,
) -> Result<String, String> {
    if !is_id(name) {
        return Err(format!("{} is not a saved address's name", name));
    }
    let json = secrets::read(&format!("{}{}", secrets::API_PREFIX, name))?
        .ok_or_else(|| format!("no saved address named {} (Settings → Credentials)", name))?;
    let profile = parse_api(&json)?;
    let url = request_url(&profile.base, path)?;

    let method = method.trim().to_uppercase();
    if !matches!(
        method.as_str(),
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD"
    ) {
        return Err(format!("{} is not a method this broker sends", method));
    }
    let header =
        reqwest::header::HeaderName::from_bytes(profile.header.as_deref().unwrap_or("Authorization").as_bytes())
            .map_err(|e| format!("bad header: {}", e))?;
    let value = reqwest::header::HeaderValue::from_str(&format!(
        "{}{}",
        profile.prefix.as_deref().unwrap_or("Bearer "),
        profile.secret
    ))
    .map_err(|e| format!("the secret does not fit a header: {}", e))?;

    let client = reqwest::Client::builder()
        // Redirects are followed by hand so every hop stays on the base's
        // host — the secret must never travel to another one.
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("http client: {}", e))?;

    if body.map(|b| b.len()).unwrap_or(0) > MAX_BODY {
        return Err("the request body is too large for the broker".into());
    }
    let (base_scheme, base_host, base_port) = b_origin(&profile.base)?;
    let mut current = url.clone();
    for _ in 0..=MAX_REDIRECTS {
        let mut request = client
            .request(
                reqwest::Method::from_bytes(method.as_bytes())
                    .map_err(|e| format!("bad method: {}", e))?,
                &current,
            )
            .header(header.clone(), value.clone());
        if current == url {
            if let Some(b) = body {
                request = request.body(b.to_string());
            }
        }
        let response = request
            .send()
            .await
            .map_err(|e| format!("{}: {}", current, e))?;
        let status = response.status();
        if status.is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            let next = reqwest::Url::parse(location)
                .ok()
                .filter(|_| !location.is_empty())
                .or_else(|| {
                    // A relative redirect stays a question of the base's host.
                    reqwest::Url::parse(&current).ok().and_then(|base| {
                        base.join(location).ok()
                    })
                });
            match next {
                Some(next) => {
                    let stays = next.scheme() == base_scheme
                        && next.host_str() == base_host.as_deref()
                        && next.port_or_known_default() == base_port;
                    if !stays {
                        return Err(format!(
                            "refused: {} redirects off the saved address",
                            current
                        ));
                    }
                    current = next.to_string();
                    continue;
                }
                None => return Err(format!("{} redirected without a usable location", current)),
            }
        }
        let text = response.text().await.unwrap_or_default();
        return Ok(format!(
            "HTTP {} {}\n{}",
            status.as_u16(),
            status.canonical_reason().unwrap_or(""),
            clip(&text, MAX_BODY)
        ));
    }
    Err("too many redirects".into())
}

/// (scheme, host, port) of the saved base — the origin every hop must keep.
fn b_origin(base: &str) -> Result<(String, Option<String>, Option<u16>), String> {
    let u = reqwest::Url::parse(base.trim()).map_err(|e| format!("bad base: {}", e))?;
    Ok((
        u.scheme().to_string(),
        u.host_str().map(|h| h.to_string()),
        u.port_or_known_default(),
    ))
}

// ---- the command -----------------------------------------------------------

/// One named operation for the tools (tools.js: ssh_run / http_auth).
/// The secret is read here and never appears in the result.
#[tauri::command]
pub async fn credential_op(op: String, args: serde_json::Value) -> Result<String, String> {
    let get = |key: &str| -> Result<String, String> {
        args.get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| format!("the call has no {}", key))
    };
    match op.as_str() {
        "ssh_run" => {
            let target = get("target")?;
            let command = get("command")?;
            let timeout = args
                .get("timeout_ms")
                .and_then(|v| v.as_u64())
                .unwrap_or(DEFAULT_TIMEOUT_MS);
            // ssh waits on the network: keep it off the runtime's threads.
            tauri::async_runtime::spawn_blocking(move || op_ssh_run(&target, &command, timeout))
                .await
                .map_err(|e| format!("ssh: {}", e))?
        }
        "http_auth" => {
            let name = get("name")?;
            let path = get("path")?;
            let method = args
                .get("method")
                .and_then(|v| v.as_str())
                .unwrap_or("GET")
                .to_string();
            let body = args.get("body").and_then(|v| v.as_str());
            op_http_auth(&name, &path, &method, body).await
        }
        other => Err(format!("{} is not a named operation this broker has", other)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXkta2V5LXZlcnNpb24K\n-----END OPENSSH PRIVATE KEY-----";

    fn ssh_json(identity: Option<&str>) -> String {
        serde_json::json!({
            "user": "jack",
            "host": "nas.local",
            "port": 22,
            "identity": identity,
        })
        .to_string()
    }

    #[test]
    fn ids_are_the_ones_the_form_makes() {
        assert!(is_id("nas"));
        assert!(is_id("home.lan"));
        assert!(!is_id(""));
        assert!(!is_id("NAS"));
        assert!(!is_id("a..b"));
        assert!(!is_id(&"x".repeat(65)));
        assert!(!is_id("git:https://github.com"));
    }

    #[test]
    fn a_saved_host_is_validated_before_ssh_sees_it() {
        let p = parse_ssh(&ssh_json(Some(KEY))).unwrap();
        assert_eq!(p.user, "jack");
        assert_eq!(p.host, "nas.local");

        assert!(parse_ssh("not json").is_err());
        assert!(parse_ssh(&serde_json::json!({"user": "a b", "host": "h"}).to_string()).is_err());
        assert!(parse_ssh(&serde_json::json!({"user": "u", "host": "-L8080:evil"}).to_string()).is_err());
        assert!(parse_ssh(&serde_json::json!({"user": "u@other", "host": "h"}).to_string()).is_err());
        assert!(parse_ssh(&serde_json::json!({"user": "u", "host": "h; rm -rf /"}).to_string()).is_err());
        assert!(
            parse_ssh(&serde_json::json!({"user": "u", "host": "h", "identity": "no\0key"}).to_string())
                .is_err()
        );
    }

    #[test]
    fn ssh_argv_has_no_shell_and_carries_the_key_only_as_a_path() {
        let p = parse_ssh(&ssh_json(Some(KEY))).unwrap();
        let args = ssh_args(&p, "uptime", Some("/tmp/k"));
        assert_eq!(args.first().unwrap(), "-o");
        assert!(args.contains(&"-i".to_string()));
        assert!(args.contains(&"/tmp/k".to_string()));
        assert!(args.contains(&"jack@nas.local".to_string()));
        assert_eq!(args.last().unwrap(), "uptime");
        // The key material itself is never in argv.
        assert!(args.iter().all(|a| !a.contains("PRIVATE KEY")));

        let p2 = parse_ssh(&ssh_json(None)).unwrap();
        let args2 = ssh_args(&p2, "ls", None);
        assert!(!args2.contains(&"-i".to_string()));
        assert!(!args2.contains(&"-p".to_string()), "no port means no -p");
    }

    #[test]
    fn a_saved_address_reaches_only_itself() {
        let json = serde_json::json!({
            "base": "https://api.example.com/v1",
            "secret": "tok_123",
        })
        .to_string();
        let p = parse_api(&json).unwrap();
        assert_eq!(p.header.as_deref(), Some("Authorization"), "the default header");
        assert_eq!(p.prefix.as_deref(), Some("Bearer "));

        assert_eq!(
            request_url(&p.base, "/status").unwrap(),
            "https://api.example.com/v1/status"
        );
        // The tricks that would move a request off the base are refused.
        assert!(request_url(&p.base, "status").is_err(), "must start with /");
        assert!(request_url(&p.base, "//evil.com/x").is_err(), "no scheme-relative path");
        assert!(request_url(&p.base, "/x#y").is_err(), "no fragment");
        assert!(request_url(&p.base, "/x y").is_err(), "no whitespace");
        // A base without a path still joins cleanly.
        assert_eq!(request_url("https://example.com", "/health"), Ok("https://example.com/health".to_string()));
    }

    #[test]
    fn an_api_profile_refuses_what_does_not_belong() {
        assert!(parse_api(&serde_json::json!({"base": "ftp://x", "secret": "s"}).to_string()).is_err());
        assert!(parse_api(&serde_json::json!({"base": "https://user:p@x", "secret": "s"}).to_string()).is_err());
        assert!(parse_api(&serde_json::json!({"base": "not a url", "secret": "s"}).to_string()).is_err());
        assert!(parse_api(&serde_json::json!({"base": "https://x", "secret": ""}).to_string()).is_err());
        assert!(parse_api(&serde_json::json!({"base": "https://x", "secret": "s", "header": "X Bad"}).to_string()).is_err());
        assert!(parse_api(&serde_json::json!({"base": "https://x", "secret": "s", "prefix": "a\nb"}).to_string()).is_err());
        // Secrets are only ever compared, never echoed: the error texts
        // above do not contain the value.
        let err = parse_api(&serde_json::json!({"base": "https://x", "secret": "sup3rs3cr3t"}).to_string());
        if let Err(e) = err {
            assert!(!e.contains("sup3rs3cr3t"));
        }
    }

    #[test]
    fn clip_never_splits_a_character() {
        assert_eq!(clip("  hi  ", 10), "hi");
        let long = "日本語".repeat(10); // 3 bytes each
        let cut = clip(&long, 10);
        assert!(cut.len() <= 10 + "… [truncated]".len());
        assert!(cut.ends_with("… [truncated]"));
    }
}
