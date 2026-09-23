// NeuraOS Voice Type (docs/MASTER_PLAN.md section 6): hold a chord anywhere
// on the desktop, speak, let go, and the words are typed into whatever app
// has focus. Mint has no Win+H; this is its replacement. The mic and Whisper
// are the same ones the composer's dictation uses (dictate.ts); the typing
// is the shell's (desktop.rs: xdotool on X11, wtype on Wayland).
//
// The chord and the on/off switch live in localStorage and are registered
// with the shell at start (init) and whenever Settings changes them.
import { hasShell, onVoiceType, voiceHotkeySet, voiceTypeText, notifyUser } from './bridge';
import { startRecording, transcribeAuto, type Recording } from './dictate';

export const VOICE_TYPE_KEY = 'neuraos.voice_type';
export const VOICE_HOTKEY_KEY = 'neuraos.voice_type_hotkey';
export const DEFAULT_VOICE_HOTKEY = 'ctrl+alt+v';

export function readEnabled(): boolean {
  try { return localStorage.getItem(VOICE_TYPE_KEY) === '1'; } catch { return false; }
}

export function readHotkey(): string {
  try { return (localStorage.getItem(VOICE_HOTKEY_KEY) || DEFAULT_VOICE_HOTKEY).trim() || DEFAULT_VOICE_HOTKEY; } catch { return DEFAULT_VOICE_HOTKEY; }
}

/** Save and apply: an empty chord, or off, releases the hotkey. */
export async function apply(enabled: boolean, hotkey: string): Promise<string> {
  try {
    localStorage.setItem(VOICE_TYPE_KEY, enabled ? '1' : '0');
    localStorage.setItem(VOICE_HOTKEY_KEY, hotkey);
  } catch { /* the shell still takes it for this session */ }
  if (!hasShell()) return '';
  return voiceHotkeySet(enabled ? hotkey : '');
}

let recording: Recording | null = null;
let busy = false;

/** Called once from App: registers the saved chord and listens for it. */
export function init(getHfToken: () => string): () => void {
  if (!hasShell()) return () => {};
  if (readEnabled()) voiceHotkeySet(readHotkey()).catch(() => { /* Settings shows the reason on its next open */ });
  let off = () => {};
  onVoiceType(async (state) => {
    if (state === 'start') {
      if (recording || busy) return;
      try {
        recording = await startRecording();
      } catch (e) {
        notifyUser('Voice Type', `Microphone: ${((e as Error).message || String(e)).split('\n')[0]}`);
      }
      return;
    }
    const rec = recording;
    recording = null;
    if (!rec) return;
    busy = true;
    try {
      const words = await transcribeAuto(await rec.stop(), getHfToken());
      if (words.trim()) await voiceTypeText(words.trim() + ' ');
    } catch (e) {
      notifyUser('Voice Type', ((e as Error).message || String(e)).split('\n')[0]);
    } finally {
      busy = false;
    }
  }).then((fn) => { off = fn; });
  return () => off();
}
