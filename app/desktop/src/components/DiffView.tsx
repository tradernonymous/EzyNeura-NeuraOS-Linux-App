// A unified diff as coloured lines, escape-safe (the same rendering the Code
// and Build screens use for the agent's diffs).
import { escapeHtml } from '../markdown';

export function diffHtml(text: string): string {
  return String(text || '').split('\n').map((line) => {
    const safe = escapeHtml(line) || '&nbsp;';
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('index ')) return `<span class="diff-hunk">${safe}</span>`;
    if (line.startsWith('+')) return `<span class="diff-add">${safe}</span>`;
    if (line.startsWith('-')) return `<span class="diff-del">${safe}</span>`;
    return `<span class="diff-ctx">${safe}</span>`;
  }).join('\n');
}

export default function DiffView({ text, empty }: { text: string; empty?: string }) {
  if (!text.trim()) return <div className="empty">{empty || 'No difference.'}</div>;
  return <pre className="diff-view" dangerouslySetInnerHTML={{ __html: diffHtml(text) }} />;
}
