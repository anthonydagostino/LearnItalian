import { useState } from "react";
import { remove, patch, useCollection, useDoc } from "../db";
import { blocksFor, emptyPlan, minutesByDate, streak, STREAK_MIN } from "../plan";
import { go, logTime, saveSettings, setDayMode, useActiveBlock, type AppCtx } from "../state";
import { daysBetween, fmtMinutes, prettyDate } from "../time";
import type { DayplanData, PlanBlock, TimelogData } from "../types";
import { LogTimeModal, Modal, Stepper, startBlock } from "../ui";

function LessonModal({ app, block, onClose }: { app: AppCtx; block: PlanBlock; onClose: () => void }) {
  const [course, setCourse] = useState(app.settings.lessonCourse);
  const [lesson, setLesson] = useState(String(app.settings.lessonNext));
  const [min, setMin] = useState(block.minutes);
  return (
    <Modal title="Log your lesson" onClose={onClose}>
      <label className="field">
        <span>Course</span>
        <input value={course} onChange={(e) => setCourse(e.target.value)} />
      </label>
      <label className="field">
        <span>Lesson finished</span>
        <input value={lesson} inputMode="numeric" onChange={(e) => setLesson(e.target.value)} />
      </label>
      <label className="field">
        <span>Minutes</span>
        <Stepper value={min} onChange={setMin} />
      </label>
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          onClick={async () => {
            await logTime({ block: "lesson", blockId: block.id, minutes: min, note: `${course} — lesson ${lesson}` });
            const n = parseInt(lesson, 10);
            await saveSettings({ lessonCourse: course, ...(Number.isFinite(n) ? { lessonNext: n + 1 } : {}) });
            onClose();
          }}
        >
          Log lesson {lesson}
        </button>
      </div>
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

  const tutorToday = logs.some((l) => l.data.date === today && l.data.block === "tutor");

  async function undo(b: PlanBlock) {
    const logId = plan.done[b.id];
    if (!confirm(`Undo "${b.label}"? This removes the logged time.`)) return;
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

  return (
    <div className="screen today">
      <header className="today-head">
        <div>
          <div className="eyebrow">
            {n === 0 ? `Starts in ${startsIn} day${startsIn === 1 ? "" : "s"} · preview of week 1` : `Week ${n} of ${cur.weeks.length}`}
          </div>
          <h2>{week.theme}</h2>
        </div>
        <div className="stats-row">
          <div className="stat">
            <b>{daysLeft}</b>
            <span>days to {prettyDate(settings.targetDate)}</span>
          </div>
          <div className="stat">
            <b>🔥 {st}</b>
            <span>day streak</span>
          </div>
          <div className="stat">
            <b>{(totalMin / 60).toFixed(1)}h</b>
            <span>total</span>
          </div>
        </div>
      </header>

      <div className="mode-toggle">
        <button className={plan.mode === "full" ? "on" : ""} onClick={() => setDayMode(today, "full")}>
          Full day · {fmtMinutes(blocksFor("full", week, cur).reduce((a, b) => a + b.minutes, 0))}
        </button>
        <button className={plan.mode === "short" ? "on" : ""} onClick={() => setDayMode(today, "short")}>
          Short day · 30 min
        </button>
      </div>

      <div className="progress-line">
        <div className="bar">
          <div style={{ width: `${Math.min(100, (todayMin / plannedMin) * 100)}%` }} />
        </div>
        <span>
          {fmtMinutes(todayMin)} / {fmtMinutes(plannedMin)} · {doneCount}/{blocks.length} done
          {todayMin >= STREAK_MIN ? " · streak safe ✓" : ` · ${STREAK_MIN - Math.round(todayMin)} min to keep the streak`}
        </span>
      </div>

      {next && !active && (
        <button className="btn primary big next-up" onClick={() => open(next)}>
          ▶ Next: {next.label} ({next.minutes} min)
        </button>
      )}

      <ul className="checklist">
        {blocks.map((b) => {
          const done = !!plan.done[b.id];
          const running = active?.blockId === b.id && active.date === today;
          const coveredByTutor = b.kind === "speaking" && tutorToday && !done;
          return (
            <li key={b.id} className={`${done ? "done" : ""} ${running ? "running" : ""}`}>
              <button className="check" onClick={() => open(b)} aria-label={done ? `Undo ${b.label}` : `Start ${b.label}`}>
                {done ? "✓" : running ? "⏱" : ""}
              </button>
              <div className="check-body" onClick={() => open(b)}>
                <div className="check-title">
                  {b.label} <span className="muted">· {b.minutes} min</span>
                </div>
                {b.hint && !done && <div className="muted small">{b.hint}</div>}
                {coveredByTutor && <div className="muted small">You logged a tutor session today: that counts as speaking. Tap to log it anyway.</div>}
                {done && <DoneNote logs={logs} id={plan.done[b.id]} />}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="row">
        <button className="btn ghost small" onClick={() => setModal({ type: "other" })}>
          + Log other time
        </button>
        {n >= 4 && (
          <button className="btn ghost small" onClick={() => go("/tutor")}>
            + Tutor session
          </button>
        )}
      </div>

      <section className="card week-card">
        <button className="linkish" onClick={() => setDetails(!details)}>
          This week's focus {details ? "▴" : "▾"}
        </button>
        <p>
          <b>Goal:</b> {week.goal}
        </p>
        {details && (
          <>
            <p>
              <b>Grammar:</b>
            </p>
            <ul>
              {week.grammar.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
            <p>
              <b>Scenarios:</b> {week.scenarios.map((s) => cur.scenarios[s]?.label ?? s).join(", ")}
            </p>
            <p className="muted small">
              Level: {app.level.label}. English support from the AI: {app.level.englishSupport}.
            </p>
          </>
        )}
      </section>

      {modal?.type === "lesson" && modal.block && <LessonModal app={app} block={modal.block} onClose={() => setModal(null)} />}
      {modal?.type === "listening" && modal.block && (
        <LogTimeModal
          title="Log listening"
          block="listening"
          blockId={modal.block.id}
          minutes={modal.block.minutes}
          notePlaceholder="What did you watch or listen to?"
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "other" && (
        <LogTimeModal title="Log other practice" block="other" minutes={15} notePlaceholder="What did you do?" onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function DoneNote({ logs, id }: { logs: { id: string; data: TimelogData }[]; id: string }) {
  const l = logs.find((x) => x.id === id);
  if (!l) return null;
  return (
    <div className="muted small">
      Logged {l.data.minutes} min{l.data.note ? ` · ${l.data.note}` : ""} · tap to undo
    </div>
  );
}
