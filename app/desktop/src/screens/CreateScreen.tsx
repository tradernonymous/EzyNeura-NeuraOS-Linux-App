// Create: two EXCLUSIVE tabs -- Design and Image. Only one is ever on: the
// tab picks the screen, and the row of pills under it is that tab's own
// sub-switch (Page · Deck · Post in Design, Image · Edit in Image). The two
// screens keep their own state across a switch; this file only decides which
// is mounted, tells it the mode, and moves the sidebar's view so the bar
// across the top and this switch never disagree.
import { lazy, Suspense, useEffect, useState } from 'react';
import Icon from '../components/Icon';
import { NAVIGATE_EVENT } from '../Sidebar';
import '../create.js';

const create: typeof import('../create.js') = (globalThis as any).FreeAI4UCreate;
const DesignScreen = lazy(() => import('./DesignScreen'));
const ImagesScreen = lazy(() => import('./ImagesScreen'));

type ModeId = import('../create.js').CreateModeId;
type TabId = import('../create.js').CreateTabId;

/** Fired by a template card or a screen to switch the mode: detail {mode}. */
export const CREATE_MODE_EVENT = 'freeai4u:create-mode';

interface Props {
  /** Which half the menu opened: Design (page) or Images (image). */
  initial: 'design' | 'images';
}

const TAB_ICONS: Record<TabId, 'design' | 'image'> = { design: 'design', image: 'image' };

export default function CreateScreen({ initial }: Props) {
  const [mode, setMode] = useState<ModeId>(initial === 'images' ? 'image' : 'page');
  const current = create.modeAt(mode) || create.MODES[0];
  const tab: TabId = create.tabOf(mode);

  /** One mode change, one view change: the tab follows wherever it came from. */
  const pick = (next: ModeId) => {
    setMode(next);
    const view = create.tabOf(next) === 'image' ? 'images' : 'design';
    if (view !== initial) window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: { view } }));
  };

  // The sidebar (or Ctrl+K) opened the other half: land on that tab's first
  // mode, so what the bar highlights and what is on screen stay the same.
  useEffect(() => {
    const want: TabId = initial === 'images' ? 'image' : 'design';
    if (create.tabOf(mode) !== want) {
      const first = create.modesForTab(want)[0];
      if (first) setMode(first.id);
    }
  }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="screen create">
      <div className="create-switch" role="tablist" aria-label="Create: Design or Image">
        {create.TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`create-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => pick(create.modesForTab(t.id)[0].id)}
            title={t.hint}
          >
            <Icon name={TAB_ICONS[t.id]} size={16} />
            <span className="create-tab-label">{t.label}</span>
            <span className="create-tab-hint">{t.hint}</span>
          </button>
        ))}
        <span className="toolbar-spacer" />
        <div className="create-modes" role="group" aria-label={tab === 'design' ? 'Frame' : 'Task'}>
          {create.modesForTab(tab).map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={mode === m.id}
              className={`create-mode ${mode === m.id ? 'active' : ''}`}
              onClick={() => pick(m.id)}
              title={m.hint}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <Suspense fallback={<div className="screen screen-skeleton" aria-busy="true"><div className="skeleton-bar skeleton-title" /><div className="skeleton-bar" /></div>}>
        {current.screen === 'design'
          ? <DesignScreen viewportHint={current.viewport as any} onMode={pick} />
          : <ImagesScreen taskHint={current.task || 'generate'} onMode={pick} />}
      </Suspense>
    </div>
  );
}
