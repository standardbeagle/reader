import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function toggleTheme(): void {
  const next: Theme = getTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("reader-theme", next);
  window.dispatchEvent(new Event("reader-theme"));
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => { window.addEventListener("reader-theme", cb); return () => window.removeEventListener("reader-theme", cb); },
    getTheme,
  );
}
