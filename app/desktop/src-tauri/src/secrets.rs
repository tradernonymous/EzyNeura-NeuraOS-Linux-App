// Secrets in the operating system's credential store, not in localStorage.
//
// The Hugging Face token used to sit in localStorage as plain text, where a
// webview XSS or a copied profile folder reads it. The OS already has a place
// for this -- Credential Manager on Windows, the Keychain on macOS, the kernel
// keyring on Linux -- and the `keyring` crate is the one door to all three.
//
// Three rules:
//
//   * one service name, so every secret this app stores can be found (and
//     removed) under it, and never collides with another program's;
//   * a missing secret is `None`, not an error: "not signed in" is a normal
//     state, and the frontend should not have to parse error strings to
//     learn it;
//   * keys are short identifiers chosen by this app (`hf_token`), never
//     user-supplied strings, so a page cannot ask for another entry. The one
//     family with a tail the user's own data decides is `byok.<id>`
//     (NEURA-054), and the shape of that id is spelled out below rather than
//     trusted.
use keyring::Entry;

pub const SERVICE: &str = "NeuraOS Desktop";

/// The keys this app may store. A name outside this list -- and outside the
/// `byok.` family -- is refused, which keeps the store from becoming a
/// general-purpose one.
pub const KEYS: &[&str] = &["hf_token", "hf_user"];

/// NEURA-054: one entry per endpoint the user added, named `byok.<id>`.
pub const BYOK_PREFIX: &str = "byok.";

/// C10: the credential broker's two families. A `ssh.<id>` entry is a saved
/// host (user, host, port, an optional private key) and a `api.<id>` entry a
/// saved address (base URL, header, secret). Neither value is ever returned
/// to a tool — broker.rs reads it and returns only the command's output or
/// the request's answer. The shape of the id is byok's, so one rule covers
/// all three families.
pub const SSH_PREFIX: &str = "ssh.";
pub const API_PREFIX: &str = "api.";

fn prefixed(key: &str, prefix: &str) -> bool {
    match key.strip_prefix(prefix) {
        Some(id) => {
            !id.is_empty()
                && id.len() <= 64
                && !id.contains("..")
                && id.chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_' || c == '.')
        }
        None => false,
    }
}

/// The ids `byok.` accepts. src/byok.js makes an id out of exactly these
/// characters, so a name with anything else in it is not one this app wrote:
/// it is a page asking for some other entry.
fn is_byok_key(key: &str) -> bool {
    prefixed(key, BYOK_PREFIX)
}

/// C10: `ssh.<id>` and `api.<id>` are the broker's entries — ids by the same
/// rule as byok, so a page still cannot ask for some other program's entry.
fn is_broker_key(key: &str) -> bool {
    prefixed(key, SSH_PREFIX) || prefixed(key, API_PREFIX)
}

fn entry(key: &str) -> Result<Entry, String> {
    if !KEYS.contains(&key) && !is_byok_key(key) && !is_broker_key(key) {
        return Err(format!("{} is not a secret this app stores", key));
    }
    Entry::new(SERVICE, key).map_err(|e| format!("credential store: {}", e))
}

/// Read a secret from inside the shell. byok.rs reads an endpoint's key this
/// way, so the value never has to cross into the page to be sent.
pub fn read(key: &str) -> Result<Option<String>, String> {
    match entry(key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("credential store: {}", e)),
    }
}

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    read(&key)
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    if value.is_empty() {
        return secret_delete(key);
    }
    entry(&key)?
        .set_password(&value)
        .map_err(|e| format!("credential store: {}", e))
}

#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("credential store: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_apps_own_keys_are_accepted() {
        assert!(entry("hf_token").is_ok());
        assert!(entry("not_a_key").is_err());
        assert!(entry("../other").is_err());
    }

    #[test]
    fn a_byok_endpoint_gets_its_own_entry_and_nothing_else_does() {
        assert!(entry("byok.api-example-com-gpt-4o-mini").is_ok());
        assert!(entry("byok.").is_err(), "an endpoint with no id");
        assert!(entry("byok.../hf_token").is_err());
        assert!(entry("byok.UPPER").is_err(), "ids are the ones byok.js makes");
        assert!(entry("byok.a b").is_err());
        assert!(entry(&format!("byok.{}", "x".repeat(65))).is_err());
        // C10: the broker's two families live by the same id rule.
        assert!(entry("ssh.nas").is_ok());
        assert!(entry("api.home.lan").is_ok());
        assert!(entry("ssh.").is_err());
        assert!(entry("ssh.NAS").is_err());
        assert!(entry("ssh.a..b").is_err());
        assert!(entry("api.hi there").is_err());
        assert!(entry("sh.nas").is_err(), "the prefix is exactly ssh.");
        // Another program's entry is still not reachable through the prefix.
        assert!(entry("git:https://github.com").is_err());
    }

    #[test]
    fn the_service_name_is_the_products() {
        assert!(SERVICE.contains("NeuraOS"));
    }
}
