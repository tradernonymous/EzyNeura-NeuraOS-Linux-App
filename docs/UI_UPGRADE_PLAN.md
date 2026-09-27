# UI/UX upgrade plan: 37 fixes, phase by phase

Drafted 2026-09-26, expanded 2026-09-27 after a screenshot pass over every
space on a built `main` (2.11.0) and a look at how the most-starred AI chat
and agent apps (Open WebUI, LobeChat, Cherry Studio, Zed) handle density.
Full research and the corrections to an earlier shadcn/Next.js/Tailwind
proposal are kept below in §7 for the record; this plan itself is the 37
concrete findings, grouped into build phases.

**Status legend:** ⬜ not started · 🔧 in progress · ✅ shipped to `main`,
verified by CI.

## Phases

### P1 — Chrome: remove duplicates, always-visible cruft ✅

Lowest risk (CSS and layout, no state logic), highest visible payoff. Each
line below was checked against the running app (a debug build under Xvfb)
before and after, not just against the source.

1. ✅ The chat sidebar renders only in Chat (`destinationOf(view) ===
   'chat'`); Settings, Code, Create and Agents no longer carry it. Ctrl+B
   still remembers hidden/shown.
2. ✅ Removed two of the three ways to open the command palette: the
   sidebar's compass icon and the status bar's "Commands Ctrl+K" button.
   The top bar's Search is now the one entry point (the keyboard shortcut
   works everywhere regardless). Engine state, version and Hugging Face
   sign-in were re-checked against the running app: each already had one
   deliberate home (the status bar says so in its own header comment,
   NEURA-076) and is left alone — the "×2/×3" counts in the original
   pass over-read some of these; corrected here rather than removing
   something that was in fact single-sourced.
3. ✅ Sidebar footer: removed the Settings, Theme and Hide-sidebar buttons
   (identical buttons already sit in the top bar) and the version text
   (the status bar's is the one that stays). The orb and Export/Import
   stay — real functionality with no other home.
7. ✅ `button` now sets `display: inline-flex; align-items: center;
   justify-content: center; gap: 6px; white-space: nowrap;` (the same
   trio `.raised` already used), so an icon-plus-label button can no
   longer wrap the label onto its own line under the icon. Fixed Doctor's
   "Run the checks again", Library's "Save as skill" and "Refresh", and
   any other plain `<button>` with an icon, in one place.
18. ✅ Chat titles: `.sidebar .session-title` now sets its own
    `font-family`, overriding a generic `.session-title` rule that was
    monospace (built for a path, not a title). `.session-title` has this
    one call site in the whole frontend, confirmed with a search, so
    nothing else was touched by giving it back the text font; not
    re-confirmed with a fresh screenshot (getting a populated chat list
    under Xvfb needs a live engine connection, which this pass's scripted
    connect attempts did not reliably reach). Folding the "NEURAOS HOME"
    header for a single folder was looked at and held back: it is also
    the fold/unfold control and the "new chat in this folder" button, not
    pure chrome — worth a proper redesign, not a delete, in a later pass.
36. 🔧 `.hf-signin` gained `text-align: left; justify-content: flex-start`
    (harmless, and correct as far as it goes), but a screenshot after the
    change still shows the sign-in line and button sitting away from the
    card's left edge, so whatever centres it is elsewhere in the cascade
    and was not found by reading the CSS alone. Left in place as a partial
    fix; the real cause needs a live inspector, not grep, and is moved to
    a follow-up rather than claimed done on the strength of a change that
    did not visibly work.

**Not done, corrected instead of forced:** a re-check against the running
app did not support three of the original claims. **32** (a bordered,
inset main content area): not found in the built app or the CSS — the
main pane is already flush; retracted. **33** and **32**'s "hide the
status bar" idea: the status bar's own header comment documents it as a
deliberate, single design (engine origin, the one findable update
control per NEURA-076); slimming it further would undo that decision,
not fix a duplicate. **34** (a visible Zen control): already in the
command palette and in Settings → Shortcuts; a top-bar icon would need a
new glyph for a small marginal gain, held for a later pass rather than
rushed. **17** (sidebar top redesign) and **37** (copy buttons for long
paths/commands) are real and unclaimed, moved to a later pass: 17 touches
real quick-access controls (folder tree, terminal, runs) that need a
proper new home, not a delete; 37 needs a small shared component, cleaner
built once, alongside P4's Settings work.

### P2 — Help text on demand 🔧 (started)

4. ✅ `components/Hint.tsx`: a short `summary` stays visible, the rest is a
   `More`/`Less` toggle away (`.linkish`, no new icon), tied to the
   expanded text with `aria-controls`/`aria-expanded` and a `useId()`.
   `test/desktop-hint.test.js` caps every literal `summary="…"` in the
   frontend at `HINT_SUMMARY_MAX` (70 chars) and pins the migrated call
   sites, so the doc and the code can't quietly drift apart. Confirmed
   working end to end with a debug build under Xvfb: collapsed to one
   line, click "More", the rest appears, button reads "Less".

   **Migrated this phase** (7 call sites, the largest and plainest —
   picked because their text has no embedded `{state}` that a mechanical
   split could get wrong): the retry-policy paragraph
   (`SettingsScreen.tsx`), Doctor's intro, the LoRA explainer
   (`LocalImagesCard.tsx`, split so "No LoRAs yet." — a state, not an
   explanation — stays outside the fold), Desktop control's two hints
   (the five-tools list, and the MCP-tools one — its `mcpError` was
   pulled out to its own always-visible line rather than migrated into
   the collapsible text, since an error is state), the "Use NeuraOS from
   other agents" blurb (`ConnectorsCard.tsx`), and Dictation's intro
   (`DictationCard.tsx`, keeping its `builtInDictationHint()` call inside
   the expandable part).

   **Still open**: roughly 120 of the 127 `settings-hint` paragraphs.
   Most of what is left either already reads as one short line (nothing
   to fold), is state text that the plan's own rule keeps visible, or
   mixes explanation with per-render dynamic values closely enough that
   a safe split needs reading each call site on its own — real work, not
   a mechanical pass, left for a follow-up rather than rushed to hit a
   count.

### P3 — a real bug, and the providers list ✅ (recalibrated)

Re-reading items 5 and 6 against the actual components (not just the
screenshot) found more real functionality than a quick pass gives credit
for, so this phase's scope changed before it was built rather than after:

19. ✅ Fixed the empty-chat bug: `ChatScreen.tsx`'s `!active` state said
    "Starting one now…" under a New chat button, but nothing calls
    `startNew()` on mount — only that button, the sidebar's own New chat,
    and the project picker do. The false promise is gone; the button is
    now the only, honest next step.
8. ✅ Pulled forward from P4 (same risk level, same phase's worth doing):
   the Providers list now shows every provider that already works, and
   folds the rest behind a native `<details>` "N more — add a key"
   instead of N rows each reading "no key set" in warning yellow — which
   read as N problems, not N providers nobody has asked to set up.
   Nothing is hidden permanently, only collapsed, same as `Hint`. Both
   changes are small and mechanical (a deleted line of copy; a
   `.filter()`/`<details>` split of an existing map) and passed the full
   local gate, but this pass's screenshot attempts kept landing on the
   connect-retry screen instead of a connected Chat or Settings → AI &
   Models, so neither is confirmed by a fresh screenshot the way P1 and
   P2 were — said plainly rather than claimed.

**Re-scoped, not built:** item 5 (empty chat: a 2×2 suggestion grid, one
"Tip" chip replacing the two promo cards) and item 6 (the composer
consolidated into a model chip + a `+` menu + one mode chip) turned out
larger than a phase-3-sized change on inspection. The suggestion pills
already wrap by content length, not a layout choice, so a strict 2×2
grid would need shorter prompts or truncation to hold, either a real
content decision; and the two promo cards (`MintPackCard.tsx`,
`Flux2OfferCard.tsx`) are not static banners but two independent,
stateful install flows (progress text, a busy state, their own dismiss)
— collapsing them into one chip means designing a shared summary UI for
two different flows, not a CSS change. Both are real, worthwhile, and
moved to their own future pass rather than forced into this one.

### P4 — Settings screen 🔧 (started)

9. 🔧 Doctor, half built. ✅ "Bundled engine FAIL" now reads "not in use"
   (state `skip`, no fix prescribed) whenever the app's current
   connection is healthy on a different engine — `App.tsx` already
   computes `outcome.kind`, threaded through `SettingsScreen` to
   `DoctorCard` to a new `remoteEngineHealthy` fact in `doctor.js`,
   read through a ref so a flip mid-session cannot trigger the whole
   probe suite to re-run. Pinned in `desktop-doctor.test.js`: `skip` and
   no fix when a remote engine is healthy, still `fail` when nothing is.
   ⬜ Still open: one row per check folded into "N passing" — the row
   markup itself, a separate, larger change from the wording fix.
10. 🔧 Settings layout, three of four done and confirmed on screen (a
    debug build under Xvfb, before/after):
    ✅ dropped the "v2.11.0" badge next to the "Settings" title — the
    status bar is the one place that names the build (NEURA-076), this
    was the duplicate, not the heading itself.
    ✅ menu subtitles are one line (`white-space: nowrap; overflow:
    hidden; text-overflow: ellipsis`); the full text is still there as
    the button's own `title` tooltip, so nothing is lost, and in
    practice most now fit without even needing the ellipsis.
    ✅ cards no longer stretch to match a taller sibling in the same grid
    row (`align-items: start` on `.settings-main` — the grid's own
    `align-items: stretch` default, plus the card's `height: 100%`, was
    the cause; Appearance used to grow a blank lower half to match a
    taller neighbour).
    ⬜ Not done: the shortcuts grid already has its own progressive
    disclosure (`ShortcutsCard.tsx`'s `PEEK` slice + "All N · change"),
    which a fixed test (`desktop-settings.test.js`) pins as intentional
    structure, not leftover duplication — collapsing it further to a
    bare link is a bigger rewrite of already-reasonable behaviour, not a
    quick win, and is dropped from this item rather than forced.

### P5 — Chat: message anatomy and performance 🔧 (started)

16. ✅ Fixed the real performance bug: every streamed token re-rendered
    **and re-parsed** every earlier message's markdown, not just the one
    growing. `send()`'s streaming `append()` (read directly, not
    guessed) replaces only the last message's object —
    `s.messages.slice()` then `msgs[msgs.length - 1] = { ...last, ... }`
    — and keeps every other message's reference exactly as it was. A new
    `MessageBody` leaf component, `memo`'d on the whole `msg` object with
    its own `useMemo` around the `renderMarkdown`/citation-linking call,
    is therefore skipped entirely — parse included — for every message
    except the one actually changing. Pinned in
    `desktop-chat-anatomy.test.js`.
11. ✅ Dropped the "You" header line from a plain user message (kept for
    a shell command, which is worth marking as one) and gave user
    messages their own lane: `max-width: min(560px, 88%); margin-left:
    auto`. The bubble shape (`16px 16px 6px 16px`, one sharp corner) was
    already drawn for a right-aligned message; nothing had actually
    narrowed or moved it there before this, so it rendered as a
    full-width card with a pointless corner. Confirmed with a real
    render: `index.css` loaded into headless Chromium (`/opt/pw-browsers`,
    already on this machine, no new dependency) against a small fixture
    of the actual message markup — before/after screenshots, not
    guessed from the CSS text. "Show the model name only when it
    changes" is not done: a real feature (tracking the previous
    message's model across renders), not a wording change, left open.
12. ⬜ Fold a finished turn into "Thinking / Commands / Edits" chips
    (Zed's pattern); code blocks over ~15 lines collapse to one row.
13. ⬜ A pinned approval bar ("1 action waiting") when an Allow card has
    scrolled out of view.
14. ⬜ Search within a chat (Ctrl+F) that opens folded steps containing a
    match.
15. ⬜ A Comfortable / Compact message-density switch.

Items 12–15 are each a real feature (new state, new interaction), not a
CSS or memoisation fix, and are left for their own pass rather than
rushed alongside 11/16.

### P6 — Code space ✅ (re-scoped, both real items closed)

20. ✅ The toolbar's own "Open a folder" button is gone once there is no
    folder — confirmed as a real, standing triple with the very first,
    pre-any-change screenshot from this project (toolbar button,
    the disabled textarea's "Open a folder first" placeholder, and the
    centred empty state's own "Open a folder…" button, all three on
    screen at once). The centred button — bigger, where the person is
    already looking, next to the recent-folders list — is the one that
    stays; the placeholder stays too (it explains a disabled control,
    which is a different job than asking twice).
22. ✅ Already fixed, no new code: the "Run"/"Stop" buttons are
    `<button className="primary">`/`<button className="danger">`, and
    P1's fix to the base `button {}` rule (`display: inline-flex`,
    `white-space: nowrap`) already covers every plain button regardless
    of which extra class it carries. Confirmed with the same headless-
    Chromium fixture technique from P5: rendered the exact disabled
    "Run" button (icon + label) against the real `index.css` — one line,
    dashed only because it is genuinely disabled with no folder open,
    which is correct.

**Retracted, not built:** items 21 and 23 did not hold up against the
actual components. **21** (the deck row on focus/as `/` commands only):
`TaskDecks.tsx` is a hover-to-preview menu — resting on "Build" for a
beat opens a card of that deck's specific tasks, the same pattern
`TopNav.tsx` already uses deliberately. The `/` list is the fast path for
someone who already knows what they want; the row is how someone finds
out what is there in the first place. They are not the same feature
wearing two costumes, and hiding the row would remove the only way to
browse. **23** (5 icons into one "Panels" menu): only one of the five
(Terminal) is actually a panel toggle; the other four are one-click
quick-fills (test/review/commit templates) and a Docker mode switch,
each already named by its own tooltip. Folding distinct, labelled,
single-click actions into a menu costs a click for no duplication fixed.

### P7 — Create space ⬜

24. Collapse the doubled project picker (a dropdown and a "PROJECT —"
    picker) plus Template/Service/Model/System/cloud-tier into
    "Project ▾" and one gear popover.
25. The start gallery (Landing page, Deck, Social post, Photo…) becomes
    the entry point; the Page/Deck/Post/Image/Edit-image tabs show only
    once a project exists, instead of duplicating the gallery.
26. Drop all-caps micro-labels (FRAME, EXPORT, TEMPLATE, SERVICE, MODEL,
    SYSTEM); the value plus a tooltip is enough.
27. Disabled buttons (Generate, Export, Run, Find skills) use normal
    disabled styling, not a dashed drop-zone border.

### P8 — Agents → Library ⬜

28. One empty state with the two real actions (sign in to Hugging Face,
    install from GitHub) instead of 5 empty sections shown at once.
29. One name for "Installed manuals" / "Skills".
30. Fix the stray checkmark glyph, the sections sitting flush against the
    panel edge, and the Hugging Face card's mixed left/centre alignment.
31. Drop the "LIBRARY" heading row and the tall Refresh button; Refresh
    becomes an icon in the tab bar.

## Verification, every phase

Each phase is its own PR, and per `.claude/skills/steward/SKILL.md`:
`tsc --noEmit`, `node --test 'app/test/*.test.js'`, the Vite build,
`cargo test`, and a screenshot pass (`run-app` skill) of every space it
touches, before it merges to `main`. CI (`.github/workflows/linux.yml`)
must be green on the merge commit before the next phase starts.

## Cross-cutting, deferred out of the phase list

From the original draft, not one of the 37 numbered items but still true:
a real spacing/type token scale (today: 20 font sizes, 124 distinct
paddings) would make every phase above safer and is worth doing once P1–P4
show where the remaining inconsistency is; a visual-regression CI gate
(screenshots vs. committed baselines) is worth adding once the layout
stops moving every week. The phone app (`freeopenai`, native Compose)
takes the same decisions, built separately, once this settles.

---

## §7 — Corrections to the original proposal (kept for the record)

The first draft of this plan (shadcn/ui + Next.js + Tailwind on
`app/shared`, reused by Android) rested on premises the code doesn't bear
out:

| The proposal said | What the code says |
| :-- | :-- |
| `app/shared` is where cross-platform UI lives | `app/shared/` holds one module: `keymap.js` |
| The app runs on Next.js | Vite 6 + React 18 in a Tauri 2 shell; no Next.js |
| Adopt shadcn/ui or HeroUI on Tailwind | No Tailwind or component kit: ~6,700 lines of hand-written, tokenised CSS |
| Port to phone with the same shared components | The Android app is native Kotlin + Jetpack Compose; it cannot render React components |

Already built before this plan started (kept, not touched): the Ctrl+K
command palette, the "Worked N steps" fold, the Allow/Deny approval
queue, Settings in four groups, reduce-motion support, and an automatic
WCAG-AA contrast sweep in CI. The icon-only top bar from the original
draft was deliberately not taken — `TopNav.tsx` already replaced icon
rails with labelled, hoverable destinations, and reversing that would
undo a shipped decision without new reasoning.
