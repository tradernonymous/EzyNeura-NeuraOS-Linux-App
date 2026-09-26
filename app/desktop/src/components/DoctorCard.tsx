import { useCallback, useEffect, useState } from 'react';
import {
  engineFindNode,
  engineStatus,
  hasShell,
  localModelStatus,
  localServerFind,
  projectHome,
  runLocal,
} from '../bridge';
import { isLinux } from '../platform';
import Icon from './Icon';
import { pushToast } from './Toasts';
// UMD modules: loaded for their side effect, read off globalThis.
import '../doctor.js';
import '../hf-auth.js';
import '../byok.js';

const doctor: typeof import('../doctor.js') = (globalThis as any).FreeAI4UDoctor;
const hfAuth: typeof import('../hf-auth.js') = (globalThis as any).FreeAI4UHfAuth;
const byokLib: typeof import('../byok.js') = (globalThis as any).FreeAI4UByok;

type Row = import('../doctor.js').DoctorRow;

/**
 * The Doctor (upgrade plan D6): one check of everything NeuraOS depends on —
 * engine, Node, git identity, the sandbox, xdotool, Hugging Face, keys, the
 * local model and image servers, disk space — each failure with its fix. The
 * checks are doctor.js's (pure, tested); this card only gathers the facts and
 * prints the rows. Nothing here starts, stops or installs anything: a doctor
 * that prescribes without asking is a different, worse feature.
 */
export default function DoctorCard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [ranAt, setRanAt] = useState(0);

  const run = useCallback(async () => {
    setBusy(true);
    const facts: import('../doctor.js').DoctorFacts = {
      shell: hasShell(),
      platform: isLinux() ? 'linux' : 'windows',
      hfSignedIn: hfAuth.signedIn(),
      byokKeys: byokLib.list().length,
    };
    const [node, engine, model, image, probe] = await Promise.all([
      hasShell() ? engineFindNode().catch(() => null) : Promise.resolve(null),
      hasShell() ? engineStatus().catch(() => null) : Promise.resolve(null),
      hasShell() ? localModelStatus().catch(() => null) : Promise.resolve(null),
      hasShell() ? localServerFind().catch(() => null) : Promise.resolve(null),
      // One read-only shell line: `command -v`, `git config --get`, `df`.
      hasShell() && isLinux()
        ? projectHome()
            .then((home) => runLocal({ root: home, runId: 'doctor', command: doctor.probeCommand() }))
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    facts.node = node;
    facts.engine = engine;
    facts.localModel = model;
    facts.imageServer = image;
    facts.probe = probe ? doctor.parseProbe(probe.stdout) : null;
    setRows(doctor.verdicts(facts));
    setRanAt(Date.now());
    setBusy(false);
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const copy = () => {
    navigator.clipboard
      ?.writeText(doctor.report(rows))
      .then(() => pushToast('ok', 'Doctor report copied.'))
      .catch(() => pushToast('error', 'Could not copy — select the rows and copy them.'));
  };

  return (
    <section className="settings-section">
      <h2>Doctor</h2>
      <div className="settings-card">
        <p className="settings-hint">
          One check of everything NeuraOS depends on. Nothing is changed or installed here — each
          failure names the command or the setting that fixes it.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}>
          <button onClick={() => void run()} disabled={busy}>
            <Icon name="settings" size={12} /> {busy ? 'Checking…' : 'Run the checks again'}
          </button>
          <button onClick={copy} disabled={!rows.length}>Copy report</button>
          {ranAt > 0 && !busy && <span className="settings-hint">{doctor.summary(rows)}</span>}
        </div>
        <div className="doctor-rows">
          {rows.map((r) => (
            <div key={r.id} className={`doctor-row is-${r.state}`}>
              <span className="doctor-dot" aria-hidden="true" />
              <div>
                <div className="doctor-title">
                  {r.title}
                  <span className={`doctor-state is-${r.state}`}>{r.state}</span>
                </div>
                {r.note && <div className="settings-hint">{r.note}</div>}
                {r.fix && <pre className="doctor-fix">{r.fix}</pre>}
              </div>
            </div>
          ))}
          {!rows.length && <div className="empty">{busy ? 'Checking…' : 'No checks yet.'}</div>}
        </div>
      </div>
    </section>
  );
}
