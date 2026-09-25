---
name: pc-backup
description: Back up and restore this PC - Timeshift for the system, a home-folder backup for files, what to exclude (model caches), and a restore test. Triggers on "backup", "timeshift", "restore", "snapshot before", "rsync my home", "what should I back up".
---

# Backup and restore

Two layers, two tools: Timeshift for the system (packages, drivers,
config under `/etc`), and a plain `rsync` of the home folder for the
things that are yours. Neither replaces the other.

## System: Timeshift

- `sudo timeshift --create --comments "reason"` before any driver,
  kernel, desktop or PPA change; automatic daily snapshots in Timeshift's
  settings (rsync mode, a separate drive if there is one).
- `sudo timeshift --list`; `sudo timeshift --restore` from a working
  system, or from the Mint live USB when the desktop no longer starts.
- Timeshift excludes home by default: keep it that way, or every
  snapshot carries the model caches.

## Files: rsync to a second drive or a NAS

```bash
DEST=/media/you/backup/home-$(hostname)
rsync -aHAX --info=progress2 --delete \
  --exclude='.cache/' --exclude='.local/share/Trash/' \
  --exclude='.ollama/' --exclude='.cache/huggingface/' \
  --exclude='**/node_modules/' --exclude='**/target/' \
  "$HOME/" "$DEST/"
```

- `--delete` mirrors; drop it for an archive that keeps deleted files.
- What is not worth space: model caches (re-downloadable; NeuraOS lists
  them), build outputs, browser caches.
- What is worth a second copy elsewhere: `~/.ssh`, `~/.gnupg`, the
  keyring (`~/.local/share/keyrings`), `~/.claude` (settings, skills,
  transcripts), NeuraOS's data (`~/.local/share/com.freeai4u.desktop`),
  and any project not pushed to a remote.
- Encrypt a backup that leaves the house: `gocryptfs` or a LUKS drive.

## Restore test, once a quarter

Restore one folder from the backup into `/tmp` and open a file from it.
A backup nobody restored from is a hope, not a backup.

## Do not

- Back up onto the same physical disk as the source.
- Run the first full backup and walk away: check `df -h "$DEST"` first.
- Snapshot with Timeshift to a FAT or NTFS drive (permissions are lost).
