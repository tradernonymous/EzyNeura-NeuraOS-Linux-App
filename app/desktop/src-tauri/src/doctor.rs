// The Doctor (D6 of docs/APP_UPGRADE_PLAN.md): one pass over everything this
// app depends on, each check with its fix.
//
// `hh doctor` in homelabhero is the model, and so is the reason this exists:
// "the app does not work" is the least actionable bug report there is, and
// almost every instance of it is one missing tool, one unconfigured identity,
// or one key that never got saved. Each of those is a two-minute fix that the
// user cannot find without knowing to look.
//
// This module gathers and classifies; it does not phrase anything. The
// sentences come from src/doctor.js, which node:test exercises directly --
// because the wording is the product here. A check that fails with no
// sentence is worse than no check, since it reports a problem it cannot help
// with.
//
// Deliberately absent: anything secret. A check may say *whether* a key is
// present, never what it is, and the whole struct is safe to log. This is the
// same rule diagnostics.rs follows, and for the same reason.
//
// Two rules govern the shape of every check below:
//
//   - a check that cannot fail does not belong here. Everything reported is
//     something the user can act on.
//   - a check must not be slow. This runs on a button press, not on a timer,
//     and every probe below has a timeout or is a `command -v`.

use std::process::{Command, Stdio};

/// A `command -v` probe: is this tool on PATH? The same helper desktop.rs uses
/// for screenshots, repeated here rather than made public because the two
/// callers want different things from it (a bool vs. a list).
fn on_path(tool: &str) -> bool {
    // A tool name is always a literal here, never user input: the callers pass
    // fixed strings from the table below. Nothing reaches `sh -c` that came
    // from a file or a prompt.
    Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {}", tool))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// git's identity, or the absence of one. A machine that cannot commit is a
/// machine where every "commit this" button fails with a message that reads
/// like the app's fault.
///
/// Not cfg-gated: `git config --global` is the same command on every platform,
/// and a missing identity is the same problem on each.
fn git_identity() -> serde_json::Value {
    let config = |key: &str| -> String {
        Command::new("git")
            .args(["config", "--global", key])
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
    };
    serde_json::json!({
        "available": on_path("git"),
        "name": config("user.name"),
        "email": config("user.email"),
    })
}

/// Whether a secret is present, without ever reading its value into the struct.
fn key_present(key: &str) -> bool {
    crate::secrets::secret_get(key.to_string())
        .ok()
        .flatten()
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

/// Is something accepting TCP connections on this loopback port?
///
/// The same "accepts a connection is the same fact as is listening" reasoning
/// engine.rs uses, and for the same reason: these are servers this process
/// either spawned itself or installed as a unit, so there is no third party
/// between the port and the answer.
fn port_is_up(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        std::time::Duration::from_millis(200),
    )
    .is_ok()
}

/// The tools a Linux desktop assistant is likely to need, and what they are for.
///
/// Not a wish list: each of these is a tool the app's own skills and recipes
/// shell out to, so "not installed" is a real, explainable gap rather than a
/// judgement about the user's machine.
fn tool_table() -> serde_json::Value {
    // One function, not two cfg-gated copies: the base five tools are checked
    // everywhere, and the Linux-only two are added under a plain #[cfg] on
    // statements, which needs no feature and trips no unexpected_cfgs lint.
    // (An earlier draft split this into two functions selected by a
    // `feature = "never"` cfg that nothing ever enables; newer clippy
    // rejects the unknown feature, and rightly so.)
    let mut table = serde_json::Map::new();
    for tool in ["git", "curl", "jq", "rg", "ffmpeg"] {
        table.insert(tool.to_string(), serde_json::json!(on_path(tool)));
    }
    #[cfg(target_os = "linux")]
    for tool in ["systemctl", "docker"] {
        table.insert(tool.to_string(), serde_json::json!(on_path(tool)));
    }
    serde_json::Value::Object(table)
}

/// Assemble the facts into the shape doctor.js reads.
///
/// Split from `doctor_facts` on purpose: gathering needs a live `AppHandle`,
/// and the part worth testing -- that every section is present even on a
/// machine with nothing set up -- does not. A test that needs a Tauri app to
/// assert a JSON shape is a test nobody writes.
fn assemble(
    shell: crate::diag::Facts,
    node: serde_json::Value,
    service: serde_json::Value,
    runtimes: serde_json::Value,
    sd: serde_json::Value,
) -> serde_json::Value {
    // The engine is either running now, or installed as a user unit, or
    // neither. All three are reported so the card can name the right next step
    // instead of a generic "engine not running".
    let engine_port: u16 = service
        .get("port")
        .and_then(|v| v.as_u64())
        .map(|n| n as u16)
        .unwrap_or(0);
    let engine_up = engine_port != 0 && port_is_up(engine_port);
    let field = |key: &str| runtimes.get(key).cloned().unwrap_or(serde_json::Value::Null);

    serde_json::json!({
        "version": shell.version,
        "os": shell.os,
        "arch": shell.arch,
        "node": node,
        "engine": {
            "running": engine_up,
            "port": engine_port,
            "service": service,
        },
        "runtimes": {
            "node": field("node"),
            "llama": field("llama"),
            "gpu": field("gpu"),
            "dir": field("dir"),
            "min_node_major": field("min_node_major"),
        },
        "sd": sd,
        "git": git_identity(),
        // Presence only. The value never leaves the keyring, and this struct is
        // logged and pasted into issues.
        "keys": {
            "hf_token": key_present("hf_token"),
            "hf_user": key_present("hf_user"),
        },
        "tools": tool_table(),
        "paths": {
            "data_dir": shell.data_dir,
            "log_path": shell.log_path,
        },
    })
}

/// One pass of every check, as facts.
///
/// The frontend decides what is a warning and what is a problem, from these
/// values, in one place that is unit-tested -- rather than each caller
/// re-deriving "no Node means what?" in a different screen.
#[tauri::command]
pub fn doctor_facts(app: tauri::AppHandle) -> serde_json::Value {
    assemble(
        crate::diag::diagnostics(app.clone()),
        crate::engine::engine_find_node(),
        crate::engine::engine_service_status(),
        crate::runtimes::runtime_facts(app.clone()),
        serde_json::to_value(crate::sd::sd_find(app)).unwrap_or(serde_json::Value::Null),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_probe_answers_true_for_a_program_that_exists() {
        // `sh` is running this test, so this cannot be a false negative: it
        // guards the opposite bug, a probe that always says no, which would
        // make the Doctor lie about a healthy machine.
        assert!(on_path("sh"));
    }

    #[test]
    fn a_probe_answers_false_for_a_program_that_does_not_exist() {
        assert!(!on_path("definitely-not-a-real-program-xyzzy"));
    }

    #[test]
    fn the_tool_table_reports_booleans_and_nothing_else() {
        // The Doctor's whole safety argument is that a fact is a fact about
        // presence. A string here would mean something read a version string or
        // a path, and this struct is pasted into issues.
        for value in tool_table().as_object().expect("tool_table is an object").values() {
            assert!(value.is_boolean(), "a tool fact is present or absent, not {:?}", value);
        }
    }

    #[test]
    fn a_key_presence_check_never_reveals_a_value() {
        // A key this app does not use: the check must answer false rather than
        // erroring, and must not panic on a missing entry.
        assert!(!key_present("doctor-test-key-that-does-not-exist"));
    }

    #[test]
    fn a_closed_port_is_reported_down() {
        // Port 1 on loopback: nothing listens there in a test sandbox, and the
        // check is about the false-positive direction (a port reported up when
        // it is not), which is the one that would send a user chasing a
        // service that is not running.
        assert!(!port_is_up(1));
    }

    /// A `Facts` with nothing in it: the machine with no Node, no engine, no
    /// keys, which is the state the Doctor has to be able to describe.
    fn empty_shell() -> crate::diag::Facts {
        crate::diag::Facts {
            version: String::new(),
            os: String::new(),
            arch: String::new(),
            runtime: String::new(),
            session: String::new(),
            log_path: String::new(),
            log_bytes: 0,
            log_tail: String::new(),
            data_dir: String::new(),
            cache_dir: String::new(),
        }
    }

    #[test]
    fn the_doctor_reports_every_section_even_when_nothing_is_installed() {
        // The shape is the contract with doctor.js. A missing key would render
        // as an undefined section rather than an empty one, and the card would
        // show a gap instead of "nothing is set up yet".
        let facts = assemble(
            empty_shell(),
            serde_json::json!({ "found": false, "ok": false }),
            serde_json::json!({ "available": false, "port": 0 }),
            serde_json::json!({}),
            serde_json::json!({ "found": false }),
        );
        for key in [
            "version", "os", "arch", "node", "engine", "runtimes", "sd", "git", "keys", "tools", "paths",
        ] {
            assert!(facts.get(key).is_some(), "the doctor is missing {}", key);
        }
    }

    #[test]
    fn an_absent_runtime_is_null_rather_than_a_missing_key() {
        // `runtimes` arrives as whatever runtime_facts said. A key that
        // vanishes when the section is sparse would make the frontend's
        // `?.` fall through to "unknown", which reads as a bug rather than as
        // "you have not installed this yet".
        let facts = assemble(
            empty_shell(),
            serde_json::json!({}),
            serde_json::json!({ "port": 0 }),
            serde_json::json!({ "node": null }),
            serde_json::json!({}),
        );
        let runtimes = facts.get("runtimes").expect("runtimes");
        for key in ["node", "llama", "gpu", "dir", "min_node_major"] {
            assert!(runtimes.get(key).is_some(), "runtimes is missing {}", key);
        }
    }

    #[test]
    fn the_doctor_never_reports_a_key_value() {
        // The safety property, asserted rather than asserted-in-prose: the
        // `keys` section is booleans, so there is nowhere for a token to be
        // even if a future edit tried to put one there.
        let facts = assemble(
            empty_shell(),
            serde_json::json!({}),
            serde_json::json!({ "port": 0 }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let keys = facts.get("keys").expect("keys").as_object().expect("keys is an object");
        assert!(!keys.is_empty());
        for (name, value) in keys {
            assert!(value.is_boolean(), "keys.{} is a presence flag, not {:?}", name, value);
        }
    }

    #[test]
    fn a_zero_port_never_reports_the_engine_as_running() {
        // A closed port and port 0 are the same "nothing is listening" fact.
        // Reading a 0 as "up" would tell every user their engine is fine when
        // it is not installed at all.
        let facts = assemble(
            empty_shell(),
            serde_json::json!({}),
            serde_json::json!({ "port": 0 }),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        // unwrap_or(true) so the assertion fails on a *missing* key too: a
        // shape that lost the field must not read as "not running" by default.
        assert!(!facts["engine"]["running"].as_bool().unwrap_or(true));
    }
}
