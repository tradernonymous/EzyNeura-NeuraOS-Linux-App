import { useMemo, useState } from 'react';
import { runLocal, writeLocalFile } from '../bridge';
import { isLinux } from '../platform';
import Icon from './Icon';
import { pushToast } from './Toasts';
// UMD: loaded for its side effect, read off globalThis.
import '../hf-skills.js';
import { mintPack } from '../skill-pack';

const hfSkills: typeof import('../hf-skills.js') = (globalThis as any).FreeAI4UHfSkills;

const DISMISS_KEY = 'freeai4u.mintPack.dismissed';

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

interface Props {
  /** The open folder; '' means none is open, so there is nowhere to install. */
  root: string;
}

/**
 * The Linux Mint pack offer (upgrade plan B10): five skills for this
 * machine, bundled with the app, offered while the chat is still empty —
 * the first screen, before any network. Installed through hf-skills.js
 * like any other skill: same lint, same ceilings, same record, with
 * textFor supplying the bundled bytes so nothing is fetched.
 */
export default function MintPackCard({ root }: Props) {
  const pack = useMemo(() => mintPack(), []);
  const [records, setRecords] = useState(() => hfSkills.readInstalled());
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState('');
  const [gone, setGone] = useState(dismissed);

  const missing = pack.filter((s) => hfSkills.installStatus(s, records) !== 'installed');
  if (gone || !pack.length || !missing.length) return null;

  const install = async () => {
    if (busy) return;
    if (!root) {
      pushToast('warn', 'Open a folder first — skills land in the folder you are working in.');
      return;
    }
    setBusy(true);
    let done = 0;
    try {
      for (const entry of missing) {
        const result = await hfSkills.installSkill(entry, {
          writeFile: (path: string, text: string) => writeLocalFile(root, path, text),
          // The pack ships no scripts; .ps1 would still be dropped on Linux.
          skipPowerShell: isLinux(),
          textFor: (file) => (file.name === 'SKILL.md' ? entry.text : null),
          otherDescriptions: Object.values(hfSkills.readInstalled())
            .map((r: any) => (r && r.name !== entry.name ? r.description : ''))
            .filter(Boolean),
          onProgress: (p) => setState(p.phase === 'done' ? 'Finishing…' : `Writing ${p.file} (${p.index + 1}/${p.total})`),
        });
        setRecords(hfSkills.rememberInstalled(entry, result));
        done += 1;
        setState(`Installed ${done} of ${missing.length}`);
      }
      pushToast('ok', `Linux Mint pack installed: ${done} skill${done === 1 ? '' : 's'} in ${hfSkills.SKILLS_DIR}.`);
      setState('');
    } catch (e) {
      const why = (e as Error).message || String(e);
      setState(why);
      pushToast('error', why);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="first-run-offer">
      <div className="first-run-offer-body">
        <div className="first-run-offer-title">
          <Icon name="terminal" size={14} /> Linux Mint pack — five skills for this PC
        </div>
        <div className="first-run-offer-hint">
          bash scripting, Mint admin, hardening, troubleshooting and systemd. Bundled with the
          app; installed into {hfSkills.SKILLS_DIR} in your open folder, linted first.
        </div>
        {state && <div className="first-run-offer-state">{state}</div>}
      </div>
      <div className="first-run-offer-actions">
        <button onClick={() => void install()} disabled={busy} title={root ? `Install ${missing.length} skill(s) into ${hfSkills.SKILLS_DIR}` : 'Open a folder first'}>
          {busy ? 'Installing…' : `Install ${missing.length} skill${missing.length === 1 ? '' : 's'}`}
        </button>
        <button
          className="linkish"
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, '1');
            } catch { /* private mode: dismissed for this session only */ }
            setGone(true);
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
