// The last line of defence for a render error. Without a boundary React
// unmounts the whole tree and the user gets a blank window with no way out
// except killing the process from the tray. This shows what broke, the way
// back (Relaunch, through Tauri's own restart so the shutdown runs and the
// window state is saved), and where the note went (the crash log).
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { appRelaunch, hasShell, logClientEvent } from '../bridge';

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class CrashScreen extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The console is the only log a webview has of its own; keep the stack
    // there for a report, but never send it anywhere.
    console.error('NeuraOS render error', error, info.componentStack);
    void logClientEvent('render', `${error.name}: ${error.message}${info.componentStack ? ' at' + String(info.componentStack).split('\n').slice(0, 3).join(' ') : ''}`);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash-screen" role="alert">
        <h1>Something in the window broke</h1>
        <p className="crash-message">{error.message || String(error)}</p>
        <div className="crash-actions">
          {hasShell() ? (
            <button className="primary" onClick={() => appRelaunch().catch(() => window.location.reload())}>
              Relaunch NeuraOS
            </button>
          ) : null}
          <button onClick={() => window.location.reload()}>Reload the window</button>
        </div>
        <p className="settings-hint">
          Your chats are saved on this machine and will be there after the relaunch.
        </p>
      </div>
    );
  }
}
