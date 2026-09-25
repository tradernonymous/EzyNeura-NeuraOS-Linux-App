---
name: mint-admin
description: Everyday administration of a Linux Mint PC - packages with apt and Flatpak, users and groups, permissions, cron and timers, logs, mounts, Timeshift. Triggers on "apt install", "PPA", "flatpak", "add user to group", "chmod", "chown", "fstab", "mount a drive", "timeshift", "update manager".
---

# Administering Mint

## Know the box

`hostnamectl` (Mint version and kernel), `cat /etc/linuxmint/info`
(edition and codename), `lscpu | grep -E "Model name|^CPU\(s\)"`,
`free -h`, `lsblk -f`. Mint 21 is on the Ubuntu 22.04 base, Mint 22 on
24.04; that base decides which PPAs and `.deb` files fit.

## Packages

- `sudo apt update && sudo apt upgrade` is what Update Manager does;
  `apt list --upgradable` shows what it would.
- Before removing: `apt-get --simulate remove pkg`. `sudo apt autoremove
  --purge` clears orphans and old kernels (keep the running one plus one).
- A PPA: `sudo add-apt-repository ppa:name/ppa`; Mint pins them normally.
  Check `apt policy pkg` to see which source wins.
- Flatpak is Mint's second store (`flatpak install flathub org.x.y`,
  `flatpak update`, `flatpak uninstall --unused`). Snap is disabled by
  policy on Mint; do not re-enable it for a package that has a `.deb` or
  a Flatpak.
- A downloaded `.deb`: `sudo apt install ./file.deb` (resolves
  dependencies; `dpkg -i` does not).
- What owns a file: `dpkg -S /path`; what a package put where:
  `dpkg -L pkg`.

## Users, groups, permissions

- `sudo usermod -aG docker "$USER"` (the `-a` matters: without it the
  other groups are gone), then log out and in.
- `chmod 750 script.sh`, `chmod 644 config`; never `chmod -R 777`.
  Diagnose a permission problem with `namei -l /full/path`.
- `sudo chown -R "$USER":"$USER" ~/some-dir` after a copy made as root.
- ACLs when chmod is not enough: `setfacl -m u:name:rwx dir`, `getfacl`.

## Scheduling

Prefer a systemd user timer (see systemd-manager) to a crontab: the
journal keeps its output. If cron: `crontab -e`, always redirect
(`cmd >> ~/.local/state/job.log 2>&1`), and remember cron's PATH is
minimal.

## Logs

`journalctl -p err -b` (this boot's errors), `journalctl -u unit`,
`journalctl --user -u unit`, `journalctl -k` (kernel), `-f` to follow,
`--since "2 hours ago"`. Size: `journalctl --disk-usage`,
`sudo journalctl --vacuum-size=300M`.

## Drives

`lsblk -f` for the device and its UUID; mount once with `udisksctl mount
-b /dev/sdb1` (no sudo, as the desktop does) or permanently in
`/etc/fstab` as `UUID=... /mnt/data ext4 defaults,nofail 0 2`, then
`sudo mount -a` before any reboot: `nofail` keeps a missing drive from
blocking boot.

## Timeshift

`sudo timeshift --create --comments "before X"` before a driver, kernel
or desktop change; `sudo timeshift --list`; restore from the live USB
when the desktop no longer starts.

## Do not

- `sudo` a graphical app (`sudo nemo`); use `admin://` in Nemo or
  `pkexec`.
- Edit `/etc/sudoers` with an editor: `sudo visudo`, or a file in
  `/etc/sudoers.d/`.
- Mix `pip install` into system Python: `pipx` or a venv.
- Leave a `.deb` from a random site installed with no source to update
  it; prefer the apt repo or the Flatpak.
