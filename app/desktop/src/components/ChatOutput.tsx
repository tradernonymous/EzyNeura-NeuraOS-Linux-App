// The panel a turn's output opens: Preview (the newest picture) and Changes
// (what is uncommitted in the chat's folder, with the diff of the file you
// pick; outside a git repository, the files the replies wrote). It exists
// only when there is something to show, so a plain conversation stays one
// centred column.
import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon';
import DiffView from './DiffView';
import { gitAmend, gitCommit, gitDiff, gitDiscard, gitPull, gitPush, gitStatus, gitUnstage, hasShell, type GitStatus } from '../bridge';
import { pushToast } from './Toasts';
import '../turn.js';

const turn: typeof import('../turn.js') = (globalThis as any).FreeAI4UTurn;

/** The host a remote URL names, for the Pull/Push tooltips: github.com. '' when it is a local path. */
const hostOf = (url: string): string => {
  const u = url.trim();
  try {
    return new URL(/^git@/.test(u) ? 'ssh://' + u.replace(/^git@([^:]+):/, '$1/') : u).hostname;
  } catch {
    return '';
  }
};

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
  // E1/E2: push and pull (the remote's host is checked in Rust first), amend
  // the last commit instead of adding one, and discard behind a second click.
  const [amend, setAmend] = useState(false);
  const [syncing, setSyncing] = useState<'pull' | 'push' | ''>('');
  const [discardAsk, setDiscardAsk] = useState('');
  const isTicked = (path: string) => ticked[path] !== false;
  const commit = async () => {
    if (!git || !git.repo || committing) return;
    const paths = git.changes.filter((c) => isTicked(c.path)).map((c) => c.path);
    if (!paths.length) { pushToast('warn', 'Tick at least one file.'); return; }
    setCommitting(true);
    try {
      const done = amend ? await gitAmend(root, paths, message) : await gitCommit(root, paths, message);
      pushToast('ok', amend
        ? `Amended ${done.files} file${done.files === 1 ? '' : 's'} into ${done.sha} — the previous commit is replaced.`
        : `Committed ${done.files} file${done.files === 1 ? '' : 's'} as ${done.sha}.`);
      setMessage('');
      setTicked({});
      setPicked('');
      setAmend(false);
      setDiscardAsk('');
      refresh();
    } catch (e) {
      pushToast('error', (e as Error).message || String(e));
    } finally {
      setCommitting(false);
    }
  };
  /** Pull with --ff-only / push: the remote URL and host are checked in Rust before git runs. */
  const sync = async (how: 'pull' | 'push') => {
    if (syncing || !git?.remote) return;
    setSyncing(how);
    setDiscardAsk('');
    try {
      const done = how === 'pull' ? await gitPull(root) : await gitPush(root);
      pushToast('ok', done.host ? `${done.message} (${done.host})` : done.message);
      refresh();
    } catch (e) {
      pushToast('error', (e as Error).message || String(e));
    } finally {
      setSyncing('');
    }
  };
  /** Take a file back out of the index; the working tree is not touched. */
  const unstage = async (paths: string[]) => {
    if (!paths.length) return;
    try {
      await gitUnstage(root, paths);
      pushToast('ok', paths.length === 1 ? 'Unstaged 1 file.' : `Unstaged ${paths.length} files.`);
      refresh();
    } catch (e) {
      pushToast('error', (e as Error).message || String(e));
    }
  };
  /** First click arms, the second discards: irreversible, so it takes two. */
  const discard = async (path: string) => {
    if (discardAsk !== path) { setDiscardAsk(path); return; }
    setDiscardAsk('');
    try {
      await gitDiscard(root, [path]);
      pushToast('warn', `Discarded the changes to ${path}.`);
      if (picked === path) setPicked('');
      refresh();
    } catch (e) {
      pushToast('error', (e as Error).message || String(e));
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
  // The panel also exists while there is something to push (ahead > 0), so a
  // commit that leaves zero changes does not hide the Push button behind it.
  const anyChanges = (gitRows ? gitRows.length > 0 || git!.ahead > 0 : out.changes.length > 0);
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
            <div className="chat-output-sync">
              <button
                type="button"
                onClick={() => void sync('pull')}
                disabled={!!syncing || !git!.remote}
                title={git!.remote ? `Pull from ${hostOf(git!.remote) || 'the local remote'} (--ff-only: never merges behind your back)` : 'No remote is set for this folder.'}
              >
                {syncing === 'pull' ? 'Pulling…' : `↓ Pull${git!.behind ? ` ${git!.behind}` : ''}`}
              </button>
              <button
                type="button"
                onClick={() => void sync('push')}
                disabled={!!syncing || !git!.remote}
                title={git!.remote ? `Push to ${hostOf(git!.remote) || 'the local remote'}` : 'No remote is set for this folder.'}
              >
                {syncing === 'push' ? 'Pushing…' : `↑ Push${git!.ahead ? ` ${git!.ahead}` : ''}`}
              </button>
              <span className="chat-output-remote" title={git!.remote}>{git!.remote ? hostOf(git!.remote) || 'local' : 'no remote'}</span>
            </div>
            {gitRows.some((c) => c.staged) && (
              <button
                type="button"
                className="linkish change-unstage-all"
                onClick={() => void unstage(gitRows.filter((c) => c.staged).map((c) => c.path))}
              >
                Unstage all ({gitRows.filter((c) => c.staged).length})
              </button>
            )}
            <ul className="chat-output-changes">
              {gitRows.map((c) => (
                <li key={c.path} className={`change-row${discardAsk === c.path ? ' is-confirming' : ''}`}>
                  <input type="checkbox" checked={isTicked(c.path)} onChange={(e) => setTicked((t) => ({ ...t, [c.path]: e.target.checked }))} aria-label={`Include ${c.path} in the commit`} />
                  <button type="button" className={picked === c.path ? 'active' : ''} onClick={() => { setDiscardAsk(''); setPicked((p) => (p === c.path ? '' : c.path)); }} title={`${STATUS_WORD[c.status] || c.status}${c.staged ? ', staged' : ''}: ${c.path} — click for the diff`}>
                    <span className={`change-kind change-${c.status === '?' || c.status === 'A' ? 'write' : 'edit'}`}>{c.status}</span>
                    <span className="change-path">{c.path}</span>
                  </button>
                  {c.staged && (
                    <button type="button" className="change-mini" onClick={() => void unstage([c.path])} title="Take it back out of the index; the file on disk keeps its changes">
                      unstage
                    </button>
                  )}
                  <button
                    type="button"
                    className="change-mini change-danger"
                    onClick={() => void discard(c.path)}
                    title={discardAsk === c.path ? 'Click again: this throws the changes away and cannot be undone' : 'Throw this file’s changes away (back to HEAD; untracked files are deleted)'}
                  >
                    {discardAsk === c.path ? 'sure?' : 'discard'}
                  </button>
                </li>
              ))}
            </ul>
            <form className="chat-output-commit" onSubmit={(e) => { e.preventDefault(); void commit(); }}>
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={amend ? 'New message (blank keeps the last one)' : 'Commit message'}
                aria-label={amend ? 'New message for the amended commit' : 'Commit message'}
                disabled={committing}
              />
              <button
                type="submit"
                className="raised"
                disabled={committing || (!gitRows.some((c) => isTicked(c.path)) && !(amend && message.trim())) || (!amend && !message.trim())}
                title={amend ? 'Replace the last commit with the ticked files. The old commit is rewritten.' : 'git add the ticked files, then git commit. Nothing is pushed.'}
              >
                {committing ? (amend ? 'Amending…' : 'Committing…') : amend ? `Amend ${gitRows.filter((c) => isTicked(c.path)).length}` : `Commit ${gitRows.filter((c) => isTicked(c.path)).length}`}
              </button>
            </form>
            {git!.head && (
              <label className="chat-output-amend" title="Rewrite the last commit instead of adding a new one">
                <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} disabled={committing} />
                Amend the last commit
              </label>
            )}
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
