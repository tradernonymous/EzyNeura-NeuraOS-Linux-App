// Desktop control (docs/MASTER_PLAN.md L9): whether a model in Chat may see
// the screen and act on the desktop, and the screen-ask chord. Off by
// default: a screenshot shows whatever is on screen, and a click or a
// keystroke lands in whichever app is in front, so both are a person's
// decision -- once here, and again on every call (tools.js ASKS).
import { hasShell } from './bridge';
import { isLinux } from './platform';

export const DESKTOP_CONTROL_KEY = 'neuraos.desktop_control';
/** Fired (window) to take a screenshot into the current chat. */
export const SCREEN_ASK_EVENT = 'neuraos:screen-ask';
export const SCREEN_HOTKEY_KEY = 'neuraos.screen_hotkey';
export const DEFAULT_SCREEN_HOTKEY = 'Ctrl+Alt+S';

export function desktopControlOn(): boolean {
  try {
    return localStorage.getItem(DESKTOP_CONTROL_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDesktopControl(on: boolean): void {
  try {
    localStorage.setItem(DESKTOP_CONTROL_KEY, on ? '1' : '0');
  } catch { /* this session has it */ }
}

/** The desktop tools are offered only where the shell can actually do them. */
export function desktopToolsAvailable(): boolean {
  return hasShell() && isLinux() && desktopControlOn();
}

export function readScreenHotkey(): string {
  try {
    return localStorage.getItem(SCREEN_HOTKEY_KEY) || DEFAULT_SCREEN_HOTKEY;
  } catch {
    return DEFAULT_SCREEN_HOTKEY;
  }
}

export function askAboutScreen(): void {
  window.dispatchEvent(new CustomEvent(SCREEN_ASK_EVENT));
}
