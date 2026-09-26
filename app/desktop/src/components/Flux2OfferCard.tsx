import { useEffect, useState } from 'react';
import { call, hasShell } from '../bridge';
import Icon from './Icon';
import { NAVIGATE_EVENT } from '../Sidebar';
// UMD: loaded for its side effect, read off globalThis.
import '../flux-setup.js';

const flux: typeof import('../flux-setup.js') = (globalThis as any).FreeAI4UFluxSetup;

const DISMISS_KEY = 'freeai4u.flux2.dismissed';

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The FLUX.2 first-run offer (upgrade plan E3): pictures drawn on THIS PC,
 * offered where the app begins — an empty chat — and only while something
 * is actually left to set up. The three steps themselves belong to Images
 * (LocalImagesCard drives them through flux-setup.js); this card's whole
 * job is to say the feature exists and take the person there, so it asks
 * the shell once, hides when the setup is already done, and remembers a
 * "Not now".
 */
export default function Flux2OfferCard() {
  const [gone, setGone] = useState(dismissed);
  const [checked, setChecked] = useState(false);
  const [needed, setNeeded] = useState(false);

  useEffect(() => {
    if (gone || checked) return;
    // No shell: there is nothing this app can set up, so there is no offer.
    if (!hasShell()) { setChecked(true); return; }
    let alive = true;
    Promise.all([
      call<any>('sd_find').catch(() => null),
      call<any>('sd_status').catch(() => null),
    ]).then(([facts, status]) => {
      if (!alive) return;
      setNeeded(!!flux.next(flux.steps(facts || {}, status || {})));
      setChecked(true);
    }).catch(() => { if (alive) setChecked(true); });
    return () => { alive = false; };
  }, [gone, checked]);

  if (gone || !checked || !needed) return null;

  const openImages = () => {
    window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: { view: 'images' } }));
  };

  return (
    <div className="first-run-offer">
      <div className="first-run-offer-body">
        <div className="first-run-offer-title">
          <Icon name="image" size={14} /> FLUX.2 on this PC — draw pictures locally
        </div>
        <div className="first-run-offer-hint">
          Three steps: the sd-server build, a FLUX.2 model set, and the server running.
          Free and private — the pictures never leave this machine. The setup lives in Images.
        </div>
      </div>
      <div className="first-run-offer-actions">
        <button onClick={openImages} title="Open Images, where the three steps are">
          Set up in Images
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
