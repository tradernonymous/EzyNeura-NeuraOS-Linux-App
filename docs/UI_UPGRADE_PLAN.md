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

### P1 — Chrome: remove duplicates, always-visible cruft ⬜

Lowest risk (CSS and layout, no state logic), highest visible payoff: this
is most of the "the app feels busy" complaint in one phase.

1. Hide the chat sidebar outside Chat (Settings, Code, Create, Agents each
   waste 248px on a list of chats they don't use).
2. Remove duplicates: version number (×3 → 1), search/commands (×2 → 1),
   Settings/theme buttons (×2 → 1), engine state (×2 → 1), Hugging Face
   sign-in (×2 → 1, in Settings; Library links to it).
3. Delete the sidebar footer (orb, 5 icon buttons, version — everything in
   it already lives in the top bar or the palette).
7. Fix icon-above-label buttons (Doctor's "Run the checks again", Agents'
   "Save as skill", Code's "Run") to one line, icon inline.
17. Sidebar top: New chat + one search box with a filter menu, replacing
    New chat + 5 unlabelled icons + an All/Running/Pinned tab row.
18. Hide the "NEURAOS HOME" folder header when there is one folder; chat
    titles stop rendering in monospace.
32. Status bar shows only live state (unhealthy engine, running tasks, an
    update); everything else moves to Settings → About; the bar hides
    itself when there is nothing to say.
33. Remove the inset border around the main content area.
34. A visible Zen mode control (today it's Ctrl+Shift+Z only, undiscoverable).
36. Left-align card text that currently renders centred (Hugging Face
    cards in Settings and Library).
37. Long paths/commands (the MCP command, the OAuth callback URL) become
    a Copy button with the text in a tooltip, not inline.

### P2 — Help text on demand ⬜

4. A `<Hint>` component: one short line stays visible, the rest opens from
   an ⓘ, tied to its control with `aria-describedby`. Migrate the 127
   `settings-hint` paragraphs across 30 files, largest first (Connectors,
   Desktop control, Run settings, Settings, Dictation, Local images). A
   test caps visible hint length so the prose can't creep back. State
   text ("No address saved", a failing check) stays visible as-is.

### P3 — Empty chat and the composer ⬜

5. Empty chat: one line + a 2×2 suggestion grid; the two promo cards
   (Mint pack, FLUX.2) become one dismissible "Tip" chip.
6. Composer: model chip (quota as tooltip) + a **+** menu (attach, skills,
   goal, search, code, MCP) + one mode chip (approval/concise/reasoning)
   + mic + send, replacing today's 10 separate controls in two rows.
19. Fix the empty-chat bug: "Starting one now…" shows under a New chat
    button that doesn't start anything.

### P4 — Settings screen ⬜

8. Providers list: show the providers that work with no key; fold the
   rest into one "N more — add a key" row instead of N rows of yellow
   "no key set".
9. Doctor: one row per check (dot, name, one line, Fix), passing checks
   folded into "N passing"; "Bundled engine FAIL" reworded to "not in
   use" while a remote engine is connected and healthy.
10. Settings layout: drop the "SETTINGS · v2.11.0" title row, shorten
    menu subtitles to one line, let cards flow instead of stretching to
    the tallest card in their row, replace the full shortcuts grid with
    a link to the existing Ctrl+/ cheat sheet.

### P5 — Chat: message anatomy and performance ⬜

11. Drop the "You" header line; right-align the user's own messages; show
    the model name only when it changes.
16. Fix long-thread performance: every streamed token re-renders and
    re-parses every message (`ChatScreen.tsx`); memoise message rows.
12. Fold a finished turn into "Thinking / Commands / Edits" chips (Zed's
    pattern); code blocks over ~15 lines collapse to one row.
13. A pinned approval bar ("1 action waiting") when an Allow card has
    scrolled out of view.
14. Search within a chat (Ctrl+F) that opens folded steps containing a
    match.
15. A Comfortable / Compact message-density switch.

### P6 — Code space ⬜

20. Collapse the triple "Open a folder" (toolbar, placeholder, centre
    button) into the one centre button.
22. Replace the dashed two-line "Run" block with a send icon in the input.
21. The 7 preset chips (Build, Fix, Refactor…) appear on focus or as `/`
    commands, not always on screen.
23. The 5 unlabelled right-side icons fold into one "Panels" menu, shown
    only once a folder is open.

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
