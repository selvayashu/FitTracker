import { useCallback, useSyncExternalStore } from "react";

/** Install-to-home-screen support. Part of the Phase 4 contract (frozen). */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * iPhone/iPad Safari has no install prompt; users add the app from the Share menu.
 * Since iPadOS 13 Safari on iPad reports a Mac user agent, so touch support tells them apart.
 */
export function isIosSafari(ua: string, maxTouchPoints = 0): boolean {
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (/Mobile/.test(ua) || maxTouchPoints > 1));
  const webkit = /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return ios && webkit;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}

// The browser fires `beforeinstallprompt` once, early after load. A listener inside a hook would miss it if the user
// had not opened Settings yet, so it is captured at startup (initInstallCapture, called from main.tsx) and read later.
let deferred: BeforeInstallPromptEvent | null = null;
let installed = typeof window !== "undefined" && isStandalone();
let started = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function initInstallCapture(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as BeforeInstallPromptEvent; notify(); });
  window.addEventListener("appinstalled", () => { installed = true; deferred = null; notify(); });
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getDeferred = () => deferred;
const getInstalled = () => installed;

export interface InstallPrompt {
  /** The browser offered an install prompt we can trigger. */
  canInstall: boolean;
  /** Already running as an installed app. */
  installed: boolean;
  /** Show "Share, then Add to Home Screen" instructions. */
  showIosHint: boolean;
  install: () => Promise<"accepted" | "dismissed" | "unavailable">;
}

export function useInstallPrompt(): InstallPrompt {
  const event = useSyncExternalStore(subscribe, getDeferred, () => null);
  const isInstalled = useSyncExternalStore(subscribe, getInstalled, () => false);

  const install = useCallback(async () => {
    const e = deferred;
    if (!e) return "unavailable" as const;
    await e.prompt();
    const { outcome } = await e.userChoice;
    deferred = null; // the event can only be used once
    notify();
    return outcome;
  }, []);

  const nav = typeof navigator === "undefined" ? null : navigator;
  return {
    canInstall: event !== null && !isInstalled,
    installed: isInstalled,
    showIosHint: !isInstalled && isIosSafari(nav?.userAgent ?? "", nav?.maxTouchPoints ?? 0),
    install,
  };
}
