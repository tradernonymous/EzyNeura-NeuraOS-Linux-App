// The destinations (one list: the top bar, Alt+N, the palette and the docs
// all read it) and the project sidebar.
//
// The sidebar used to be a rail of icons that peeked open on hover; the
// right-hand rail is gone with it. Now the top bar says WHERE you are, and this
// column, hideable with Ctrl+B, is the history: every chat belongs to a folder
// (the Claude Code flow), and the chats are read by folder. Chats about
// nothing in particular live in the home folder, `~/NeuraOS`.
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon, { type IconName } from './components/Icon';
import './threads.js';
import './shell.js';
import './chats.js';
import { trayStateSet } from './bridge';
import { OPEN_CHAT_EVENT } from './screens/ChatScreen';
import type { ChatSession } from './screens/ChatScreen';

const threadsLib: typeof import('./threads.js') = (globalThis as any).FreeAI4UThreads;
const shell: typeof import('./shell.js') = (globalThis as any).FreeAI4UShell;
const chats: typeof import('./chats.js') = (globalThis as any).FreeAI4UChats;
import { APP_VERSION } from './version';
import { isLinux } from './platform';
// Paused background recipe runs waiting for an answer (NEURA-036): a badge on
// Agents, whose Recipes tab holds the approval cards.
import './recipes.js';

const recipesLib: typeof import('./recipes.js') = (globalThis as any).FreeAI4URecipes;

export function usePendingApprovals(): number {
  const [count, setCount] = useState(() => recipesLib.approvals.pending().length);
  useEffect(() => recipesLib.approvals.subscribe((rows) => setCount(rows.length)), []);
  return count;
}

// The ONE list of destinations and their keys. App.tsx resolves Alt+N from it,
// the command palette shows its keys, and the README names them.
//
// Four, not five: Activity is a tab under Agents now. Settings is not a space:
// it opens from the gear in the top bar, or Ctrl+, (shared/keymap.js).
// `view` is the tab a space opens on when it has no remembered one.
export const NAV_ITEMS: Array<{ id: NavId; label: string; icon: IconName; keys: string; view: ViewId }> = [
  { id: 'chat', label: 'Chat', icon: 'chat', keys: 'Alt+1', view: 'chat' },
  { id: 'code', label: 'Code', icon: 'terminal', keys: 'Alt+2', view: 'code' },
  { id: 'create', label: 'Create', icon: 'design', keys: 'Alt+3', view: 'design' },
  { id: 'agents', label: 'Agents', icon: 'library', keys: 'Alt+4', view: 'library' },
];

/** Every view, the destination whose menu it sits in, and one line on what it is for. */
export const SUB_VIEWS: Array<{ id: ViewId; label: string; parent: NavId; hint: string }> = [
  { id: 'chat', label: 'Chat', parent: 'chat', hint: 'Talk to a model, with tools' },
  { id: 'build', label: 'Builds', parent: 'chat', hint: 'Long builds and the approvals they stop for' },
  { id: 'code', label: 'Agent', parent: 'code', hint: 'The coding agent in the open folder' },
  { id: 'local', label: 'Local folder', parent: 'code', hint: 'Tree, viewer and terminal' },
  { id: 'files', label: 'Files', parent: 'code', hint: 'Extract and generate documents' },
  { id: 'parallel', label: 'Worktrees', parent: 'code', hint: 'Several agents at once, each in its own git worktree' },
  { id: 'acp', label: 'External agents', parent: 'code', hint: 'Claude Code, Gemini CLI, Codex over ACP' },
  { id: 'design', label: 'Design', parent: 'create', hint: 'Pages, decks and posts' },
  { id: 'images', label: 'Images', parent: 'create', hint: 'Draw and change pictures' },
  { id: 'library', label: 'Library', parent: 'agents', hint: 'Skills and memory' },
  { id: 'agents', label: 'Agents', parent: 'agents', hint: 'Sub-agents chat can run or delegate to' },
  { id: 'recipes', label: 'Recipes', parent: 'agents', hint: 'Saved prompts, servers and schedules' },
  { id: 'activity', label: 'Runs', parent: 'agents', hint: 'What ran, and what is waiting on you' },
  { id: 'evals', label: 'Evals', parent: 'agents', hint: 'Score several models on the same tasks' },
  { id: 'settings', label: 'Settings', parent: 'settings', hint: 'Engine, providers, appearance' },
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
export function useBusyChats(): Set<string> {
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
  return busy;
}

export function useListening(): 'idle' | 'recording' | 'working' {
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

/** The tabs a destination shows; one tab means no menu. */
export function tabsOf(destination: NavId): Array<{ id: ViewId; label: string; hint: string }> {
  return SUB_VIEWS.filter((v) => v.parent === destination);
}

/** The {view: 'Alt+N'} map the palette is handed. */
export function navKeys(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of NAV_ITEMS) out[item.id] = item.keys;
  return out;
}

/** The destination a key press names, or null. `Alt+2` -> 'code'. */
export function navForKey(key: string): NavId | null {
  const wanted = `Alt+${String(key || '').toUpperCase()}`;
  const hit = NAV_ITEMS.find((item) => item.keys.toUpperCase() === wanted);
  return hit ? hit.id : null;
}

export type NavId = 'chat' | 'code' | 'create' | 'agents' | 'settings';
/** A view: a destination's own tab, or one of the tabs inside one. */
export type ViewId = 'chat' | 'code' | 'settings' | 'activity' | 'design' | 'library' | 'build' | 'local' | 'files' | 'images' | 'evals' | 'agents' | 'recipes' | 'parallel' | 'acp';

export interface PanelKeyMap {
  folder: boolean;
  terminal: boolean;
}

export type PanelId = keyof PanelKeyMap;

interface SidebarProps {
  active: ViewId;
  /** The chat on screen, so its row reads as current. */
  activeChat: string;
  onNavigate: (id: ViewId) => void;
  onOpenPalette: () => void;
  onTogglePanel: (key: PanelId) => void;
  panels: Partial<PanelKeyMap>;
  /** "+ New chat": App opens the folder picker. `project` starts one in a known folder. */
  onNewChat: (project?: string) => void;
  onHide: () => void;
  /** The home folder (`~/NeuraOS`); '' in a browser build. */
  home: string;
  onExport: () => void;
  onImport: (file: File) => void;
  importMsg: string;
  /** The theme toggle sits here on Linux, where there is no in-app titlebar. */
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
}

const FILTERS: Array<{ id: import('./shell.js').SidebarFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'pinned', label: 'Pinned' },
];

function relative(at: number): string {
  const d = Date.now() - (at || 0);
  const m = Math.round(d / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.round(h / 24);
  return days < 30 ? `${days}d` : new Date(at).toLocaleDateString();
}

// The name is the product's, not the engine's: this is NeuraOS, and the engine
// it talks to is still the FreeAI4U server. The localStorage keys keep their
// freeai4u-* spelling, so an existing install updates in place.
export default function Sidebar({ active, activeChat, onNavigate, onOpenPalette, onTogglePanel, panels, onNewChat, onHide, home, onExport, onImport, importMsg, theme, onToggleTheme }: SidebarProps) {
  const approvals = usePendingApprovals();
  const busy = useBusyChats();
  const listening = useListening();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [meta, setMeta] = useState(() => threadsLib.readMeta());
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [filter, setFilter] = useState<import('./shell.js').SidebarFilter>('all');
  const [folded, setFolded] = useState<string[]>(() => shell.readFolded());
  const [shown, setShown] = useState<Record<string, number>>({});
  const [, setTick] = useState(0);

  useEffect(() => {
    const load = () => setSessions(chats.readStore() as ChatSession[]);
    const spin = () => setTick((t) => t + 1);
    load();
    window.addEventListener(threadsLib.CHANGED_EVENT, load);
    window.addEventListener(threadsLib.ACTIVITY_EVENT, spin);
    return () => {
      window.removeEventListener(threadsLib.CHANGED_EVENT, load);
      window.removeEventListener(threadsLib.ACTIVITY_EVENT, spin);
    };
  }, []);

  const busyAny = busy.size > 0;
  const orbState = listening === 'recording' ? 'listening' : listening === 'working' || busyAny ? 'thinking' : 'idle';
  // The tray shows the same three states: a person needed beats working.
  useEffect(() => {
    void trayStateSet(approvals > 0 ? 'approval' : busyAny ? 'thinking' : 'idle');
  }, [approvals, busyAny]);

  const groups = useMemo(
    () => shell.groups(sessions, { query, filter, busy, pinned: meta.pinned, home }),
    [sessions, query, filter, busy, meta, home],
  );

  const pin = (id: string) => {
    const next = threadsLib.togglePin(meta, id);
    threadsLib.writeMeta(next);
    setMeta(next);
  };
  const fold = (key: string) => {
    const next = shell.toggleFolded(folded, key);
    shell.writeFolded(next);
    setFolded(next);
  };
  const open = (id: string) => {
    onNavigate('chat');
    window.dispatchEvent(new CustomEvent(OPEN_CHAT_EVENT, { detail: id }));
  };

  // The orb: a click is voice (Chat starts dictation), a long press is a new
  // chat. It breathes while listening and pulses while any agent works.
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const orbDown = () => {
    longPressed.current = false;
    pressTimer.current = window.setTimeout(() => { longPressed.current = true; onNewChat(); }, 550);
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

  return (
    <aside className="sidebar" aria-label="Projects and history">
      <div className="sidebar-top">
        <button className="sidebar-new raised" type="button" onClick={() => onNewChat()} title="New chat — Ctrl+N">
          <Icon name="plus" size={14} />
          <span>New chat</span>
          <kbd>Ctrl+N</kbd>
        </button>
        {/* Small raised buttons: the chat's own functions, one icon each, the
            words on hover (the Freebuff row, the Claude Code sidebar). */}
        <div className="sidebar-tools" role="toolbar" aria-label="Chat tools">
          <button type="button" className={`raised icon-btn ${searching ? 'active' : ''}`} aria-pressed={searching} onClick={() => { setSearching((v) => !v); if (searching) setQuery(''); }} title="Search chats"><Icon name="search" size={14} /></button>
          <button type="button" className="raised icon-btn" onClick={onOpenPalette} title="Commands — Ctrl+K"><Icon name="compass" size={14} /></button>
          <button type="button" className={`raised icon-btn ${panels.folder ? 'active' : ''}`} aria-pressed={!!panels.folder} onClick={() => onTogglePanel('folder')} title="Folder tree"><Icon name="folder" size={14} /></button>
          <button type="button" className={`raised icon-btn ${panels.terminal ? 'active' : ''}`} aria-pressed={!!panels.terminal} onClick={() => onTogglePanel('terminal')} title="Terminal — Ctrl+`"><Icon name="terminal" size={14} /></button>
          <button type="button" className={`raised icon-btn ${active === 'activity' ? 'active' : ''}`} onClick={() => onNavigate('activity')} title={approvals ? `Runs — ${approvals} waiting for you` : 'Runs'}>
            <Icon name="activity" size={14} />
            {approvals > 0 && <span className="sidebar-badge" aria-label={`${approvals} waiting for approval`}>{approvals}</span>}
          </button>
        </div>
        {searching && (
          <input className="sidebar-search-input" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats…" aria-label="Search chats" onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); setSearching(false); } }} />
        )}
        <div className="sidebar-filters" role="tablist" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={`sidebar-filter ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
      </div>

      <div className="sidebar-groups">
        {groups.map((group) => {
          const shut = folded.includes(group.key);
          const limit = shown[group.key] || shell.PAGE;
          const rows = shut ? [] : group.items.slice(0, limit);
          return (
            <section key={group.key} className="project-group" data-running={group.running ? 'true' : 'false'}>
              <div className="project-head">
                <button type="button" className="project-fold" aria-expanded={!shut} onClick={() => fold(group.key)} title={group.path || (group.path === '' ? home : '')}>
                  <span className="project-chevron" aria-hidden="true">{shut ? '▸' : '▾'}</span>
                  <Icon name={group.path === null ? 'check' : 'folder'} size={12} />
                  <span className="project-title">{group.title}</span>
                  <span className="project-count">{group.items.length}</span>
                </button>
                {group.path !== null && (
                  <button type="button" className="project-new" onClick={() => onNewChat(group.path || home)} title={`New chat in ${group.title}`} aria-label={`New chat in ${group.title}`}>
                    <Icon name="plus" size={12} />
                  </button>
                )}
              </div>
              {rows.map((s) => {
                const pinned = meta.pinned.includes(s.id);
                const status = shell.statusOf(s, busy);
                return (
                  <div key={s.id} className={`thread-item ${s.id === activeChat ? 'active' : ''}`}>
                    <button className="thread-open" onClick={() => open(s.id)} aria-current={s.id === activeChat ? 'true' : undefined} aria-describedby={`thread-preview-${s.id}`}>
                      <span className={`thread-dot thread-dot-${status}`} aria-label={status === 'running' ? 'Answering' : undefined} />
                      <span className="session-title">{s.title || 'Untitled'}</span>
                      <span className="thread-when">{relative(s.updatedAt)}</span>
                    </button>
                    <div className="thread-preview" id={`thread-preview-${s.id}`} role="tooltip">{threadsLib.preview(s)}</div>
                    <div className="thread-actions">
                      <button onClick={() => pin(s.id)} title={pinned ? 'Unpin' : 'Pin to the top'} aria-pressed={pinned} aria-label={pinned ? 'Unpin' : 'Pin'}>
                        <Icon name={pinned ? 'check' : 'paperclip'} size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
              {!shut && group.items.length > limit && (
                <button type="button" className="project-more" onClick={() => setShown({ ...shown, [group.key]: limit + shell.PAGE })}>
                  Show {Math.min(shell.PAGE, group.items.length - limit)} more
                </button>
              )}
            </section>
          );
        })}
        {groups.length === 0 && (
          <div className="empty sidebar-empty">
            {sessions.length ? 'No chats match.' : 'No chats yet. Start one — it lives in a folder, and history is read by folder.'}
          </div>
        )}
      </div>

      <div className="sidebar-foot">
        {/* The orb (docs/MASTER_PLAN.md section 4): click for voice, hold for a
            new chat. Its ring is the app's one "thinking" signal. */}
        <button
          type="button"
          className="orb orb-small"
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
        <div className="sidebar-foot-actions">
          <button type="button" className="raised icon-btn" onClick={onExport} title="Export chats to a file"><Icon name="download" size={13} /></button>
          <label className="raised icon-btn" title="Import chats from a file">
            <Icon name="copy" size={13} />
            <input type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); }} />
          </label>
          {isLinux() && onToggleTheme && (
            <button type="button" className="raised icon-btn" onClick={onToggleTheme} aria-label="Toggle theme" title={`${theme === 'dark' ? 'Light' : 'Dark'} theme`}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={13} />
            </button>
          )}
          <button type="button" className={`raised icon-btn ${active === 'settings' ? 'active' : ''}`} onClick={() => onNavigate('settings')} title="Settings — Ctrl+,"><Icon name="settings" size={13} /></button>
          <button type="button" className="raised icon-btn" onClick={onHide} title="Hide the sidebar — Ctrl+B" aria-label="Hide the sidebar"><Icon name="close" size={13} /></button>
        </div>
        <span className="sidebar-version" title="NeuraOS for Linux">v{APP_VERSION}</span>
      </div>
      {importMsg && <div className="sidebar-hint">{importMsg}</div>}
    </aside>
  );
}
