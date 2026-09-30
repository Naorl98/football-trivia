// Accessibility preferences.
//
// Everything here is applied by writing data attributes and a CSS custom
// property onto <html>, so the styling lives in CSS and this module only
// decides state. That keeps the settings working on every screen without any
// component needing to know they exist.
//
// Storage is gated on the "preferences" consent category, exactly like the
// sound toggle: without consent the choices still apply for the session, they
// are simply not written to disk.

import { privacy } from "./privacy.ts";
import { sound } from "./sound.ts";

export interface A11ySettings {
  /** Root font scale. Every size in the product is relative, so this moves all of it. */
  textScale: number;
  highContrast: boolean;
  /** true = animations suppressed. */
  reduceMotion: boolean;
  underlineLinks: boolean;
}

const STORAGE_KEY = "fiq_a11y_v1";

/** The steps the +/- buttons walk through. 1 is the design's intended size. */
export const TEXT_SCALES = [0.9, 1, 1.15, 1.3, 1.5] as const;

export const DEFAULT_SETTINGS: A11ySettings = {
  textScale: 1,
  highContrast: false,
  reduceMotion: false,
  underlineLinks: false,
};

/** Tolerant parse: anything unexpected falls back to the default for that field. */
export function parseSettings(raw: string | null): A11ySettings {
  if (!raw) return DEFAULT_SETTINGS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_SETTINGS;
  const o = parsed as Record<string, unknown>;
  const scale = typeof o.textScale === "number" && TEXT_SCALES.includes(o.textScale as never)
    ? (o.textScale as number)
    : DEFAULT_SETTINGS.textScale;
  return {
    textScale: scale,
    highContrast: o.highContrast === true,
    reduceMotion: o.reduceMotion === true,
    underlineLinks: o.underlineLinks === true,
  };
}

/** Next scale in the given direction, clamped at both ends. */
export function stepScale(current: number, direction: 1 | -1): number {
  const index = TEXT_SCALES.indexOf(current as never);
  const from = index === -1 ? TEXT_SCALES.indexOf(1 as never) : index;
  const next = Math.min(TEXT_SCALES.length - 1, Math.max(0, from + direction));
  return TEXT_SCALES[next];
}

class A11yStore {
  private settings: A11ySettings = DEFAULT_SETTINGS;
  private listeners = new Set<(s: A11ySettings) => void>();

  /** Called once at startup, after the DOM exists. */
  init() {
    if (typeof document === "undefined") return;
    if (privacy.allows("preferences")) {
      try {
        this.settings = parseSettings(localStorage.getItem(STORAGE_KEY));
      } catch {
        this.settings = DEFAULT_SETTINGS;
      }
    }
    this.apply();
  }

  get(): A11ySettings {
    return this.settings;
  }

  subscribe(listener: (s: A11ySettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(patch: Partial<A11ySettings>) {
    this.settings = { ...this.settings, ...patch };
    this.apply();
    this.persist();
    this.listeners.forEach((l) => l(this.settings));
  }

  reset() {
    this.set({ ...DEFAULT_SETTINGS });
  }

  private persist() {
    if (!privacy.allows("preferences")) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Session-only is an acceptable degradation.
    }
  }

  private apply() {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.style.setProperty("--text-scale", String(this.settings.textScale));
    root.dataset.contrast = this.settings.highContrast ? "high" : "normal";
    root.dataset.motion = this.settings.reduceMotion ? "off" : "on";
    root.dataset.underlineLinks = this.settings.underlineLinks ? "on" : "off";
  }
}

export const a11y = new A11yStore();

/**
 * True when motion should be suppressed, for the JS-driven effects that CSS
 * cannot reach (canvas bursts, timed overlays). Checks both the OS setting and
 * the in-app switch.
 */
export function motionAllowed(): boolean {
  if (a11y.get().reduceMotion) return false;
  if (typeof window === "undefined") return true;
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** The menu's sound switch delegates here so there is one source of truth. */
export function setSoundEnabled(enabled: boolean) {
  sound.setEnabled(enabled);
}
