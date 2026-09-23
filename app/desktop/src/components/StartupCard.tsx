// Settings → Startup: one toggle for "start NeuraOS when I log in". The app
// lives in the tray and can run a local engine and a local model, so starting
// it with the session -- hidden, into the tray -- is what makes "always ready"
// true. The plugin writes the OS's own entry (an ~/.config/autostart .desktop
// file on Linux, the Run key on Windows) and reads it back, so the toggle
// shows what the OS actually has, not what was last clicked.
import { useEffect, useState } from 'react';
import { autostartIsEnabled, autostartSet, hasShell } from '../bridge';
import { pushToast } from './Toasts';

export default function StartupCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hasShell()) return;
    autostartIsEnabled().then(setEnabled).catch(() => setEnabled(null));
  }, []);

  if (!hasShell()) return null;

  const flip = async (on: boolean) => {
    setBusy(true);
    try {
      await autostartSet(on);
      setEnabled(await autostartIsEnabled());
    } catch (err) {
      pushToast('error', 'Could not change the startup entry: ' + (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section">
      <h2>Startup</h2>
      <div className="settings-card">
        <label className="toggle">
          <input
            type="checkbox"
            checked={!!enabled}
            disabled={busy || enabled === null}
            onChange={(e) => flip(e.target.checked)}
          />
          Start NeuraOS when I log in (hidden, in the tray)
        </label>
        <p className="settings-hint">
          {enabled === null
            ? 'The startup entry could not be read on this system.'
            : 'The window stays hidden until you click the tray icon or open NeuraOS from the menu. Turn it off here or in Startup Applications.'}
        </p>
      </div>
    </section>
  );
}
