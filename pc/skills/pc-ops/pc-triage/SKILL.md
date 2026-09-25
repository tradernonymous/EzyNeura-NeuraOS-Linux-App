---
name: pc-triage
description: Start here for any "something is wrong with this PC" request - decide in one pass which pc-ops skill applies, after a read-only look, before changing anything. Triggers on "my PC", "this machine", "something's wrong", "is everything ok", "health check", "what's going on with".
---

# Triage before treatment

A person says the PC is slow, hot, full, offline or "weird". Do not
guess. Read, decide, hand off.

## 1. Read-only, no permission needed

```bash
uptime; free -h | head -2; df -h / /home 2>/dev/null; systemctl --failed --no-pager
journalctl -p err -b --no-pager | tail -15
ss -tulpn 2>/dev/null | grep -v 127.0.0.1 | tail -n +2     # anything on the LAN
```

Plus `nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv`
if the box has an NVIDIA card (`~/.claude/pc.md` says).

## 2. Decide

| Sign | Next skill |
| :-- | :-- |
| Load high, a process at the top of `top` | `pc-vitals` (who, then why) |
| `df` over 90%, "no space left" | `mint-troubleshooter` disk section |
| `systemctl --failed` non-empty | `systemd-manager` |
| `apt list --upgradable` long, a kernel behind, reboot pending (`/var/run/reboot-required`) | `pc-patch` |
| No route, DNS fails, Wi-Fi drops | `pc-network` |
| A container down, disk eaten by images | `pc-docker` |
| A port open to the LAN nobody meant, a login you do not know, Lynis not run in months | `pc-security-audit` |
| Before any of the above changes something | `pc-backup` (a Timeshift snapshot) |

## 3. Hand off with the evidence

Name the skill and paste the two or three lines that decided it. The
person sees why, and the next skill does not repeat the reads.

## Never in triage

No `sudo` that writes, no restart, no `apt`, no `kill`. Triage is the
look; the treatment is a separate, visible step.
