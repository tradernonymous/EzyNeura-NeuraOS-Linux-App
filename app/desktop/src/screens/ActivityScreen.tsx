// Activity (docs/MASTER_PLAN.md section 4): everything that is running or
// waiting, in one place -- the APK's Activity space. The approval queue
// first, because it is the one thing that needs a person; then what is
// running on this machine, the schedules, and the chats that are streaming.
// Nothing here is a new store: each card reads the module that already owns
// its facts (recipes.js, threads.js, the shell's status commands).
import { useEffect, useState } from 'react';
import Icon from '../components/Icon';
import { engineStatus, hasShell, localModelStatus, runLocal, writeLocalFile, type EngineStatus, type LocalModelStatus } from '../bridge';
import { pushToast } from '../components/Toasts';
import type { ViewId } from '../Sidebar';
import '../recipes.js';
import '../threads.js';
import '../chats.js';
import '../runs.js';
import '../audit.js';
// C11: the read-only preset's folder list (with its way off).
import '../approval.js';
// C7: the local traces — model and tool calls, one line each.
import '../traces.js';
// C2: the changed files a run left, for its evidence folder.
import '../turn.js';
import { OPEN_CHAT_EVENT } from './ChatScreen';

const runsLib: typeof import('../runs.js') = (globalThis as any).FreeAI4URuns;
const chatsLib: typeof import('../chats.js') = (globalThis as any).FreeAI4UChats;
const LAYOUT_KEY = 'freeai4u.runs.layout';

const recipesLib: typeof import('../recipes.js') = (globalThis as any).FreeAI4URecipes;
const auditLib: typeof import('../audit.js') = (globalThis as any).FreeAI4UAudit;
const approvalLib: typeof import('../approval.js') = (globalThis as any).FreeAI4UApproval;
const tracesLib: typeof import('../traces.js') = (globalThis as any).FreeAI4UTraces;
const turnLib: typeof import('../turn.js') = (globalThis as any).FreeAI4UTurn;

// The folder the local surfaces work in (App.tsx owns it; this screen only
// reads it — evidence has to land in a real folder).
const LOCAL_ROOT_KEY = 'freeai4u.localRoot';
const ARTIFACTS_KEY = 'freeai4u.runs.artifacts';

function readLocalRoot(): string {
  try {
    return localStorage.getItem(LOCAL_ROOT_KEY) || '';
  } catch {
    return '';
  }
}

// POSIX-quote a path for the one shell line that opens the evidence folder.
function shellQuote(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}
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
  // C11: turning a folder's read-only preset off has to redraw the list.
  const [, setPresetAt] = useState(0);
  // C7: the same for clearing the traces.
  const [, setTraceAt] = useState(0);
  const busy = useBusyChats();
  const { model, engine } = useShellStatus();
  const [recipes] = useState(() => recipesLib.list().filter((r) => r.schedule && r.schedule.enabled !== false));
  const runs = recipesLib.lastRuns();
  const now = Date.now();
  // List or board (the vibe-kanban idea): the choice is remembered.
  const [layout, setLayout] = useState<'list' | 'board'>(() => { try { return localStorage.getItem(LAYOUT_KEY) === 'board' ? 'board' : 'list'; } catch { return 'list'; } });
  const pickLayout = (next: 'list' | 'board') => { setLayout(next); try { localStorage.setItem(LAYOUT_KEY, next); } catch { /* this session has it */ } };
  const [allRecipes] = useState(() => recipesLib.list());
  const sessions = chatsLib.readStore() as any[];
  // The last answer a run produced — its report, the thing a contract is
  // ticked against and the evidence folder keeps.
  const reportOf = (chat: any): string => {
    const msgs = Array.isArray(chat?.messages) ? chat.messages : [];
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const m = msgs[i];
      if (m && m.role === 'assistant' && !m.note && !m.error && typeof m.content === 'string' && m.content.trim()) return m.content;
    }
    return '';
  };
  // C1/C3: what each recipe demanded, and what its last run produced —
  // the report itself plus an approximate spend (characters/4: not every
  // provider reports usage, so the card says ≈).
  const contracts: Record<string, string[]> = {};
  const budgets: Record<string, number> = {};
  const reports: Record<string, string> = {};
  const spend: Record<string, number> = {};
  {
    const byId = new Map<string, any>(sessions.map((s) => [s.id, s]));
    (allRecipes as any[]).forEach((r) => {
      if (Array.isArray(r.contract) && r.contract.length) contracts[r.id] = r.contract;
      if (Number(r.budget) > 0) budgets[r.id] = Number(r.budget);
    });
    Object.keys(runs).forEach((id) => {
      const entry = runs[id] || {};
      const chat = entry.chatId ? byId.get(entry.chatId) : null;
      if (!chat) return;
      const report = reportOf(chat);
      if (report) reports[id] = report;
      const msgs = Array.isArray(chat.messages) ? chat.messages : [];
      const chars = msgs.reduce((n: number, m: any) => n + (m && typeof m.content === 'string' ? m.content.length : 0), 0);
      spend[id] = Math.ceil(chars / 4);
    });
  }
  // C2: the folder each card's evidence was saved in (kept on this machine
  // so the link still works after a restart).
  const [artifacts, setArtifacts] = useState<Record<string, string>>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(ARTIFACTS_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  });
  const [savingEvidence, setSavingEvidence] = useState<Record<string, string>>({});

  const saveEvidence = async (card: import('../runs.js').RunCard) => {
    const root = readLocalRoot();
    if (!root) {
      pushToast('warn', 'Open a folder first — a run keeps its evidence in .neuraos/runs of the open folder.');
      return;
    }
    const entry = card.recipeId ? runs[card.recipeId] : null;
    const chat = entry && entry.chatId ? sessions.find((s) => s.id === entry.chatId) : null;
    setSavingEvidence((s) => ({ ...s, [card.id]: 'working' }));
    try {
      const since = Number(entry && entry.at) || card.at;
      const plan = runsLib.artifactPlan({
        recipeName: card.title,
        at: since,
        ok: card.ok !== false,
        chatId: entry && entry.chatId ? entry.chatId : undefined,
        report: reportOf(chat),
        contract: contracts[card.recipeId || ''],
        changes: turnLib.changesOf(Array.isArray(chat?.messages) ? chat.messages : []),
        // C7's lines inside this run's window, oldest first in the file.
        traces: tracesLib.recent(500).filter((t) => t.at >= since && t.at <= Date.now()).slice().reverse(),
        error: entry && entry.error ? entry.error : undefined,
      });
      for (const f of plan.files) await writeLocalFile(root, `${plan.dir}/${f.path}`, f.text);
      const next = { ...artifacts, [card.id]: plan.dir };
      setArtifacts(next);
      try { localStorage.setItem(ARTIFACTS_KEY, JSON.stringify(next)); } catch { /* the folder is written either way */ }
      pushToast('ok', `Evidence saved in ${plan.dir}`);
    } catch (err) {
      pushToast('error', `Could not save the evidence: ${((err as Error).message || String(err)).split('\n')[0]}`);
    } finally {
      setSavingEvidence((s) => { const n = { ...s }; delete n[card.id]; return n; });
    }
  };

  const showEvidence = async (card: import('../runs.js').RunCard) => {
    const dir = artifacts[card.id];
    if (!dir) return;
    try {
      await runLocal({ root: readLocalRoot(), runId: 'runs-evidence-open', command: `xdg-open ${shellQuote(dir)}` });
    } catch {
      pushToast('info', `The evidence is in ${dir} of the open folder.`);
    }
  };

  const columns = runsLib.board({
    pending, busy, sessions, recipes: allRecipes, runs,
    contracts, reports, budgets, spend,
    nextRun: recipesLib.nextRun, scheduleLabel: recipesLib.scheduleLabel, now,
  });
  const openCard = (card: import('../runs.js').RunCard) => {
    if (card.chatId) { onOpen('chat'); window.dispatchEvent(new CustomEvent(OPEN_CHAT_EVENT, { detail: card.chatId })); return; }
    if (card.kind === 'approval') return;
    onOpen('recipes');
  };

  return (
    <div className="screen activity">
      <header className="screen-header">
        <h1>Runs</h1>
        <div className="header-actions">
          <div className="sidebar-filters runs-layout" role="tablist" aria-label="Layout">
            <button type="button" role="tab" aria-selected={layout === 'list'} className={`sidebar-filter ${layout === 'list' ? 'active' : ''}`} onClick={() => pickLayout('list')}>List</button>
            <button type="button" role="tab" aria-selected={layout === 'board'} className={`sidebar-filter ${layout === 'board' ? 'active' : ''}`} onClick={() => pickLayout('board')}>Board</button>
          </div>
          <button type="button" className="raised" onClick={() => onOpen('evals')}>Evals</button>
          <button type="button" className="raised" onClick={() => onOpen('build')}>Builds</button>
        </div>
      </header>

      {layout === 'board' && (
        <div className="runs-board" aria-label="Runs board">
          {columns.map((col) => (
            <section key={col.id} className={`runs-col runs-col-${col.id}`}>
              <h3>{col.label} <span className="runs-count">{col.cards.length}</span></h3>
              <p className="runs-hint">{col.hint}</p>
              {col.cards.length === 0 && <div className="runs-empty">—</div>}
              {col.cards.map((card) => (
                <div key={card.id} className={`runs-card kind-${card.kind} ${card.kind === 'run' ? (card.ok ? 'is-ok' : 'is-failed') : ''}`}>
                  <button type="button" className="runs-card-open" onClick={() => openCard(card)} title={card.meta}>
                    <span className={`thread-dot ${col.id === 'running' ? 'thread-dot-running' : col.id === 'review' ? 'thread-dot-needs-you' : ''}`} aria-hidden="true" />
                    <span className="runs-card-title">{card.title}</span>
                    <span className="runs-card-meta">{card.meta}</span>
                  </button>
                  {card.contract && (
                    <ul className="runs-contract" aria-label="Output contract">
                      {card.contract.items.map((item, i) => (
                        <li key={i} className={`runs-tick ${item.ok ? 'is-ok' : 'is-missing'}`}>
                          <span aria-hidden="true">{item.ok ? '✓' : '·'}</span>
                          <span>{item.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {card.budget && card.budget.level !== 'none' && (
                    <div
                      className={`runs-budget is-${card.budget.level}`}
                      title="An estimate: characters/4 of the run's chat, against the recipe's budget"
                    >
                      {card.budget.label}
                      {card.budget.level === 'near' && ' — near the limit'}
                      {card.budget.level === 'over' && ' — over the budget'}
                    </div>
                  )}
                  {card.kind === 'run' && (
                    <div className="runs-card-actions">
                      {artifacts[card.id] ? (
                        <button
                          type="button"
                          onClick={() => void showEvidence(card)}
                          title={`${artifacts[card.id]} in the open folder — click to open the folder`}
                        >
                          Evidence
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={savingEvidence[card.id] === 'working'}
                          onClick={() => void saveEvidence(card)}
                        >
                          {savingEvidence[card.id] === 'working' ? 'Saving…' : 'Save evidence'}
                        </button>
                      )}
                    </div>
                  )}
                  {card.kind === 'approval' && card.approvalId && (
                    <div className="runs-card-actions">
                      <button type="button" className="primary" onClick={() => recipesLib.approvals.answer(card.approvalId!, 'once')}>Allow</button>
                      <button type="button" onClick={() => recipesLib.approvals.answer(card.approvalId!, 'deny')}>Deny</button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
      {layout === 'list' && (<>

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

      {/* C12: the approval audit — in the app's own store, where the
          model's file and shell tools do not reach. Decisions and the
          card's summary only: never the raw arguments, which can hold a
          secret. */}
      <section className="activity-section">
        <h2><Icon name="shield" size={14} /> Approvals</h2>
        {(() => {
          const rows = auditLib.recent(undefined, 20);
          if (!rows.length) {
            return <p className="settings-hint">Nothing has asked yet. Every Allow, Deny, edit and “always” is recorded here as it happens.</p>;
          }
          return (
            <ul className="activity-list audit-list">
              {rows.map((e, i) => (
                <li key={`${e.at}-${i}`} className="audit-row">
                  <span className={`audit-decision is-${e.decision}`}>{auditLib.wordFor(e.decision)}</span>
                  <strong>{e.tool}</strong>
                  <span className="audit-summary">{e.summary}</span>
                  <span className="audit-when">{new Date(e.at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          );
        })()}
        <p className="settings-hint">Decisions and summaries only — never the arguments themselves, which can carry secrets. The log lives where the model's tools do not reach.</p>
        {/* C11: where the read-only preset is on — because "once per project"
            implies the person can take it back, in the same place the
            decisions are already listed. */}
        {(() => {
          const folders = approvalLib.presetProjects();
          if (!folders.length) return null;
          return (
            <div className="audit-readonly">
              <p className="settings-hint">Known read-only commands (ls, git status, docker ps, …) run without asking in:</p>
              <ul className="activity-list audit-list">
                {folders.map((folder) => (
                  <li key={folder} className="audit-row">
                    <span className="audit-decision is-project">read-only</span>
                    <span className="audit-summary">{folder}</span>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => { approvalLib.revokePreset(folder); setPresetAt((n) => n + 1); }}
                    >
                      Turn off
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}
      </section>

      {/* C7: local traces — one line per model call and tool call, kept in
          this app's own store and read by nothing else. Timing, size and
          outcome only: the prompt, the arguments and the result are not in
          any line, so there is nothing here to leak or to send. */}
      <section className="activity-section">
        <h2><Icon name="activity" size={14} /> Traces</h2>
        {(() => {
          const rows = tracesLib.recent(30);
          if (!rows.length) {
            return <p className="settings-hint">Nothing traced yet. Every model call and tool call in a chat writes one line here — on this machine only, never sent anywhere.</p>;
          }
          return (
            <ul className="activity-list trace-list">
              {rows.map((r, i) => (
                <li key={`${r.at}-${i}`} className="trace-row mono">
                  <span className="trace-when">{new Date(r.at).toLocaleTimeString()}</span>
                  <span className={`trace-kind is-${r.kind}`}>{r.kind === 'model' ? 'model' : 'tool'}</span>
                  <span className="trace-what">
                    {r.kind === 'model'
                      ? [r.provider, r.model].filter(Boolean).join(' · ') + (r.agent ? ` (${r.agent})` : '') + (r.error ? ` — ${r.error}` : '')
                      : `${(r as import('../traces.js').TraceTool).name} · ${(r as import('../traces.js').TraceTool).status}${r.agent ? ` (${r.agent})` : ''}`}
                  </span>
                  <span className="trace-meta">{r.ms}ms{r.kind === 'model' ? ` · ${r.chars} chars` : ''}</span>
                </li>
              ))}
            </ul>
          );
        })()}
        <p className="settings-hint">
          One line per call — when, which, how long, whether it worked. Never the prompt, the arguments or the result.
          {' '}<button type="button" className="link-button" onClick={() => { tracesLib.clear(); setTraceAt((n) => n + 1); }}>Clear traces</button>
        </p>
      </section>
      </>)}
    </div>
  );
}
