/**
 * Table sounds (roadmap W1.6), synthesized with the Web Audio API: no audio
 * files to load and nothing for the Content Security Policy to allow.
 */
export type SoundKind = 'turn' | 'deal' | 'chips' | 'check' | 'fold' | 'win';

interface Tone {
  freq: number;
  /** Seconds after the sound starts. */
  at: number;
  dur: number;
  type: OscillatorType;
  gain: number;
  slideTo?: number;
}

export const RECIPES: Record<SoundKind, Tone[]> = {
  // Two rising notes: it is your turn.
  turn: [
    { freq: 880, at: 0, dur: 0.12, type: 'sine', gain: 0.35 },
    { freq: 1320, at: 0.12, dur: 0.18, type: 'sine', gain: 0.35 },
  ],
  // A quick swish for each card or street.
  deal: [{ freq: 1800, at: 0, dur: 0.07, type: 'triangle', gain: 0.18, slideTo: 700 }],
  // A few short clicks: chips into the pot.
  chips: [
    { freq: 2600, at: 0, dur: 0.035, type: 'square', gain: 0.08 },
    { freq: 2200, at: 0.045, dur: 0.035, type: 'square', gain: 0.07 },
    { freq: 2900, at: 0.09, dur: 0.035, type: 'square', gain: 0.06 },
  ],
  // A low knock.
  check: [{ freq: 180, at: 0, dur: 0.09, type: 'sine', gain: 0.4, slideTo: 120 }],
  // A soft falling note.
  fold: [{ freq: 420, at: 0, dur: 0.16, type: 'sine', gain: 0.15, slideTo: 220 }],
  // A short major arpeggio.
  win: [
    { freq: 523, at: 0, dur: 0.14, type: 'triangle', gain: 0.3 },
    { freq: 659, at: 0.1, dur: 0.14, type: 'triangle', gain: 0.3 },
    { freq: 784, at: 0.2, dur: 0.14, type: 'triangle', gain: 0.3 },
    { freq: 1047, at: 0.3, dur: 0.3, type: 'triangle', gain: 0.3 },
  ],
};

type AudioContextClass = new () => AudioContext;

class SoundPlayer {
  private ctx: AudioContext | null = null;
  private failed = false;

  play(kind: SoundKind, volume: number): void {
    if (volume <= 0) return;
    const ctx = this.context();
    if (!ctx) return;
    // Browsers start audio suspended until the page has been interacted with.
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const now = ctx.currentTime;
    for (const t of RECIPES[kind]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + t.at;
      osc.type = t.type;
      osc.frequency.setValueAtTime(t.freq, start);
      if (t.slideTo) osc.frequency.exponentialRampToValueAtTime(t.slideTo, start + t.dur);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, t.gain * volume), start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + t.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + t.dur + 0.02);
    }
  }

  private context(): AudioContext | null {
    if (this.ctx || this.failed || typeof window === 'undefined') return this.ctx;
    const w = window as unknown as {
      AudioContext?: AudioContextClass;
      webkitAudioContext?: AudioContextClass;
    };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    try {
      this.ctx = Ctor ? new Ctor() : null;
    } catch {
      this.ctx = null;
    }
    this.failed = this.ctx === null;
    return this.ctx;
  }
}

export const sounds = new SoundPlayer();
