// Football IQ sound design.
//
// Sounds are synthesised with the Web Audio API rather than shipped as audio
// files. That keeps the bundle at zero extra bytes, means nothing to preload or
// cache, and lets every cue be tuned in code. The palette is deliberately
// broadcast-like — short filtered tones and a crowd-ish noise swell — rather
// than arcade blips.
//
// Rules this module guarantees:
//   * nothing is created until the player's first gesture (autoplay policy)
//   * the preference persists in localStorage ONLY with "preferences" consent;
//     without it the toggle still works, it just lives for the session
//   * any audio failure is swallowed — sound must never break gameplay

import { privacy } from "./privacy";

export type SoundName =
  | "click"
  | "correct"
  | "wrong"
  | "next"
  | "streak"
  | "complete"
  | "reveal"
  | "hint";

const STORAGE_KEY = "fiq_sound_enabled";

function readPreference(): boolean {
  if (!privacy.allows("preferences")) return true;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = readPreference();
  private unlocked = false;
  private listeners = new Set<(enabled: boolean) => void>();

  isEnabled(): boolean {
    return this.enabled;
  }

  subscribe(listener: (enabled: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    // No "preferences" consent means the choice is honoured for this session
    // but never written to disk.
    if (privacy.allows("preferences")) {
      try {
        localStorage.setItem(STORAGE_KEY, String(enabled));
      } catch {
        // Private mode / blocked storage — the session still honours the toggle.
      }
    }
    this.listeners.forEach((l) => l(enabled));
    if (enabled) this.unlock();
  }

  toggle() {
    this.setEnabled(!this.enabled);
  }

  /** Called on the first real user gesture; browsers require this. */
  unlock() {
    if (this.unlocked) return;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.28;
      this.master.connect(this.ctx.destination);
      this.unlocked = true;
    } catch {
      this.ctx = null;
    }
    void this.ctx?.resume().catch(() => {});
  }

  private tone(opts: {
    freq: number;
    type?: OscillatorType;
    start?: number;
    duration?: number;
    gain?: number;
    sweepTo?: number;
  }) {
    if (!this.ctx || !this.master) return;
    const { freq, type = "sine", start = 0, duration = 0.18, gain = 0.6, sweepTo } = opts;
    const t0 = this.ctx.currentTime + start;

    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t0 + duration);

    // Short attack, exponential release — reads as a soft mallet rather than a beep.
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(env);
    env.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  /** Filtered noise burst — stands in for a crowd swell or a net ripple. */
  private noise(opts: { start?: number; duration?: number; gain?: number; freq?: number; q?: number }) {
    if (!this.ctx || !this.master) return;
    const { start = 0, duration = 0.5, gain = 0.25, freq = 900, q = 0.9 } = opts;
    const t0 = this.ctx.currentTime + start;
    const frames = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(freq, t0);
    filter.Q.value = q;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + duration * 0.35);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    src.connect(filter);
    filter.connect(env);
    env.connect(this.master);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  play(name: SoundName) {
    if (!this.enabled) return;
    this.unlock();
    if (!this.ctx) return;
    try {
      switch (name) {
        case "click":
          this.tone({ freq: 520, type: "triangle", duration: 0.06, gain: 0.22 });
          break;
        case "correct":
          // Rising third + crowd swell.
          this.tone({ freq: 523.25, type: "triangle", duration: 0.16, gain: 0.5 });
          this.tone({ freq: 659.25, type: "triangle", start: 0.09, duration: 0.2, gain: 0.45 });
          this.tone({ freq: 783.99, type: "sine", start: 0.17, duration: 0.3, gain: 0.35 });
          this.noise({ start: 0.05, duration: 0.55, gain: 0.1, freq: 1400, q: 0.6 });
          break;
        case "wrong":
          // Soft, low, restrained — a miss should not feel punishing.
          this.tone({ freq: 220, type: "sine", duration: 0.22, gain: 0.4, sweepTo: 150 });
          this.tone({ freq: 164, type: "sine", start: 0.06, duration: 0.26, gain: 0.3 });
          break;
        case "next":
          this.tone({ freq: 380, type: "sine", duration: 0.1, gain: 0.25, sweepTo: 520 });
          break;
        case "reveal":
          this.tone({ freq: 440, type: "sine", duration: 0.14, gain: 0.3, sweepTo: 330 });
          break;
        case "hint":
          this.tone({ freq: 880, type: "sine", duration: 0.1, gain: 0.22 });
          break;
        case "streak":
          // Bright ascending arpeggio for a milestone.
          [659.25, 783.99, 987.77].forEach((f, i) =>
            this.tone({ freq: f, type: "triangle", start: i * 0.07, duration: 0.18, gain: 0.4 })
          );
          this.noise({ start: 0.05, duration: 0.4, gain: 0.08, freq: 2000, q: 0.5 });
          break;
        case "complete":
          // Short stadium celebration: fanfare over a crowd wash.
          [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
            this.tone({ freq: f, type: "triangle", start: i * 0.1, duration: 0.3, gain: 0.42 })
          );
          this.noise({ start: 0, duration: 1.1, gain: 0.13, freq: 1100, q: 0.4 });
          break;
      }
    } catch {
      // Audio is decorative; never let it surface as an error.
    }
  }
}

export const sound = new SoundEngine();
