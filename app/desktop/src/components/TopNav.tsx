// The top bar: four destinations, each a menu of its tabs that opens on hover
// (after a beat), on click and from the keyboard, so it works with a touchpad
// and a keyboard alike. It replaces the two icon rails: the left one that
// peeked open on hover and the right one that held Design/Build/Files/Changes.
//
// The bar says where you are -- a destination reads as current, and when the
// open tab is not the destination's first one its name follows the label, so
// "Code · Files" needs no second strip of tabs under it.
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import emblem from '../../../assets/branding/neuraos-emblem.svg';
import { NAV_ITEMS, SUB_VIEWS, defaultViewOf, destinationOf, tabsOf, type NavId, type ViewId } from '../Sidebar';

/** How long the pointer rests on a destination before its menu opens. */
export const HOVER_DELAY_MS = 150;

interface Props {
  active: ViewId;
  onNavigate: (view: ViewId) => void;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
  /** The sidebar toggle at the bar's left edge. */
  sidebarHidden: boolean;
  onToggleSidebar: () => void;
  /** The engine's state, for the dot at the right end. */
  engineState: string;
  engineLabel: string;
  /** Recipe runs waiting on the person: a badge on Agents. */
  approvals: number;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export default function TopNav({ active, onNavigate, onOpenPalette, onOpenSettings, sidebarHidden, onToggleSidebar, engineState, engineLabel, approvals, theme, onToggleTheme }: Props) {
  const [open, setOpen] = useState<NavId | null>(null);
  const timer = useRef<number | null>(null);
  const barRef = useRef<HTMLElement | null>(null);

  const clear = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = null; };
  const enter = (id: NavId) => {
    clear();
    timer.current = window.setTimeout(() => setOpen(id), HOVER_DELAY_MS);
  };
  const leave = () => {
    clear();
    timer.current = window.setTimeout(() => setOpen(null), HOVER_DELAY_MS);
  };
  useEffect(() => clear, []);

  // A click outside, or Escape, closes an open menu. Escape is not swallowed:
  // the palette and the composer listen for it too.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const current = destinationOf(active);
  const go = (view: ViewId) => { setOpen(null); onNavigate(view); };

  return (
    <nav className="topnav" ref={barRef} aria-label="Main">
      <button type="button" className="topnav-burger" onClick={onToggleSidebar} aria-pressed={!sidebarHidden} aria-label={sidebarHidden ? 'Show the sidebar' : 'Hide the sidebar'} title={`${sidebarHidden ? 'Show' : 'Hide'} the sidebar — Ctrl+B`}>
        <span /><span /><span />
      </button>
      <div className="topnav-brand">
        <img className="sidebar-emblem" src={emblem} alt="" width={20} height={20} draggable={false} />
        <span className="topnav-title">NeuraOS</span>
      </div>

      <ul className="topnav-items" role="menubar">
        {NAV_ITEMS.map((item) => {
          const tabs = tabsOf(item.id);
          const isCurrent = current === item.id;
          const tab = SUB_VIEWS.find((v) => v.id === active);
          const suffix = isCurrent && tab && tab.id !== item.view ? tab.label : '';
          const isOpen = open === item.id;
          return (
            <li
              key={item.id}
              role="none"
              className={`topnav-item ${isCurrent ? 'current' : ''} ${isOpen ? 'open' : ''}`}
              onPointerEnter={(e) => { if (e.pointerType === 'mouse') enter(item.id); }}
              onPointerLeave={(e) => { if (e.pointerType === 'mouse') leave(); }}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup={tabs.length > 1 ? 'menu' : undefined}
                aria-expanded={tabs.length > 1 ? isOpen : undefined}
                aria-current={isCurrent ? 'page' : undefined}
                className="topnav-btn"
                title={`${item.label} — ${item.keys}`}
                onClick={() => {
                  // A click on the destination goes there; a second click on the
                  // current one opens its menu, so the menu is reachable by touch.
                  if (tabs.length > 1 && isCurrent) setOpen(isOpen ? null : item.id);
                  else go(defaultViewOf(item.id));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown' && tabs.length > 1) { e.preventDefault(); setOpen(item.id); }
                }}
                onFocus={() => { if (tabs.length > 1) setOpen(item.id); }}
              >
                <Icon name={item.icon} size={15} />
                <span className="topnav-label">{item.label}</span>
                {suffix && <span className="topnav-suffix">· {suffix}</span>}
                {item.id === 'agents' && approvals > 0 && (
                  <span className="sidebar-badge" aria-label={`${approvals} waiting for approval`}>{approvals}</span>
                )}
                {tabs.length > 1 && <span className="topnav-caret" aria-hidden="true">▾</span>}
              </button>
              {tabs.length > 1 && isOpen && (
                <div className="topnav-menu deck" role="menu" aria-label={item.label} onKeyDown={(e) => {
                  const items = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitem"]'));
                  const at = items.indexOf(document.activeElement as HTMLElement);
                  if (e.key === 'ArrowDown') { e.preventDefault(); items[(at + 1) % items.length]?.focus(); }
                  if (e.key === 'ArrowUp') { e.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
                }}>
                  {tabs.map((t) => (
                    <button key={t.id} type="button" role="menuitem" className={`topnav-menu-row ${active === t.id ? 'active' : ''}`} onClick={() => go(t.id)} aria-current={active === t.id ? 'true' : undefined}>
                      <span className="topnav-menu-label">{t.label}</span>
                      <span className="topnav-menu-hint">{t.hint}</span>
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="topnav-end">
        <button type="button" className="topnav-search" onClick={onOpenPalette} title="Search or run a command — Ctrl+K">
          <Icon name="search" size={13} />
          <span>Search</span>
          <kbd>Ctrl+K</kbd>
        </button>
        <span className={`topnav-engine engine-${engineState}`} title={engineLabel} role="status" aria-label={engineLabel} />
        <button type="button" className={`topnav-icon ${active === 'settings' ? 'active' : ''}`} onClick={onOpenSettings} title="Settings — Ctrl+," aria-label="Settings" aria-current={active === 'settings' ? 'page' : undefined}>
          <Icon name="settings" size={15} />
        </button>
        <button type="button" className="topnav-icon" onClick={onToggleTheme} title={`${theme === 'dark' ? 'Light' : 'Dark'} theme`} aria-label="Toggle theme">
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
        </button>
      </div>
    </nav>
  );
}
