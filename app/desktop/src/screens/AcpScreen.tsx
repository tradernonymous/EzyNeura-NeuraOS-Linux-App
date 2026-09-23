// Code → Agents (ACP): run Gemini CLI, Claude Code, Codex or any Agent
// Client Protocol agent inside NeuraOS, in the open folder, with every file
// read, file write and permission request going through this screen
// (docs/MASTER_PLAN.md section 3 and L6). The shell (acp.rs) owns the
// process and the pipes and streams what the agent says as `acp-message`
// events; this screen renders the transcript and ANSWERS the agent's own
// requests -- a permission is a card with the agent's options, a file
// write is a card with the content, and a file read is served from the
// open folder and nowhere else.
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon';
import { pushToast } from '../components/Toasts';
import {
  acpCancel, acpPrompt, acpRespond, acpStart, acpStop, hasShell, notifyUser, notifyWithActions,
  onAcpMessage, onNotificationAction, readLocalFile, writeLocalFile, type AcpMessage, type AcpStarted,
} from '../bridge';

type Props = { localRoot: string | null };

/** The agents with a known ACP entry point; "custom" is any command. */
const PRESETS: Array<{ id: string; label: string; command: string; args: string[]; note: string }> = [
  { id: 'gemini', label: 'Gemini CLI', command: 'gemini', args: ['--experimental-acp'], note: 'npm i -g @google/gemini-cli' },
  { id: 'claude', label: 'Claude Code', command: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp'], note: 'needs the claude CLI signed in' },
  { id: 'codex', label: 'Codex', command: 'npx', args: ['-y', '@zed-industries/codex-acp'], note: 'needs an OpenAI sign-in' },
  { id: 'custom', label: 'Custom command', command: '', args: [], note: 'any ACP agent: command, then arguments' },
];

type Block =
  | { kind: 'user'; text: string }
  | { kind: 'agent'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'tool'; id: string; title: string; status: string; toolKind: string; detail: string }
  | { kind: 'plan'; entries: Array<{ content: string; status: string }> }
  | { kind: 'note'; text: string };

/** A request from the agent that a person (or the folder) must answer. */
type Ask =
  | { kind: 'permission'; requestId: number | string; title: string; detail: string; options: Array<{ optionId: string; name: string; optKind: string }> }
  | { kind: 'write'; requestId: number | string; path: string; content: string };

function textOf(content: any): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(textOf).join('');
  if (content.type === 'text') return String(content.text || '');
  if (content.type === 'content') return textOf(content.content);
  if (content.type === 'diff') return `${content.path}\n${content.newText ? String(content.newText).slice(0, 2000) : ''}`;
  return '';
}

/** `/home/me/proj/src/a.ts` inside `/home/me/proj` -> `src/a.ts`; null when outside. */
export function relativeTo(root: string, absolute: string): string | null {
  const base = root.replace(/[\\/]+$/, '');
  const norm = absolute.replace(/\\/g, '/');
  const baseNorm = base.replace(/\\/g, '/');
  if (norm === baseNorm) return '';
  if (!norm.startsWith(baseNorm + '/')) return null;
  const rel = norm.slice(baseNorm.length + 1);
  if (rel.split('/').some((p) => p === '..')) return null;
  return rel;
}

export default function AcpScreen({ localRoot }: Props) {
  const [preset, setPreset] = useState(PRESETS[0].id);
  const [command, setCommand] = useState(PRESETS[0].command);
  const [args, setArgs] = useState(PRESETS[0].args.join(' '));
  const [started, setStarted] = useState<AcpStarted | null>(null);
  const [busy, setBusy] = useState<'' | 'starting' | 'prompting'>('');
  const [prompt, setPrompt] = useState('');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [asks, setAsks] = useState<Ask[]>([]);
  const [stderr, setStderr] = useState<string[]>([]);
  const agentId = 'acp-main';
  const rootRef = useRef(localRoot);
  rootRef.current = localRoot;
  const startedRef = useRef(started);
  startedRef.current = started;
  const logRef = useRef<HTMLDivElement>(null);

  const choosePreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id) || PRESETS[0];
    setPreset(id);
    setCommand(p.command);
    setArgs(p.args.join(' '));
  };

  const append = (block: Block) => setBlocks((prev) => [...prev, block]);
  const appendText = (kind: 'agent' | 'thought', text: string) => setBlocks((prev) => {
    const last = prev[prev.length - 1];
    if (last && last.kind === kind) return [...prev.slice(0, -1), { kind, text: last.text + text }];
    return [...prev, { kind, text }];
  });

  // Every line from the agent: updates go to the transcript, requests become
  // cards (permission, write) or are answered here (read).
  useEffect(() => {
    let off = () => {};
    onAcpMessage(async (m: AcpMessage) => {
      if (m.agent !== agentId) return;
      if (m.stderr) { setStderr((prev) => [...prev.slice(-30), m.stderr!]); return; }
      if (m.exited) { append({ kind: 'note', text: 'The agent exited.' }); setStarted(null); setBusy(''); return; }
      const msg = m.message;
      if (!msg || !msg.method) return;
      const p = msg.params || {};
      if (msg.method === 'session/update') {
        const u = p.update || {};
        switch (u.sessionUpdate) {
          case 'agent_message_chunk': appendText('agent', textOf(u.content)); break;
          case 'agent_thought_chunk': appendText('thought', textOf(u.content)); break;
          case 'tool_call':
            append({ kind: 'tool', id: String(u.toolCallId), title: String(u.title || u.kind || 'tool'), status: String(u.status || 'pending'), toolKind: String(u.kind || ''), detail: textOf(u.content).slice(0, 4000) });
            break;
          case 'tool_call_update':
            setBlocks((prev) => prev.map((b) => (b.kind === 'tool' && b.id === String(u.toolCallId)
              ? { ...b, status: String(u.status || b.status), detail: u.content ? textOf(u.content).slice(0, 4000) : b.detail, title: u.title ? String(u.title) : b.title }
              : b)));
            break;
          case 'plan':
            append({ kind: 'plan', entries: (u.entries || []).map((e: any) => ({ content: String(e.content || ''), status: String(e.status || '') })) });
            break;
          default: break;
        }
        return;
      }
      if (msg.id === undefined) return;
      const requestId = msg.id;
      if (msg.method === 'session/request_permission') {
        const tc = p.toolCall || {};
        const options = (p.options || []).map((o: any) => ({ optionId: String(o.optionId), name: String(o.name || o.optionId), optKind: String(o.kind || '') }));
        const title = String(tc.title || tc.kind || 'The agent asks for permission');
        setAsks((prev) => [...prev, { kind: 'permission', requestId, title, detail: textOf(tc.content).slice(0, 4000), options }]);
        notifyWithActions(`acp:${requestId}`, 'NeuraOS agent needs your OK', title, [['approve', 'Allow'], ['reject', 'Reject']])
          .then((r) => { if (!r.shown) notifyUser('NeuraOS agent needs your OK', title); });
        return;
      }
      if (msg.method === 'fs/read_text_file') {
        const root = rootRef.current;
        const rel = root ? relativeTo(root, String(p.path || '')) : null;
        if (!root || rel === null) {
          await acpRespond(agentId, requestId, undefined, `NeuraOS only serves files inside the open folder (${root || 'none open'}).`);
          return;
        }
        try {
          const file = await readLocalFile(root, rel);
          let text = file.text;
          if (p.line || p.limit) {
            const lines = text.split('\n');
            const from = Math.max(0, Number(p.line || 1) - 1);
            text = lines.slice(from, p.limit ? from + Number(p.limit) : undefined).join('\n');
          }
          await acpRespond(agentId, requestId, { content: text });
        } catch (e) {
          await acpRespond(agentId, requestId, undefined, (e as Error).message || String(e));
        }
        return;
      }
      if (msg.method === 'fs/write_text_file') {
        setAsks((prev) => [...prev, { kind: 'write', requestId, path: String(p.path || ''), content: String(p.content || '') }]);
        notifyWithActions(`acp:${requestId}`, 'NeuraOS agent wants to write a file', String(p.path || ''), [['approve', 'Allow'], ['reject', 'Reject']])
          .then((r) => { if (!r.shown) notifyUser('NeuraOS agent wants to write a file', String(p.path || '')); });
        return;
      }
      // Anything else the agent asks for is declined, by name, so it can go on.
      await acpRespond(agentId, requestId, undefined, `NeuraOS does not support ${msg.method}`);
    }).then((fn) => { off = fn; });
    return () => off();
  }, []);

  const answerPermission = useCallback(async (ask: Extract<Ask, { kind: 'permission' }>, optionId: string) => {
    setAsks((prev) => prev.filter((a) => a.requestId !== ask.requestId));
    await acpRespond(agentId, ask.requestId, { outcome: { outcome: 'selected', optionId } });
    append({ kind: 'note', text: `${ask.title}: ${ask.options.find((o) => o.optionId === optionId)?.name || optionId}` });
  }, []);

  const answerWrite = useCallback(async (ask: Extract<Ask, { kind: 'write' }>, allow: boolean) => {
    setAsks((prev) => prev.filter((a) => a.requestId !== ask.requestId));
    const root = rootRef.current;
    const rel = root ? relativeTo(root, ask.path) : null;
    if (!allow) {
      await acpRespond(agentId, ask.requestId, undefined, 'The person rejected this write.');
      append({ kind: 'note', text: `Rejected: write ${ask.path}` });
      return;
    }
    if (!root || rel === null) {
      await acpRespond(agentId, ask.requestId, undefined, `NeuraOS only writes inside the open folder (${root || 'none open'}).`);
      return;
    }
    try {
      await writeLocalFile(root, rel, ask.content);
      await acpRespond(agentId, ask.requestId, {});
      append({ kind: 'note', text: `Wrote ${rel} (${ask.content.length} chars)` });
    } catch (e) {
      await acpRespond(agentId, ask.requestId, undefined, (e as Error).message || String(e));
    }
  }, []);

  // Allow / Reject pressed on the notification: the first matching option.
  const asksRef = useRef(asks);
  asksRef.current = asks;
  useEffect(() => {
    let off = () => {};
    onNotificationAction((id, action) => {
      if (!id.startsWith('acp:') || (action !== 'approve' && action !== 'reject')) return;
      const requestId = id.slice(4);
      const ask = asksRef.current.find((a) => String(a.requestId) === requestId);
      if (!ask) return;
      if (ask.kind === 'write') { void answerWrite(ask, action === 'approve'); return; }
      const option = ask.options.find((o) => (action === 'approve' ? o.optKind.startsWith('allow') : o.optKind.startsWith('reject')))
        || ask.options[action === 'approve' ? 0 : ask.options.length - 1];
      if (option) void answerPermission(ask, option.optionId);
    }).then((fn) => { off = fn; });
    return () => off();
  }, [answerPermission, answerWrite]);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [blocks, asks]);

  const start = async () => {
    if (!localRoot) { pushToast('warn', 'Open a folder first (Code → Local): the agent works inside it.'); return; }
    if (!command.trim()) { pushToast('warn', 'Give the agent a command.'); return; }
    setBusy('starting');
    setBlocks([]);
    setStderr([]);
    try {
      const s = await acpStart(agentId, command.trim(), args.trim() ? args.trim().split(/\s+/) : [], localRoot);
      setStarted(s);
      append({ kind: 'note', text: `${s.agentInfo?.name || command} started in ${localRoot} (session ${s.sessionId})` });
      if (s.authMethods && s.authMethods.length) {
        append({ kind: 'note', text: `This agent may need a sign-in first: ${s.authMethods.map((a) => a.name).join(', ')}. Sign in with its own CLI once, then start again.` });
      }
    } catch (e) {
      pushToast('error', (e as Error).message || String(e));
    } finally {
      setBusy('');
    }
  };

  const send = async () => {
    const s = startedRef.current;
    const text = prompt.trim();
    if (!s || !text) return;
    setPrompt('');
    append({ kind: 'user', text });
    setBusy('prompting');
    try {
      const r = await acpPrompt(agentId, s.sessionId, text);
      append({ kind: 'note', text: `Turn ended: ${r.stopReason || 'done'}` });
    } catch (e) {
      append({ kind: 'note', text: (e as Error).message || String(e) });
    } finally {
      setBusy('');
    }
  };

  const stop = async () => {
    const s = startedRef.current;
    if (s && busy === 'prompting') { await acpCancel(agentId, s.sessionId).catch(() => {}); }
    await acpStop(agentId);
    setStarted(null);
    setBusy('');
  };

  if (!hasShell()) {
    return <div className="screen"><div className="empty">Running an agent needs the desktop app.</div></div>;
  }

  return (
    <div className="screen acp">
      <header className="screen-header">
        <h1>Agents (ACP)</h1>
        <div className="header-actions">
          {started ? <button onClick={stop}>Stop</button> : null}
        </div>
      </header>

      {!started && (
        <div className="settings-card acp-setup">
          <p className="settings-hint">
            Run a coding agent inside NeuraOS, in <span className="mono">{localRoot || 'the folder you open'}</span>. Its file reads stay inside that folder,
            and every write and every permission it asks for is a card here (and a notification with Allow / Reject).
          </p>
          <div className="acp-presets" role="radiogroup" aria-label="Agent">
            {PRESETS.map((p) => (
              <label key={p.id} className={`dictation-engine${preset === p.id ? ' active' : ''}`}>
                <input type="radio" name="acp-preset" checked={preset === p.id} onChange={() => choosePreset(p.id)} />
                <span className="dictation-engine-label">{p.label}</span>
                <span className="dictation-engine-note">{p.note}</span>
              </label>
            ))}
          </div>
          <div className="local-status-row">
            <input className="mono" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="command" aria-label="Agent command" />
            <input className="mono acp-args" value={args} onChange={(e) => setArgs(e.target.value)} placeholder="arguments" aria-label="Agent arguments" />
            <button className="primary" onClick={start} disabled={busy === 'starting'}>{busy === 'starting' ? 'Starting…' : 'Start'}</button>
          </div>
        </div>
      )}

      <div className="acp-log" ref={logRef}>
        {blocks.map((b, i) => {
          switch (b.kind) {
            case 'user': return <div key={i} className="acp-block acp-user">{b.text}</div>;
            case 'agent': return <div key={i} className="acp-block acp-agent">{b.text}</div>;
            case 'thought': return <details key={i} className="acp-block acp-thought"><summary>Thought</summary>{b.text}</details>;
            case 'tool': return (
              <div key={i} className={`acp-block acp-tool status-${b.status}`}>
                <div className="acp-tool-head"><Icon name={b.status === 'completed' ? 'check' : b.status === 'failed' ? 'alert' : 'activity'} size={13} /> {b.title} <span className="settings-hint">{b.toolKind} · {b.status}</span></div>
                {b.detail && <pre className="acp-detail">{b.detail}</pre>}
              </div>
            );
            case 'plan': return (
              <ul key={i} className="acp-block acp-plan">
                {b.entries.map((e, j) => <li key={j} className={`plan-${e.status}`}>{e.content}</li>)}
              </ul>
            );
            default: return <div key={i} className="acp-block acp-note settings-hint">{b.text}</div>;
          }
        })}
        {asks.map((a) => a.kind === 'permission' ? (
          <div key={String(a.requestId)} className="approval-card">
            <div className="approval-title">Permission: {a.title}</div>
            {a.detail && <pre className="acp-detail">{a.detail}</pre>}
            <div className="approval-actions">
              {a.options.map((o) => (
                <button key={o.optionId} className={o.optKind.startsWith('allow') ? 'primary' : o.optKind.startsWith('reject') ? 'danger' : ''} onClick={() => answerPermission(a, o.optionId)}>{o.name}</button>
              ))}
            </div>
          </div>
        ) : (
          <div key={String(a.requestId)} className="approval-card">
            <div className="approval-title">Write {a.path}</div>
            <pre className="acp-detail">{a.content.slice(0, 6000)}{a.content.length > 6000 ? '\n…' : ''}</pre>
            <div className="approval-actions">
              <button className="primary" onClick={() => answerWrite(a, true)}>Approve (A)</button>
              <button className="danger" onClick={() => answerWrite(a, false)}>Reject (R)</button>
            </div>
          </div>
        ))}
        {stderr.length > 0 && (
          <details className="acp-block acp-stderr"><summary>Agent output ({stderr.length} lines)</summary><pre className="acp-detail">{stderr.join('\n')}</pre></details>
        )}
      </div>

      {started && (
        <form className="acp-composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={busy === 'prompting' ? 'The agent is working… (Stop cancels)' : `Ask ${started.agentInfo?.name || 'the agent'} to do something in ${localRoot}`}
            disabled={busy === 'prompting'}
            aria-label="Prompt"
          />
          <button className="primary" type="submit" disabled={busy === 'prompting' || !prompt.trim()}>Send</button>
        </form>
      )}
    </div>
  );
}
