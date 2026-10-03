#!/usr/bin/env python3
"""Lint .github/workflows/*.yml: valid YAML and SHA-pinned actions.

Exists because agent-triage.yml shipped with a colon that broke YAML
parsing, and GitHub reported it only as a nameless failed file-run --
the PR's checks stayed green-looking while a workflow was dead on arrival.
Two rules, both cheap:
  1. every workflow file parses as YAML;
  2. every external action is pinned to a 40-char commit SHA (the repo rule
     in docs/UPGRADE_WAVE_1.md); local ./.github/workflows refs are exempt.
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
findings = []

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
        for step in (job or {}).get("steps") or []:
            uses = (step or {}).get("uses", "")
            if uses and not SHA_USES.match(uses):
                findings.append(f"{path.name} [{job_name}]: unpinned action {uses!r}")

for finding in findings:
    print(finding)
print(f"{len(findings)} workflow finding(s)")
sys.exit(1 if findings else 0)
