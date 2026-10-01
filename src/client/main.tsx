// Startup.
//
// Short, and every line of it is about not failing. The old version was three
// statements with a non-null assertion on `getElementById`, which meant any
// throw between here and the first paint produced a blank page with nothing on
// it — see index.html for the two mechanisms that actually did that in
// production.
//
// The order below is load-bearing:
//
//   1. the error boundary is the OUTERMOST element, outside BrowserRouter and
//      outside App. A boundary inside the router cannot catch the router
//      throwing, and a bad history entry or a malformed URL is one of the things
//      worth catching.
//   2. the boot layer is told we mounted only after render() has returned, so
//      "mounted" means React genuinely put something on screen rather than
//      "the bundle evaluated".
//   3. nothing optional runs before render. Accessibility settings and the audio
//      context are armed from an effect inside App, so neither can keep the
//      first paint from happening.
//
// global.css must be imported BEFORE App.
//
// Vite emits CSS in module-graph order, so importing App first put every
// component stylesheet ahead of the base layer — and any rule that tied on
// specificity with a global one (`.stamp` vs `.fixture-tag`, say) silently lost
// to the global. Base first, components after, is the order everything else
// here assumes.
import "./styles/global.css";

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

function start() {
  const container = document.getElementById("root");

  // The container is in index.html, so its absence means the document itself is
  // not the one we built. Nothing to render into and nothing to be done about
  // it — but it must not be an unexplained blank page, and the boot layer's
  // failsafe is still armed and will say so.
  if (!container) {
    console.error("startup: #root is missing from the document");
    return;
  }

  if (typeof window !== "undefined") window.__FIQ_STAGE__ = "JS_LOADED";

  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ErrorBoundary>
    </React.StrictMode>
  );

  // Dismisses the loading shell and cancels the nine-second failsafe. In the
  // frame after render, so a synchronous throw out of the initial render is
  // still caught by the failsafe rather than being hidden by a shell we already
  // took down.
  requestAnimationFrame(() => {
    try {
      window.__FIQ_MOUNTED__?.();
    } catch {
      /* the shell is a fallback, not a dependency */
    }
  });
}

try {
  start();
} catch (error) {
  // A throw out here is a module-evaluation or createRoot failure, which the
  // error boundary cannot see because it is not mounted yet. Leave the boot
  // layer's shell and failsafe in place to handle the screen, and make sure the
  // reason is recorded.
  console.error("startup failed", error);
  try {
    window.__FIQ_ERRORS__?.push({
      kind: "startup",
      stage: window.__FIQ_STAGE__ ?? null,
      route: window.location.pathname,
      message: String((error as Error)?.message ?? error).slice(0, 300),
      stack: String((error as Error)?.stack ?? "").split("\n").slice(0, 4).join(" | "),
      at: Date.now(),
    });
  } catch {
    /* nothing left to do */
  }
}
