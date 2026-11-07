import { Component, type ReactNode } from 'react';
import { AppShell } from './ui/AppShell';

interface BoundaryState {
  error: Error | null;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col justify-center gap-4 px-8">
          <h1 className="font-display text-3xl">The analyzer hit an error</h1>
          <pre className="max-w-3xl overflow-auto text-sm opacity-80">{this.state.error.message}</pre>
          <button
            className="w-fit rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950"
            onClick={() => window.location.reload()}
            type="button"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AppShell />
    </AppErrorBoundary>
  );
}
