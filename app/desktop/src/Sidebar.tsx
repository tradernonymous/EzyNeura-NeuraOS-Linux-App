// The sidebar. It used to be twelve flat buttons whose icons were emoji
// (💬 🖼 🛠 …), which render differently on every Windows build, cannot be
// aligned or sized, and made the app look unfinished at a glance. Now every row
// is the same 24x24 stroke icon at the same weight as its label.
//
// The four-second hint that used to appear down here is gone: feedback belongs
// in the toast queue (src/toasts.js), where it can be read, dismissed and
// announced.
//
// The panels used to advertise the ENGINE's workspace and terminal, two things
// that mostly refuse to work (they need WORKSPACE_RUN=1 and a login on the
// server). Folder and Terminal are now the local ones -- real files on this
// machine, which is what a desktop app should answer for -- and the engine's
// two live under Settings → Advanced, labelled for what they are.
import { useEffect, useRef, useState } from 'react';
import Icon, { type IconName } from './components/Icon';
import './threads.js';

const threadsLib: typeof import('./threads.js') = (globalThis as any).FreeAI4UThreads;
import { APP_VERSION } from './version';
import { isLinux } from './platform';
import emblem from '../../assets/branding/neuraos-emblem.svg';
// Paused background recipe runs waiting for an answer (NEURA-036): a badge on
// Library, whose Recipes tab holds the approval cards.
import './recipes.js';

const recipesLib: typeof import('./recipes.js') = (globalThis as any).FreeAI4URecipes;

function usePendingApprovals(): number {
  const [count, setCount] = useState(() => recipesLib.approvals.pending().length);
  useEffect(() => recipesLib.approvals.subscribe((rows) => setCount(rows.length)), []);
  return count;
}

// The ONE list of destinations and their keys. App.tsx resolves Alt+N from it,
// the command palette shows its keys, and test/desktop-shortcuts.test.js holds
// README.md and docs/desktop.md to it -- three places used to disagree.
//
// Five, not nine: the screens that overlapped now live inside a destination as
// its tabs (SUB_VIEWS). Chat holds Builds; Code holds the local folder and the
// Files generator; Library holds Images. Nothing was removed -- every view is
// still one Ctrl+K away and keeps its own screen.
//
// The five spaces of docs/MASTER_PLAN.md section 4 (the APK's four plus Code):
// Chat, Code, Create, Agents, Activity. Settings is not a space: it opens from
// the account row at the foot of the rail, or Ctrl+, (shared/keymap.js).
// `view` is the tab a space opens on when it has no remembered one.
export const NAV_ITEMS: Array<{ id: NavId; label: string; icon: IconName; keys: string; view: ViewId }> = [
  { id: 'chat', label: 'Chat', icon: 'chat', keys: 'Alt+1', view: 'chat' },
  { id: 'code', label: 'Code', icon: 'terminal', keys: 'Alt+2', view: 'code' },
  { id: 'create', label: 'Create', icon: 'design', keys: 'Alt+3', view: 'design' },
  { id: 'agents', label: 'Agents', icon: 'library', keys: 'Alt+4', view: 'library' },
  { id: 'activity', label: 'Activity', icon: 'activity', keys: 'Alt+5', view: 'activity' },
];

/** Every view, and the destination whose tab strip it sits in. */
export const SUB_VIEWS: Array<{ id: ViewId; label: string; parent: NavId }> = [
  { id: 'chat', label: 'Chat', parent: 'chat' },
  { id: 'build', label: 'Builds', parent: 'chat' },
  { id: 'code', label: 'Agent', parent: 'code' },
  { id: 'local', label: 'Local', parent: 'code' },
  { id: 'files', label: 'Files', parent: 'code' },
  { id: 'parallel', label: 'Parallel', parent: 'code' },
  { id: 'design', label: 'Design', parent: 'create' },
  { id: 'images', label: 'Images', parent: 'create' },
  { id: 'library', label: 'Library', parent: 'agents' },
  { id: 'agents', label: 'Agents', parent: 'agents' },
  { id: 'recipes', label: 'Recipes', parent: 'agents' },
  { id: 'activity', label: 'Activity', parent: 'activity' },
  { id: 'evals', label: 'Evals', parent: 'activity' },
  { id: 'settings', label: 'Settings', parent: 'settings' },
];

/** The tab a space opens on: its own default, so Alt+3 lands on Design. */
export function defaultViewOf(destination: NavId): ViewId {
  return NAV_ITEMS.find((item) => item.id === destination)?.view || 'chat';
}

/** Fired by the orb: the Chat screen starts (or stops) dictation. */
export const ORB_EVENT = 'neuraos:orb';
/** Fired by whoever owns the mic, so the orb can breathe while listening. */
export const DICTATION_EVENT = 'neuraos:dictation';

/** True while any chat is streaming or a tool runs (threads.ACTIVITY_EVENT). */
function useBusy(): boolean {
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const onActivity = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      setBusy((prev) => {
        const next = new Set(prev);
        if (d.busy) next.add(String(d.id)); else next.delete(String(d.id));
        return next;
      });
    };
    window.addEventListener(threadsLib.ACTIVITY_EVENT, onActivity);
    return () => window.removeEventListener(threadsLib.ACTIVITY_EVENT, onActivity);
  }, []);
  return busy.size > 0;
}

function useListening(): 'idle' | 'recording' | 'working' {
  const [state, setState] = useState<'idle' | 'recording' | 'working'>('idle');
  useEffect(() => {
    const on = (e: Event) => setState(((e as CustomEvent).detail || {}).state || 'idle');
    window.addEventListener(DICTATION_EVENT, on);
    return () => window.removeEventListener(DICTATION_EVENT, on);
  }, []);
  return state;
}

/** Anything can ask the shell to move: detail { view?: ViewId, panel?: 'sessions' }. */
export const NAVIGATE_EVENT = 'freeai4u:navigate';

/** The destination a view belongs to. */
export function destinationOf(view: ViewId): NavId {
  return SUB_VIEWS.find((v) => v.id === view)?.parent || 'chat';
}

/** The tabs a destination shows; one tab means no strip. */
export function tabsOf(destination: NavId): Array<{ id: ViewId; label: string }> {
  return SUB_VIEWS.filter((v) => v.parent === destination);
}

const PANEL_ITEMS: Array<{ key: 'folder' | 'terminal' | 'sessions' | 'builds' | 'knowledge'; label: string; icon: IconName; title: string }> = [
  { key: 'folder', label: 'Folder', icon: 'folder', title: 'Files in the folder you opened' },
  { key: 'terminal', label: 'Terminal', icon: 'terminal', title: 'Commands on this machine' },
  { key: 'sessions', label: 'History', icon: 'history', title: 'Saved chats' },
  { key: 'builds', label: 'Approvals', icon: 'check', title: 'Pending build approvals' },
  { key: 'knowledge', label: 'Skills', icon: 'skills', title: 'Skills and memory' },
];

/** The {view: 'Alt+N'} map the palette is handed. */
export function navKeys(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of NAV_ITEMS) out[item.id] = item.keys;
  return out;
}

/** The destination a key press names, or null. `Alt+5` -> 'settings'. */
export function navForKey(key: string): NavId | null {
  const wanted = `Alt+${String(key || '').toUpperCase()}`;
  const hit = NAV_ITEMS.find((item) => item.keys.toUpperCase() === wanted);
  return hit ? hit.id : null;
}

export type NavId = 'chat' | 'code' | 'create' | 'agents' | 'activity' | 'settings';
/** A view: a destination's own tab, or one of the tabs inside one. */
export type ViewId = 'chat' | 'code' | 'settings' | 'activity' | 'design' | 'library' | 'build' | 'local' | 'files' | 'images' | 'evals' | 'agents' | 'recipes' | 'parallel';

export interface PanelKeyMap {
  folder: boolean;
  terminal: boolean;
  sessions: boolean;
  builds: boolean;
  knowledge: boolean;
}

export type PanelId = keyof PanelKeyMap;

interface SidebarProps {
  active: ViewId;
  onNavigate: (id: ViewId) => void;
  onOpenPalette: () => void;
  onTogglePanel: (key: PanelId) => void;
  panels: Partial<PanelKeyMap>;
  /** Pinned: the rail stands beside the floor. Unpinned it floats over it and
      the floor keeps a rail's width of margin, so nothing hides underneath. */
  pinned: boolean;
  onTogglePin: () => void;
  /** The theme toggle sits here on Linux, where there is no in-app titlebar. */
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  /** The orb's long press: a new chat (the APK's orb long-press). */
  onNewChat?: () => void;
}

// The name is the product's, not the engine's: this is NeuraOS, and the engine
// it talks to is still the FreeAI4U server. The crate, the binary, the bundle
// identifier and the localStorage keys all keep their freeai4u-* spelling, so
// an existing install updates in place and existing chats and settings survive
// the rename.
export default function Sidebar({ active, onNavigate, onOpenPalette, onTogglePanel, panels, pinned, onTogglePin, theme, onToggleTheme, onNewChat }: SidebarProps) {
  const approvals = usePendingApprovals();
  const busy = useBusy();
  const listening = useListening();
  // The orb: a click is voice (Chat starts dictation), a long press is a new
  // chat. It breathes while listening and pulses while any agent works --
  // "calm until it thinks" -- and both stop under Reduce motion (index.css).
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const orbDown = () => {
    longPressed.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      onNewChat?.();
    }, 550);
  };
  const orbUp = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const orbClick = () => {
    if (longPressed.current) return;
    onNavigate('chat');
    window.dispatchEvent(new CustomEvent(ORB_EVENT));
  };
  const orbState = listening === 'recording' ? 'listening' : listening === 'working' || busy ? 'thinking' : 'idle';
  // A peeking rail is held open by the pointer and by focus, so Escape closes
  // it by letting the focus go; there is no "open" flag to clear. A pinned rail
  // is where the person put it, and stays. Escape is not swallowed -- the
  // palette and the composer listen for it too.
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || pinned) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && e.currentTarget.contains(focused)) focused.blur();
  };
  return (
    <aside className="sidebar" data-pinned={pinned ? 'true' : 'false'} onKeyDown={onKeyDown}>
      <div className="sidebar-brand">
        {/* The real emblem (app/assets/branding), not a letter in a box: the
            same mark as the Android app's icon and the tray. */}
        <img className="sidebar-logo sidebar-emblem" src={emblem} alt="" width={24} height={24} draggable={false} />
        <span className="sidebar-title">NeuraOS</span>
      </div>

      <button className="sidebar-search" type="button" onClick={onOpenPalette}>
        <Icon name="search" size={14} />
        <span>Search or run a command</span>
        <kbd>Ctrl+K</kbd>
      </button>

      <nav className="sidebar-nav" aria-label="Screens">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`sidebar-btn ${destinationOf(active) === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(defaultViewOf(item.id))}
            title={item.id === 'activity' && approvals
              ? `${item.label} — ${approvals} approval${approvals > 1 ? 's' : ''} waiting`
              : `${item.label} — ${item.keys}`}
            aria-current={destinationOf(active) === item.id ? 'page' : undefined}
          >
            <Icon name={item.icon} />
            <span className="sidebar-label">{item.label}</span>
            {item.id === 'activity' && approvals > 0 && (
              <span className="sidebar-badge" aria-label={`${approvals} waiting for approval`}>{approvals}</span>
            )}
            <span className="sidebar-keys">{item.keys}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-divider" />
      {/* The docks are toggles, not places: a quiet row of icons, each also on
          the keyboard (Ctrl+H history, Ctrl+` terminal) and in Ctrl+K. */}
      <nav className="sidebar-nav sidebar-panels" aria-label="Panels">
        {PANEL_ITEMS.map((item) => (
          <button
            key={item.key}
            className={`sidebar-btn sidebar-panel-btn ${panels[item.key] ? 'active' : ''}`}
            onClick={() => onTogglePanel(item.key)}
            title={`${item.label} — ${item.title}`}
            aria-label={item.label}
            aria-pressed={!!panels[item.key]}
          >
            <Icon name={item.icon} />
            <span className="sidebar-label">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* The orb (docs/MASTER_PLAN.md section 4): click for voice, hold for a
          new chat. Its ring is the app's one "thinking" signal. */}
      <button
        type="button"
        className="orb"
        data-state={orbState}
        onPointerDown={orbDown}
        onPointerUp={orbUp}
        onPointerLeave={orbUp}
        onClick={orbClick}
        aria-label={orbState === 'listening' ? 'Stop listening' : 'Talk to NeuraOS (hold for a new chat)'}
        title={orbState === 'listening' ? 'Listening — click to stop and type what you said'
          : orbState === 'thinking' ? 'Working… (click to dictate, hold for a new chat)'
          : 'Dictate — hold for a new chat (Ctrl+N)'}
      >
        <span className="orb-core" />
      </button>

      {/* The account row: where Settings lives now that it is not a space. */}
      <button
        type="button"
        className={`sidebar-btn sidebar-account ${active === 'settings' ? 'active' : ''}`}
        onClick={() => onNavigate('settings')}
        title="Settings — Ctrl+,"
        aria-current={active === 'settings' ? 'page' : undefined}
      >
        <Icon name="settings" />
        <span className="sidebar-label">Settings</span>
        <span className="sidebar-keys">Ctrl+,</span>
      </button>

      {/* Icon only, with no label span: the pin sits at the rail's right edge,
          so a label would be the part clipped away at 40px and the icon the
          part hidden. The title and the aria-label carry the words instead. */}
      <button
        className="sidebar-pin"
        type="button"
        aria-pressed={pinned}
        aria-label={pinned ? 'Unpin the sidebar' : 'Keep the sidebar open'}
        title={pinned ? 'Let this rail close again when you move away' : 'Keep this rail open'}
        onClick={onTogglePin}
      >
        <Icon name="paperclip" size={12} />
      </button>

      <div className="sidebar-footer">
        {isLinux() && onToggleTheme && (
          <button
            className="sidebar-theme"
            type="button"
            onClick={onToggleTheme}
            aria-label="Toggle theme"
            title={`${theme === 'dark' ? 'Light' : 'Dark'} theme`}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        )}
        <span className="sidebar-version" title="FreeAI4U Desktop">v{APP_VERSION}</span>
      </div>
    </aside>
  );
}
