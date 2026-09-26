// "Worked N steps ›": a reply's tool calls folded into one line (the Freebuff
// anatomy), with a badge per step when opened. A turn that is still running
// or asking starts open, so nothing that needs the person is hidden.
import { useEffect, useState } from 'react';
import Icon from './Icon';
import ToolCards from './ToolCards';
import type { ToolEvent } from '../agent-turn';
import '../turn.js';

const turn: typeof import('../turn.js') = (globalThis as any).FreeAI4UTurn;

interface Props {
  events: ToolEvent[];
  onDecide?: (id: string, allow: boolean, always: boolean, args?: Record<string, any>) => void;
  expandAll?: boolean;
}

export default function StepsFold({ events, onDecide, expandAll }: Props) {
  const steps = turn.stepsOf(events);
  const [open, setOpen] = useState<boolean | null>(null);
  // Ctrl+T (expandAll) overrides the fold's own memory until the next click.
  useEffect(() => { if (expandAll !== undefined) setOpen(null); }, [expandAll]);
  if (!events.length) return null;
  const shown = open ?? (expandAll ?? steps.open);
  return (
    <div className={`steps-fold ${shown ? 'is-open' : ''} ${steps.open ? 'is-live' : ''}`}>
      <button type="button" className="steps-summary" onClick={() => setOpen(!shown)} aria-expanded={shown}>
        <Icon name={steps.open ? 'activity' : 'check'} size={13} />
        <span className="steps-label">{steps.label}</span>
        {steps.asking > 0 && <span className="step-badge badge-asking">{turn.badgeOf('asking')}</span>}
        {steps.failed > 0 && <span className="step-badge badge-error">{steps.failed} {turn.badgeOf('error')}</span>}
        <span className="steps-chevron" aria-hidden="true">{shown ? '▾' : '›'}</span>
      </button>
      {shown && (
        <div className="steps-body">
          <ToolCards events={events} expandAll={expandAll} onDecide={onDecide} />
        </div>
      )}
    </div>
  );
}
