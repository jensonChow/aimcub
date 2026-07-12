/**
 * Aimcub Glass — the renderer theme-preference store.
 *
 * One tiny external store so every surface that can change appearance (the sidebar
 * account menu's Appearance row and Settings → General) reads and writes the same
 * preference. The value is localStorage-persisted; applying it to the NATIVE window
 * chrome stays in CockpitShell (single `setThemeSource` effect) so an in-app override
 * never desyncs the titlebar/traffic-light context from the visible content.
 */
import { useSyncExternalStore } from "react";

export type ThemePref = "system" | "light" | "dark";

const THEME_PREF_STORAGE_KEY = "aimcub.themePref";
const listeners = new Set<() => void>();

function readStoredThemePref(): ThemePref {
  if (typeof window === "undefined") return "system";
  const raw = window.localStorage.getItem(THEME_PREF_STORAGE_KEY);
  return raw === "light" || raw === "dark" ? raw : "system";
}

let themePref: ThemePref = readStoredThemePref();

export function getThemePref(): ThemePref {
  return themePref;
}

export function setThemePref(next: ThemePref): void {
  if (next === themePref) return;
  themePref = next;
  if (typeof window !== "undefined") {
    if (next === "system") window.localStorage.removeItem(THEME_PREF_STORAGE_KEY);
    else window.localStorage.setItem(THEME_PREF_STORAGE_KEY, next);
  }
  for (const listener of listeners) listener();
}

function subscribeThemePref(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribeThemePref, getThemePref, getThemePref);
}
