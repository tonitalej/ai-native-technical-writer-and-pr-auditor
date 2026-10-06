import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <main className="panel config-error stack">
          <h1>This page hit a snag</h1>
          <p className="muted">Refresh the page. If it keeps happening, sign out and back in.</p>
          <button type="button" className="btn" onClick={() => window.location.assign('/repositories')}>
            Back to repositories
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
