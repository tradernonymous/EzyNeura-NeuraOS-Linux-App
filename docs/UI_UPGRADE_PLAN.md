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
   **Corrected 2026-09-27 (BACKLOG):** on the bare `button` rule the trio
   also hit every column button — the sidebar toggle vanished, the Settings
   rail centred, Create's sketches disappeared, Library's skill cards
   collapsed to a row. It is `button:where(:has(> svg))` now: the icon
   buttons only, same specificity as the bare tag.
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
    guessed from the CSS text. **Corrected 2026-09-27:** `margin-right: 0`
    aligned the bubble to the pane's edge, not the centred column, on a
    wide window; it is the column's side gap now, and the rewind button
    moved to the bubble's corner, off the text. "Show the model name only when it
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

### P7 — Create space ✅ (reviewed, nothing built — all four retracted)

All four items came from one screenshot of the "no project yet" state,
read without the component behind it. Each one turned out to already be
handled, or to rest on a misreading of a deliberate, cross-app pattern.
Nothing here was worth forcing a change to close a checkbox.

24. **Retracted.** The picker is already a native `<details
    className="studio-project" open={!active}>` — open (showing Project,
    Template, Service, Model, System, tier) only while there is no
    active project, exactly when those fields matter; once a project is
    open it collapses to one summary line: a folder icon, the project's
    name, `{system} · {model}`, and a caret. That line **is** "Project
    ▾" — the screenshot this item was written from simply caught the
    screen in its one auto-expanded state (no project yet), which looks
    like permanent clutter but is not.
25. **Retracted.** The top tabs (Page/Deck/Post/Image/Edit-image) choose
    a *mode*, always relevant, the same role `SpaceSwitch` plays
    elsewhere in the app; the gallery is a *starting point* within
    whatever mode is current, and already changes its own heading
    ("Create a project, then pick a start" → "What are we making?") once
    a project exists. Hiding the tabs until a project exists would
    remove the only way to choose a mode before making one.
26. **Retracted.** `SelectPill`'s small caps label (`.pill-key`, 9px) is
    a consistent, reusable convention used the same way everywhere the
    component appears across the app (Code's Model picker included), not
    a Create-specific decoration — a value alone ("gpt-4o-mini") does
    not say whether it is the service or the model without it. Fixing
    this only in Create would be the inconsistency, not the label.
27. **Retracted.** The dashed disabled style is not a Create bug: it is
    the whole app's own considered accessibility fix (`index.css`'s own
    comment, NEURA-024) — no fill, a dashed border and muted text,
    chosen because a plain opacity dim failed contrast (WCAG 1.4.11) in
    the light theme. Undoing it would undo that fix, not correct one.

### P8 — Agents → Library ✅

28. **Built.** A `nothingYet` check (no HF sign-in, no HF/GitHub catalogue
    loaded, nothing installed, no engine skill, no saved chat — a genuine
    first launch) replaces the HF card, the installed-skills section and the
    whole three-column layout with one block holding just the two real
    actions: sign in to Hugging Face, or paste a GitHub repo. Both actions
    are the existing `<HfSignIn>` component and the GitHub install field,
    each defined once (`hfSignInBlock`, `ghInstallField`) and reused by both
    the empty state and the normal layout — not duplicated. The moment either
    one produces anything (a catalogue entry, a sign-in), `nothingYet` goes
    false on its own and the full screen appears. Verified with a headless
    Chromium render of both states against the real `index.css`.
    **Corrected 2026-09-27:** it was judged before the first load and from
    the loading flags, so it flashed on every visit, toggled around each
    Refresh (remounting the sign-in block) and hid the engine-skills error;
    it now waits for the first load to settle and never shows over an error.
31. **Built, folded into the same change.** The screen's own `<h1>Library</h1>`
    header row is gone — the tab bar above it (`SpaceSwitch`, driven by
    `tabsOf('agents')`) already reads "Library" as one of its pills, which a
    render confirmed; the heading was a duplicate, same reasoning as the
    version line dropped from Settings in P4. `SpaceSwitch` gained an
    `actions` slot (right-aligned via `.space-switch-actions { margin-left:
    auto }`) and App.tsx fills it with a small `raised icon-btn` Refresh,
    shown only while Library is the open tab. Library and App.tsx are wired
    by one literal event name (`'freeai4u:library-refresh'`) rather than a
    prop, because Library is lazy-loaded (`lazy(() => import(...))`) and an
    App.tsx import of a named export from it would pull its whole chunk into
    the eager bundle — the same reasoning already used for
    `'freeai4u:cheat-sheet'` elsewhere in this file.
29. **Built.** "Installed manuals" is now "Installed skills", matching the
    "Skills" catalogue column below it — both are the same underlying idea
    (a skill), one installed and one browsable. The per-row "Manual" button
    (opens the SKILL.md as a page) is a different, still-correct label and
    was left alone.
30. **Built (two of three), one retracted as already fixed.**
    - The stray checkmark `<Icon name="check" />` next to "Installed
      manuals" is gone with the rename above — every sibling `col-title` in
      this screen is plain text with a count, and this one was the only
      exception.
    - `.library-installed` had no horizontal margin while `.hf-section`
      above it sets `margin: 0 16px 16px` — so its search field and rows ran
      flush to the screen's edges while the HF card sat 16px in on both
      sides. Now `margin: 14px 16px 16px`, same 16px both cards share.
      Confirmed with a headless-Chromium render.
    - The Hugging Face card's "mixed left/centre alignment": this is the
      exact issue P1 tried and, per this same doc, failed to fix — a
      screenshot afterward still showed it centred. Reading `.hf-signin` this
      time (not just grepping for it) found *two* rules for the same class:
      one near the top of the file (`display: flex; flex-direction: column`)
      and P1's own fix further down (`align-items: center; justify-content:
      flex-start; text-align: left`, with a comment explaining the intent).
      CSS cascades property-by-property at equal specificity, and P1's rule
      never touched `flex-direction` — so the earlier rule's `column` won
      silently, and `align-items: center` in a *column* flex centres each
      child horizontally by its own width instead of centring a button
      against its line of text vertically in a *row*, which is what the rule
      was actually written for. Different-width children (a sentence, two
      buttons) landing at different horizontal offsets is exactly "mixed
      left/centre." Fixed by deleting the stray earlier rule and folding its
      one needed property (`color`) into the surviving one, with
      `flex-direction: row` now spelled out so the same silent conflict
      cannot recur. Confirmed left-aligned with a headless-Chromium render —
      the first real visual confirmation this issue has had, rather than a
      second guess.

### P9 — Design studio: the inspector's seven tabs become four ✅

The right-hand inspector had grown one tab per artifact type — Tweaks,
Tokens, Components, Mockups, Comments, Checks, History — and three of them
edited the same design system from different angles: Tweaks moved the
page's own tokens, Tokens showed and imported the system, Components
inserted parts built from those tokens. Two more (Comments, Checks) were
two destinations for the same "tell me what to fix" moment. A survey of
nine open-source design-agent projects in October 2026 (nexu-io/open-design,
VoltAgent/awesome-claude-design, alchaincyf/huashu-design, JimLiu/baoyu-design,
6551Team/claude-code-design-guide, rohitg00/awesome-claude-design,
Dammyjay93/interface-design, open-pencil/open-pencil, superdesigndev/superdesign)
converged on the same three moves, so the studio took them:

1. **One surface for one source of truth.** Every repo that carries a
   design system (open-design's brand contract, baoyu-design's binding
   tokens/components sync, interface-design's single `system.md`) keeps
   tokens, rules and the parts that embody them in ONE place — separate
   stores are where drift starts. So Style now holds everything that
   styles the page: *This page's controls* (the Tweaks schema), *Page
   tokens*, *Design system* (tokens.css, DESIGN.md, import, brand from a
   URL) and *Components*, each its own folded `<details>` section.
2. **Feedback is one loop, not two tabs.** huashu-design's five-dimension
   review, interface-design's review pass and rohitg00's anti-slop kit all
   frame gate + critique + fixes as one review moment. Review merges the
   comments (point at an element, say what changes) with the checks score,
   findings and the optional critique; the tab picks up a `Review n`
   count while pins exist, and a click on the canvas lands there.
3. **Progressive disclosure inside the tab, not more tabs.** The small
   visible core with subordinate sections revealed on demand is the
   organizing lesson of claude-code-design-guide's layered runtime and
   baoyu-design's lazy sub-skills; superdesign's exploration model is why
   Mockups stays its own canvas-adjacent tab, and open-pencil's
   everything-through-one-surface is the reason not to go further than
   four.

Nothing moved between stores: the schema protocol (tweaks.js), the version
store, the gate and the exports all keep their data where they had it —
only the paths to reach them changed. `desktop-create.test.js` pins the
four-tab shape, the folded sections, and that no old tab id can return.

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
