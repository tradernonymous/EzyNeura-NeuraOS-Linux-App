import { useState, useEffect, useRef, useCallback } from 'react';
import { api, streamChat, streamLocalChat, type StreamFrame } from '../api';
import { escapeHtml } from '../markdown';
import Icon from '../components/Icon';
import SelectPill from '../components/SelectPill';
import { isSavedProvider, streamSaved } from '../run-model';
import type { EffectiveConfig, GlobalSettings } from '../project-config';
import '../saved-models.js';
import { hasShell, pickFolder, listLocalDir, readLocalFile, writeLocalFile, editLocalFile, runLocal } from '../bridge';
// UMD modules: loaded for their side effect, read off globalThis.
import '../coding-agent.js';
import '../hf-auth.js';
import '../chats.js';
import '../docker-sandbox.js';
// Loaded before the agent ever runs: the agent reads the folder's rules off the
// global, and without them it approval-gates every mutation.
import '../project-config.js';
// NEURA-056: the agent reads the folder's map off the global for the same
// reason, and this screen owns the open folder, so it is the one that can
// answer the Rebuild button in Agents.
import '../project-scout.js';
import '../tasks.js';
import '../shell.js';
import TaskDecks from '../components/TaskDecks';
import { NAVIGATE_EVENT } from '../Sidebar';

const tasksLib: typeof import('../tasks.js') = (globalThis as any).FreeAI4UTasks;
const shellLib: typeof import('../shell.js') = (globalThis as any).FreeAI4UShell;

const agent: typeof import('../coding-agent.js') = (globalThis as any).FreeAI4UCodingAgent;
const scout: typeof import('../project-scout.js') = (globalThis as any).FreeAI4UProjectScout;
const projectConfig: typeof import('../project-config.js') = (globalThis as any).FreeAI4UProjectConfig;
const dockerSandbox: typeof import('../docker-sandbox.js') = (globalThis as any).FreeAI4UDockerSandbox;
const chats: typeof import('../chats.js') = (globalThis as any).FreeAI4UChats;

// ---- diff rendering (escape-safe, same pattern as BuildScreen) -----------

function diffHtml(preview: string): string {
  const lines = String(preview || '').split('\n');
  return lines.map((line) => {
    const safe = escapeHtml(line) || '&nbsp;';
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@'))
      return `<span class="diff-hunk">${safe}</span>`;
    if (line.startsWith('+')) return `<span class="diff-add">${safe}</span>`;
    if (line.startsWith('-')) return `<span class="diff-del">${safe}</span>`;
    return `<span class="diff-ctx">${safe}</span>`;
  }).join('\n');
}

// ---- status styling ------------------------------------------------------

const STEP_STATUS: Record<string, string> = {
  running: 'running',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped',
};

interface Step {
  id: number;
  title: string;
  status: string;
  tool: string;
  args: Record<string, unknown>;
  result: string | null;
  diff: string | null;
}

interface Approval {
  id: string;
  stepId: number;
  tool: string;
  args: Record<string, unknown>;
  diff: string | null;
  command: string | null;
}

// ---- the screen ----------------------------------------------------------

/**
 * A request handed over from another screen (Design's "Handoff to Code"),
 * read once on mount -- the same pattern as Chat -> Design's DESIGN_BRIEF_KEY.
 */
export const CODE_HANDOFF_KEY = 'freeai4u.codeHandoff';

/**
 * The person's own coding-agent settings: the ceiling a project's
 * `.freeai4u.json` can never rise above. There is no screen for these yet, so
 * what almost everyone has is the default -- ask about every mutation, allow no
 * command without asking -- and a project file can only keep it there or make
 * it stricter.
 */
export const CODE_APPROVAL_KEY = 'freeai4u.code_approval';

function myApprovalSettings(): GlobalSettings {
  try {
    const raw = localStorage.getItem(CODE_APPROVAL_KEY);
    return projectConfig.globalSettings(raw ? JSON.parse(raw) : null);
  } catch {
    // Unreadable or nonsense: the default is the strict one, so falling back
    // to it can only ask more often.
    return projectConfig.globalSettings(null);
  }
}

export default function CodeScreen({ localRoot }: { localRoot: string }) {
  const [request, setRequest] = useState('');
  useEffect(() => {
    try {
      const handed = sessionStorage.getItem(CODE_HANDOFF_KEY);
      if (handed) { sessionStorage.removeItem(CODE_HANDOFF_KEY); setRequest(handed); }
    } catch { /* nothing handed over */ }
  }, []);
  const [steps, setSteps] = useState<Step[]>([]);
  // The toolbar's project chip: the folder's name and its git branch, read
  // from .git/HEAD (readable, never written). The project's own tasks come
  // from .neuraos/commands/*.md, the Zed / Warp pattern.
  const [branch, setBranch] = useState('');
  const [customTasks, setCustomTasks] = useState<import('../tasks.js').Task[]>([]);
  const requestRef = useRef<HTMLTextAreaElement | null>(null);
  const [slashCursor, setSlashCursor] = useState(0);
  const loadCustom = useCallback(() => {
    if (!localRoot || !hasShell()) { setCustomTasks([]); return; }
    listLocalDir(localRoot, tasksLib.DIR)
      .then(async (listing) => {
        const files = listing.entries.filter((e: any) => !e.dir && /\.md$/i.test(e.name)).slice(0, 40);
        const rows = await Promise.all(files.map(async (e: any) => {
          try { const f = await readLocalFile(localRoot, `${tasksLib.DIR}/${e.name}`); return tasksLib.parseCustom(e.name, f.text || ''); } catch { return null; }
        }));
        setCustomTasks(rows.filter(Boolean) as import('../tasks.js').Task[]);
      })
      .catch(() => setCustomTasks([]));
  }, [localRoot]);
  useEffect(() => {
    if (!localRoot || !hasShell()) { setBranch(''); setCustomTasks([]); return; }
    readLocalFile(localRoot, '.git/HEAD')
      .then((f) => { const m = /ref: refs\/heads\/(.+)/.exec(f.text || ''); setBranch(m ? m[1].trim() : (f.text || '').trim().slice(0, 7)); })
      .catch(() => setBranch(''));
    loadCustom();
  }, [localRoot, loadCustom]);
  // A template lands in the box with its first {{blank}} selected, so typing
  // replaces it: the Freebuff "fill in the blanks" feel without a form.
  const fillRequest = (template: string) => {
    setRequest(template);
    requestAnimationFrame(() => {
      const box = requestRef.current;
      const at = tasksLib.firstBlank(template);
      if (!box) return;
      box.focus();
      if (at) box.setSelectionRange(at.start, at.end);
    });
  };
  const saveTask = async (label: string, template: string) => {
    const file = tasksLib.customFile(label, template);
    await writeLocalFile(localRoot, file.path, file.text);
    loadCustom();
  };
  const slashRows = tasksLib.isSlash(request) ? tasksLib.slashRows(request, customTasks) : [];
  // The native picker, then the shell is told: the folder becomes the working
  // folder for every local surface, not only this screen.
  const openAnother = () => {
    if (!hasShell()) return;
    pickFolder().then((p) => { if (p) window.dispatchEvent(new CustomEvent('freeai4u:open-project', { detail: { project: p } })); }).catch(() => {});
  };
  const [approval, setApproval] = useState<Approval | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [model, setModel] = useState('');
  const [provider, setProvider] = useState('');
  // The agent never had a way to be given a model, so it never had one. The
  // list is "my models" first, then the engine's first ready provider.
  const [modelChoices, setModelChoices] = useState<Array<{ provider: string; model: string; label: string }>>([]);
  useEffect(() => {
    const saved = (globalThis as any).FreeAI4USavedModels as typeof import('../saved-models.js');
    const mine = saved.list().map((m) => ({
      provider: saved.PROVIDERS[m.kind].id,
      model: m.name,
      label: `${saved.PROVIDERS[m.kind].label} \u00b7 ${m.name}`,
    }));
    setModelChoices(mine);
    if (mine.length) { setProvider(mine[0].provider); setModel(mine[0].model); }
    api.providers()
      .then((rows: any) => {
        const ready = (Array.isArray(rows) ? rows : []).find((p: any) => p.kind !== 'image' && p.configured);
        if (!ready) return null;
        return api.models(ready.id).then((list: any) => {
          const engine = (Array.isArray(list) ? list : []).slice(0, 12).map((r: any) => ({
            provider: String(ready.id),
            model: String(r.id || r),
            label: `${ready.label} \u00b7 ${String(r.id || r)}`,
          }));
          setModelChoices([...mine, ...engine]);
          if (!mine.length && engine.length) { setProvider(engine[0].provider); setModel(engine[0].model); }
        });
      })
      .catch(() => { /* no engine: my models are still there */ });
  }, []);
  const [rejectReason, setRejectReason] = useState('');
  // Opt-in Docker sandbox for run_command (docker-sandbox.js); ParallelScreen reads the same setting.
  const [docker, setDocker] = useState(() => dockerSandbox.settings());
  const updateDocker = (next: import('../docker-sandbox.js').DockerSettings) => {
    setDocker(next);
    dockerSandbox.saveSettings(next);
  };

  // The opened folder's own .freeai4u.json, re-read whenever the folder changes.
  // Absent or unreadable leaves `configRef` null, which is exactly today's
  // behaviour: the agent asks before every mutation.
  const configRef = useRef<EffectiveConfig | null>(null);
  const [overrides, setOverrides] = useState<string[]>([]);
  const [configProblems, setConfigProblems] = useState<string[]>([]);
  useEffect(() => {
    configRef.current = null;
    setOverrides([]);
    setConfigProblems([]);
    if (!localRoot || !hasShell()) return;
    let live = true;
    const mine = myApprovalSettings();
    projectConfig.read((path) => readLocalFile(localRoot, path), mine)
      .then((loaded) => {
        if (!live) return;
        configRef.current = loaded.effective;
        setConfigProblems(loaded.problems);
        setOverrides(loaded.present ? projectConfig.describe(loaded.effective, mine) : []);
        // A model is a preference, not a permission, so the project's choice
        // stands; everything else was already narrowed by the merge.
        if (loaded.effective.model) {
          setProvider(loaded.effective.model.provider);
          setModel(loaded.effective.model.model);
        }
      })
      .catch(() => { /* no readable file: the folder has no say, which is the default */ });
    return () => { live = false; };
  }, [localRoot]);

  // ---- the project index (NEURA-056) ------------------------------------
  // What the agent's own indexing is doing, in one line under the request bar:
  // building, built, or the reason it could not be.
  const [indexNote, setIndexNote] = useState('');
  // Agents' Rebuild button dispatches REBUILD_EVENT; only the screen holding
  // the open folder can answer it, because only it has a root and a bridge.
  const rebuildingRef = useRef(false);
  useEffect(() => {
    const onRebuild = () => {
      if (rebuildingRef.current) return;
      if (!localRoot || !hasShell()) {
        setIndexNote('Open a folder before rebuilding the project index.');
        return;
      }
      rebuildingRef.current = true;
      setIndexNote('Building the project index…');
      scout.buildIndex(localRoot, {
        listFiles: (path: string) => listLocalDir(localRoot, path || ''),
        readFile: (path: string) => readLocalFile(localRoot, path),
      })
        .then((index) => {
          // save() fires CHANGED_EVENT, which is what the Agents card listens for.
          scout.save(index);
          const state = scout.status(index);
          setIndexNote(`Project index: ${state.fileCount} files, ${state.symbolCount} symbols.`);
        })
        .catch((err: unknown) => {
          // A map that cannot be built is a missing convenience, never a broken
          // screen: the agent falls back to list_files and read_file.
          setIndexNote(`Could not build the project index: ${(err as Error)?.message || String(err)}`);
        })
        .finally(() => { rebuildingRef.current = false; });
    };
    window.addEventListener(scout.REBUILD_EVENT, onRebuild);
    return () => window.removeEventListener(scout.REBUILD_EVENT, onRebuild);
  }, [localRoot]);

  const listRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<any>(null);

  // Auto-scroll to latest step.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [steps.length]);

  // Build the agent callbacks from the existing bridge.
  const buildCallbacks = useCallback(() => {
    const root = localRoot;
    return {
      sendMessage: async (messages: Array<{ role: string; content: string }>, model: string, provider: string) => {
        // Use the local model if available, otherwise the engine.
        // The agent's model/provider are set at session start.
        return new Promise<string>((resolve, reject) => {
          let content = '';
          const onFrame = (frame: StreamFrame) => {
            if (frame.content) content += frame.content;
            if (frame.done) resolve(content);
          };
          // "My models" run on this PC; the stream ending is the answer ending
          // whether or not a `done` frame came.
          if (isSavedProvider(provider)) {
            streamSaved(provider, model, messages, onFrame).then(() => resolve(content)).catch(reject);
          } else if (provider === 'local') {
            streamLocalChat('http://127.0.0.1:8080', model, messages, onFrame)
              .then(() => resolve(content)).catch(reject);
          } else {
            streamChat(provider, { model, messages, stream: true }, onFrame)
              .then(() => resolve(content)).catch(reject);
          }
        });
      },
      listFiles: async (root: string, path: string) => {
        return listLocalDir(root, path);
      },
      readFile: async (root: string, path: string) => {
        return readLocalFile(root, path);
      },
      writeFile: async (root: string, path: string, content: string) => {
        return writeLocalFile(root, path, content);
      },
      editFile: async (root: string, path: string, oldText: string, newText: string) => {
        return editLocalFile({ root, path, oldText, newText });
      },
      runCmd: async (root: string, command: string, cwd?: string) => {
        // docker-sandbox.run is a straight call when the Docker setting is off.
        // A command the host shell would rewrite goes through a script file in .neuraos.
        const files = { write: (p: string, c: string) => writeLocalFile(root, p, c) };
        return dockerSandbox.run({ root, command, cwd, files }, (line, at, timeoutMs) =>
          runLocal({ root, runId: 'agent-' + Date.now(), command: line, cwd: at, timeoutMs: timeoutMs ?? 120_000 }));
      },
      onEvent: (event: any) => {
        // 'auto' is a mutation the folder's settings let through without an
        // approval card; it still gets a row, so nothing happens unseen.
        if (event.type === 'step' || event.type === 'auto') {
          setSteps(prev => {
            const idx = prev.findIndex(s => s.id === event.step?.id);
            if (idx >= 0) {
              const next = prev.slice();
              next[idx] = { ...next[idx], ...event.step };
              return next;
            }
            return [...prev, event.step];
          });
        }
        if (event.type === 'approval') {
          setApproval(event.approval);
          setStatus('awaiting');
        }
        if (event.type === 'status') {
          setStatus(event.status);
          if (event.message) setMessage(event.message);
        }
        if (event.type === 'error') {
          setError(event.error);
          setStatus('error');
        }
        // The agent's own indexing, so a first turn that pauses to map the
        // folder says what it is doing instead of just looking slow.
        if (event.type === 'index') {
          if (event.state === 'building') setIndexNote('Building the project index…');
          if (event.state === 'ready') {
            setIndexNote(`Project index: ${event.status?.fileCount ?? 0} files, ${event.status?.symbolCount ?? 0} symbols`
              + `${event.status?.state === 'stale' ? ' (stale)' : ''}.`);
          }
          if (event.state === 'failed') {
            setIndexNote(`No project index (${event.error}); the agent will list and read files as usual.`);
          }
        }
        if (event.type === 'round') {
          // Could show a round counter if desired.
        }
      },
      onDecision: (approvalId: string, resolve: (d: any) => void) => {
        // Store the resolver so the approve/reject buttons can call it.
        (window as any).__codeAgentResolve = resolve;
      },
    };
  }, [localRoot]);

  const startAgent = async () => {
    const text = request.trim();
    if (!text || !localRoot) return;
    setSteps([]);
    setApproval(null);
    setError('');
    setMessage('');
    setStatus('planning');

    const session = agent.createSession(localRoot, model, provider);
    session.config = configRef.current;
    session.plan = [{ id: 0, title: text, status: 'running', tool: 'user_request', args: {}, result: null, diff: null }];
    sessionRef.current = session;

    try {
      await agent.runAgent(session, buildCallbacks());
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
    }
  };

  const stopAgent = () => {
    if (sessionRef.current) {
      sessionRef.current.status = 'stopped';
      setStatus('stopped');
    }
  };

  const decide = (approved: boolean) => {
    const resolve = (window as any).__codeAgentResolve;
    if (resolve) {
      resolve({ approved, reason: approved ? undefined : rejectReason });
      (window as any).__codeAgentResolve = null;
      setApproval(null);
      setRejectReason('');
      setStatus('running');
    }
  };

  const canRun = hasShell() && localRoot && status !== 'running' && status !== 'planning' && status !== 'awaiting';

  return (
    <div className="screen code-screen">
      {/* One compact toolbar: where you are, who answers, and the switches.
          The Docker choice is a pressed button with its image in a title; the
          long explanation lives in Settings → Advanced. */}
      <div className="code-toolbar">
        {localRoot ? (
          <button type="button" className="raised code-project-chip" onClick={openAnother} title={`${localRoot}${branch ? ` · ${branch}` : ''} — click to open another folder`}>
            <Icon name="folder" size={13} />
            <span className="code-project-name">{localRoot.split(/[/\\]/).pop()}</span>
            {branch && <span className="code-project-branch">{branch}</span>}
          </button>
        ) : (
          <button className="raised" onClick={openAnother}>
            <Icon name="folder" size={13} /> Open a folder
          </button>
        )}
        <SelectPill
          label="Model"
          title="Model the coding agent uses"
          value={provider && model ? `${provider}|${model}` : ''}
          options={modelChoices.map((c) => ({ value: `${c.provider}|${c.model}`, label: c.label }))}
          onPick={(value) => { const [p, ...rest] = value.split('|'); setProvider(p || ''); setModel(rest.join('|')); }}
        />
        <span className="code-toolbar-gap" />
        <button type="button" className="raised icon-btn" title="Run the tests (fills the box)" aria-label="Run the tests" onClick={() => fillRequest(tasksLib.deckAt('test')?.tasks[0].template || '')}><Icon name="check" size={13} /></button>
        <button type="button" className="raised icon-btn" title="Review my changes (fills the box)" aria-label="Review my changes" onClick={() => fillRequest(tasksLib.deckAt('review')?.tasks[0].template || '')}><Icon name="search" size={13} /></button>
        <button type="button" className="raised icon-btn" title="Terminal — Ctrl+`" aria-label="Terminal" onClick={() => window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: { panel: 'terminal' } }))}><Icon name="terminal" size={13} /></button>
        <button type="button" className="raised icon-btn" title="Commit my changes (fills the box)" aria-label="Git" onClick={() => fillRequest(tasksLib.deckAt('git')?.tasks[0].template || '')}><Icon name="activity" size={13} /></button>
        <button
          type="button"
          className="raised icon-btn"
          aria-pressed={docker.enabled}
          onClick={() => updateDocker({ ...docker, enabled: !docker.enabled })}
          title={docker.enabled
            ? `Commands run in Docker (${docker.image || dockerSandbox.DEFAULT_IMAGE}), this folder mounted at /work — click to run them on this PC`
            : 'Run the agent\'s commands in a throwaway Docker container (needs Docker running) — click to turn on'}
          aria-label="Docker sandbox"
        >
          <Icon name="shield" size={13} />
        </button>
        {docker.enabled && (
          <input
            className="code-docker-image"
            value={docker.image}
            onChange={(e) => updateDocker({ ...docker, image: e.target.value })}
            placeholder={dockerSandbox.DEFAULT_IMAGE}
            spellCheck={false}
            aria-label="Docker image"
          />
        )}
      </div>

      <div className="code-layout">
        <div className="code-request">
          {slashRows.length > 0 && (
            <div className="deck code-slash" role="listbox" aria-label="Tasks">
              {slashRows.map((row, i) => (
                <button key={row.id} type="button" role="option" aria-selected={i === slashCursor} className={`task-row ${i === slashCursor ? 'is-active' : ''}`} onMouseDown={(e) => { e.preventDefault(); fillRequest(row.template); }} onMouseEnter={() => setSlashCursor(i)}>
                  <span className="task-row-deck">{row.deck}</span>
                  <span className="task-row-label">{row.label}</span>
                  <span className="task-row-hint">{row.hint}</span>
                </button>
              ))}
            </div>
          )}
          <div className="code-request-bar">
            <textarea
              ref={requestRef}
              value={request}
              rows={1}
              onChange={(e) => { setRequest(e.target.value); setSlashCursor(0); }}
              onKeyDown={(e) => {
                if (slashRows.length) {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setSlashCursor((c) => (c + 1) % slashRows.length); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setSlashCursor((c) => (c - 1 + slashRows.length) % slashRows.length); return; }
                  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); fillRequest(slashRows[Math.min(slashCursor, slashRows.length - 1)].template); return; }
                  if (e.key === 'Escape') { e.preventDefault(); setRequest(''); return; }
                }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); startAgent(); }
              }}
              placeholder={localRoot ? 'Describe what to change — / for tasks, Shift+Enter for a new line' : 'Open a folder first'}
              disabled={!canRun}
              aria-label="What to change"
            />
            {status === 'running' || status === 'planning' ? (
              <button className="danger" onClick={stopAgent}>
                <Icon name="close" size={13} /> Stop
              </button>
            ) : (
              <button className="primary" onClick={startAgent} disabled={!canRun || !request.trim()}>
                <Icon name="check" size={13} /> Run
              </button>
            )}
          </div>
          <TaskDecks custom={customTasks} onPick={fillRequest} draft={request} onSave={localRoot && hasShell() ? saveTask : undefined} />
        </div>

        {indexNote && (
          <div className="code-project-index">
            <span className="settings-hint">{indexNote}</span>
          </div>
        )}

        {(overrides.length > 0 || configProblems.length > 0) && (
          <div className="code-project-config" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {overrides.length > 0 && (
              <span className="settings-hint">
                This folder's {projectConfig.FILENAME} sets {overrides.join('; ')}.
              </span>
            )}
            {/* Quiet, never fatal, never silent: each line names a field that was
                ignored, and an ignored field means your own setting applies. */}
            {configProblems.map((problem, i) => (
              <span key={i} className="settings-hint">{problem}</span>
            ))}
          </div>
        )}

        {error && <div className="stream-error">{error}</div>}

        {approval && (
          <div className={`approval-card ${approval.command ? 'command' : ''}`}>
            <div className="approval-title">
              {approval.tool === 'run_command'
                ? `Run command: ${approval.command}`
                : `Approval needed: ${approval.tool}`}
            </div>
            {approval.diff && (
              <pre className="diff-view" dangerouslySetInnerHTML={{ __html: diffHtml(approval.diff) }} />
            )}
            {approval.tool === 'run_command' && typeof approval.args.cwd === 'string' && (
              <div className="approval-cwd">cwd: {approval.args.cwd}</div>
            )}
            {approval.tool === 'run_command' && docker.enabled && (
              <div className="approval-cwd">runs in Docker ({docker.image}), this folder mounted at /work</div>
            )}
            <div className="approval-actions">
              <button className="primary" onClick={() => decide(true)}>Approve</button>
              <input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason (optional)"
                className="approval-input"
                onKeyDown={(e) => { if (e.key === 'Enter') decide(false); }}
              />
              <button className="danger" onClick={() => decide(false)}>Reject</button>
            </div>
          </div>
        )}

        <div className="code-steps" ref={listRef}>
          {steps.map((step) => (
            <div
              key={step.id}
              className={`step ${STEP_STATUS[step.status] || ''}`}
            >
              <div className="step-indicator" />
              <div className="step-body">
                <div className="step-title">{step.title}</div>
                {step.diff && (
                  <pre
                    className="step-diff diff-view"
                    dangerouslySetInnerHTML={{ __html: diffHtml(step.diff) }}
                  />
                )}
                {step.result && (
                  <pre className="step-detail">{step.result}</pre>
                )}
              </div>
            </div>
          ))}
          {steps.length === 0 && status === 'idle' && (
            <div className="code-empty">
              <h2>{localRoot ? 'What should change?' : 'Open a project'}</h2>
              <p>
                {localRoot
                  ? 'Pick a task from a deck above, or type / for the list. The agent plans the edit, shows the diff, and waits for your OK before touching a file.'
                  : 'The agent works in one folder at a time: it plans the edit, shows the diff, and waits for your OK before touching a file.'}
              </p>
              <div className="code-empty-projects">
                {shellLib.readRecent().filter((p) => p !== localRoot).slice(0, 5).map((p) => (
                  <button key={p} type="button" className="raised" onClick={() => window.dispatchEvent(new CustomEvent('freeai4u:open-project', { detail: { project: p } }))} title={p}>
                    <Icon name="folder" size={12} /> {shellLib.projectName(p)}
                  </button>
                ))}
                {hasShell() && (
                  <button type="button" className="raised" onClick={openAnother}><Icon name="plus" size={12} /> Open a folder…</button>
                )}
              </div>
            </div>
          )}
          {steps.length === 0 && status !== 'idle' && (
            <div className="empty">Waiting for the agent to start…</div>
          )}
        </div>

        {message && status === 'done' && (
          <div className="code-summary">
            <strong>Done.</strong> {message}
          </div>
        )}
      </div>
    </div>
  );
}
