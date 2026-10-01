// A boundary for things the product can live without.
//
// WHY THIS EXISTS, in one sentence: a consent bar measuring its own height took
// down the entire game, and the root error boundary — which is what caught it —
// was the wrong place to catch it.
//
// The failure, which is worth stating because the fix is shaped by it: the
// privacy bar's layout effect called `new ResizeObserver(...)` with no feature
// detection. On a browser without it, that throws from a passive effect, i.e.
// after the first paint. React propagates an error thrown in an effect up to the
// nearest error boundary, so a page that had fully rendered — header, hero,
// headline, all visible — emptied itself a moment later.
//
// Guarding that one call fixes that one bug. It does not fix the shape of the
// problem, which is that every optional piece of furniture in the tree had the
// authority to destroy the product. The root boundary is a last resort for "the
// app is broken"; it should never be what handles "the consent bar could not
// measure itself", because the honest response to the second one is to carry on
// without the bar.
//
// So: anything that is not the game gets wrapped in one of these. If it throws,
// it renders nothing and the rest of the page is untouched. The failure is
// recorded for diagnosis rather than shown, because there is nothing a visitor
// could usefully do about a missing privacy bar — and a scary error banner in
// place of a working game would be a worse outcome than the quiet one.
//
// WHAT MUST NOT BE WRAPPED IN THIS. The routes themselves. If the quiz board
// throws, silently rendering nothing is exactly the blank page this whole phase
// has been about; that belongs to the root ErrorBoundary, which says so and
// offers a way out.

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Named in the diagnostic, so a failure says which feature it was. */
  feature: string;
  children: ReactNode;
  /** Rendered instead, when something better than nothing exists. Usually nothing does. */
  fallback?: ReactNode;
}

interface State {
  failed: boolean;
}

export class FeatureBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Deliberately a warning, not an error: this did not break the product, and
    // logging it as a failure would train whoever reads the console to ignore
    // the ones that did.
    console.warn(`optional feature "${this.props.feature}" failed and was dropped`, {
      message: error?.message,
      componentStack: info?.componentStack?.split("\n").slice(0, 4).join(" | "),
    });

    try {
      window.__FIQ_ERRORS__?.push({
        kind: `feature:${this.props.feature}`,
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

  render() {
    if (this.state.failed) return this.props.fallback ?? null;
    return this.props.children;
  }
}
