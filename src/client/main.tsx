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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
