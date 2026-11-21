import { useState } from "react";
import { useCollection } from "../db";
import { Icon } from "../look";
import { minutesByDate } from "../plan";
import { computeSkills, Stars } from "../skills";
import { go, type AppCtx } from "../state";
import { addDays } from "../time";
import type { ConversationData, TimelogData } from "../types";
import { Header, Modal } from "../ui";

const PHASE: Record<string, { label: string; color: string }> = {
  foundation: { label: "Foundation", color: "blue" },
  talking: { label: "Start talking", color: "purple" },
  conversation: { label: "Conversation", color: "tomato" },
};

export default function Path({ app }: { app: AppCtx }) {
  const logs = useCollection<TimelogData>("timelogs") ?? [];
  const convs = useCollection<ConversationData>("conversations") ?? [];
  const [open, setOpen] = useState<number | null>(null);
  const byDate = minutesByDate(logs);
  const cur = Math.max(app.n, 1);
  const hours = (w: number) => {
    let m = 0;
    for (let i = 0; i < 7; i++) m += byDate.get(addDays(app.settings.startDate, (w - 1) * 7 + i)) ?? 0;
    if (w === 1) for (const [d, v] of byDate) if (d < app.settings.startDate) m += v;
    return m / 60;
  };
  const skills = computeSkills(convs);
  const goal = skills.find((s) => s.id === "long")!;
  const week = open ? app.cur.weeks[open - 1] : null;

  let lastPhase = "";
  return (
    <div className="screen">
      <Header title="Your path" sub="9 weeks from ciao to a real conversation." />
      <div className="path">
        {app.cur.weeks.map((w, i) => {
          const state = w.week < cur ? "done" : w.week === cur ? "current" : "locked";
          const showPhase = w.phase !== lastPhase;
          lastPhase = w.phase;
          const ph = PHASE[w.phase] ?? { label: w.phase, color: "blue" };
          const offset = [0, 30, 45, 30, 0, -30, -45, -30][i % 8];
          return (
            <div key={w.week}>
              {showPhase && (
                <div className={`phase-banner c-${ph.color}`}>
                  <b>{ph.label}</b>
                  <span>
                    Weeks {w.week}–{Math.max(...app.cur.weeks.filter((x) => x.phase === w.phase).map((x) => x.week))}
                  </span>
                </div>
              )}
              <div className={`path-row ${state === "current" ? "is-current" : ""}`} style={{ transform: `translateX(${offset}px)` }}>
                <button className={`path-node ${state} c-${ph.color}`} onClick={() => setOpen(w.week)}>
                  {state === "done" ? <Icon name="check" size={30} /> : state === "locked" ? "🔒" : w.week}
                  {state === "current" && <span className="you-are-here">You are here</span>}
                </button>
                <div className="path-label">
                  <b>Week {w.week}</b>
                  <small>{w.theme}</small>
                  {state !== "locked" && <small className="muted">{hours(w.week).toFixed(1)}h practiced</small>}
                </div>
              </div>
            </div>
          );
        })}
        <div className="path-row finale">
          <div className={`path-node trophy ${goal.stars >= 2 ? "done" : ""}`}>🏆</div>
          <div className="path-label">
            <b>The goal</b>
            <small>A 20–30 min conversation with a native speaker</small>
            <Stars n={goal.stars} />
          </div>
        </div>
      </div>

      {week && (
        <Modal title={`Week ${week.week}`} onClose={() => setOpen(null)}>
          <h2>{week.theme}</h2>
          <div className="card soft c-green">
            <b>🎯 Goal</b>
            <p>{week.goal}</p>
          </div>
          <p className="small muted">Grammar</p>
          <ul>
            {week.grammar.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
          <p className="small muted">Scenarios</p>
          <div className="tags">
            {week.scenarios.map((s) => (
              <span key={s} className="tag">
                {app.cur.scenarios[s]?.label ?? s}
              </span>
            ))}
          </div>
          {week.week === cur && (
            <button className="btn primary big full" onClick={() => go("/today")}>
              Go to today's plan
            </button>
          )}
        </Modal>
      )}
    </div>
  );
}
