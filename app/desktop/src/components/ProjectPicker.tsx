// "New chat" asks where the chat lives first (the Claude Code flow): a recent
// folder, a folder picked now, or the home folder for chats about nothing in
// particular. History is then read by folder, so the choice is the filing.
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import '../shell.js';

const shell: typeof import('../shell.js') = (globalThis as any).FreeAI4UShell;

interface Props {
  open: boolean;
  /** `~/NeuraOS`; '' in a browser build, where every chat is a home chat. */
  home: string;
  /** Recent picks first, then every folder a chat lives in. */
  known: string[];
  onPick: (project: string) => void;
  onBrowse: () => void;
  /** Clone a repository into the home folder; resolves to the new folder. */
  onClone?: (url: string) => Promise<string>;
  onClose: () => void;
}

export default function ProjectPicker({ open, home, known, onPick, onBrowse, onClone, onClose }: Props) {
  const first = useRef<HTMLButtonElement | null>(null);
  const [cloning, setCloning] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!open) { setCloning(false); setUrl(''); setBusy(false); setError(''); } }, [open]);
  const clone = async () => {
    if (!onClone || !url.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const folder = await onClone(url.trim());
      onPick(folder);
    } catch (e) {
      setError((e as Error).message || String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!open) return undefined;
    const handle = window.setTimeout(() => first.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.clearTimeout(handle); window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="palette-backdrop" onClick={onClose} role="presentation">
      <div className="project-picker deck" role="dialog" aria-modal="true" aria-label="Where does this chat live?" onClick={(e) => e.stopPropagation()}>
        <h3>Where does this chat live?</h3>
        <p className="project-picker-hint">Every chat belongs to a folder. The agent works there, and history is read by folder.</p>
        <button ref={first} type="button" className="project-row" onClick={() => onPick(home)}>
          <Icon name="chat" size={14} />
          <span className="project-row-name">{shell.HOME_LABEL}</span>
          <span className="project-row-path">{home || 'chats about nothing in particular'}</span>
        </button>
        {known.filter((p) => p && p !== home).map((p) => (
          <button key={p} type="button" className="project-row" onClick={() => onPick(p)}>
            <Icon name="folder" size={14} />
            <span className="project-row-name">{shell.projectName(p)}</span>
            <span className="project-row-path">{p}</span>
          </button>
        ))}
        <button type="button" className="project-row project-row-browse" onClick={onBrowse}>
          <Icon name="plus" size={14} />
          <span className="project-row-name">Open a folder…</span>
          <span className="project-row-path">Pick any folder on this PC</span>
        </button>
        {onClone && !cloning && (
          <button type="button" className="project-row" onClick={() => setCloning(true)}>
            <Icon name="download" size={14} />
            <span className="project-row-name">Clone a repository…</span>
            <span className="project-row-path">git clone into {home || 'the home folder'}</span>
          </button>
        )}
        {onClone && cloning && (
          <form className="project-clone" onSubmit={(e) => { e.preventDefault(); void clone(); }}>
            <input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo.git"
              aria-label="Repository URL"
              spellCheck={false}
              disabled={busy}
            />
            <button type="submit" className="raised" disabled={busy || !url.trim()}>{busy ? 'Cloning…' : 'Clone'}</button>
            {error && <div className="project-clone-error" role="alert">{error}</div>}
            {busy && <div className="project-picker-hint">Cloning can take a while for a large repository. It stops by itself after ten minutes.</div>}
          </form>
        )}
      </div>
    </div>
  );
}
