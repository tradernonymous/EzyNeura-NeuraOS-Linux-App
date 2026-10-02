// The Doctor (D6 of docs/APP_UPGRADE_PLAN.md): one button that checks
// everything NeuraOS depends on, and a line per thing with its fix.
//
// The model is `hh doctor`. "The app does not work" is the least actionable
// bug report there is, and almost every instance of it is one missing tool,
// one unconfigured git identity, or one key that never got saved -- each a
// two-minute fix the user cannot find without knowing to look.
//
// Two deliberate choices:
//
//   - it runs on a click, not on a timer. It shells out to `command -v` for
//     seven tools, and something that costs a subprocess round trip should not
//     do it behind somebody's back while they are reading Settings.
//   - it says "safe to paste". That claim has to be true, which is why the
//     backend reports whether a key is present and never what it is, and why
//     there is a test asserting no check can echo anything token-shaped.
//
// The facts come from src-tauri/src/doctor.rs; the sentences and the ordering
// come from src/doctor.js, which node:test exercises directly.
import { useCallback, useState } from 'react';
import { doctorFacts, hasShell } from '../bridge';
import '../doctor.js';

const doctor: typeof import('../doctor.js') = (globalThis as any).FreeAI4UDoctor;

type Facts = import('../doctor.js').DoctorFacts;
type Check = import('../doctor.js').DoctorCheck;

/** The mark beside each row. A word, not only a colour: this has to be
 *  readable by someone who cannot tell green from amber. */
const MARK: Record<string, string> = { ok: '✓', warn: '!', bad: '×' };

export default function DoctorCard() {
  const [facts, setFacts] = useState<Facts | null>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const run = useCallback(async () => {
    setRunning(true);
    setError('');
    try {
      const found = await doctorFacts();
      setFacts(found);
      setChecks(doctor.buildChecks(found));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }, []);

  // Nothing is shown before the first run, on purpose. A card full of greyed
  // rows that have not been checked yet reads as a list of problems, and the
  // person who needs the Doctor least is the one who would believe it.
  if (!checks.length) {
    return (
      <section className="settings-section">
        <h2>Doctor</h2>
        <div className="settings-card">
          <p className="settings-hint">
            Checks everything NeuraOS depends on &mdash; Node, the engine, git, your saved keys, and
            the command-line tools skills use &mdash; and says how to fix whatever is missing.
            Takes about a second. Nothing here is a secret, so the result is safe to paste into a bug report.
          </p>
          {error && <p className="settings-hint is-error">{error}</p>}
          <div className="setting-row">
            <span className="setting-label">{facts ? '' : 'Not run yet'}</span>
            <button className="primary" onClick={run} disabled={running || !hasShell()}>
              {running ? 'Checking…' : 'Run the Doctor'}
            </button>
          </div>
        </div>
      </section>
    );
  }

  const overall = doctor.overallState(checks);

  return (
    <section className="settings-section">
      <h2>Doctor</h2>
      <div className="settings-card">
        <p className="settings-hint">
          {doctor.summarize(checks)}
          {facts?.version ? ` NeuraOS ${facts.version} on ${facts.os}/${facts.arch}.` : ''}
        </p>

        <ul className="doctor-list">
          {checks.map((c) => (
            <li key={c.id} className={`doctor-row is-${c.state}`}>
              <span className="doctor-mark" aria-hidden="true">{MARK[c.state]}</span>
              <div className="doctor-body">
                <span className="doctor-label">
                  {c.label}
                  <span className="doctor-state">{c.state === 'ok' ? '' : c.state}</span>
                </span>
                <span className="doctor-detail">{c.detail}</span>
                {/* The fix is the point of the card, so it is rendered
                    whenever there is one -- and there only ever is one on a
                    `bad`, which doctor.js enforces. */}
                {c.fix && <span className="doctor-fix">{c.fix}</span>}
              </div>
            </li>
          ))}
        </ul>

        <div className="setting-row">
          <span className="setting-label">
            {overall === 'ok' ? 'Nothing to do.' : 'Re-run after fixing the above.'}
          </span>
          <button className="primary" onClick={run} disabled={running}>
            {running ? 'Checking…' : 'Check again'}
          </button>
        </div>
      </div>
    </section>
  );
}
