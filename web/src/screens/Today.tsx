import { useEffect, useRef, useState } from "react";
import { patch, remove, useCollection, useDoc } from "../db";
import { ACTIVITY, Bubble, celebrate, cheer, greeting, Icon, Ring, toast } from "../look";
import { blocksFor, emptyPlan, minutesByDate, streak, STREAK_MIN } from "../plan";
import { go, logTime, saveSettings, setDayMode, useActiveBlock, type AppCtx } from "../state";
import { daysBetween, prettyDate } from "../time";
import type { DayplanData, PlanBlock, TimelogData } from "../types";
import { LogTimeModal, Modal, Stepper, startBlock } from "../ui";

function LessonModal({ app, block, onClose }: { app: AppCtx; block: PlanBlock; onClose: () => void }) {
  const [course, setCourse] = useState(app.settings.lessonCourse);
  const [lesson, setLesson] = useState(String(app.settings.lessonNext));
  const [min, setMin] = useState(block.minutes);
  const [saving, setSaving] = useState(false);
  return (
    <Modal title="Lesson done?" onClose={onClose}>
      <div className="sheet-hero">
        <Bubble kind="lesson" size={56} />
      </div>
      <div className="lesson-number">
        <span className="muted">Lesson</span>
        <button type="button" onClick={() => setLesson(String(Math.max(1, (parseInt(lesson, 10) || 1) - 1)))}>
          −
        </button>
        <input value={lesson} inputMode="numeric" onChange={(e) => setLesson(e.target.value)} />
        <button type="button" onClick={() => setLesson(String((parseInt(lesson, 10) || 0) + 1))}>
          +
        </button>
      </div>
      <label className="field">
        <span>Course</span>
        <input value={course} onChange={(e) => setCourse(e.target.value)} />
      </label>
      <p className="center muted small">Time spent</p>
      <Stepper value={min} onChange={setMin} />
      <button
        className="btn primary big full"
        disabled={saving}
        onClick={async () => {
          if (saving) return;
          setSaving(true);
          await logTime({ block: "lesson", blockId: block.id, minutes: min, note: `${course} — lesson ${lesson}` });
          const n = parseInt(lesson, 10);
          await saveSettings({ lessonCourse: course, ...(Number.isFinite(n) ? { lessonNext: n + 1 } : {}) });
          celebrate();
          toast(`${cheer()} Lesson ${lesson} done`);
          onClose();
        }}
      >
        <Icon name="check" size={20} /> I finished lesson {lesson}
      </button>
    </Modal>
  );
}

export default function Today({ app }: { app: AppCtx }) {
  const { cur, settings, today, n, week } = app;
  const plan = useDoc<DayplanData>("dayplans", today) ?? emptyPlan(today);
  const logs = useCollection<TimelogData>("timelogs") ?? [];
  const active = useActiveBlock();
  const [modal, setModal] = useState<{ type: "lesson" | "listening" | "other"; block?: PlanBlock } | null>(null);
  const [details, setDetails] = useState(false);

  const blocks = blocksFor(plan.mode, week, cur);
  const byDate = minutesByDate(logs);
  const todayMin = byDate.get(today) ?? 0;
  const totalMin = [...byDate.values()].reduce((a, b) => a + b, 0);
  const st = streak(byDate, today);
  const daysLeft = Math.max(0, daysBetween(today, settings.targetDate));
  const doneCount = blocks.filter((b) => plan.done[b.id]).length;
  const plannedMin = blocks.reduce((a, b) => a + b.minutes, 0);
  const startsIn = daysBetween(today, settings.startDate);
  const allDone = doneCount === blocks.length && blocks.length > 0;
  const streakSafe = todayMin >= STREAK_MIN;
  const tutorToday = logs.some((l) => l.data.date === today && l.data.block === "tutor");
  const g = greeting();

  // Big celebration the moment the whole plan is done.
  const wasDone = useRef<boolean | null>(null);
  useEffect(() => {
    if (wasDone.current === false && allDone) {
      celebrate(true);
      toast("Tutto fatto! Day complete 🇮🇹");
    }
    wasDone.current = allDone;
  }, [allDone]);

  async function undo(b: PlanBlock) {
    const logId = plan.done[b.id];
    if (!confirm(`Undo "${b.label}"? This removes the time you logged.`)) return;
    if (logId) await remove("timelogs", logId);
    await patch<DayplanData>("dayplans", today, (old) => {
      const p = old ?? emptyPlan(today);
      const done = { ...p.done };
      delete done[b.id];
      return { ...p, done };
    });
  }

  function open(b: PlanBlock) {
    if (plan.done[b.id]) return void undo(b);
    if (b.kind === "lesson") return setModal({ type: "lesson", block: b });
    if (b.kind === "listening") return setModal({ type: "listening", block: b });
    startBlock({ blockId: b.id, kind: b.kind, label: b.label, planned: b.minutes, date: today });
  }

  const next = blocks.find((b) => !plan.done[b.id]);
  const runningHere = active && active.date === today ? blocks.find((b) => b.id === active.blockId) : undefined;

  return (
    <div className="screen today">
      <header className="hello">
        <div>
          <h1>
            {g.it}, {settings.name || "amico"}!
          </h1>
          <p className="muted">
            {g.en} ·{" "}
            {n === 0 ? `Your course starts in ${startsIn} day${startsIn === 1 ? "" : "s"}` : `Week ${n} of ${cur.weeks.length}`}
          </p>
        </div>
      </header>

      <section className={`hero ${allDone ? "hero-done" : ""}`}>
        <Ring value={plannedMin > 0 ? todayMin / plannedMin : 0} size={116}>
          <b>{Math.round(todayMin)}</b>
          <span>of {plannedMin} min</span>
        </Ring>
        <div className="hero-stats">
          <div className={`hero-stat ${st > 0 ? "lit" : ""}`}>
            <span className="hero-emoji flame">🔥</span>
            <div>
              <b>{st}</b> day streak
              <small>{streakSafe ? "Safe for today ✓" : `${Math.max(0, STREAK_MIN - Math.round(todayMin))} min to keep it`}</small>
            </div>
          </div>
          <div className="hero-stat">
            <span className="hero-emoji">🗓️</span>
            <div>
              <b>{daysLeft}</b> days to go
              <small>until {prettyDate(settings.targetDate)}</small>
            </div>
          </div>
          <div className="hero-stat">
            <span className="hero-emoji">⏳</span>
            <div>
              <b>{(totalMin / 60).toFixed(1)}h</b> practiced
              <small>all time</small>
            </div>
          </div>
        </div>
      </section>

      {allDone ? (
        <section className="next-card c-green done-card">
          <div className="next-emoji">🎉</div>
          <h2>Tutto fatto!</h2>
          <p>You finished today's plan. See you tomorrow — a domani!</p>
          <div className="row center">
            <button className="btn light" onClick={() => go("/talk")}>
              Bonus chat 💬
            </button>
            <button className="btn light" onClick={() => go("/cards")}>
              Extra cards 🃏
            </button>
          </div>
        </section>
      ) : runningHere ? (
        <button className={`next-card c-${ACTIVITY[runningHere.kind].color}`} onClick={() => open(runningHere)}>
          <div className="next-top">
            <span className="next-label">In progress</span>
            <span className="next-time">⏱ {runningHere.minutes} min</span>
          </div>
          <div className="next-emoji">{ACTIVITY[runningHere.kind].emoji}</div>
          <h2>{runningHere.label}</h2>
          <span className="next-cta">
            Continue <Icon name="play" size={16} />
          </span>
        </button>
      ) : (
        next && (
          <button className={`next-card c-${ACTIVITY[next.kind].color}`} onClick={() => open(next)}>
            <div className="next-top">
              <span className="next-label">{doneCount === 0 ? "Start here" : "Up next"}</span>
              <span className="next-time">{next.minutes} min</span>
            </div>
            <div className="next-emoji">{ACTIVITY[next.kind].emoji}</div>
            <h2>{next.label}</h2>
            <p>{next.hint ?? ACTIVITY[next.kind].blurb}</p>
            <span className="next-cta">
              {next.kind === "lesson" || next.kind === "listening" ? "Log it" : "Let's go"} <Icon name="play" size={16} />
            </span>
          </button>
        )
      )}

      <div className="segmented">
        <button className={plan.mode === "full" ? "on" : ""} onClick={() => setDayMode(today, "full")}>
          <b>Full day</b>
          <small>{Math.round(blocksFor("full", week, cur).reduce((a, b) => a + b.minutes, 0) / 60)} hours</small>
        </button>
        <button className={plan.mode === "short" ? "on" : ""} onClick={() => setDayMode(today, "short")}>
          <b>Busy day</b>
          <small>30 min, keeps the streak</small>
        </button>
      </div>

      <div className="section-title">
        <h3>Today's plan</h3>
        <span className="pill">
          {doneCount}/{blocks.length} done
        </span>
      </div>
      <ul className="plan">
        {blocks.map((b, i) => {
          const done = !!plan.done[b.id];
          const running = active?.blockId === b.id && active.date === today;
          const log = done ? logs.find((x) => x.id === plan.done[b.id]) : undefined;
          const coveredByTutor = b.kind === "speaking" && tutorToday && !done;
          return (
            <li key={b.id} style={{ animationDelay: `${i * 40}ms` }}>
              <button className={`plan-row ${done ? "done" : ""} ${running ? "running" : ""}`} onClick={() => open(b)}>
                <Bubble kind={b.kind} />
                <span className="plan-text">
                  <b>{b.label}</b>
                  <small>
                    {done
                      ? `${log?.data.minutes ?? b.minutes} min${log?.data.note ? ` · ${log.data.note}` : ""}`
                      : running
                        ? "Timer running…"
                        : coveredByTutor
                          ? "Tutor session counts ✓"
                          : `${b.minutes} min`}
                  </small>
                </span>
                <span className={`plan-check ${done ? "on" : ""}`}>{done ? <Icon name="check" size={18} /> : running ? "⏱" : <Icon name="play" size={14} />}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="quick-row">
        <button className="chip-btn" onClick={() => setModal({ type: "other" })}>
          <Icon name="plus" size={16} /> Log other practice
        </button>
        {n >= 4 && (
          <button className="chip-btn" onClick={() => go("/tutor")}>
            👩‍🏫 Tutor session
          </button>
        )}
      </div>

      <section
        className="focus-card"
        role="button"
        tabIndex={0}
        aria-expanded={details}
        onClick={() => setDetails(!details)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setDetails(!details))}
      >
        <div className="focus-head">
          <span className="focus-emoji">🎯</span>
          <div className="grow">
            <small>This week's goal</small>
            <b>{week.goal}</b>
          </div>
          <span className="muted">{details ? "▴" : "▾"}</span>
        </div>
        {details && (
          <div className="focus-body">
            <button className="chip-btn" onClick={(e) => (e.stopPropagation(), go("/path"))}>
              🗺️ See your 9-week path
            </button>
            <p className="small muted">Grammar to notice</p>
            <ul>
              {week.grammar.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <p className="small muted">Practice scenarios</p>
            <div className="tags">
              {week.scenarios.map((s) => (
                <span key={s} className="tag">
                  {cur.scenarios[s]?.label ?? s}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {modal?.type === "lesson" && modal.block && <LessonModal app={app} block={modal.block} onClose={() => setModal(null)} />}
      {modal?.type === "listening" && modal.block && (
        <LogTimeModal
          title="Listening"
          block="listening"
          blockId={modal.block.id}
          minutes={modal.block.minutes}
          notePlaceholder="What did you watch or listen to?"
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "other" && (
        <LogTimeModal title="Other practice" block="other" minutes={15} notePlaceholder="What did you do?" onClose={() => setModal(null)} />
      )}
    </div>
  );
}
