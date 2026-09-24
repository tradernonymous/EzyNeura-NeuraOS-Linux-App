// Create (UI plan, phase 4): Design and Images in one screen. A mode switch
// at the top -- Page · Deck · Post · Image · Edit image -- opens the studio
// with that frame or the picture tools with that task. The two screens keep
// their own state; this only decides which is on and tells it the mode.
import { lazy, Suspense, useState } from 'react';
import '../create.js';

const create: typeof import('../create.js') = (globalThis as any).FreeAI4UCreate;
const DesignScreen = lazy(() => import('./DesignScreen'));
const ImagesScreen = lazy(() => import('./ImagesScreen'));

type ModeId = import('../create.js').CreateModeId;

/** Fired by a template card or a screen to switch the mode: detail {mode}. */
export const CREATE_MODE_EVENT = 'freeai4u:create-mode';

interface Props {
  /** Which half the menu opened: Design (page) or Images (image). */
  initial: 'design' | 'images';
}

export default function CreateScreen({ initial }: Props) {
  const [mode, setMode] = useState<ModeId>(initial === 'images' ? 'image' : 'page');
  const current = create.modeAt(mode) || create.MODES[0];
  return (
    <div className="screen create">
      <div className="create-switch" role="tablist" aria-label="What to make">
        {create.MODES.map((m) => (
          <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} className={`create-mode ${mode === m.id ? 'active' : ''}`} onClick={() => setMode(m.id)} title={m.hint}>
            {m.label}
          </button>
        ))}
      </div>
      <Suspense fallback={<div className="screen screen-skeleton" aria-busy="true"><div className="skeleton-bar skeleton-title" /><div className="skeleton-bar" /></div>}>
        {current.screen === 'design'
          ? <DesignScreen viewportHint={current.viewport as any} onMode={setMode} />
          : <ImagesScreen taskHint={current.task || 'generate'} onMode={setMode} />}
      </Suspense>
    </div>
  );
}
