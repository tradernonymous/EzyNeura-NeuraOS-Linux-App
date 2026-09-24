// The task decks under the Code box: Build · Fix · Refactor · Test · Review ·
// Docs · Git & Ops, plus Mine (the project's .neuraos/commands/*.md). Pointing
// at a deck for a beat, clicking it, or pressing ↓ opens its card of tasks;
// picking one fills the box with a template whose first {{blank}} is
// selected. "Save as task" writes the box's text into the project.
import { useEffect, useRef, useState } from 'react';
import Icon, { type IconName } from './Icon';
import '../tasks.js';

const tasks: typeof import('../tasks.js') = (globalThis as any).FreeAI4UTasks;
const HOVER_MS = 150;

interface Props {
  custom: import('../tasks.js').Task[];
  /** Fill the box with a template. */
  onPick: (template: string) => void;
  /** The box's current text, offered to "Save as task"; '' hides the button. */
  draft: string;
  /** Write a custom task; absent in a browser build or with no folder. */
  onSave?: (label: string, template: string) => Promise<void>;
}

export default function TaskDecks({ custom, onPick, draft, onSave }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState('');
  const timer = useRef<number | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const clear = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = null; };
  const enter = (id: string) => { clear(); timer.current = window.setTimeout(() => setOpen(id), HOVER_MS); };
  const leave = () => { clear(); timer.current = window.setTimeout(() => setOpen(null), HOVER_MS); };
  useEffect(() => clear, []);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => { if (rowRef.current && !rowRef.current.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const decks: Array<{ id: string; label: string; icon: IconName; hint: string; tasks: import('../tasks.js').Task[] }> = [
    ...tasks.DECKS.map((d) => ({ ...d, icon: d.icon as IconName })),
    ...(custom.length ? [{ id: 'mine', label: 'Mine', icon: 'skills' as IconName, hint: `Your tasks in ${tasks.DIR}`, tasks: custom }] : []),
  ];

  const save = async () => {
    if (!onSave || !label.trim() || !draft.trim()) return;
    await onSave(label.trim(), draft.trim());
    setLabel('');
    setSaving(false);
  };

  return (
    <div className="task-decks" ref={rowRef} role="toolbar" aria-label="Task decks">
      {decks.map((deck) => {
        const isOpen = open === deck.id;
        return (
          <div key={deck.id} className={`task-deck ${isOpen ? 'open' : ''}`} onPointerEnter={(e) => { if (e.pointerType === 'mouse') enter(deck.id); }} onPointerLeave={(e) => { if (e.pointerType === 'mouse') leave(); }}>
            <button
              type="button"
              className="raised task-deck-btn"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              title={deck.hint}
              onClick={() => setOpen(isOpen ? null : deck.id)}
              onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(deck.id); } }}
            >
              <Icon name={deck.icon} size={13} />
              <span>{deck.label}</span>
            </button>
            {isOpen && (
              <div className="deck task-deck-card" role="menu" aria-label={deck.label} onKeyDown={(e) => {
                const items = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitem"]'));
                const at = items.indexOf(document.activeElement as HTMLElement);
                if (e.key === 'ArrowDown') { e.preventDefault(); items[(at + 1) % items.length]?.focus(); }
                if (e.key === 'ArrowUp') { e.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
              }}>
                <div className="task-deck-head">{deck.label} <span>{deck.hint}</span></div>
                {deck.tasks.map((t) => (
                  <button key={t.id} type="button" role="menuitem" className="task-row" onClick={() => { setOpen(null); onPick(t.template); }} title={t.template}>
                    <span className="task-row-label">{t.label}</span>
                    {tasks.blanks(t.template).length > 0 && <span className="task-row-blanks">{tasks.blanks(t.template).length} blank{tasks.blanks(t.template).length === 1 ? '' : 's'}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {onSave && draft.trim() && (
        saving ? (
          <form className="task-save" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Task name" aria-label="Task name" onKeyDown={(e) => { if (e.key === 'Escape') setSaving(false); }} />
            <button type="submit" className="raised" disabled={!label.trim()}>Save</button>
          </form>
        ) : (
          <button type="button" className="raised task-save-btn" onClick={() => setSaving(true)} title={`Keep this prompt as a task in ${tasks.DIR}`}>
            <Icon name="plus" size={12} /> Save as task
          </button>
        )
      )}
    </div>
  );
}
