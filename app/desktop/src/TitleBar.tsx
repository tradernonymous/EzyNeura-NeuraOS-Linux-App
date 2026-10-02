// The in-app titlebar. Windows and macOS only: App renders it behind
// `!isLinux()`, because Mint draws a real titlebar and a second one here was
// 32px of dead space (App.tsx).
//
// The brand mark and the theme toggle come from components/Icon so they sit on
// the same 24x24 / 1.6px grid as the rest of the app and inherit the button's
// colour and focus ring. An earlier version inlined its own SVGs at
// strokeWidth 2 with no size rules, which rendered the mark at its default
// intrinsic size inside a 32px bar and drew the logo as the same sun glyph as
// the light-mode toggle.
import Icon from './components/Icon';

type TitleBarProps = {
  onToggleTheme: () => void;
  theme: 'light' | 'dark';
};

export default function TitleBar({ onToggleTheme, theme }: TitleBarProps) {
  const toDark = theme === 'dark';
  // "Switch to dark theme" / "Switch to light theme" -- one clause, named
  // target, no doubled word.
  const label = `Switch to ${toDark ? 'dark' : 'light'} theme`;

  return (
    <div className="titlebar">
      {/* The brand sits inside the drag region, once. It was previously
          rendered twice -- once here and once in .titlebar-drag -- so the
          wordmark appeared on both sides of the bar. */}
      <div className="titlebar-drag">
        <Icon name="brand" size={15} className="titlebar-mark" />
        <span className="titlebar-brand">NeuraOS</span>
      </div>
      <div className="titlebar-controls">
        <button type="button" className="titlebar-btn" onClick={onToggleTheme} aria-label={label} title={label}>
          <Icon name={toDark ? 'sun' : 'moon'} size={15} />
        </button>
      </div>
    </div>
  );
}
