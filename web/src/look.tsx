import confetti from "canvas-confetti";
import { useSyncExternalStore, type ReactNode } from "react";
import type { BlockKind } from "./types";

/** Visual identity per activity: color token, emoji, friendly blurb. */
export const ACTIVITY: Record<BlockKind, { emoji: string; color: string; blurb: string }> = {
  lesson: { emoji: "📚", color: "blue", blurb: "Do today's course lesson, then log which one you finished." },
  flashcards: { emoji: "🃏", color: "purple", blurb: "Review your words. The app picks what you're about to forget." },
  speaking: { emoji: "🗣️", color: "tomato", blurb: "Have a real conversation out loud with your AI partner." },
  shadowing: { emoji: "🎧", color: "teal", blurb: "Listen, repeat, and copy the melody of real Italian." },
  listening: { emoji: "📻", color: "amber", blurb: "A podcast, show, or YouTube video in Italian. Just log what it was." },
  review: { emoji: "📝", color: "pink", blurb: "Go over today's mistakes so they stick." },
  tutor: { emoji: "👩‍🏫", color: "green", blurb: "A session with your human tutor." },
  other: { emoji: "✨", color: "blue", blurb: "Any other Italian practice." },
};

export const SCENARIO_EMOJI: Record<string, string> = {
  introductions: "👋",
  job: "💻",
  restaurant: "🍝",
  hotel: "🏨",
  train_tickets: "🚆",
  directions: "🗺️",
  shopping: "🛍️",
  pharmacy: "💊",
  small_talk: "☕",
  free: "💬",
};

export function Bubble({ kind, size = 44 }: { kind: BlockKind; size?: number }) {
  const a = ACTIVITY[kind];
  return (
    <span className={`bubble-icon c-${a.color}`} style={{ width: size, height: size, fontSize: size * 0.5 }}>
      {a.emoji}
    </span>
  );
}

// ---------- Icons (24px stroke) ----------
const paths: Record<string, ReactNode> = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20h5v-6h4v6h5V9.5" />
    </>
  ),
  cards: (
    <>
      <rect x="3" y="6" width="13" height="15" rx="2.5" />
      <path d="M8 3h10.5A2.5 2.5 0 0 1 21 5.5V17" />
    </>
  ),
  chat: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4.2A2.5 2.5 0 0 1 4 13.5z" />
      <path d="M8.5 9.5h.01M12 9.5h.01M15.5 9.5h.01" strokeWidth="3" />
    </>
  ),
  headphones: (
    <>
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="3" y="14" width="5" height="7" rx="2" />
      <rect x="16" y="14" width="5" height="7" rx="2" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="2" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="2" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="2" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />,
  play: <path d="M8 5.5v13l10-6.5z" fill="currentColor" />,
  next: (
    <>
      <path d="M6 5.5v13l9-6.5z" fill="currentColor" />
      <path d="M18 5v14" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9" />
    </>
  ),
  bulb: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" />
    </>
  ),
  send: <path d="M4 12 20 4l-6 16-2.5-6.5z" fill="currentColor" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  speaker: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  repeat: (
    <>
      <path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20l-3-3M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4l3 3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="M15 5l-7 7 7 7" />,
};

export function Icon({ name, size = 24, className = "" }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

/** Circular progress ring. */
export function Ring({ value, size = 112, stroke = 11, children }: { value: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="ring-track" fill="none" />
        {v > 0.005 && <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          className="ring-value"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />}
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

// ---------- Celebrations ----------
const COLORS = ["#ff5a47", "#ffc43d", "#2bb673", "#4f8cff", "#a66cff", "#ff7eb6"];
let celebrationsOn = false;
export function setCelebrations(on: boolean) {
  celebrationsOn = on;
}
export function celebrate(big = false) {
  if (!celebrationsOn) return;
  void confetti({
    particleCount: big ? 160 : 60,
    spread: big ? 100 : 70,
    startVelocity: big ? 45 : 32,
    origin: { y: big ? 0.6 : 0.75 },
    colors: COLORS,
    disableForReducedMotion: true,
    scalar: 0.9,
  });
  if (big)
    setTimeout(() => {
      void confetti({ particleCount: 80, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors: COLORS, disableForReducedMotion: true });
      void confetti({ particleCount: 80, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors: COLORS, disableForReducedMotion: true });
    }, 250);
}

// ---------- Toasts ----------
interface ToastMsg {
  id: number;
  text: string;
}
let toasts: ToastMsg[] = [];
const tl = new Set<() => void>();
const emit = () => tl.forEach((l) => l());
export function toast(text: string) {
  const id = Date.now() + Math.random();
  toasts = [...toasts, { id, text }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 2600);
}
export function Toasts() {
  const list = useSyncExternalStore(
    (l) => {
      tl.add(l);
      return () => tl.delete(l);
    },
    () => toasts,
  );
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return { it: "Buonasera", en: "Up late? 🦉" };
  if (h < 13) return { it: "Buongiorno", en: "Good morning" };
  if (h < 18) return { it: "Buon pomeriggio", en: "Good afternoon" };
  return { it: "Buonasera", en: "Good evening" };
}

const CHEERS = ["Bravo!", "Perfetto!", "Ottimo!", "Fantastico!", "Grande!", "Bellissimo!", "Così si fa!"];
export const cheer = () => (celebrationsOn ? CHEERS[Math.floor(Math.random() * CHEERS.length)] : "✓");
