# UI/UX upgrade plan: calmer, faster, denser

Drafted 2026-09-26 from a proposal the user pasted ("shadcn/ui + Next.js +
Tailwind on `app/shared`, reused by the Android build"), checked line by
line against the code on `main`. **Nothing here is built yet.** The goal is
the proposal's goal, which still holds: a UI that is calmer, faster and
easier to reach by eye and thumb on the Mint desktop build and the phone,
without touching chat or agent logic.

The proposal's direction is right; several of its premises are not. They
are corrected first, because the phases depend on them.

## 1. The proposal, corrected against the code

| The proposal said | What the code says | So |
| :-- | :-- | :-- |
| `app/shared` is where cross-platform UI lives | `app/shared/` holds one module: `keymap.js` (+ `.d.ts`), the key resolver | There is no shared UI package. Nothing to build on there. |
| The app runs on Next.js | Vite 6 + React 18 in a Tauri 2 shell (`app/desktop/package.json`, `vite.config.ts`); no Next.js anywhere | Next.js (SSR, file routing) buys nothing in a desktop webview and would replace the build. |
| Adopt shadcn/ui or HeroUI on Tailwind | No Tailwind, Radix or component kit: hand-written CSS (`src/index.css`, 6,747 lines) with its own tokens: `--text-1/2/3`, `--radius-sm/-/-lg` (8/12/16), `--rail*`, `--sidebar`, OKLCH accent from one `--accent-h` | Either kit means restyling every one of ~60 components and replacing that CSS: a rewrite, not an upgrade. The same density is reachable inside the CSS we have. |
| Port to phone with the same shared components | The Android app (`freeopenai/android`) is native Kotlin + Jetpack Compose + Material 3 | A React component cannot render in Compose. The phone gets the same *decisions* (spacing, type, accent, motion), implemented in Compose. |
| Build a Ctrl+K command palette (t13) | Built: `components/CommandPalette.tsx` over `commands.js` | Done. Keep. |
| Collapse tool traces into a "Steps" pill (t15) | Built: `components/StepsFold.tsx`, "Worked N steps ›", open while running, `Ctrl+T` expands all | Done. Keep. |
| A compact Allow/Deny queue (t16) | Built: `ApprovalMenu.tsx` + Allow cards in `ToolCards.tsx`; recipe approvals badge Agents in `TopNav.tsx` | Done. Polish only. |
| Progressive-disclosure Settings (t19) | Built: `SettingsScreen` in four groups of cards (UI plan phase 5, `docs/BACKLOG.md`) | Done. |
| Icon-only 32 px top bar (t12) | `TopNav.tsx` deliberately replaced the icon rails with labelled destinations whose menus open on hover, click or keyboard (see its header comment) | Going back to icon-only reverses a shipped decision, and makes the app harder to learn. Not taken. |
| Reduce-motion, contrast check (t22) | Built: `data-motion="reduced"` + `prefers-reduced-motion` throughout; `test/desktop-look.test.js` sweeps every accent hue for WCAG AA | Done, and already a CI gate. |
| One cyan accent, dark by default | Dark is the default; the accent is Neural Violet (hue 286, from the APK) and any hue stays AA through the OKLCH formula | Keep violet: it is the brand across the APK, the exe and this app. Cyan stays one click away in Appearance. |
| Tailwind v3 or v4 in `app/shared`? | Neither | The question does not arise. |

## 2. What is actually open

Each item was found in the code, not guessed.

1. **Every streamed token re-renders the whole thread.** `ChatScreen.tsx`
   (2,795 lines) renders `active.messages.map(...)` inline (line 2383),
   keyed by index, with no memoised row, and calls
   `renderMarkdown(msg.content)` for **every** message on every render. A
   long chat re-parses all of its markdown for each token. This is the
   single biggest speed win, and it comes before any virtualisation.
2. **No off-screen skipping.** No `content-visibility` and no windowing:
   a 500-message thread lays out 500 messages.
3. **Spacing is not tokenised.** Radius, colour and rail sizes are tokens,
   but spacing and type sizes are literals repeated across the CSS (`gap:
   8px`, `padding: 8px 10px`, font sizes 10 to 18 px with half-pixel
   one-offs like 12.5 px). A density change today is a search through
   6,747 lines.
4. **The sidebar has two states:** 248 px or hidden (`toggleSidebar`). There
   is no narrow middle state for a small laptop screen.
5. **No visual regression gate.** CI fails on a panic (the Xvfb smoke test)
   and the screenshot tour exists (`scripts/screenshot-tour.sh`), but nothing
   compares a screenshot with a baseline, so a density change can drift
   unnoticed.
6. **Still open from L2** (`docs/BACKLOG.md`): the message anatomy's last
   pieces (folding Thought) and an Orca (screen reader) pass.
7. **Help text that is always on screen** (the user's own report,
   2026-09-26: "details or info that consume space, especially in
   Settings"). Measured: **127 `settings-hint` paragraphs across 30 files**,
   all always expanded. The longest are 200 to 300 characters of
   explanation above a single switch: the retry policy
   (`SettingsScreen.tsx:178`, 306 chars), Desktop control's tool list
   (`DesktopControlCard.tsx:47`, 290), the MCP server blurb
   (`ConnectorsCard.tsx:462`, 287), the LoRA explainer
   (`LocalImagesCard.tsx:50`, 225). By card, Connectors carries the most
   (~840 chars of static prose), then Desktop control, Run settings,
   Settings itself, Dictation and Local images. Only 6 `<details>` exist
   in all of Settings.
8. **Hover-only actions** (the rewind button, message actions) need a
   visible fallback for keyboard users; touch matters only on a touchscreen
   Mint laptop, and nobody has said the user has one.

## 3. Phases

Ordered by payoff over risk. Each phase is one PR, ends green in CI, and
changes how the app looks or feels, never what it does.

### Phase U0: words on demand (what the user asked for)

- One `<Hint>` component replaces the bare `settings-hint` paragraph: a
  short line (a hard cap of ~70 characters) stays visible, and the rest
  opens from an ⓘ beside the control's label, inline and remembered per
  hint. It is keyboard reachable, and the full text stays tied to the
  control through `aria-describedby`, so a screen reader loses nothing.
- Every one of the 127 hints is rewritten into that shape, largest first
  (Connectors, Desktop control, Run settings, Settings, Dictation, Local
  images, then the other screens). Text that states a *state* ("No
  address saved", a failing check) is not help: it stays visible, in one
  sentence.
- Tool lists, example commands and "how it works" paragraphs move behind
  the ⓘ. Copy-paste commands (Connectors → MCP) become a single Copy
  button with the command in its tooltip.
- A test in `app/test/` fails when a visible hint passes the cap, so the
  prose cannot creep back.
- Risk: help moved out of sight is help not read. The safety wording
  stays visible (Desktop control's "each call asks first", sandbox
  and approval levels), shortened but never hidden.

### Phase U1: the chat is fast in a long thread (highest payoff)

- Extract `MessageRow` from `ChatScreen.tsx`, wrapped in `React.memo`, with
  a stable key (a message id, falling back to the index) so that only the
  streaming message re-renders.
- Memoise the rendered HTML per message (content + sources → HTML), so a
  finished message is parsed once, not once per token.
- `content-visibility: auto` + `contain-intrinsic-size` on `.message`. That
  gets most of virtualisation's benefit with no dependency, and does not
  fight streaming, the pinned-to-bottom scroll, Find, or text selection.
- Measure before and after: a 300-message fixture, with time per token and
  scroll frame time recorded in Diagnostics. Real windowing is taken up
  only if the numbers still ask for it.
- Risk: rewind and edit rely on the index; keep `data-index` and the cut
  logic in `turn.js` untouched, and pin that behaviour with a test.

### Phase U2: a spacing and type scale, as tokens

- `--space-1..8` on a 4 px grid (4, 8, 12, 16, 20, 24, 32, 40) and
  `--fs-xs/sm/md/lg` (11, 12, 14, 16) with two weights and tabular numerals
  for counts, times and sizes.
- Swap literals for tokens one screen at a time (Chat, then the bars and
  sidebar, then the other spaces), each a pixel-identical change checked by
  U5's screenshots, so the mechanical step and the density step never land
  together.
- Then **one** density setting (Comfortable / Compact) in Appearance that
  only moves token values, never markup.
- `test/desktop-look.test.js` gains a pin that new rules use the tokens.

### Phase U3: the chrome, refined (not rebuilt)

- A third sidebar state: a 56 px icon strip with titles on hover, between
  248 px and hidden, chosen automatically below a window-width threshold
  and remembered when set by hand.
- The top bar keeps its labelled destinations; it only gets U2's scale.
- Hover-only message actions get a keyboard route (focus reveals them)
  and a visible "⋯" when the pointer is coarse.

### Phase U4: the rest of the anatomy, and an accessibility pass

- Folding "Thought" blocks, like steps (the open L2 item).
- The Allow card: one line with Allow / Deny / Always, details on expand.
- An Orca pass on Chat, the palette, Allow cards and Settings; focus rings
  checked in both themes; the findings fixed, not only listed.

### Phase U5: lock it in, a visual regression gate

- The screenshot tour under Xvfb on every PR against committed baselines,
  failing on a diff over a small threshold, with the diff image uploaded
  as an artifact. Updating a baseline is an explicit commit.
- Ideally built early: U2 depends on it. Suggested order below.

### Phase U6: the phone (in `freeopenai`, in Kotlin)

- The same decisions, in Compose: U2's spacing and type scale as a
  `NeuraSpacing` / typography object, the violet accent, and the
  reduced-motion rule wired to the system animator scale.
- Thumb reach: primary actions in the bottom half, actions as bottom
  sheets. Checked with the Roborazzi screenshot tests the Android build
  already has.
- A separate PR in a separate repository, planned there against its own
  code. No code is shared with this app.

## 4. Suggested order

U0 → U1 → U5 → U2 → U3 → U4, with U6 in parallel whenever the phone app
is being worked on. U0 first because it is what the user asked for, is
text and one small component, and frees the most space for the least
risk. U1 next because it is the one change a user feels straight away and
needs nothing else; U5 before U2 because the token swap
should be proved pixel-identical, not eyeballed.

| Phase | Effort (days, est.) | Payoff (1–5) |
| :-- | :-: | :-: |
| U0 words on demand (127 hints) | 1.5 | 4 |
| U1 fast long threads | 2 | 5 |
| U5 visual regression gate | 1.5 | 3 |
| U2 spacing/type tokens + density | 3 | 4 |
| U3 chrome refinements | 1.5 | 3 |
| U4 anatomy + Orca pass | 2 | 3 |
| U6 phone (Compose) | 3 | 3 |

## 5. Risks

- **Streaming and memoisation:** a stale memo would freeze a message that
  is still growing. The streaming message is keyed on its content length,
  and the fixture test asserts that the last message updates.
- **`content-visibility` and scroll position:** skipped rows take their
  estimated height, which can nudge the scrollbar. Give an honest
  `contain-intrinsic-size` (auto + last measured) and keep the
  pinned-to-bottom logic as it is.
- **The token swap is large:** done per screen behind screenshot diffs, it
  is safe; done in one commit, it is not.
- **Screenshot baselines are font- and GPU-sensitive:** render them in the
  same CI image with bundled Inter, software rendering, and a small diff
  threshold.
- **Windows must keep building** (`AGENTS.md`): all of this is CSS and
  React, shared by both builds. No `cfg` work, but the look must still hold
  on Windows, where Mica makes the side panes translucent.

## 6. Decisions for the user

- **Component kit:** recommend **neither** (reasons in §1). If a kit is
  still wanted later, a `shadcn`-style approach (copy the component, own
  the code) is the only one that fits hand-written CSS; HeroUI would not.
- **Accent:** recommend **keeping Neural Violet** as the default.
- **Light theme:** recommend **keeping it**. It already exists, passes the
  AA sweep, and "follow the system" relies on it.
- **Density default:** Comfortable (today's look) or Compact?
- **Hints:** a collapsed ⓘ per control (recommended), or one "Show
  explanations" switch in Appearance that opens them all?
- **Start with U0, then U1?** Both are independent of every other decision.
