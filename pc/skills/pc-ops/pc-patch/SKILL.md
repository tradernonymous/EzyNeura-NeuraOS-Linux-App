---
name: pc-patch
description: Update this Linux Mint PC safely - apt, Flatpak, firmware, kernels, the NeuraOS app and Claude Code - with a Timeshift snapshot first and a clear list of what changed. Triggers on "upgrade the system", "apt upgrade", "patch tuesday", "pending upgrades", "kernel upgrade", "is a reboot needed", "unattended-upgrades".
---

# Patching Mint

## Look (no prompt)

```bash
sudo -n true 2>/dev/null || echo "sudo will ask for a password: run this in a terminal you can answer in"
apt list --upgradable 2>/dev/null
flatpak remote-ls --updates 2>/dev/null
fwupdmgr get-updates 2>/dev/null | head -20
[ -f /var/run/reboot-required ] && cat /var/run/reboot-required.pkgs
claude --version 2>/dev/null; apt policy neuraos 2>/dev/null | head -3
```

## Plan, show, then do (asks)

1. Snapshot: `sudo timeshift --create --comments "before updates $(date +%F)"`
   (skip only if one is under a day old: `sudo timeshift --list | tail -3`).
2. `sudo apt update && sudo apt full-upgrade` (Update Manager's level 4
   and 5 packages, kernels included, are fine on a snapshotted machine).
3. `flatpak update -y`.
4. `sudo fwupdmgr update` only when the person is present: firmware can
   ask for a reboot mid-way.
5. `sudo apt autoremove --purge` (keeps the running kernel and one more).
6. NeuraOS comes through apt (its own repo) and Claude Code updates
   itself (`claude update` to force it).
7. Reboot if `/var/run/reboot-required` exists; a kernel or NVIDIA driver
   update needs it, a library update usually does not (`needrestart` lists
   the services to restart instead).

## After

`journalctl -p err -b` once rebooted, `dkms status` on NVIDIA, and the
two lines that matter to the person: what changed, and whether a reboot
happened.

## Do not

- `apt upgrade` with `-y` before showing the list: a held-back package
  or a removal in that list is the whole point of looking.
- Remove a kernel that is the one running (`uname -r`).
- Update firmware over Wi-Fi on a laptop on battery.
- Mix in unrelated installs; a patch run changes versions, nothing else.
