// The root error boundary.
//
// WHAT IT IS FOR. React 19 unmounts the entire root when a render throws with no
// boundary above it. The container is emptied, nothing is logged where a visitor
// can see it, and the result is a blank page — the same symptom as a failed
// bundle, from a completely different cause. Reproduced against production
// before this file existed: with storage access refused (Safari's "block all
// cookies"), /play and /results both threw inside render and both went white.
//
// So this is not a nicety. It is the difference between one feature failing and
// the product disappearing.
//
// WHY RETRY IS TWO BUTTONS AND NOT ONE. "Try again" re-mounts the tree, which
// fixes a transient failure — a fetch that rejected, a race on first paint — and
// does nothing at all for a persistent one, because the same render will throw
// the same way. So there is a second route: go home, which navigates away from
// whatever state the broken route was in. A visitor stuck in a loop on /results
// needs the second one, and a single "try again" would have left them pressing
// it forever.
//
// Deliberately a class component. Error boundaries are the one thing in React
// that hooks still cannot express.

import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  /** Bumped on retry, and used as a key so the subtree is rebuilt rather than reused. */
  attempt: number;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Tell the boot layer to stand down: it is still holding a loading shell and
    // a nine-second failsafe, and both would now be fighting this screen.
    try {
      window.__FIQ_BOUNDARY__?.();
    } catch {
      /* the boot script is optional, not load-bearing, from here on */
    }

    // The stack goes to the console, which is where a developer looks, and to
    // the bounded in-page buffer the QA harness reads. Nothing is sent anywhere
    // and nothing about the visitor is recorded.
    console.error("react error boundary", {
      route: window.location.pathname,
      message: error?.message,
      componentStack: info?.componentStack?.split("\n").slice(0, 6).join(" | "),
    });
    try {
      window.__FIQ_ERRORS__?.push({
        kind: "react",
        stage: window.__FIQ_STAGE__ ?? null,
        route: window.location.pathname,
        message: String(error?.message ?? "").slice(0, 300),
        stack: String(error?.stack ?? "").split("\n").slice(0, 4).join(" | "),
        at: Date.now(),
      });
    } catch {
      /* diagnostics must never be the thing that throws */
    }
  }

  private retry = () => {
    // Clearing the error and changing the key together is what makes this a real
    // retry: React rebuilds the subtree from scratch instead of reusing the
    // instances that were mid-failure.
    this.setState((previous) => ({ error: null, attempt: previous.attempt + 1 }));
  };

  render() {
    if (!this.state.error) {
      /*
        A KEYED FRAGMENT, NOT A KEYED DIV.

        The key is what makes "try again" a real retry: changing it makes React
        treat this as a different element and rebuild the subtree from scratch
        rather than reusing instances that were mid-failure.

        It was a `<div>` first, and that was a layout bug. `#root` is a flex
        column whose direct children are the header (`flex: none`), `.app-main`
        (`flex: 1`) and the footer; wrapping them in an unstyled block element
        left `#root` with a single child and made `flex: 1` meaningless, so the
        main region no longer filled the viewport and the footer no longer sat
        at the bottom. A Fragment carries the key without putting a node in the
        tree, which is exactly what is wanted here.
      */
      return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
    }

    return (
      <div className="page boot-recover" role="alert">
        <div className="boot-recover-card">
          <svg className="boot-recover-mark" viewBox="0 0 48 48" aria-hidden="true">
            <circle cx="24" cy="24" r="16.5" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.35" />
            <path d="M24 14.5l6.3 4.6-2.4 7.4h-7.8L17.7 19z" fill="currentColor" />
          </svg>

          <h1 className="boot-recover-title">משהו השתבש בטעינת המשחק</h1>
          <p className="boot-recover-body">
            זה לא קרה בגללכם. אפשר לנסות שוב, ואם זה חוזר — לחזור לדף הבית ולהתחיל מחדש.
          </p>

          <div className="boot-recover-actions">
            <button type="button" className="btn btn-primary" onClick={this.retry}>
              נסו שוב
            </button>
            {/* A real navigation, not a client-side one: the router itself may be
                part of what failed, and an <a> does not need it to work. */}
            <a className="btn btn-quiet" href="/">
              חזרה לדף הבית
            </a>
          </div>
        </div>
      </div>
    );
  }
}
