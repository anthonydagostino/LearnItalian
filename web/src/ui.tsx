import { useEffect, useState, type ReactNode } from "react";
import { ACTIVITY, Bubble, celebrate, cheer, Icon, toast } from "./look";
import { elapsedMinutes, go, logTime, setActiveBlock, useActiveBlock, type ActiveBlock } from "./state";
import { speak, unlockAudio } from "./speech";
import { localDate } from "./time";
import type { BlockKind } from "./types";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal-grab" />
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn round" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SpeakBtn({ text, rate, label }: { text: string; rate?: number; label?: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <button
      className={`speak-btn ${playing ? "playing" : ""}`}
      aria-label={`Play "${text}"`}
      onClick={async (e) => {
        e.stopPropagation();
        unlockAudio();
        setPlaying(true);
        await speak(text, rate ? { rate } : {});
        setPlaying(false);
      }}
    >
      <Icon name="speaker" size={18} />
      {label && <span>{label}</span>}
    </button>
  );
}

export function Stepper({ value, onChange, step = 5 }: { value: number; onChange: (n: number) => void; step?: number }) {
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(Math.max(0, value - step))} aria-label={`Minus ${step}`}>
        −
      </button>
      <div className="stepper-value">
        <input type="number" inputMode="numeric" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
        <span>min</span>
      </div>
      <button type="button" onClick={() => onChange(value + step)} aria-label={`Plus ${step}`}>
        +
      </button>
    </div>
  );
}

/** Generic "log time" sheet. */
export function LogTimeModal(props: {
  title: string;
  block: BlockKind;
  blockId?: string;
  minutes: number;
  notePlaceholder?: string;
  noteDefault?: string;
  onClose: () => void;
  onSaved?: (note: string, minutes: number) => void;
}) {
  const [min, setMin] = useState(props.minutes);
  const [note, setNote] = useState(props.noteDefault ?? "");
  return (
    <Modal title={props.title} onClose={props.onClose}>
      <div className="sheet-hero">
        <Bubble kind={props.block} size={56} />
      </div>
      <p className="center muted">How long did you practice?</p>
      <Stepper value={min} onChange={setMin} />
      {props.notePlaceholder !== undefined && (
        <label className="field">
          <span>Note (optional)</span>
          <input value={note} placeholder={props.notePlaceholder || "Anything to remember?"} onChange={(e) => setNote(e.target.value)} />
        </label>
      )}
      <button
        className="btn primary big full"
        onClick={async () => {
          await logTime({ block: props.block, blockId: props.blockId, minutes: min, note });
          celebrate();
          toast(`${cheer()} ${min} min logged`);
          props.onSaved?.(note, min);
          props.onClose();
        }}
      >
        <Icon name="check" size={20} /> Log {min} minute{min === 1 ? "" : "s"}
      </button>
    </Modal>
  );
}

const SCREEN: Partial<Record<BlockKind, string>> = {
  flashcards: "/cards",
  speaking: "/talk",
  shadowing: "/shadow",
  review: "/mistakes",
};
export const screenFor = (k: BlockKind) => SCREEN[k];

export function startBlock(b: Omit<ActiveBlock, "startedAt">) {
  setActiveBlock({ ...b, startedAt: Date.now() });
  const s = SCREEN[b.kind];
  if (s) go(s);
}

/** Floating pill while a block's timer is running. */
export function TimerBar() {
  const active = useActiveBlock();
  const [, tick] = useState(0);
  const [finishing, setFinishing] = useState(false);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => tick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, [active]);
  if (!active) return null;
  const el = elapsedMinutes(active);
  const pct = Math.min(100, (el / active.planned) * 100);
  const a = ACTIVITY[active.kind];
  return (
    <>
      <div className={`timerbar c-${a.color}`}>
        <div className="timerbar-fill" style={{ width: `${pct}%` }} />
        <button className="timerbar-label" onClick={() => SCREEN[active.kind] && go(SCREEN[active.kind]!)}>
          <span className="timerbar-emoji">{a.emoji}</span>
          <span>
            <b>{active.label}</b>
            <small>
              {el} of {active.planned} min{el >= active.planned ? " · time's up! 🎉" : ""}
            </small>
          </span>
        </button>
        <button className="timerbar-done" onClick={() => setFinishing(true)}>
          Done
        </button>
        <button
          className="timerbar-x"
          aria-label="Cancel timer"
          onClick={() => confirm("Stop the timer without logging?") && setActiveBlock(null)}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      {finishing && (
        <LogTimeModal
          title={active.label}
          block={active.kind}
          blockId={active.date === localDate() ? active.blockId : undefined}
          minutes={el}
          notePlaceholder=""
          onClose={() => setFinishing(false)}
          onSaved={() => {
            setActiveBlock(null);
            go("/today");
          }}
        />
      )}
    </>
  );
}

export function activeFor(kind: BlockKind): ActiveBlock | null {
  const raw = localStorage.getItem("parla.activeBlock");
  const a: ActiveBlock | null = raw ? JSON.parse(raw) : null;
  return a && a.kind === kind ? a : null;
}

export function Empty({ emoji = "🎉", title, children }: { emoji?: string; title?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-emoji">{emoji}</div>
      {title && <h3>{title}</h3>}
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function Header({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      {right}
    </header>
  );
}
