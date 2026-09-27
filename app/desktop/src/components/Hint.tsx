// Explanation text used to sit fully expanded under every control it
// explained -- 127 of these paragraphs across Settings alone, the largest
// running 200-300 characters above a single switch (docs/UI_UPGRADE_PLAN.md,
// phase P2). One line stays on screen; the rest is a click away, tied to the
// toggle by aria-controls/aria-expanded so a screen reader loses nothing.
//
// This is only for explanation. State text -- "No key set", a failing
// check, a live count -- is not this: it stays a plain
// <p className="settings-hint"> next to the control it reports on, because
// hiding what is actually going on behind an extra click is the opposite of
// the point. test/desktop-hint.test.js pins that distinction by capping how
// long a literal `summary` string may run, so the always-visible line stays
// short by construction rather than by memory.
import { useId, useState } from 'react';
import type { ReactNode } from 'react';

/** The cap the test enforces on a literal `summary=".."` string. */
export const HINT_SUMMARY_MAX = 70;

interface Props {
  /** The line that is always on screen. */
  summary: string;
  /** The rest, shown once the person asks for it. */
  children: ReactNode;
}

export default function Hint({ summary, children }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <p className="settings-hint hint">
      {summary}{' '}
      <button
        type="button"
        className="linkish hint-toggle"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Less' : 'More'}
      </button>
      {open && <span id={id} className="hint-more">{' '}{children}</span>}
    </p>
  );
}
