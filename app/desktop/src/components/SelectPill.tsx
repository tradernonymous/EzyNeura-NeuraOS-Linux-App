import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

// A picker that belongs to this app rather than to the operating system.
//
// The screens used native <select> elements, which on Windows render as an OS
// dropdown: grey chrome, a different font, and a system highlight colour. In a
// dark, hand-styled window that is the detail that makes the whole thing read
// as a web page in a frame. This is the same choice as a pill that names the
// current value, opening a panel that lists the options with the reason for
// each -- which is also where a note like "needs a key" can be said at all.
//
// The panel is PORTALED to the body and placed against the viewport: in a
// 280px column or beside the right edge, an absolutely-placed panel ran off
// the screen (the Design pickers did, on a real Mint machine). Fixed
// coordinates, clamped to the viewport on both axes, flipped above the pill
// when there is no room below, and re-placed on scroll and resize.

export interface SelectOption {
  value: string;
  label: string;
  note?: string;
  /** Greyed and unselectable, with its note as the explanation. */
  disabled?: boolean;
  /** Rows with the same group sit under one heading, in first-seen order. */
  group?: string;
  /** A status dot before the name: ok, warn, or off. */
  dot?: 'ok' | 'warn' | 'off';
}

interface SelectPillProps {
  label: string;
  title: string;
  value: string;
  options: SelectOption[];
  onPick: (value: string) => void;
  disabled?: boolean;
  mono?: boolean;
  filterable?: boolean;
  width?: number;
}

/** Viewport-clamped coordinates for the panel, against the pill's button. */
function clampPanel(btn: DOMRect, panel: { offsetWidth: number; offsetHeight: number }) {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const left = Math.max(8, Math.min(btn.right - panel.offsetWidth, vw - panel.offsetWidth - 8));
  const below = btn.bottom + 6;
  const top = below + panel.offsetHeight > vh - 8
    ? Math.max(8, btn.top - 6 - panel.offsetHeight)
    : below;
  return { top, left };
}

export default function SelectPill({
  label,
  title,
  value,
  options,
  onPick,
  disabled,
  mono,
  filterable,
  width,
}: SelectPillProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Measured after paint, so the first frame is hidden rather than misplaced.
  // Same numbers, SAME reference: the placement effect runs on every render,
  // and a new object each time would be a setState loop (#185).
  const place = () => {
    const btn = buttonRef.current;
    const panel = panelRef.current;
    if (!btn || !panel) return;
    const next = clampPanel(btn.getBoundingClientRect(), panel);
    setAt((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
  };

  useEffect(() => {
    if (!open) {
      setAt(null);
      return;
    }
    // The panel is OUTSIDE the box (portal), so a click inside it must not
    // count as "somewhere else" -- it would close before the pick fired.
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const move = () => place();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', move);
    document.addEventListener('scroll', move, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', move);
      document.removeEventListener('scroll', move, true);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = options.find((o) => o.value === value);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, filter]);

  // The panel can change height after opening (a filter, a longer list), so
  // it is placed on open and re-placed whenever the list it shows changes.
  useLayoutEffect(() => { if (open) place(); }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="select-pill" ref={boxRef} style={width ? { maxWidth: width } : undefined}>
      <button
        type="button"
        ref={buttonRef}
        className={`pill ${open ? 'open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={title}
      >
        <span className="pill-key">{label}</span>
        <span className={`pill-value ${mono ? 'mono' : ''}`}>{current ? current.label : value || '—'}</span>
        <Icon name="chevron-down" size={12} />
      </button>

      {open && createPortal(
        <div
          className="select-panel"
          role="listbox"
          aria-label={title}
          ref={panelRef}
          style={at ? { top: at.top, left: at.left } : { visibility: 'hidden' }}
        >
          {filterable && options.length > 6 && (
            <input
              className="select-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              spellCheck={false}
              autoFocus
            />
          )}
          <div className="select-list">
            {shown.map((o, i) => (
              <Fragment key={o.value || `row:${i}`}>
              {o.group && (i === 0 || shown[i - 1].group !== o.group) && (
                <div className="select-group">{o.group}</div>
              )}
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`select-row ${o.value === value ? 'active' : ''}`}
                disabled={o.disabled}
                title={o.disabled && o.note ? o.note : o.label}
                onClick={() => {
                  if (o.disabled) return;
                  onPick(o.value);
                  setOpen(false);
                  setFilter('');
                }}
              >
                {o.dot && <span className={`select-row-dot dot-${o.dot}`} aria-hidden="true" />}
                <span className={`select-row-name ${mono ? 'mono' : ''}`}>{o.label}</span>
                {o.note && <span className="select-row-note">{o.note}</span>}
              </button>
              </Fragment>
            ))}
            {shown.length === 0 && <div className="select-empty">Nothing matches.</div>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
