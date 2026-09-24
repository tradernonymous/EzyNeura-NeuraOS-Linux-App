// Settings → Desktop control (docs/MASTER_PLAN.md L9, and the Wayland
// portals of L8): whether a model in Chat may look at the screen and act on
// the desktop, and what this desktop offers for it -- xdotool on X11, the
// portals on Wayland. Off by default; every call still asks.
import { useEffect, useState } from 'react';
import { desktopCapabilities, hasShell, type DesktopCapabilities } from '../bridge';
import { desktopControlOn, setDesktopControl, askAboutScreen, readScreenHotkey } from '../desktopControl';
import { isLinux } from '../platform';

export default function DesktopControlCard() {
  const [on, setOn] = useState(desktopControlOn);
  const [caps, setCaps] = useState<DesktopCapabilities | null>(null);

  useEffect(() => {
    if (!hasShell() || !isLinux()) return;
    desktopCapabilities().then(setCaps).catch(() => setCaps(null));
  }, []);

  if (!hasShell() || !isLinux()) return null;

  const yes = (v?: boolean) => (v ? 'yes' : 'no');
  const wayland = caps?.session === 'wayland';
  const control = caps?.control === 'xdotool'
    ? 'clicks and keys go through xdotool'
    : caps?.control === 'portal'
      ? 'clicks and keys go through the RemoteDesktop portal (the desktop asks once)'
      : wayland
        ? 'this Wayland desktop has no RemoteDesktop portal: screenshots and typing may still work, clicks will not'
        : 'install xdotool for clicks and keys: sudo apt install xdotool';

  return (
    <section className="settings-section">
      <h2>Desktop control</h2>
      <div className="settings-card">
        <label className="toggle">
          <input type="checkbox" checked={on} onChange={(e) => { setDesktopControl(e.target.checked); setOn(e.target.checked); }} />
          Let a model in Chat see the screen and act on the desktop
        </label>
        <p className="settings-hint">
          Adds five tools: screen_capture, desktop_click, desktop_type, desktop_key and desktop_scroll. Each one shows an
          Allow / Deny card first — a screenshot shows whatever is on screen, and a click lands in whichever app is in front.
          Best with a vision model (llava, gemma3, qwen2.5-vl, GPT-4o…).
        </p>
        <div className="setting-row">
          <button type="button" onClick={askAboutScreen}>Ask about the screen now</button>
          <span className="settings-hint">or press {readScreenHotkey()} in any app (Settings → Shortcuts to change it).</span>
        </div>
        {caps && (
          <p className="settings-hint">
            Session: <span className="mono">{caps.session || 'unknown'}</span>
            {' · '}screenshots: {caps.screenshotTool ? caps.screenshotTool : caps.portalScreenshot ? 'portal' : 'nothing found (sudo apt install scrot)'}
            {' · '}{control}
            {' · '}portals: screenshot {yes(caps.portalScreenshot)}, global shortcuts {yes(caps.portalShortcuts)}, remote desktop {yes(caps.portalRemoteDesktop)}
            {wayland && !caps.portalShortcuts ? ' — without the GlobalShortcuts portal the Quick, selection and Voice Type chords do not fire on Wayland; use the palette and the orb' : ''}
          </p>
        )}
      </div>
    </section>
  );
}
