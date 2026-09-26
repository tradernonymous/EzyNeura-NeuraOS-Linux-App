# 3. Secrets never travel

Status: accepted · 2026-09

## Context

A desktop app is asked to remember BYOK keys and a Hugging Face token; a
Tauri app's assets are trivially unpackable (dist, `.deb`, AppImage). A
secret that reaches a file, a log, a commit or a build artifact is public
the moment any of those leaves the machine.

## Decision

- **Storage**: BYOK keys and the HF token go through the OS keyring —
  Secret Service over D-Bus on Linux (`secrets.rs`,
  `sync-secret-service`), *not* the `linux-native` keyutils backend, which
  does not survive a reboot. Nothing secret is written to a settings file.
- **Transit**: secrets never appear in a log line, a crash report, an audit
  entry (C12 records summaries, never arguments) or a git commit —
  including this repository's commit messages.
- **CI**: `scripts/check-dist-secrets.mjs` scans the built dist, the `.deb`
  and the AppImage on every push (D1) and fails the build on a token or
  key, reporting **file and pattern name only** — a log line is also a
  place secrets travel.

## Consequences

- Forgetting the keyring (no session bus, Secret Service missing) means
  re-entering a key; the Doctor (D6) reports it rather than silently
  falling back to a file.
- The scan is a pattern gate, not a proof: it can be beaten by encoding.
  It exists to catch the accident (a pasted key), not the adversary.
- Patterns need maintenance: token shapes that collide with ordinary
  material (mangled crate names, distro library fixtures) carve out
  explicitly, with a test pinning each carve-out.
