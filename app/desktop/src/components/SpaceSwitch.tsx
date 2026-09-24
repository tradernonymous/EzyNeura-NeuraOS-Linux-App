// The switch at the top of a space (the Create strip's shape, reused): its
// pages as pills, so Agents reads Library · Agents · Recipes · Runs · Evals
// without a second strip of tabs under the top bar's menu.
import { tabsOf, type NavId, type ViewId } from '../Sidebar';

interface Props { destination: NavId; active: ViewId; onNavigate: (view: ViewId) => void; badge?: Partial<Record<ViewId, number>>; }

export default function SpaceSwitch({ destination, active, onNavigate, badge }: Props) {
  const tabs = tabsOf(destination);
  if (tabs.length < 2) return null;
  return (
    <div className="create-switch space-switch" role="tablist" aria-label={`${destination} pages`}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={active === t.id} className={`create-mode ${active === t.id ? 'active' : ''}`} onClick={() => onNavigate(t.id)} title={t.hint}>
          {t.label}
          {badge && badge[t.id] ? <span className="sidebar-badge space-badge">{badge[t.id]}</span> : null}
        </button>
      ))}
    </div>
  );
}
