// The panel a turn's output opens: Preview (the newest picture) and Changes
// (what is uncommitted in the chat's folder, with the diff of the file you
// pick; outside a git repository, the files the replies wrote). It exists
// only when there is something to show, so a plain conversation stays one
// centred column.
import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon';
import DiffView from './DiffView';
import { gitCommit, gitDiff, gitStatus, hasShell, type GitStatus } from '../bridge';
import { pushToast } from './Toasts';
import '../turn.js';

const turn: typeof import('../turn.js') = (globalThis as any).FreeAI4UTurn;

type Tab = 'preview' | 'changes';

interface Props {
  messages: any[];
  /** The chat's folder; '' when there is none. */
  root: string;
  tab: Tab;
  onTab: (tab: Tab) => void;
  onClose: () => void;
  /** Open the file in the Local folder view. */
  onOpenFile: (path: string) => void;
  onSavePicture: (url: string) => void;
}

const STATUS_WORD: Record<string, string> = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', '?': 'untracked', C: 'conflict' };

export default function ChatOutput({ messages, root, tab, onTab, onClose, onOpenFile, onSavePicture }: Props) {
  const out = turn.outputOf(messages);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [picked, setPicked] = useState('');
  const [diff, setDiff] = useState('');
  const [busy, setBusy] = useState(false);
  const canGit = !!root && hasShell();
  // Commit from here: the files ticked (all by default), a message, one
  // button. Nothing is pushed; the terminal is still there for that.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const isTicked = (path: string) => ticked[path] !== false;
  const commit = async () => {
    if (!git || !git.repo || committing) return;
    const paths = git.changes.filter((c) => isTicked(c.path)).map((c) => c.path);
    if (!paths.length) { pushToast('warn', 'Tick at least one file.'); return; }
    setCommitting(true);
    try {
      const done = await gitCommit(root, paths, message);
      pushToast('ok', `Committed ${done.files} file${done.files === 1 ? '' : 's'} as ${done.sha}.`);
      setMessage('');
      setTicked({});
      setPicked('');
      refresh();
    } catch (e) {
      pushToast('error', (e as Error).message || String(e));
    } finally {
      setCommitting(false);
    }
  };
  // Re-read git whenever a turn lands (the message count moves) or on Refresh.
  const refresh = useCallback(() => {
    if (!canGit) { setGit(null); return; }
    gitStatus(root).then(setGit).catch(() => setGit(null));
  }, [root, canGit]);
  useEffect(() => { refresh(); }, [refresh, messages.length]);
  useEffect(() => {
    if (!picked || !canGit) { setDiff(''); return; }
    setBusy(true);
    gitDiff(root, picked).then(setDiff).catch((e: unknown) => setDiff(`Could not read the diff: ${(e as Error).message || String(e)}`)).finally(() => setBusy(false));
  }, [picked, root, canGit, messages.length]);

  const gitRows = git && git.repo ? git.changes : null;
  const anyChanges = (gitRows ? gitRows.length > 0 : out.changes.length > 0);
  if (!out.picture && !anyChanges) return null;
  const shown: Tab = tab === 'preview' && !out.picture ? 'changes' : tab === 'changes' && !anyChanges ? 'preview' : tab;
  return (
    <aside className="chat-output" aria-label="Output">
      <div className="chat-output-head" role="tablist">
        {out.picture && (
          <button type="button" role="tab" aria-selected={shown === 'preview'} className={`chat-output-tab ${shown === 'preview' ? 'active' : ''}`} onClick={() => onTab('preview')}>Preview</button>
        )}
        {anyChanges && (
          <button type="button" role="tab" aria-selected={shown === 'changes'} className={`chat-output-tab ${shown === 'changes' ? 'active' : ''}`} onClick={() => onTab('changes')}>
            Changes <span className="chat-output-count">{gitRows ? gitRows.length : out.changes.length}</span>
          </button>
        )}
        {shown === 'changes' && canGit && (
          <button type="button" className="chat-output-close" onClick={refresh} aria-label="Re-read the folder" title="Re-read the folder"><Icon name="refresh" size={13} /></button>
        )}
        <button type="button" className="chat-output-close" onClick={onClose} aria-label="Close the output panel"><Icon name="close" size={13} /></button>
      </div>
      <div className="chat-output-body">
        {shown === 'preview' && out.picture && (
          <div className="chat-output-preview">
            <img src={out.picture} alt="The newest picture in this chat" />
            <button type="button" className="raised" onClick={() => onSavePicture(out.picture)}><Icon name="download" size={12} /> Save</button>
          </div>
        )}
        {shown === 'changes' && gitRows && (
          <>
            <div className="chat-output-branch">
              <Icon name="activity" size={12} /> {git!.branch || 'no branch'}{git!.ahead ? ` · ${git!.ahead} ahead` : ''}{git!.behind ? ` · ${git!.behind} behind` : ''} · uncommitted
            </div>
            <ul className="chat-output-changes">
              {gitRows.map((c) => (
                <li key={c.path} className="change-row">
                  <input type="checkbox" checked={isTicked(c.path)} onChange={(e) => setTicked((t) => ({ ...t, [c.path]: e.target.checked }))} aria-label={`Include ${c.path} in the commit`} />
                  <button type="button" className={picked === c.path ? 'active' : ''} onClick={() => setPicked((p) => (p === c.path ? '' : c.path))} title={`${STATUS_WORD[c.status] || c.status}: ${c.path} — click for the diff`}>
                    <span className={`change-kind change-${c.status === '?' || c.status === 'A' ? 'write' : 'edit'}`}>{c.status}</span>
                    <span className="change-path">{c.path}</span>
                  </button>
                </li>
              ))}
            </ul>
            <form className="chat-output-commit" onSubmit={(e) => { e.preventDefault(); void commit(); }}>
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Commit message"
                aria-label="Commit message"
                disabled={committing}
              />
              <button type="submit" className="raised" disabled={committing || !message.trim() || !gitRows.some((c) => isTicked(c.path))} title="git add the ticked files, then git commit. Nothing is pushed.">
                {committing ? 'Committing…' : `Commit ${gitRows.filter((c) => isTicked(c.path)).length}`}
              </button>
            </form>
            {picked && (
              <div className="chat-output-diff">
                <div className="chat-output-diff-head">
                  <span className="mono">{picked}</span>
                  <button type="button" className="linkish" onClick={() => onOpenFile(picked)}>Open</button>
                </div>
                {busy ? <div className="empty">Reading…</div> : <DiffView text={diff} empty="Nothing to show: the file is empty, or binary." />}
              </div>
            )}
          </>
        )}
        {shown === 'changes' && !gitRows && (
          <ul className="chat-output-changes">
            {out.changes.map((c) => (
              <li key={c.path}>
                <button type="button" onClick={() => onOpenFile(c.path)} title={`Open ${c.path}`}>
                  <span className={`change-kind change-${c.kind}`}>{c.kind === 'write' ? 'W' : 'E'}</span>
                  <span className="change-path">{c.path}</span>
                  {c.turns > 1 && <span className="change-turns">×{c.turns}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
