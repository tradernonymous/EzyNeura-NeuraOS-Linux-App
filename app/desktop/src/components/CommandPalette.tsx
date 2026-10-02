// Ctrl+K: every screen, action, panel, chat and skill from the keyboard.
//
// The matching rules are src/commands.js (pure, tested); this is the list, the
// cursor and the keys. Before it, the whole keyboard story was Alt+1..6 and a
// sidebar nobody could search.
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import '../commands.js';

const commands: typeof import('../commands.js') = (globalThis as any).FreeAI4UCommands;

export interface PaletteEntry {
  id: string;
  group: string;
  title: string;
  hint?: string;
  keys?: string;
  palette?: string;
  chat?: string;
  skill?: string;
  /** A chat command to hand to Chat, e.g. "/image" -- App routes it there. */
  command?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Chats and skills, so the palette reaches them too. */
  extra: PaletteEntry[];
  /** {view: 'Alt+N'} from the sidebar, so the hints shown are the keys that work. */
  keys?: Record<string, string>;
  onRun: (entry: PaletteEntry) => void;
}

export default function CommandPalette({ open, onClose, extra, keys, onRun }: Props) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const results: PaletteEntry[] = useMemo(
    () => (open ? commands.search(query, { extra, keys }) : []),
    [open, query, extra, keys],
  );

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCursor(0);
    // Focus after paint, so the palette is typable the instant it opens.
    const handle = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(handle);
  }, [open]);

  useEffect(() => {
    if (cursor >= results.length) setCursor(0);
  }, [results.length, cursor]);

  if (!open) return null;

  const choose = (entry: PaletteEntry | undefined) => {
    if (!entry) return;
    onRun(entry);
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((c) => (results.length ? (c + 1) % results.length : 0));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((c) => (results.length ? (c - 1 + results.length) % results.length : 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[cursor]);
    }
  };

  let lastGroup = '';

  // Stable ids so aria-activedescendant has something to point at. Index-based
  // rather than entry-id-based: the list reorders as the query narrows, and the
  // index is what aria-selected is compared against.
  const optionId = (index: number) => `palette-option-${index}`;

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-input">
          <Icon name="search" size={16} />
          {/* A combobox over a listbox. Focus stays in the input while the
              cursor moves through the options, so aria-activedescendant is
              what tells a screen reader which option is highlighted -- without
              it, arrowing through the palette moved a CSS class and announced
              nothing. */}
          <input
            ref={inputRef}
            id="palette-input"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setCursor(0); }}
            onKeyDown={onKeyDown}
            placeholder="Search screens, actions, chats and skills…"
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-listbox"
            aria-autocomplete="list"
            aria-activedescendant={results.length ? optionId(cursor) : undefined}
          />
          <span className="palette-hint">esc</span>
        </div>
        <div className="palette-list" role="listbox" id="palette-listbox" aria-label="Commands">
          {results.length === 0 && <div className="palette-empty">Nothing matches that.</div>}
          {results.map((entry, index) => {
            const header = entry.group !== lastGroup ? entry.group : '';
            lastGroup = entry.group;
            const option = (
              <button
                type="button"
                role="option"
                id={optionId(index)}
                aria-selected={index === cursor}
                className={`palette-row ${index === cursor ? 'active' : ''}`}
                onMouseEnter={() => setCursor(index)}
                onClick={() => choose(entry)}
              >
                <span className="palette-title">{entry.title}</span>
                {entry.hint && <span className="palette-sub">{entry.hint}</span>}
                {entry.keys && <span className="palette-keys">{entry.keys}</span>}
              </button>
            );
            // role=group so the row's section is announced with the option.
            // role=presentation on the unlabelled wrapper keeps the listbox's
            // children to groups and options, which is all it may contain.
            return header ? (
              <div key={entry.id} role="group" aria-label={header}>
                <div className="palette-group" aria-hidden="true">{header}</div>
                {option}
              </div>
            ) : (
              <div key={entry.id} role="presentation">{option}</div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
