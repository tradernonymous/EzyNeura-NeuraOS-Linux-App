// Ctrl+/: every shortcut on top of whatever is on screen (the Raycast and
// Linear cheat sheet, PowerToys' Shortcut Guide), by category. It reads the
// same table Settings edits, so it can never disagree with the keys that work.
import { useEffect } from 'react';
import Icon from './Icon';
import { NAV_ITEMS } from '../Sidebar';
import { QUICK_HOTKEY_KEY, SELECTION_HOTKEY_KEY, COMPOSER_KEYS } from './ShortcutsCard';
import { readScreenHotkey } from '../desktopControl';
import '../../../shared/keymap.js';
import '../settings-groups.js';

const keymap: typeof import('../../../shared/keymap.js') = (globalThis as any).FreeAI4UKeymap;
const groupsLib: typeof import('../settings-groups.js') = (globalThis as any).FreeAI4USettingsGroups;

interface Props { open: boolean; onClose: () => void; }

function stored(key: string, fallback: string): string {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

export default function CheatSheet({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const rows = [
    ...keymap.withOverrides(keymap.readOverrides()).map((b) => ({ id: b.id, label: b.label, keys: b.keys })),
    ...NAV_ITEMS.map((n) => ({ id: 'nav', label: `Go to ${n.label}`, keys: n.keys })),
    { id: 'quick', label: 'Quick window, from any app', keys: stored(QUICK_HOTKEY_KEY, 'Alt+Space') },
    { id: 'selection', label: 'Ask about selected text', keys: stored(SELECTION_HOTKEY_KEY, 'Alt+Shift+Space') },
    { id: 'screen', label: 'Ask about the screen', keys: readScreenHotkey() },
  ];
  const by = groupsLib.categorise(rows);
  return (
    <div className="palette-backdrop" onClick={onClose} role="presentation">
      <div className="deck cheat-sheet" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <div className="cheat-sheet-head">
          <h3>Keyboard shortcuts</h3>
          <span className="settings-hint">Change them in Settings → General → Shortcuts</span>
          <button type="button" className="chat-output-close" onClick={onClose} aria-label="Close"><Icon name="close" size={13} /></button>
        </div>
        <div className="cheat-sheet-grid">
          {groupsLib.SHORTCUT_CATEGORIES.map((c) => (
            <section key={c.id} className="cheat-sheet-col">
              <h4>{c.label}</h4>
              {by[c.id].map((r, i) => (
                <div key={`${r.id}:${i}`} className="cheat-row"><span>{r.label}</span><kbd>{r.keys}</kbd></div>
              ))}
            </section>
          ))}
          <section className="cheat-sheet-col">
            <h4>In the box</h4>
            {COMPOSER_KEYS.map(([keys, what]) => (
              <div key={keys} className="cheat-row"><span>{what}</span><kbd>{keys}</kbd></div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
