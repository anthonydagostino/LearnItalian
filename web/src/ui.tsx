import { useEffect, useState, type ReactNode } from "react";
import { elapsedMinutes, go, logTime, setActiveBlock, useActiveBlock, type ActiveBlock } from "./state";
import { speak, unlockAudio } from "./speech";
import type { BlockKind } from "./types";
import { localDate } from "./time";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SpeakBtn({ text, rate, label }: { text: string; rate?: number; label?: string }) {
  return (
    <button
      className="icon-btn speak"
      aria-label={`Play "${text}"`}
      onClick={(e) => {
        e.stopPropagation();
        unlockAudio();
        void speak(text, rate ? { rate } : {});
      }}
    >
      🔊{label ? ` ${label}` : ""}
    </button>
  );
}

export function Stepper({ value, onChange, step = 5 }: { value: number; onChange: (n: number) => void; step?: number }) {
  return (
    <div className="stepper">
      <button onClick={() => onChange(Math.max(0, value - step))}>−{step}</button>
      <input type="number" inputMode="numeric" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
      <span>min</span>
      <button onClick={() => onChange(value + step)}>+{step}</button>
    </div>
  );
}

/** Generic "log time" dialog. */
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
      <label className="field">
        <span>Minutes</span>
        <Stepper value={min} onChange={setMin} />
      </label>
      {props.notePlaceholder !== undefined && (
        <label className="field">
          <span>Note</span>
          <input value={note} placeholder={props.notePlaceholder} onChange={(e) => setNote(e.target.value)} />
        </label>
      )}
      <div className="row end">
        <button className="btn ghost" onClick={props.onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          onClick={async () => {
            await logTime({ block: props.block, blockId: props.blockId, minutes: min, note });
            props.onSaved?.(note, min);
            props.onClose();
          }}
        >
          Log {min} min
        </button>
      </div>
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

/** Floating bar while a block's timer is running. */
export function TimerBar() {
  const active = useActiveBlock();
  const [, tick] = useState(0);
  const [finishing, setFinishing] = useState(false);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [active]);
  if (!active) return null;
  const el = elapsedMinutes(active);
  const pct = Math.min(100, (el / active.planned) * 100);
  return (
    <>
      <div className="timerbar">
        <div className="timerbar-fill" style={{ width: `${pct}%` }} />
        <button className="timerbar-label" onClick={() => SCREEN[active.kind] && go(SCREEN[active.kind]!)}>
          ⏱ {active.label} · {el}/{active.planned} min
        </button>
        <button className="btn small primary" onClick={() => setFinishing(true)}>
          Finish
        </button>
        <button className="icon-btn" aria-label="Cancel timer" onClick={() => confirm("Stop the timer without logging?") && setActiveBlock(null)}>
          ✕
        </button>
      </div>
      {finishing && (
        <LogTimeModal
          title={`Log: ${active.label}`}
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

/** Call from a screen when its activity naturally finishes (e.g. ending a conversation). Returns the active block if it matches. */
export function activeFor(kind: BlockKind): ActiveBlock | null {
  const raw = localStorage.getItem("parla.activeBlock");
  const a: ActiveBlock | null = raw ? JSON.parse(raw) : null;
  return a && a.kind === kind ? a : null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
