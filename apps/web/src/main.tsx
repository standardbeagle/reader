import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { App } from "./App";
import { initInstallPrompt } from "./installPrompt";
import "./theme.css";
import "./styles.css";

const queryClient = new QueryClient();

initInstallPrompt();
// The service worker serves the real app; the demo is a static bundle where a
// stale cache would pin old seed data.
if ("serviceWorker" in navigator && import.meta.env.VITE_DEMO !== "1") {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/feeds/:feedId" element={<App />} />
          <Route path="/feeds/:feedId/articles/:articleId" element={<App />} />
          <Route path="/lists/:listId" element={<App />} />
          <Route path="/lists/:listId/articles/:articleId" element={<App />} />
          <Route path="/articles/:articleId" element={<App />} />
          <Route path="*" element={<App />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
