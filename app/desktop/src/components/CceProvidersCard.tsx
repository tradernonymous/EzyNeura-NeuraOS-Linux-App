import { useEffect, useState } from 'react';
import { api } from '../api';
import { hasShell, secretGet, secretSet } from '../bridge';
import '../cce-providers.js';
import type {} from '../cce-providers.js';

const cce: typeof import('../cce-providers.js') = (globalThis as any).FreeAI4UCceProviders;

// CCE-style provider manager card: star/default, disable, key via OS keyring,
// test connection, model counts. Chat, Code and Images all read api.providers()
// so one card serves all three.
export default function CceProvidersCard({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [star, setStar] = useState(cce.starred());
  const [off, setOff] = useState<string[]>(cce.disabled());
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');

  const load = () => {
    api.providers().then((r: any) => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([]));
    setStar(cce.starred()); setOff(cce.disabled());
  };
  useEffect(() => { load(); }, []);

  const saveKey = async (id: string) => {
    if (!hasShell()) { setMsg('Keys need the installed app (OS keyring).'); return; }
    try {
      await secretSet(cce.secretKey(id), keys[id] || '');
      setMsg(`Saved ${id} key to OS keyring. Restart the engine to apply.`);
      onChanged?.();
    } catch (e) { setMsg((e as Error).message); }
  };
  const test = async (id: string) => {
    try {
      const ms: any = await api.models(id);
      const n = Array.isArray(ms) ? ms.length : (Array.isArray(ms?.models) ? ms.models.length : 0);
      setMsg(`${id}: ok, ${n} models.`);
    } catch (e) { setMsg(`${id}: ${(e as Error).message}`); }
  };

  const merged = cce.PRESETS.map((p) => {
    const live = rows.find((r: any) => r.id === p.id);
    return { ...p, configured: !!live?.configured, label: live?.label || p.label };
  });

  return (
    <div className="settings-card">
      <div className="setting-row"><span className="setting-label">CCE providers</span>
        <span className="settings-hint">Star = default · unchecked = hidden · keys in OS keyring</span></div>
      {merged.map((p) => (
        <div key={p.id} className="provider-row" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button title="Star as default" onClick={() => { cce.setStarred(p.id); setStar(p.id); onChanged?.(); }}>
            {star === p.id ? '★' : '☆'}</button>
          <label className="toggle" title="Disable (hide from pickers)">
            <input type="checkbox" checked={off.includes(p.id)}
              onChange={() => { setOff(cce.toggleDisabled(p.id).slice()); onChanged?.(); }} /></label>
          <span className="setting-label">{p.label} <span className="settings-hint">{p.configured ? 'ready' : (p.note || p.envVar || '')}</span></span>
          {(p.envVar) && (
            <>
              <input type="password" placeholder={`${p.envVar}`} value={keys[p.id] || ''}
                onChange={(e) => setKeys({ ...keys, [p.id]: e.target.value })}
                style={{ flex: 1, minWidth: 140 }} aria-label={`${p.id} key`} />
              <button onClick={() => saveKey(p.id)}>Save</button>
            </>
          )}
          <button onClick={() => test(p.id)}>Test</button>
        </div>
      ))}
      {msg && <p className="settings-hint">{msg}</p>}
      <p className="settings-hint">Catalog: models.dev (cached 24h) + bundled presets offline. Restart engine after saving keys.</p>
    </div>
  );
}
