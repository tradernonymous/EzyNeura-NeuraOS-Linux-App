---
name: mint-hardening
description: Harden a Linux Mint desktop that also runs AI agents - firewall, SSH keys only, automatic security updates, fail2ban, AppArmor, keyring for secrets, an audit trail - without locking yourself out. Triggers on "harden", "firewall", "ufw", "ssh hardening", "fail2ban", "unattended-upgrades", "apparmor", "security audit", "lynis".
---

# Hardening a Mint desktop

A desktop that runs agents needs three things a plain desktop does not:
nothing listening on the LAN that need not, secrets the agents cannot read,
and a record of what they ran. Everything here keeps one session open
while it changes access: never test an SSH change by closing the only
terminal you have.

## 1. Measure first

```bash
sudo ss -tulpn                      # every listening port and its owner
sudo apt install -y lynis && sudo lynis audit system --quick
```

Lynis under 65 means fix the warnings first; over 80 means maintenance.

## 2. Firewall (Mint ships ufw, off)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.1.0/24 to any port 22 proto tcp   # SSH from the LAN only, if at all
sudo ufw enable && sudo ufw status verbose
```

The Claude Code web UI, llama-server, sd-server and the NeuraOS engine all
bind `127.0.0.1`: they never need a rule. A service that "needs" `0.0.0.0`
gets an SSH tunnel instead.

## 3. SSH, if the PC accepts it

In `/etc/ssh/sshd_config.d/hardening.conf`:

```
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AllowUsers you
```

`sudo sshd -t && sudo systemctl reload ssh` (test, then reload; never
restart from the session you are in). Keys: `ssh-keygen -t ed25519`.
`fail2ban` (`sudo apt install fail2ban`, backend `systemd` in
`/etc/fail2ban/jail.local`) then bans the rest.

## 4. Updates

`sudo apt install unattended-upgrades && sudo dpkg-reconfigure
unattended-upgrades` for security updates alone; Update Manager keeps
doing the rest on your schedule.

## 5. AppArmor

On by default on Mint (`sudo aa-status`). Keep it in enforce; a denial
shows in `journalctl -k | grep apparmor`. Claude Code's Bash sandbox
(bubblewrap) needs the `bwrap` profile on Mint 22; `pc/safety/sandbox-setup.sh`
in the NeuraOS repository adds it.

## 6. Secrets

- API keys in the keyring (`secret-tool store`), read by a helper
  script, never in `.bashrc`, a `.env` the agent can read, or a command
  line (it shows in `ps`).
- `~/.claude/settings.json` deny rules for `~/.ssh/**`, `~/.gnupg/**`,
  `**/.env` (`pc/settings/readonly-allowlist.json`).
- SSH agent forwarding off by default; `ssh-add -t 1h` when a key is
  loaded.

## 7. An audit trail

A PostToolUse hook that appends every command an agent runs to a
root-owned, append-only file (`chattr +a`): `pc/safety/install-audit-log.sh`.
`sudo auditd` on top if compliance asks for it.

## Do not

- `setenforce 0`-style shortcuts: `aa-complain` a profile you are
  debugging, then back to enforce.
- `NOPASSWD: ALL` in sudoers for an agent user; name the exact commands.
- Open a port "temporarily" without a note to close it; `ufw status
  numbered` and `ufw delete N` when done.
- Disable the firewall to debug: `sudo ufw allow from <ip>` for the
  duration instead.
