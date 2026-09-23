// Activity (docs/MASTER_PLAN.md section 4): everything that is running or
// waiting, in one place -- the APK's Activity space. The approval queue
// first, because it is the one thing that needs a person; then what is
// running on this machine, the schedules, and the chats that are streaming.
// Nothing here is a new store: each card reads the module that already owns
// its facts (recipes.js, threads.js, the shell's status commands).
import { useEffect, useState } from 'react';
import Icon from '../components/Icon';
import { engineStatus, hasShell, localModelStatus, type EngineStatus, type LocalModelStatus } from '../bridge';
import type { ViewId } from '../Sidebar';
import '../recipes.js';
import '../threads.js';

const recipesLib: typeof import('../recipes.js') = (globalThis as any).FreeAI4URecipes;
const threadsLib: typeof import('../threads.js') = (globalThis as any).FreeAI4UThreads;

type Props = { onOpen: (view: ViewId) => void };

function useBusyChats(): string[] {
  const [busy, setBusy] = useState<string[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      setBusy((prev) => (d.busy ? Array.from(new Set([...prev, String(d.id)])) : prev.filter((id) => id !== String(d.id))));
    };
    window.addEventListener(threadsLib.ACTIVITY_EVENT, on);
    return () => window.removeEventListener(threadsLib.ACTIVITY_EVENT, on);
  }, []);
  return busy;
}

function useShellStatus() {
  const [model, setModel] = useState<LocalModelStatus | null>(null);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  useEffect(() => {
    if (!hasShell()) return;
    let alive = true;
    const tick = () => {
      localModelStatus().then((s) => { if (alive) setModel(s); }).catch(() => {});
      engineStatus().then((s) => { if (alive) setEngine(s); }).catch(() => {});
    };
    tick();
    const timer = window.setInterval(tick, 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  return { model, engine };
}

export default function ActivityScreen({ onOpen }: Props) {
  const [pending, setPending] = useState(() => recipesLib.approvals.pending());
  useEffect(() => recipesLib.approvals.subscribe(setPending), []);
  const busy = useBusyChats();
  const { model, engine } = useShellStatus();
  const [recipes] = useState(() => recipesLib.list().filter((r) => r.schedule && r.schedule.enabled !== false));
  const runs = recipesLib.lastRuns();
  const now = Date.now();

  return (
    <div className="screen activity">
      <header className="screen-header">
        <h1>Activity</h1>
        <div className="header-actions">
          <button type="button" onClick={() => onOpen('evals')}>Evals</button>
          <button type="button" onClick={() => onOpen('build')}>Builds</button>
        </div>
      </header>

      <section className="activity-section">
        <h2>
          <Icon name="check" size={14} /> Waiting for you
          {pending.length > 0 && <span className="sidebar-badge">{pending.length}</span>}
        </h2>
        {pending.length === 0 ? (
          <p className="settings-hint">Nothing needs an answer. Build approvals show under Chat → Builds while a build runs.</p>
        ) : pending.map((p) => (
          <div key={p.id} className="approval-card">
            <div className="approval-title">{p.recipeName}: {p.tool}</div>
            {p.summary && <div className="approval-summary">{p.summary}</div>}
            <div className="approval-actions">
              <button type="button" className="primary" onClick={() => recipesLib.approvals.answer(p.id, 'once')}>Allow once</button>
              <button type="button" onClick={() => recipesLib.approvals.answer(p.id, 'deny')}>Deny</button>
              <button type="button" onClick={() => recipesLib.approvals.answer(p.id, 'always')}>Always for this recipe</button>
            </div>
          </div>
        ))}
      </section>

      <section className="activity-section">
        <h2><Icon name="activity" size={14} /> Running now</h2>
        <ul className="activity-list">
          <li>
            <span className={`dot ${busy.length ? 'on' : ''}`} />
            {busy.length ? `${busy.length} chat${busy.length > 1 ? 's' : ''} streaming` : 'No chat is streaming'}
            {busy.length > 0 && <button type="button" className="link-button" onClick={() => onOpen('chat')}>Open</button>}
          </li>
          {hasShell() && (
            <>
              <li>
                <span className={`dot ${model && model.state !== 'stopped' ? 'on' : ''}`} />
                {model && model.state !== 'stopped'
                  ? `Local model ${model.state}: ${model.file || model.repo}${model.port ? ` on 127.0.0.1:${model.port}` : ''}`
                  : 'No local model server running'}
                <button type="button" className="link-button" onClick={() => onOpen('settings')}>Local models</button>
              </li>
              <li>
                <span className={`dot ${engine?.running ? 'on' : ''}`} />
                {engine?.running ? `Engine on this machine at ${engine.url || `127.0.0.1:${engine.port}`}` : 'Engine on this machine is not running'}
              </li>
            </>
          )}
        </ul>
      </section>

      <section className="activity-section">
        <h2><Icon name="history" size={14} /> Scheduled</h2>
        {recipes.length === 0 ? (
          <p className="settings-hint">No recipe has a schedule. Add one under Agents → Recipes.</p>
        ) : (
          <ul className="activity-list">
            {recipes.map((r) => {
              const next = recipesLib.nextRun(r, runs[r.id]?.at, now);
              return (
                <li key={r.id}>
                  <span className="dot" />
                  <strong>{r.name}</strong> · {recipesLib.scheduleLabel(r)}
                  {next ? ` · next ${new Date(next).toLocaleString()}` : ''}
                </li>
              );
            })}
          </ul>
        )}
        <button type="button" className="link-button" onClick={() => onOpen('recipes')}>All recipes</button>
      </section>
    </div>
  );
}
