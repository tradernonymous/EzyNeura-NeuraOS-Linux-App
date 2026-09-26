# 4. Approvals ask by default; allowlists are explicit and per project

Status: accepted · 2026-09

## Context

The model can write files, run commands and drive the keyboard. Asking for
everything is safe and slow; allowing everything is fast and unsafe. The
upstream app chose "ask" as the default and an `always | commands | never`
mode per person; a repository's `.freeai4u.json` can arrive with a cloned
project and would like fewer prompts.

## Decision

- **Ask is the default and the strict end.** Unknown, missing or broken
  settings read as "ask" (`approval.js` `STRICTEST`), in the code and on
  the card.
- **A project file can only narrow.** `.freeai4u.json` is a *request*:
  `project-config.merge` intersects its `allowedCommands` with the
  person's own and takes the stricter approval mode. Cloning a repository
  is not consent to what its author wrote in it.
- **Auto-allowance is either a rule or a switch the person throws.**
  The C11 read-only preset is a curated allowlist (chain, redirect and
  write-flag rejection before the list is consulted), keyed **per folder**,
  revocable from Activity. Commands are never trusted wholesale:
  `tools.js` `alwaysKey` returns `''` for them, as it does for every
  desktop-control tool.
- **Every decision is recorded.** C12 appends tool, summary and decision —
  never arguments — to a log the model's tools cannot read or rewrite.

## Consequences

- A power user who wants speed picks a level (delegate/full/sandbox) or
  throws the read-only preset per project; both are visible choices with a
  stated effect, not defaults that grew.
- The cost is cards: the mitigation is making the card cheap to read
  (summary, diff, C6 edit-before-allow), not making it disappear.
