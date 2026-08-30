type InstallPromptEvent = Event & {
  prompt: () => void;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredEvent: InstallPromptEvent | null = null;
const listeners = new Set<(available: boolean) => void>();

export function canInstall(): boolean {
  return deferredEvent !== null;
}

export function onInstallAvailability(listener: (available: boolean) => void): () => void {
  listeners.add(listener);
  listener(canInstall());
  return () => listeners.delete(listener);
}

export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches
    || "standalone" in window.navigator;
}

export function promptInstall(): boolean {
  if (!deferredEvent) return false;
  void deferredEvent.userChoice.finally(() => {
    deferredEvent = null;
    listeners.forEach((l) => l(false));
  });
  deferredEvent.prompt();
  return true;
}

export function initInstallPrompt(): () => void {
  const onBeforeInstall = (event: Event) => {
    event.preventDefault();
    deferredEvent = event as InstallPromptEvent;
    listeners.forEach((l) => l(true));
  };
  window.addEventListener("beforeinstallprompt", onBeforeInstall);
  const onInstalled = () => {
    deferredEvent = null;
    listeners.forEach((l) => l(false));
  };
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    window.removeEventListener("appinstalled", onInstalled);
  };
}
