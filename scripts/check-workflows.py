#!/usr/bin/env python3
"""Lint .github/workflows/*.yml: valid YAML, SHA-pinned actions, legal if:.

Exists because agent-triage.yml shipped with a colon that broke YAML
parsing, and GitHub reported it only as a nameless failed file-run --
the PR's checks stayed green-looking while a workflow was dead on arrival.
Three rules, all cheap:
  1. every workflow file parses as YAML;
  2. every external action is pinned to a 40-char commit SHA (the repo rule
     in docs/UPGRADE_WAVE_1.md); local ./.github/workflows refs are exempt;
  3. no `if:` reads the `secrets` context. GitHub's context-availability
     table grants `secrets` to `env`, `with` and `run` but not to a job or
     step `if`, and a reference there invalidates the file -- the same
     nameless 0-second file-run this script was written to catch. Gate on a
     step output (a key check) instead.
Usage: python3 scripts/check-workflows.py   (exit 1 on any finding)
"""
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("check-workflows needs pyyaml: pip install pyyaml", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
SHA_USES = re.compile(r"^[^@]+@[0-9a-f]{40}(#.*| .*)?$|^\./")
SECRETS_IN_IF = re.compile(r"\bsecrets\.")
findings = []


def reads_secrets_in_if(value):
    """True if an if: condition (inline scalar or >-block) mentions `secrets.`."""
    return isinstance(value, str) and bool(SECRETS_IN_IF.search(value))


for path in sorted((ROOT / ".github" / "workflows").glob("*.yml")):
    try:
        doc = yaml.safe_load(path.read_text())
    except yaml.YAMLError as exc:
        findings.append(f"{path.name}: invalid YAML: {exc}")
        continue
    if not isinstance(doc, dict) or "jobs" not in doc:
        findings.append(f"{path.name}: no jobs mapping")
        continue
    for job_name, job in (doc.get("jobs") or {}).items():
        if reads_secrets_in_if((job or {}).get("if")):
            findings.append(
                f"{path.name} [{job_name}]: job `if:` reads `secrets`, "
                "which GitHub rejects; gate on a step output instead"
            )
        for step in (job or {}).get("steps") or []:
            if reads_secrets_in_if((step or {}).get("if")):
                findings.append(
                    f"{path.name} [{job_name}]: step `if:` reads `secrets`, "
                    "which GitHub rejects; gate on a step output instead"
                )
            uses = (step or {}).get("uses", "")
            if uses and not SHA_USES.match(uses):
                findings.append(f"{path.name} [{job_name}]: unpinned action {uses!r}")

for finding in findings:
    print(finding)
print(f"{len(findings)} workflow finding(s)")
sys.exit(1 if findings else 0)
