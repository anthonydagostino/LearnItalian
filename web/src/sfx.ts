/** Tiny synthesized sound effects (no audio files, works offline). */
let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundsEnabled(on: boolean) {
  enabled = on;
}

function ac(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Call from a tap handler once so iOS allows audio. */
export function unlockSfx() {
  ac();
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.18) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + start;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

export const sfx = {
  correct() {
    tone(784, 0, 0.18, "sine");
    tone(1175, 0.09, 0.28, "sine");
  },
  wrong() {
    tone(196, 0, 0.22, "triangle", 0.2);
    tone(155, 0.12, 0.3, "triangle", 0.2);
  },
  tap() {
    tone(660, 0, 0.06, "sine", 0.08);
  },
  match() {
    tone(988, 0, 0.12, "sine", 0.12);
  },
  complete() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.32, "sine", 0.16));
  },
};
