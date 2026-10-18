import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { writeLocalFile } from '../bridge';

// A plain textarea editor for one local file, opened from the Local screen's
// Edit. Monaco (10 MB of dist, 112 MB of node_modules, five workers) was
// removed in the lean build: this screen peeks at and tweaks config and small
// files, it does not need an IDE. Same props, same Ctrl-S contract, same
// shell confinement -- writeLocalFile still refuses a path outside the open
// folder. Saving is the person's own Save; nothing here writes on its own.

interface CodeEditorProps {
  root: string;
  path: string;
  /** The file's text as read; the editor owns the buffer after it opens. */
  text: string;
  onSaved: (text: string) => void;
  /** Discard / Done: back to the read-only viewer. Unsaved edits are dropped. */
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

function message(e: unknown): string {
  return ((e as Error)?.message || String(e)).split('\n')[0];
}

function languageLabel(path: string): string {
  const name = (path.split(/[/\\]/).pop() || '').toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : 'text';
}

export default function CodeEditor({ root, path, text, onSaved, onClose, onDirtyChange }: CodeEditorProps) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const savedRef = useRef(text);
  const [status, setStatus] = useState<'ready' | 'saving' | 'error'>('ready');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const saveRef = useRef<() => void>(() => undefined);
  const savedCb = useRef(onSaved);
  savedCb.current = onSaved;
  const dirtyCb = useRef(onDirtyChange);
  dirtyCb.current = onDirtyChange;

  useEffect(() => {
    dirtyCb.current?.(dirty);
  }, [dirty]);

  useEffect(() => {
    areaRef.current?.focus();
  }, []);

  saveRef.current = () => {
    const area = areaRef.current;
    if (!area || status === 'saving') return;
    const value = area.value;
    if (value === savedRef.current) {
      setDirty(false);
      return;
    }
    setStatus('saving');
    setError('');
    writeLocalFile(root, path, value)
      .then(() => {
        savedRef.current = value;
        setDirty(area.value !== value);
        setStatus('ready');
        savedCb.current(value);
      })
      .catch((e: unknown) => {
        setStatus('ready');
        setError(`Not saved: ${message(e)}`);
      });
  };

  return (
    <div className="code-editor" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }}>
      <div className="viewer-header">
        <span className="viewer-path" title={path}>
          {path}
        </span>
        <span className="viewer-meta">
          {languageLabel(path)} ·{' '}
          {status === 'saving' ? 'saving…' : dirty ? '● unsaved changes' : 'saved'}
        </span>
        <button className="primary" onClick={() => saveRef.current()} disabled={status !== 'ready' || !dirty} title="Save (Ctrl+S)">
          <Icon name="check" size={13} /> Save
        </button>
        <button onClick={onClose} title={dirty ? 'Drop the unsaved changes and go back to the read-only view' : 'Back to the read-only view'}>
          <Icon name="close" size={13} /> {dirty ? 'Discard' : 'Done'}
        </button>
      </div>
      {error && <div className="empty files-error">{error}</div>}
      <textarea
        ref={areaRef}
        className="code-editor-host"
        spellCheck={false}
        defaultValue={text}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            saveRef.current();
          }
        }}
        onChange={(e) => {
          setDirty(e.target.value !== savedRef.current);
          if (status === 'error') setStatus('ready');
        }}
        style={{
          flex: 1,
          minHeight: 240,
          width: '100%',
          resize: 'none',
          border: 'none',
          outline: 'none',
          padding: '12px 14px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: 13,
          lineHeight: 1.5,
          tabSize: 2,
        }}
      />
    </div>
  );
}
