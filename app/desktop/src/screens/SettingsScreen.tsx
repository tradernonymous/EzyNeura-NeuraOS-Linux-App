import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import ConnectionCard from '../components/ConnectionCard';
import DiagnosticsCard from '../components/DiagnosticsCard';
import DoctorCard from '../components/DoctorCard';
import LocalModelsCard from '../components/LocalModelsCard';
import DictationCard from '../components/DictationCard';
import ConnectorsCard from '../components/ConnectorsCard';
import CredentialsCard from '../components/CredentialsCard';
import ShortcutsCard from '../components/ShortcutsCard';
import AppearanceCard from '../components/AppearanceCard';
import StartupCard from '../components/StartupCard';
import DesktopControlCard from '../components/DesktopControlCard';
import Hint from '../components/Hint';
import FileTree from '../components/FileTree';
import Terminal from '../components/Terminal';
import '../settings-groups.js';

const groupsLib: typeof import('../settings-groups.js') = (globalThis as any).FreeAI4USettingsGroups;

// Settings: everything the engine can tell us about itself.
//
// The engine address and the sign-in form live in ConnectionCard, because the
// first-run connect screen needs exactly the same two things -- one owner, one
// set of outcomes, instead of a copy per screen.
interface Props {
  /** The address or the session changed: the shell has to re-probe. */
  onConnectionChanged?: () => void;
  /** What the shell last concluded about the engine, in the diagnostics report. */
  diagnosticsState?: string;
  /** The app's current connection is healthy -- Doctor's own "Bundled engine" row. */
  engineHealthy?: boolean;
}

/** One row of the Providers list, ready or not. */
function providerRow(p: any) {
  return (
    <div key={p.id} className="provider-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span className="setting-label">
        {p.configured ? '' : '○ '}{p.label || p.id}
        {p.kind && p.kind !== 'chat' ? ` (${p.kind})` : ''}
      </span>
      <span className={`setting-value ${p.configured ? 'ok' : 'warn'}`}>
        {p.configured
          ? ((p.freeTier && (p.freeTier.text || p.freeTier.limitText)) || 'ready')
          : (p.note || 'no key set')}
      </span>
    </div>
  );
}

export default function SettingsScreen({ onConnectionChanged, diagnosticsState, engineHealthy }: Props) {
  const [providers, setProviders] = useState<any[]>([]);
  const [limits, setLimits] = useState<any>(null);
  const [memory, setMemory] = useState<Array<any>>([]);

  const load = () => {
    api.providers().then((rows: any) => setProviders(Array.isArray(rows) ? rows : [])).catch(() => setProviders([]));
    api.limits().then(setLimits).catch(() => setLimits(null));
    api.memory().then((m: any) => setMemory(Array.isArray(m) ? m : Array.isArray(m?.facts) ? m.facts : [])).catch(() => setMemory([]));
  };

  useEffect(() => { load(); }, []);

  // One searchable surface: the query hides every section that does not
  // mention it, and the rail lists what is left to jump to. It reads the
  // rendered text, so a card added later is searchable without registering.
  //
  // Four groups instead of thirteen rows (UI plan, phase 5): the nav lists
  // the groups, the main is a grid of cards for the open one. A search
  // jumps to the group holding the first hit and lights every hit up.
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('general');
  const [titles, setTitles] = useState<string[]>([]);
  // An HTMLElement, not an HTMLMainElement: the element is a <section> now.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = mainRef.current;
    if (!root) return;
    const q = query.trim().toLowerCase();
    const hits: string[] = [];
    const sections = Array.from(root.querySelectorAll<HTMLElement>(':scope > .settings-section'));
    sections.forEach((section) => {
      const title = section.querySelector('h2')?.textContent || '';
      const hit = !!q && (section.textContent || '').toLowerCase().includes(q);
      if (hit && title) hits.push(title);
    });
    const shownGroup = q ? groupsLib.groupForSearch(hits, group) : group;
    if (q && shownGroup !== group) setGroup(shownGroup);
    sections.forEach((section) => {
      const title = section.querySelector('h2')?.textContent || '';
      const inGroup = groupsLib.groupOf(title) === shownGroup;
      const hit = !q || hits.includes(title);
      section.hidden = !inGroup || (!!q && !hit);
      section.classList.toggle('is-hit', !!q && hit);
      section.classList.toggle('is-wide', groupsLib.isWide(title));
    });
    setTitles((prev) => (prev.join('|') === hits.join('|') ? prev : hits));
  }, [query, group, providers.length, memory.length]);
  const counts = groupsLib.counts(query.trim() ? titles : groupsLib.GROUPS.flatMap((g) => g.sections));

  const forget = async (id: string) => {
    try {
      await api.memoryForget(id);
      setMemory((prev) => prev.filter((f: any) => f.id !== id));
    } catch { /* the list refreshes on the next load */ }
  };

  return (
    <div className="screen settings">
      {/* The version stayed here and in the status bar -- the status bar is
          the one place that names the build (its own header comment,
          NEURA-076), so this copy was the duplicate. */}
      <header className="screen-header">
        <h1>Settings</h1>
      </header>
      <div className="settings-layout">
        <aside className="settings-nav">
          <input
            type="search"
            className="settings-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings"
            aria-label="Search settings"
            autoFocus
          />
          {counts.map((g) => (
            <button
              key={g.id}
              className={`settings-nav-btn ${group === g.id ? 'active' : ''}`}
              type="button"
              aria-current={group === g.id ? 'page' : undefined}
              onClick={() => { setGroup(g.id); if (query) setQuery(''); }}
              title={g.hint}
            >
              <span>{g.label}</span>
              <span className="settings-nav-hint">{query.trim() ? `${g.count} match${g.count === 1 ? '' : 'es'}` : g.hint}</span>
            </button>
          ))}
          {query.trim() && !titles.length && <div className="settings-hint">Nothing matches “{query}”.</div>}
          <button type="button" className="raised settings-cheat" onClick={() => window.dispatchEvent(new CustomEvent('freeai4u:cheat-sheet'))} title="Every shortcut, on top of any screen — Ctrl+/">
            Cheat sheet <kbd>Ctrl+/</kbd>
          </button>
        </aside>
        {/* A <section>, not a <main>: App.tsx owns the one main landmark for
            the window, and <main> may not be nested inside it. */}
        <section className="settings-main" ref={mainRef} aria-label="Settings groups">
          <section className="settings-section">
            <h2>Engine</h2>
            {/* A saved address is a setting; whether it answers is the card's
                business, and it says which of the two happened. The shell is
                told either way, so fixing a wrong address here moves the app
                off the connect surface instead of waiting for a restart. */}
            <ConnectionCard
              onServerChanged={() => { load(); onConnectionChanged?.(); }}
              onConnected={() => { load(); onConnectionChanged?.(); }}
            />
          </section>

          <section className="settings-section">
            <h2>Providers</h2>
            <div className="settings-card">
              {providers.length === 0 && <div className="empty">No providers reported by the engine.</div>}
              {/* Ready providers first, always shown -- these are the ones a free
                  tier already answers with, so they are what "Providers" is
                  mostly for. The rest used to be the same number of rows, each
                  reading "no key set" in warning yellow, which looked like N
                  problems rather than N providers nobody has asked to set up. */}
              {providers.filter((p: any) => p.configured).map(providerRow)}
              {providers.some((p: any) => !p.configured) && (
                <details className="provider-more">
                  <summary>
                    {providers.filter((p: any) => !p.configured).length} more — add a key
                  </summary>
                  {providers.filter((p: any) => !p.configured).map(providerRow)}
                </details>
              )}
            </div>
          </section>

          <section className="settings-section">
            <h2>Limits the engine enforces</h2>
            <div className="settings-card">
              {limits?.retries && (
                <div className="setting-row">
                  <span className="setting-label">How long a rate-limited model is retried</span>
                  <span className="setting-value">
                    {Math.round(limits.retries.budgetMs / 1000)}s in total, {limits.retries.maxAttempts} attempt
                    {limits.retries.maxAttempts === 1 ? '' : 's'}, {Math.round((limits.retries.baseDelayMs || 0) / 1000 * 10) / 10}s apart
                  </span>
                </div>
              )}
              {limits?.timeouts && (
                <div className="setting-row">
                  <span className="setting-label">Chat timeout</span>
                  <span className="setting-value">{Math.round(limits.timeouts.chat / 1000)}s</span>
                </div>
              )}
              <Hint summary="A rate-limited model is retried, then handed off.">
                A rate-limited service is retried only as long as the turn is worth waiting for; after that the engine hands
                the same question to the next model instead of leaving you with nothing. This is why a rate limit never ends a
                turn here, and it is a setting rather than a warning: nothing is wrong with your chat.
              </Hint>
            </div>
          </section>

          <section className="settings-section">
            <h2>Memory the model saved</h2>
            <div className="settings-card">
              {memory.length === 0 && <div className="empty">Nothing saved yet.</div>}
              {memory.map((f: any) => (
                <div key={f.id} className="provider-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span className="setting-label">{f.text || f.fact || f.name || f.id}</span>
                  <button onClick={() => forget(f.id)}>Forget</button>
                </div>
              ))}
            </div>
          </section>

          <ConnectorsCard />

          {/* C10: the credential broker's saved hosts and addresses. */}
          <CredentialsCard />

          <section className="settings-section">
            <h2>Appearance</h2>
            <AppearanceCard />
          </section>

          <section className="settings-section">
            <h2>Shortcuts</h2>
            <ShortcutsCard />
          </section>

          <LocalModelsCard />

          <DictationCard />

          {/* The engine's own shell, kept but demoted. It only works when the
              server sets WORKSPACE_RUN=1 and the account is signed in, which is
              why it is not a sidebar row any more: the local folder and the
              local terminal answer for the app's own machine. */}
          <StartupCard />

          <DesktopControlCard />

          <DoctorCard engineHealthy={engineHealthy} />

          <section className="settings-section">
            <h2>Advanced</h2>
            <div className="settings-card">
              <details className="engine-shell">
                <summary>Engine shell (needs WORKSPACE_RUN=1 on the server)</summary>
                <p className="settings-hint">
                  Commands and files on the FreeAI4U server, in the engine's own workspace — not on
                  this machine. The <strong>Folder</strong> and <strong>Terminal</strong> panels in
                  the sidebar are the local ones.
                </p>
                <div className="engine-shell-body">
                  <FileTree />
                  <Terminal />
                </div>
              </details>
            </div>
          </section>

          <DiagnosticsCard state={diagnosticsState} />
        </section>
      </div>
    </div>
  );
}
