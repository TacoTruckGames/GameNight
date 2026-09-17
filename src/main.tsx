import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { createQueryClient } from "./api/hooks";
import { ToastProvider } from "./components/Toast";
import { IdentityProvider } from "./identity/IdentityContext";
import { trackScrollbarGutter } from "./lib/scrollbar";
import "./theme/tokens.css";
import "./theme/base.css";

// Before the first paint: the bars read `--scrollbar-gutter` on their first layout.
trackScrollbarGutter();

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

// Provider order matters: identity reads the query client (it clears the cache
// when you switch people) and the router (the board and `/admin` remember
// different people, and the path is what says which), and the query hooks toast
// on RSVP conflicts.
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <BrowserRouter>
          <IdentityProvider>
            <App />
          </IdentityProvider>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
