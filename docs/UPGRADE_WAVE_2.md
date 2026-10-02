# Upgrade wave 2: skills you can trust, and a Doctor

2026-09-25. The second phase of the upgrade work the user asked for —
performance, UI/UX and reliability, everything in scope including
dependencies. Wave 1 (`docs/UPGRADE_WAVE_1.md`) was the build chain; this is
the first wave of *app* work, and it is the plan's own wave 1: **B2, B3, B7,
D6, E4** from `docs/APP_UPGRADE_PLAN.md`.

The through-line is one sentence: **the app should tell you when something is
wrong, before it goes wrong, in words you can act on.** A skill that will
never fire, a machine missing a tool, a git identity nobody set — each is a
two-minute fix that today either happens silently or not at all.

## B2, B3, B5 — judging a skill before installing it

`app/desktop/src/skill-lint.js`, pure and UMD like the repo's other shared
modules, so `node:test` drives every rule directly.

**The cost (B2).** A skill's name and description ride in *every* prompt from
the moment it is installed, forever, whether or not that prompt needs it. Four
skills that look free in a store are a standing tax on every conversation, and
nothing in the UI said so. The estimate is `(name + description) / 4 + 12`
tokens — four characters per token, plus the per-entry overhead the preamble
pays — and it is shown on the row, with the running total against the
installed set. The body is deliberately *not* counted: it is read only when the
skill is chosen.

**The rules (B3).** Errors block the install, warnings do not, and the split is
the whole design:

| Blocks | Why it means the skill does not work |
| :-- | :-- |
| no frontmatter | the router never sees it |
| no name, or a name that is not its folder | it installs where the engine will not look |
| description over 1024 chars, or multi-line | it rides in every prompt |
| empty body, or over 500 lines | a document, not a skill |
| unknown frontmatter key | almost always a typo of a key we do read |
| a dead relative link | the catalogue did not keep its promise |
| a description identical to an installed skill | the router cannot tell them apart |

| Does not block | Why it is still worth saying |
| :-- | :-- |
| description under 40 chars | the router picks by description, so a terse one may never be chosen |
| no quoted trigger | same, from the other end |
| two or more triggers shared with another skill (B4) | they compete on every prompt |

The two rules that need more than one skill — the duplicate description and the
trigger collision — live in `lintSkills`, which is also where the B4 flag comes
from. B4's *fix* (disabling one of a colliding pair) is a screen's decision and
is not in this wave; the flag is, so the decision has something to be made
from.

The limits are the ones `scripts/check-skills.mjs` already enforces on this
repository's own 15 skills — the same list, deliberately, so "what passes in the
app" and "what passes our lint" cannot drift apart.

**The negative trigger (B5)** is surfaced on the card — `Do not use when …` is
often the most useful line a skill says, and the person deciding whether to
install is exactly the person who can say "not for this machine". *Honouring*
it in routing belongs to the engine, so it goes upstream as a proposal; showing
it does not.

## B7 — what a skill needs from the machine

`app/desktop/src/skill-prereqs.js`, again pure. A skill that shells out to a
tool the machine does not have fails at the moment it is chosen, mid-task, with
whatever error the tool chose to print. Prerequisites are read from a
`compatibility:` frontmatter key and from a `Prerequisites` section in the body,
and `checkPrerequisites` takes the PATH lookup as an injected function so only
the Rust side ever asks the real machine.

The known-tools table is deliberately short — a table of every tool in the
world is a table that is wrong the day a package is renamed, and **a wrong apt
line is worse than no apt line**, because it sends the user to a command that
fails. A tool that is not in the table is still checked; it just gets no hint.

A missing prerequisite does **not** block the install. The tool may be added
later, and the skill may have a path that does not need it. The one thing not
negotiable is silence.

## D6 — the Doctor

`app/desktop/src-tauri/src/doctor.rs` gathers; `app/desktop/src/doctor.js` says
it; `DoctorCard.tsx` renders it in Settings → System. The model is `hh doctor`,
and so is the reason: "the app does not work" is the least actionable bug report
there is.

One pass over Node, the engine, git, the saved keys, the local runtimes and the
command-line tools skills use — each check with its fix.

**Three states, not two.** `ok`, `warn`, `bad`, and the middle one is what a
boolean throws away. An engine that is not running is *fine* if you never asked
it to run, and NeuraOS starts it on demand. But an engine unit that is
**enabled to start on login and is not running** is a fault: the user asked for
that and it quietly did not happen.

A missing `git` is a `warn` (most of the app works without it). A `git` with no
`user.name`/`user.email` is `bad`, with both commands, because that is the
single most common reason a first-time user's first commit fails with a message
that reads like the app's fault.

**Two rules govern every check:** a check that cannot fail does not belong here,
and a check must not be slow — it runs on a button press, never on a timer,
because it shells out to `command -v` for seven tools.

**Nothing secret is ever reported.** The backend answers *whether* a key is
present and never what it is, so the card is safe to paste into a bug report —
which is the entire reason someone opens it. That is asserted, not asserted-in-
prose: a Rust test walks the `keys` section and fails if anything there is not a
boolean, and a node test walks every string the Doctor can produce and fails on
anything token-shaped.

## E4 — testing a Hugging Face token

`hf-auth.js` gained `checkToken`, and the paste field gained a **Test token**
button next to *Use token*.

`useToken` already validated against whoami before saving, so the check itself
existed — but only as part of committing. The split matters: `checkToken`
verifies and resolves with the user it belongs to, and **saves nothing**. A
button labelled "Test" that quietly wrote a credential to the OS keyring would
be a nasty surprise, and the point is to find out *before* committing to a
token. `useToken` is now `checkToken` plus the saving, so the two cannot
disagree about what a valid token is — a test walks the same four cases through
both and compares the verdicts.

The three failures stay distinct because each has a different next step: a
malformed string is a copy-paste problem (and costs no request), a 401 is a
wrong-or-revoked token, and a missing inference permission is a checkbox on
Hugging Face's own page.

## What was verified, and how

| Check | Result |
| :-- | :-- |
| `cargo test --locked` | **157 passed**, 0 failed, 1 ignored (pre-existing) — 148 before |
| `cargo clippy --locked --all-targets -- -D warnings` | clean |
| `npx tsc --noEmit` | clean |
| `node --test 'app/test/*.test.js'` | **172 passed**, 0 failed — 105 before |
| `node scripts/check-skills.mjs` | 15 skills, 0 findings |
| `npm run build` | green, under the size budget (see below) |
| CI (`Linux / build`) | green, end to end |

The 67 new tests are 35 for the lint, 19 for the Doctor, 11 for the token, plus
2 for the new Rust. The ones worth naming, because they are the ones a
screenshot would not catch:

- **every `bad` check carries a fix, and no other check does** — a doctor that
  reports a problem you cannot act on teaches people to ignore the card;
- **`checkToken` saves nothing**, asserted against a recording store rather
  than merely unmentioned;
- **a warning is never promoted to an error, and an error never demoted**,
  pinned in both directions, because a rule in the wrong half of that split is
  a real bug: too strict and a working skill cannot be installed, too lax and a
  broken one installs and silently never fires.

### Two bugs this phase's own tests caught

**1. The Doctor would have cried wolf on every Linux machine.** The first draft
warned when the engine's user unit was "available but not enabled". But
`service.available` only means systemd *user sessions* work, which is true on
essentially every machine with a desktop — so that check would have fired on
all of them, on the first run, for a state that is entirely normal. Not running
is now `ok`; only *enabled and not running* is `bad`.

**2. A generic quoted word was not being filtered.** The trigger extractor
dropped "the" and "and" but kept "code" and "api" — the two words the plan
names as actively harmful, because they fire on every prompt and so teach the
router nothing. The generic list is now the same one `check-skills.mjs` uses.

**3. Newer clippy rejects the `feature = "never"` cfg trick.** `doctor.rs`
selected its Linux tool table with a feature nothing ever enables; current
stable clippy fails it as `unexpected_cfgs` under `-D warnings`. The two
cfg-gated copies are now one function with a `#[cfg]` on statements — same
facts on every platform, no fake feature.

## Not verified here, and said plainly

**The Doctor and the token test have not been watched working in the running
app.** The logic behind both is unit-tested and the frontend type-checks and
builds, but `doctor_facts` shells out through Tauri and the card renders from
it, and that path has only been exercised on real Mint hardware by nobody yet.
It needs a click on a real machine before it is called done.

**The prerequisite check in the catalogue is stubbed to "present".** In
`LibraryScreen` the `isPresent` callback returns `true` for everything, because
the catalogue is read before anyone opens Settings and probing seven tools per
row on render is not free. So a skill asking for `jq` will not be flagged in the
store today. The parsing, the hints and the message are all tested; the wiring
to a real PATH probe is not, and is the obvious next step — the Doctor already
gathers exactly the facts it needs.

**A dead relative link is only checked when the caller can check one.** The
store has not fetched the sibling files, so reporting a link as dead there
would be a lie; the rule runs only when a `hasFile` is supplied.

**B7's executable bit on bundled `.sh` scripts is not done.** It is in the
plan's B7 and belongs here, but it needs a `chmod` through the shell and a
decision about what it means for a file in a user's project; it is left rather
than half-done. The rest of B7 is in.

## Worth an upstream PR

Same call as wave 1 — "fix here, note for upstream". These are upstream
improvements, not Linux workarounds:

1. `checkToken` split out of `useToken`, with the Test button (E4) — every
   platform has this field;
2. the context-cost estimate and the lint on the skill card (B2, B3) — the
   rules and limits match what `freeopenai`'s own skill tooling checks;
3. the Doctor card (D6), including the "safe to paste" discipline.

## Still open

From `docs/APP_UPGRADE_PLAN.md`: B1, B4's fix, B8–B12, all of phase C (agents
and runs), D1–D5, and the held follow-ups in phase E. The Linux-phase
checklist that still needs real Mint hardware is unchanged and remains in
`docs/BACKLOG.md`.
