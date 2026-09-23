// One button that fetches one runtime (Node 24, a llama.cpp build) into the
// app's own folder and shows the download as it goes. It says what was and
// was not verified: nodejs.org publishes a sha256 and it is checked;
// GitHub's llama.cpp releases publish none, so that one is TLS-only and the
// result says so instead of implying more.
import { useEffect, useState } from 'react';
import { onRuntimeDownload, runtimeInstall, type RuntimeKind, type RuntimeProgress } from '../bridge';
import { pushToast } from './Toasts';

type Props = {
  kind: RuntimeKind;
  label: string;
  /** Called with the install result once the runtime is in place. */
  onDone?: () => void;
  disabled?: boolean;
  title?: string;
};

function human(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export default function RuntimeButton({ kind, label, onDone, disabled, title }: Props) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<RuntimeProgress | null>(null);

  useEffect(() => {
    let off = () => {};
    onRuntimeDownload((p) => { if (p.kind === kind) setProgress(p); }).then((fn) => { off = fn; });
    return () => off();
  }, [kind]);

  const start = async () => {
    setBusy(true);
    setProgress(null);
    try {
      const result = await runtimeInstall(kind);
      pushToast('ok', `${label}: installed${result.version ? ` (${result.version})` : result.tag ? ` (${result.tag})` : ''}${result.verified ? ', sha256 verified' : ' — no digest is published for this release, so only TLS was checked'}.`);
      onDone?.();
    } catch (e) {
      pushToast('error', `${label}: ${(e as Error).message || String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const line = !progress ? '' :
    progress.phase === 'resolve' ? 'Finding the newest release…' :
    progress.phase === 'download' ? `Downloading ${human(progress.received)}${progress.total ? ` of ${human(progress.total)}` : ''}…` :
    progress.phase === 'extract' ? 'Unpacking…' :
    progress.phase === 'error' ? progress.error : '';

  return (
    <span className="runtime-button">
      <button type="button" onClick={start} disabled={busy || disabled} title={title}>
        {busy ? 'Working…' : label}
      </button>
      {busy && line && <span className="settings-hint">{line}</span>}
    </span>
  );
}
