// The panel a turn's output opens: Preview (the newest picture) and Changes
// (the files the replies wrote or edited). It exists only when there is
// something to show, so a plain conversation stays one centred column.
import Icon from './Icon';
import '../turn.js';

const turn: typeof import('../turn.js') = (globalThis as any).FreeAI4UTurn;

type Tab = 'preview' | 'changes';

interface Props {
  messages: any[];
  tab: Tab;
  onTab: (tab: Tab) => void;
  onClose: () => void;
  /** Open the file in the Local folder view. */
  onOpenFile: (path: string) => void;
  onSavePicture: (url: string) => void;
}

export default function ChatOutput({ messages, tab, onTab, onClose, onOpenFile, onSavePicture }: Props) {
  const out = turn.outputOf(messages);
  if (!out.any) return null;
  const shown: Tab = tab === 'preview' && !out.picture ? 'changes' : tab === 'changes' && !out.changes.length ? 'preview' : tab;
  return (
    <aside className="chat-output" aria-label="Output">
      <div className="chat-output-head" role="tablist">
        {out.picture && (
          <button type="button" role="tab" aria-selected={shown === 'preview'} className={`chat-output-tab ${shown === 'preview' ? 'active' : ''}`} onClick={() => onTab('preview')}>Preview</button>
        )}
        {out.changes.length > 0 && (
          <button type="button" role="tab" aria-selected={shown === 'changes'} className={`chat-output-tab ${shown === 'changes' ? 'active' : ''}`} onClick={() => onTab('changes')}>
            Changes <span className="chat-output-count">{out.changes.length}</span>
          </button>
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
        {shown === 'changes' && (
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
