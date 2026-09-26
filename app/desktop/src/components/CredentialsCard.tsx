// Settings → Credentials (C10, the credential broker's front half): the
// saved hosts and addresses a model's ssh_run / http_auth may name. The
// values go one way — the form into the OS keyring (secret_set →
// secrets.rs) — and this card keeps only a non-secret index (name, kind,
// one display line) in localStorage, so nothing here can be read back as a
// credential. What the broker returns is the command's output or the
// request's answer; the key itself never leaves the shell.
import { useState } from 'react';
import { call, hasShell, secretDelete, secretSet } from '../bridge';
import { pushToast } from './Toasts';
import '../credentials.js';

const creds: typeof import('../credentials.js') = (globalThis as any).FreeAI4UCredentials;

const emptySsh = { name: '', user: '', host: '', port: '', identity: '' };
const emptyApi = { name: '', base: '', header: '', prefix: '', secret: '' };

export default function CredentialsCard() {
  const [entries, setEntries] = useState(() => creds.list());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [ssh, setSsh] = useState(emptySsh);
  const [api, setApi] = useState(emptyApi);

  if (!hasShell()) return null;

  const saveSsh = async () => {
    setError('');
    const name = ssh.name.trim();
    const key = creds.keyFor('ssh', name);
    if (!key) { setError('The name is lowercase letters, digits, dot, dash or underscore — as in nas.'); return; }
    const built = creds.sshProfile(ssh);
    if (built.error || !built.profile) { setError(built.error || 'That host was refused.'); return; }
    try {
      await secretSet(key, built.profile);
      creds.remember('ssh', name, built.detail || '');
      setEntries(creds.list());
      setSsh(emptySsh);
      pushToast('ok', `Saved ${name}. The key sits in your login keyring, not in this app.`);
    } catch (e) {
      setError(String((e as Error).message || e).split('\n')[0]);
    }
  };

  const saveApi = async () => {
    setError('');
    const name = api.name.trim();
    const key = creds.keyFor('api', name);
    if (!key) { setError('The name is lowercase letters, digits, dot, dash or underscore — as in home.'); return; }
    const built = creds.apiProfile(api);
    if (built.error || !built.profile) { setError(built.error || 'That address was refused.'); return; }
    try {
      await secretSet(key, built.profile);
      creds.remember('api', name, built.detail || '');
      setEntries(creds.list());
      setApi(emptyApi);
      pushToast('ok', `Saved ${name}. The secret sits in your login keyring.`);
    } catch (e) {
      setError(String((e as Error).message || e).split('\n')[0]);
    }
  };

  const drop = async (kind: string, name: string) => {
    try {
      await secretDelete(creds.keyFor(kind, name));
    } catch { /* already gone: the index still comes off */ }
    creds.forget(kind, name);
    setEntries(creds.list());
    pushToast('info', `Removed ${name}.`);
  };

  const test = async (row: import('../credentials.js').CredentialEntry) => {
    setBusy(`${row.kind}:${row.name}`);
    try {
      const out = row.kind === 'ssh'
        ? await call<string>('credential_op', { op: 'ssh_run', args: { target: row.name, command: 'echo ok', timeout_ms: 15_000 } })
        : await call<string>('credential_op', { op: 'http_auth', args: { name: row.name, path: '/' } });
      pushToast('ok', `${row.name}: ${out.split('\n')[0]}`);
    } catch (e) {
      pushToast('error', `${row.name}: ${String((e as Error).message || e).split('\n')[0]}`);
    } finally {
      setBusy('');
    }
  };

  const rows = (kind: 'ssh' | 'api') => entries.filter((e) => e.kind === kind);

  return (
    <section className="settings-section">
      <h2>Credentials</h2>
      <div className="settings-card">
        <p className="settings-hint">
          Saved logins for the two broker tools — <span className="mono">ssh_run</span> and <span className="mono">http_auth</span>.
          The values go straight into your OS login keyring; a model names the entry and gets only the command's output or
          the response back, never the key. Every call still shows an Allow card first.
        </p>
        {error && <p className="chip-note" role="alert">{error}</p>}

        <h3 className="local-heading">SSH hosts</h3>
        {rows('ssh').length ? (
          <div className="local-catalogue">
            {rows('ssh').map((row) => (
              <div key={`ssh:${row.name}`} className="local-row">
                <div className="local-row-main">
                  <span className="local-row-name"><span className="mono">{row.name}</span><span className="chip">ssh</span></span>
                  <span className="local-row-note">{row.detail}</span>
                </div>
                <button type="button" onClick={() => void test(row)} disabled={!!busy}>Test</button>
                <button type="button" onClick={() => void drop('ssh', row.name)}>Remove</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="settings-hint">No host saved. A model can then run a command on it without ever holding the login.</p>
        )}
        <div className="credential-form">
          <input placeholder="name (nas)" value={ssh.name} aria-label="Host name"
            onChange={(e) => setSsh({ ...ssh, name: e.target.value })} />
          <input placeholder="user (jack)" value={ssh.user} aria-label="User"
            onChange={(e) => setSsh({ ...ssh, user: e.target.value })} />
          <input placeholder="host (nas.local)" value={ssh.host} aria-label="Host"
            onChange={(e) => setSsh({ ...ssh, host: e.target.value })} />
          <input placeholder="port" inputMode="numeric" value={ssh.port} aria-label="Port"
            onChange={(e) => setSsh({ ...ssh, port: e.target.value })} />
          <textarea rows={2} aria-label="Private key" className="credential-key"
            placeholder="Optional private key, pasted here once — it goes to the keyring and is never shown again"
            value={ssh.identity} onChange={(e) => setSsh({ ...ssh, identity: e.target.value })} />
          <button type="button" onClick={() => void saveSsh()} disabled={!ssh.name.trim() || !ssh.user.trim() || !ssh.host.trim()}>
            Save host
          </button>
        </div>

        <h3 className="local-heading">API addresses</h3>
        {rows('api').length ? (
          <div className="local-catalogue">
            {rows('api').map((row) => (
              <div key={`api:${row.name}`} className="local-row">
                <div className="local-row-main">
                  <span className="local-row-name"><span className="mono">{row.name}</span><span className="chip">api</span></span>
                  <span className="local-row-note">{row.detail}</span>
                </div>
                <button type="button" onClick={() => void test(row)} disabled={!!busy}>Test</button>
                <button type="button" onClick={() => void drop('api', row.name)}>Remove</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="settings-hint">No address saved. A request then goes out with the credential attached, but only to the address saved with it — never a model's choosing.</p>
        )}
        <div className="credential-form">
          <input placeholder="name (home)" value={api.name} aria-label="Credential name"
            onChange={(e) => setApi({ ...api, name: e.target.value })} />
          <input placeholder="https://api.example.com/v1" value={api.base} aria-label="Base address"
            onChange={(e) => setApi({ ...api, base: e.target.value })} />
          <input placeholder="header (Authorization)" value={api.header} aria-label="Header"
            onChange={(e) => setApi({ ...api, header: e.target.value })} />
          <input placeholder="prefix (Bearer )" value={api.prefix} aria-label="Prefix"
            onChange={(e) => setApi({ ...api, prefix: e.target.value })} />
          <input placeholder="secret" type="password" autoComplete="off" value={api.secret} aria-label="Secret"
            onChange={(e) => setApi({ ...api, secret: e.target.value })} />
          <button type="button" onClick={() => void saveApi()} disabled={!api.name.trim() || !api.base.trim() || !api.secret}>
            Save address
          </button>
        </div>
      </div>
    </section>
  );
}
