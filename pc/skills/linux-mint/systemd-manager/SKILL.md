---
name: systemd-manager
description: Create, edit, time and debug systemd units on Linux Mint, system-wide or per user. Triggers on "systemd", "service file", "systemctl --user", "timer instead of cron", "unit failed", "daemon-reload", "journalctl -u".
---

# systemd on Mint

Mint 21 and 22 run systemd; Cinnamon sessions also have a per-user
instance (`systemctl --user`) that is the right home for anything that
belongs to the logged-in person: the Claude Code web UI, a llama-server,
a sync job. Root units go in `/etc/systemd/system/`; user units in
`~/.config/systemd/user/`. Never edit `/lib/systemd/system/*`: an update
overwrites it; use `systemctl edit <unit>` for an override.

## Which unit type

| Need | Unit |
| :-- | :-- |
| A long-running process | `.service`, `Type=simple` (or `notify` if the program supports it) |
| Something on a schedule | `.timer` + `.service`, not cron: logs land in the journal |
| Start when a port is hit | `.socket` + `.service` |
| Group several units | `.target` |
| Act when a path changes | `.path` + `.service` |

## A service file

```ini
[Unit]
Description=What it is, in one line
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/the-program --flag
Restart=on-failure
RestartSec=5
Environment=PORT=3001
# Hardening that costs nothing for most programs:
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only

[Install]
WantedBy=multi-user.target      # default.target for a --user unit
```

Then: `systemctl daemon-reload && systemctl enable --now name`.
For a user unit, the same with `--user`; add `loginctl enable-linger
$USER` if it must run while nobody is logged in.

## A timer

```ini
# backup.timer
[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true          # runs a missed one at next boot
[Install]
WantedBy=timers.target
```

`systemctl enable --now backup.timer`, then `systemctl list-timers`.

## Debug order

1. `systemctl status name` — is it failed, and what was the exit code.
2. `journalctl -u name -n 100 --no-pager` (add `-f` to follow, `--since
   "1 hour ago"` to narrow). For a user unit, `journalctl --user -u name`.
3. `systemctl cat name` — the file it actually loaded, with overrides.
4. `systemd-analyze verify /path/to/name.service` — syntax.
5. `systemd-analyze security name` — what the hardening is missing.
6. Boot time: `systemd-analyze blame`, `systemd-analyze critical-chain`.

## Do not

- Forget `daemon-reload` after editing a unit: the old one keeps running.
- Use `Type=forking` without `PIDFile=`: systemd loses the process.
- Set `Restart=always` with no `RestartSec`: a crashing unit loops at
  full speed and floods the journal; use `on-failure` plus a delay.
- Put secrets in `Environment=`: `systemctl show` prints them. Use
  `LoadCredential=` or an `EnvironmentFile=` with mode 0600.
- Reach for a system unit for a per-user program: it then runs as root or
  needs a dedicated user, when `--user` was enough.
