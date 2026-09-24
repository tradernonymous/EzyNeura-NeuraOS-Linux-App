import { useState } from 'react';
import { NAV_ITEMS } from '../Sidebar';
import { pushToast } from './Toasts';
import { hasShell, quickHotkeySet, screenHotkeySet, selectionHotkeySet } from '../bridge';
import { DEFAULT_SCREEN_HOTKEY, readScreenHotkey, SCREEN_HOTKEY_KEY } from '../desktopControl';
import '../../../shared/keymap.js';
import '../settings-groups.js';
import Icon from './Icon';

const groupsLib: typeof import('../settings-groups.js') = (globalThis as any).FreeAI4USettingsGroups;
const keymap: typeof import('../../../shared/keymap.js') = (globalThis as any).FreeAI4UKeymap;

/** The Quick window's global hotkey, as the person set it (the shell's default otherwise). */
export const QUICK_HOTKEY_KEY = 'freeai4u.quick_hotkey';
const QUICK_DEFAULT = 'Alt+Space';
/** The selection hotkey: copies what is selected in any app into Quick. */
export const SELECTION_HOTKEY_KEY = 'freeai4u.selection_hotkey';
const SELECTION_DEFAULT = 'Alt+Shift+Space';

// Shortcuts, in Settings: the one table App.tsx resolves keys from, shown as a
// list you can change. "Change" records the next combo pressed; a clash with
// another action or a navigation key is named at once, not discovered later.

export const COMPOSER_KEYS: Array<[string, string]> = [
  ['Enter / Shift+Enter', 'Send / new line'],
  ['Tab / Shift+Tab', 'Chat → Plan → Build'],
  ['! at the start', 'Run a command in the open folder'],
  ['/ and @', 'Commands; models, files and MCP servers'],
  ['Backspace at start, Esc', 'Leave the mode; Esc also stops a reply'],
  ['Up in an empty box', 'Bring back the last message'],
];

export default function ShortcutsCard() {
  // Which category cards are unfolded to their full list.
  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState(() => keymap.readOverrides());
  const [on, setOn] = useState(() => keymap.enabled());
  const [recording, setRecording] = useState('');
  const [quickKey, setQuickKey] = useState(() => { try { return localStorage.getItem(QUICK_HOTKEY_KEY) || QUICK_DEFAULT; } catch { return QUICK_DEFAULT; } });
  const [selectionKey, setSelectionKey] = useState(() => { try { return localStorage.getItem(SELECTION_HOTKEY_KEY) || SELECTION_DEFAULT; } catch { return SELECTION_DEFAULT; } });
  const [screenKey, setScreenKey] = useState(readScreenHotkey);
  const recordScreen = (e: React.KeyboardEvent) => {
    e.preventDefault();
    if (e.key === 'Escape') { setRecording(''); return; }
    const combo = keymap.comboOf(e);
    if (!combo || !/^(Ctrl|Alt)\+/.test(combo)) return;
    screenHotkeySet(combo.toLowerCase())
      .then(() => {
        try { localStorage.setItem(SCREEN_HOTKEY_KEY, combo); } catch { /* this session has it */ }
        setScreenKey(combo);
        pushToast('ok', `${combo} now takes a screenshot into the chat, from any app.`);
      })
      .catch((err: unknown) => pushToast('error', ((err as Error).message || String(err)).split('\n')[0]))
      .finally(() => setRecording(''));
  };

  // A global hotkey belongs to the whole desktop, so it is taken by the shell
  // and can fail when another app owns the chord -- which is said, not hidden.
  const recordQuick = (e: React.KeyboardEvent) => {
    e.preventDefault();
    if (e.key === 'Escape') { setRecording(''); return; }
    const combo = keymap.comboOf(e);
    if (!combo || !/^(Ctrl|Alt)\+/.test(combo)) return;
    quickHotkeySet(combo.toLowerCase())
      .then(() => {
        try { localStorage.setItem(QUICK_HOTKEY_KEY, combo); } catch { /* this session has it */ }
        setQuickKey(combo);
        pushToast('ok', `The Quick window now opens with ${combo}, from any app.`);
      })
      .catch((err: unknown) => pushToast('error', ((err as Error).message || String(err)).split('\n')[0]))
      .finally(() => setRecording(''));
  };
  const recordSelection = (e: React.KeyboardEvent) => {
    e.preventDefault();
    if (e.key === 'Escape') { setRecording(''); return; }
    const combo = keymap.comboOf(e);
    if (!combo || !/^(Ctrl|Alt)\+/.test(combo)) return;
    selectionHotkeySet(combo.toLowerCase())
      .then(() => {
        try { localStorage.setItem(SELECTION_HOTKEY_KEY, combo); } catch { /* this session has it */ }
        setSelectionKey(combo);
        pushToast('ok', `Select text in any app and press ${combo} to ask about it.`);
      })
      .catch((err: unknown) => pushToast('error', ((err as Error).message || String(err)).split('\n')[0]))
      .finally(() => setRecording(''));
  };
  const bindings = keymap.withOverrides(overrides);
  const reserved = NAV_ITEMS.map((n) => ({ id: `go to ${n.label}`, keys: n.keys }));
  const clashes = keymap.conflicts(bindings, reserved);

  const record = (id: string, e: React.KeyboardEvent) => {
    e.preventDefault();
    if (e.key === 'Escape') { setRecording(''); return; }
    const combo = keymap.comboOf(e);
    if (!combo || !/^(Ctrl|Alt)\+/.test(combo)) return; // wait for a real chord
    setOverrides(keymap.setOverride(id, combo));
    setRecording('');
    pushToast('ok', `${id} is now ${combo}.`);
  };

  // Every row in one shape, then sorted into the four category cards. A
  // card shows its top three; "All N" unfolds it, and Change records the
  // next chord pressed, the same way the flat table did.
  type Row = { id: string; label: string; keys: string; category?: string; custom?: boolean; fixed?: boolean; onChange?: () => void; recordKey?: (e: React.KeyboardEvent) => void; reset?: () => void };
  const rows: Row[] = [
    ...bindings.map((b): Row => ({
      id: b.id, label: b.label, keys: b.keys, custom: !!b.custom, fixed: !!b.fixed,
      onChange: () => setRecording(b.id), recordKey: (e) => record(b.id, e),
      reset: b.custom ? () => setOverrides(keymap.setOverride(b.id, null)) : undefined,
    })),
    ...NAV_ITEMS.map((n): Row => ({ id: 'nav', label: `Go to ${n.label}`, keys: n.keys, fixed: true })),
    { id: 'quick', label: 'Quick window, from any app', keys: quickKey, custom: quickKey !== QUICK_DEFAULT, fixed: !hasShell(), onChange: () => setRecording('quick'), recordKey: recordQuick },
    { id: 'selection', label: 'Ask about selected text, in any app', keys: selectionKey, custom: selectionKey !== SELECTION_DEFAULT, fixed: !hasShell(), onChange: () => setRecording('selection'), recordKey: recordSelection },
    { id: 'screen', label: 'Ask about the screen, from any app', keys: screenKey, custom: screenKey !== DEFAULT_SCREEN_HOTKEY, fixed: !hasShell(), onChange: () => setRecording('screen'), recordKey: recordScreen },
  ];
  const by = groupsLib.categorise(rows);
  const cards = [
    ...groupsLib.SHORTCUT_CATEGORIES.map((c) => ({ id: c.id, label: c.label, hint: c.hint, rows: by[c.id] })),
    { id: 'composer', label: 'In the box', hint: 'While typing a message', rows: COMPOSER_KEYS.map(([keys, what]): Row => ({ id: 'composer', label: what, keys, fixed: true })) },
  ];

  return (
    <div className="settings-card shortcuts-card">
      <div className="shortcuts-head">
        <label className="toggle">
          <input type="checkbox" checked={on} onChange={(e) => { keymap.setEnabled(e.target.checked); setOn(e.target.checked); }} />
          Keyboard shortcuts on
        </label>
        <span className="settings-hint">Off, only Ctrl+K, Esc, Ctrl+/ and Ctrl+Shift+Z still answer. <kbd>Ctrl+/</kbd> shows every shortcut on any screen.</span>
      </div>
      {clashes.length > 0 && (
        <div className="chip-note" role="alert">
          {clashes.map((c) => `${c.keys}: ${c.ids.join(' and ')}${c.reason ? ` (${c.reason})` : ''}`).join(' · ')}
        </div>
      )}
      <div className="shortcut-cards">
        {cards.map((card) => {
          const unfolded = !!openCards[card.id];
          const shown = unfolded ? card.rows : card.rows.slice(0, groupsLib.PEEK);
          return (
            <section key={card.id} className={`shortcut-card ${unfolded ? 'is-open' : ''}`}>
              <h4>{card.label} <span>{card.hint}</span></h4>
              <div className="shortcut-table">
                {shown.map((r, i) => (
                  <div key={`${r.id}:${i}`} className="shortcut-row">
                    <span className="shortcut-label">{r.label}</span>
                    <kbd className={r.custom ? 'is-custom' : ''}>{r.keys}</kbd>
                    {unfolded && !r.fixed && r.onChange && (
                      recording === r.id
                        ? <button className="primary" autoFocus onKeyDown={r.recordKey} onBlur={() => setRecording('')}>Press a combo…</button>
                        : <button onClick={r.onChange}>Change</button>
                    )}
                    {unfolded && r.custom && r.reset && <button className="linkish" onClick={r.reset}>Reset</button>}
                  </div>
                ))}
              </div>
              {card.rows.length > groupsLib.PEEK || card.rows.some((r) => !r.fixed) ? (
                <button type="button" className="linkish shortcut-more" onClick={() => setOpenCards((o) => ({ ...o, [card.id]: !unfolded }))} aria-expanded={unfolded}>
                  <Icon name="chevron-down" size={12} className={unfolded ? 'flip-y' : ''} /> {unfolded ? 'Fewer' : `All ${card.rows.length}${card.rows.some((r) => !r.fixed) ? ' · change' : ''}`}
                </button>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
