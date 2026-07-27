import { Component, type ReactNode } from "react";

type ErrorBoundaryState = { message?: string };

// Without this, any render error silently unmounts the whole overlay (FAB and
// drawer vanish with nothing in the page UI).
export default class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  render() {
    if (this.state.message !== undefined) {
      return (
        <div className="jtRoot">
          <p className="jtError">JobTracker widget crashed: {this.state.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
