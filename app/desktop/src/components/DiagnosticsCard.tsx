// "Something is wrong" should not require a screenshot.
//
// The facts come from the shell (version, OS, WebView2, where the logs are) and
// from the app (which engine, what the last answer meant); the wording and the
// redaction come from src/diagnostics.js, which node:test checks. The bundle is
// safe to paste: no token, no key, no chat content.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { appRelaunch, crashLogReveal, diagnosticsFacts, engineLogVacuum, hasShell, rendererModeGet, rendererModeSet, telemetryGet, telemetrySet, type DiagnosticsFacts, type RendererMode, type TelemetryState } from '../bridge';
import '../diagnostics.js';
import '../backup.js';

const diagnostics: typeof import('../diagnostics.js') = (globalThis as any).FreeAI4UDiagnostics;
const backupLib: typeof import('../backup.js') = (globalThis as any).FreeAI4UBackup;

export default function DiagnosticsCard({ state }: { state?: string }) {
  const [facts, setFacts] = useState<DiagnosticsFacts | null>(null);
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(false);
  const [telemetry, setTelemetry] = useState<TelemetryState | null>(null);

  useEffect(() => {
    if (!hasShell()) return;
    let cancelled = false;
    diagnosticsFacts()
      .then((found) => { if (!cancelled) setFacts(found); })
      .catch(() => { if (!cancelled) setFacts(null); });
    telemetryGet()
      .then((state) => { if (!cancelled) setTelemetry(state); })
      .catch(() => { if (!cancelled) setTelemetry(null); });
    return () => { cancelled = true; };
  }, []);

  // Cold start (NEURA-035): the marks main.tsx and App set on this launch.
  const startup = diagnostics.startupTimings();
  const startupLine = diagnostics.startupLabel(startup);

  const report = diagnostics.buildReport({
    shell: facts || {},
    client: { engine: api.getServer(), state, hasShell: hasShell(), startup },
  });

  const copy = () => {
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      setOpen(true);
      setMessage('This window cannot copy for you — select the text below.');
      return;
    }
    clipboard.writeText(report).then(
      () => setMessage('Copied. Paste it wherever you are reporting the problem.'),
      () => {
        setOpen(true);
        setMessage('Copy was refused — select the text below instead.');
      },
    );
  };

  return (
    <section className="settings-section">
      <h2>Diagnostics</h2>
      <div className="settings-card">
        <p className="settings-hint">
          What this build is, where it points, and how it last answered. Safe to paste:
          addresses have their query strings removed, and anything shaped like a key is redacted.
        </p>
        {startupLine && (
          <p className="settings-hint" title="Milliseconds since the window started loading, on this launch">
            Start-up: {startupLine}
          </p>
        )}
        <div className="setting-row">
          <button type="button" onClick={copy}>Copy diagnostics</button>
          <button type="button" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : 'Show'}
          </button>
          {hasShell() && (
            <button type="button" onClick={() => crashLogReveal().catch((e: Error) => setMessage(e.message || String(e)))}>
              Open the logs folder
            </button>
          )}
          {hasShell() && (
            <button
              type="button"
              title="Shrink the engine's systemd journal to 200M / 30 days (U06). Nothing else is touched."
              onClick={() => engineLogVacuum().then(setMessage).catch((e: Error) => setMessage(e.message || String(e)))}
            >
              Vacuum engine logs
            </button>
          )}
          <button
            type="button"
            title="Download settings as a file (U08). Secrets never leave; chats are not settings and stay."
            onClick={() => {
              try {
                const doc = backupLib.exportBackup(window.localStorage);
                const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'neuraos-settings.json';
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 5000);
                const n = Object.keys(doc.values).length;
                setMessage(`Exported ${n} setting${n === 1 ? '' : 's'} (${doc.skippedSecrets.length} secret(s) left behind).`);
              } catch (e: unknown) {
                setMessage(`Export failed: ${(e as Error).message || String(e)}`);
              }
            }}
          >
            Export settings
          </button>
          <label className="status-item status-button" title="Restore settings from a file (U08). Only keys this build knows are written; secrets are never imported.">
            Import settings
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    const result = backupLib.importBackup(JSON.parse(String(reader.result)), window.localStorage);
                    if (result.errors.length) {
                      setMessage(`Import refused: ${result.errors.join('; ')}`);
                    } else {
                      setMessage(`Restored ${result.restored.length} setting(s), skipped ${result.skipped.length}. Takes effect on relaunch for most settings.`);
                    }
                  } catch (err: unknown) {
                    setMessage(`Import refused: not a settings file (${(err as Error).message || String(err)}).`);
                  }
                };
                reader.readAsText(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {message && <p className="settings-hint">{message}</p>}
        {hasShell() && telemetry && (
          <p className="settings-hint">
            <label>
              <input
                type="checkbox"
                checked={telemetry.enabled}
                onChange={(e) => telemetrySet(e.target.checked).then(setTelemetry).catch((err: Error) => setMessage(err.message || String(err)))}
              />{' '}
              Count anonymous usage (launches, Doctor runs, crashes, finished downloads and runs) on this machine.
              Off by default; the counts never leave the PC unless pasted into a report.
              {telemetry.enabled && Object.keys(telemetry.counts).length > 0 && (
                <> Current counts: {Object.entries(telemetry.counts).map(([k, v]) => `${k}=${v}`).join(', ')}.</>
              )}
            </label>
          </p>
        )}
        {open && <pre className="diagnostics-report">{report}</pre>}
      </div>
      <RendererRow />
    </section>
  );
}

const RENDERER_LABELS: Record<string, string> = {
  safe: 'Safe (default): GPU buffers off, draws right on every machine',
  gpu: 'Full GPU: fastest, but stripes or a blank window on some drivers',
  basic: 'Basic: no compositing, for a machine where Safe still misdraws',
};

/**
 * Linux only: which WebKitGTK renderer the next start uses. The first real
 * Mint machine drew Settings as coloured bands until the DMA-BUF renderer
 * was off, which is why Safe is the default and this row exists at all.
 */
function RendererRow() {
  const [state, setState] = useState<RendererMode | null>(null);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!hasShell()) return;
    rendererModeGet().then(setState).catch(() => setState(null));
  }, []);
  if (!state?.available) return null;
  const choose = async (mode: string) => {
    try {
      setState(await rendererModeSet(mode));
      setChanged(true);
      setError('');
    } catch (e) {
      setError((e as Error).message || String(e));
    }
  };
  return (
    <div className="settings-card" style={{ marginTop: 12 }}>
      <div className="setting-row">
        <span className="setting-label">Renderer{state.nvidia ? ' (NVIDIA driver: GPU buffers are always off)' : ''}</span>
        <select value={state.mode} onChange={(e) => { void choose(e.target.value); }} aria-label="Renderer mode">
          {state.modes.map((mode) => <option key={mode} value={mode}>{RENDERER_LABELS[mode] || mode}</option>)}
        </select>
      </div>
      <p className="settings-hint">
        Stripes, smeared text or a blank window mean the GPU path is wrong for this driver: pick Safe, or Basic if Safe is not enough.
        {changed && ' The change applies at the next start.'}
        {' '}
        {changed && <button type="button" onClick={() => appRelaunch().catch((e: Error) => setError(e.message || String(e)))}>Restart NeuraOS now</button>}
      </p>
      {error && <p className="settings-hint">{error}</p>}
    </div>
  );
}
