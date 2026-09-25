---
name: bash-scripting
description: Write and review Bash scripts that are safe to re-run on this PC - strict mode, quoting, traps, argument parsing, ShellCheck. Triggers on "bash script", "shell script", "set -euo pipefail", "shellcheck", "write a script that", "cron job script".
---

# Bash that survives contact

Every script starts with:

```bash
#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
```

`-e` stops at the first failure, `-u` at the first unset variable, and
`pipefail` makes a pipe fail when any stage does. Scripts that must keep
going after a step fails say so per step: `cmd || true`.

## Rules

- Quote every expansion: `"$var"`, `"${arr[@]}"`, `"$(cmd)"`. A path
  with a space is the normal case on a desktop (`~/Documents/Tax 2026`).
- `[[ ]]` for tests, `(( ))` for arithmetic, `$( )` for command
  substitution, never backticks.
- `die()` and a `trap cleanup EXIT` that removes temp files and kills
  background children by PID (`$!`), never `pkill -f`.
- Check tools before using them: `command -v jq >/dev/null || die "jq
  missing (sudo apt install jq)"`.
- `mktemp -d` for scratch, `local` for every function variable,
  `readonly` for constants.
- Loop over files with `find ... -print0 | while IFS= read -r -d '' f`,
  never over `ls` output.
- Arguments: a short `while getopts` or a `case` loop; `--help` prints
  usage and exits 0.
- Idempotent: running it twice changes nothing the second time (`mkdir
  -p`, `install -m`, `grep -q || echo >>`).
- Timestamps in logs as `date -Is`.

## Skeleton

```bash
#!/usr/bin/env bash
set -euo pipefail
usage() { echo "usage: $0 [-n] <dir>" >&2; exit "${1:-1}"; }
die() { echo "$0: $*" >&2; exit 1; }
dry=0
while getopts "nh" opt; do case "$opt" in n) dry=1 ;; h) usage 0 ;; *) usage ;; esac; done
shift $((OPTIND - 1))
[[ $# -eq 1 ]] || usage
dir="$1"; [[ -d "$dir" ]] || die "not a directory: $dir"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
# work...
```

## Review checklist

`shellcheck script.sh` (apt: `shellcheck`) is step one; then: any
unquoted `$`; any `eval`; any `rm -rf "$var/"` where `var` could be
empty (`-u` catches unset, not empty: test it); `sudo` inside a script
that a hook or timer runs (it will hang on the password prompt); a script
over about 200 lines (write it in Python instead).

## Do not

- `eval` on anything from outside the script.
- `cd` without `|| exit`: with `-e` off it keeps going in the wrong dir.
- Parse `ls`; test `-f` and `-d` instead.
- Assume the working directory: use `"$(dirname "$0")"` or an absolute
  path.
