import { useState } from "react";
import { useCollection } from "../db";
import { minutesByDate, streak } from "../plan";
import type { AppCtx } from "../state";
import { addDays, daysBetween, fmtMinutes } from "../time";
import { Header } from "../ui";
import { computeSkills, Stars } from "../skills";
import type { CardData, ConversationData, ReviewData } from "../types";
import { MISTAKE_LABELS, type MistakeData, type MistakeType, type SrsData, type TimelogData } from "../types";

/** Hours per curriculum week vs. the weekly target. Single series: one hue, target as a dashed reference line. */
function WeeksChart({ weeks, target, current }: { weeks: { week: number; hours: number }[]; target: number; current: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 340;
  const H = 170;
  const pad = { l: 26, r: 8, t: 12, b: 22 };
  const max = Math.max(target * 1.15, ...weeks.map((w) => w.hours), 1);
  const bw = (W - pad.l - pad.r) / weeks.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, Math.round(target / 2), target];
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Hours per week versus target">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 4} y={y(t) + 3} className="axis" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(target)} y2={y(target)} className="target" />
        {weeks.map((w, i) => {
          const x = pad.l + i * bw + bw * 0.2;
          const width = bw * 0.6;
          const h = Math.max(0, y(0) - y(w.hours));
          const r = Math.min(4, width / 2, h);
          const top = y(w.hours);
          const d = h > 0 ? `M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${y(0)} Z` : "";
          return (
            <g key={w.week} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onClick={() => setHover(i)}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              {d && <path d={d} className={`bar ${w.week === current ? "current" : ""}`} />}
              <text x={x + width / 2} y={H - 6} className={`axis ${w.week === current ? "strong" : ""}`} textAnchor="middle">
                {w.week}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="chart-caption">
        {hover !== null ? (
          <span>
            Week {weeks[hover].week}: <b>{weeks[hover].hours.toFixed(1)}h</b> of {target}h
          </span>
        ) : (
          <span className="muted">Hours per week · dashed line = {target}h target · tap a bar</span>
        )}
      </div>
    </div>
  );
}

function HBar({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div key={r.label} className="hbar" title={`${r.label}: ${r.value}`}>
          <span className="hbar-label">{r.label}</span>
          <span className="hbar-track">
            <span className="hbar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="hbar-value">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function Progress({ app }: { app: AppCtx }) {
  const logs = useCollection<TimelogData>("timelogs") ?? [];
  const srs = useCollection<SrsData>("srs") ?? [];
  const mistakes = useCollection<MistakeData>("mistakes") ?? [];
  const convs = useCollection<ConversationData>("conversations") ?? [];
  const skills = computeSkills(convs);
  const earned = skills.filter((k) => k.stars > 0).length;
  const [table, setTable] = useState(false);
  const byDate = minutesByDate(logs);
  const total = [...byDate.values()].reduce((a, b) => a + b, 0);
  const speaking = logs.filter((l) => l.data.block === "speaking" || l.data.block === "tutor").reduce((a, l) => a + l.data.minutes, 0);
  const weeks = app.cur.weeks.map((w) => {
    let m = 0;
    for (let i = 0; i < 7; i++) m += byDate.get(addDays(app.settings.startDate, (w.week - 1) * 7 + i)) ?? 0;
    // Time logged before the start date counts toward week 1.
    if (w.week === 1) for (const [d, v] of byDate) if (d < app.settings.startDate) m += v;
    return { week: w.week, hours: m / 60 };
  });
  const thisWeek = weeks[Math.max(app.n, 1) - 1]?.hours ?? 0;
  const learned = srs.filter((s) => s.data.state === 2).length;
  const reviews = useCollection<ReviewData>("reviews") ?? [];
  const cards = useCollection<CardData>("cards") ?? [];

  // ---- Efficiency metrics ----
  const prodIds = new Set(cards.filter((c) => c.data.dir === "en2it").map((c) => c.id));
  const canSay = srs.filter((s) => prodIds.has(s.id) && s.data.state === 2).length;
  const wordsPerHour = total > 30 ? canSay / (total / 60) : 0;
  const weekAgoTs = Date.now() - 7 * 86_400_000;
  const recent = reviews.filter((r) => r.data.ts > weekAgoTs && r.data.rating > 0);
  const recall = recent.length >= 30 ? Math.round((recent.filter((r) => r.data.rating >= 2).length / recent.length) * 100) : null;
  const times = recent.map((r) => r.data.ms ?? 0).filter((x) => x > 0).sort((a, b) => a - b);
  const secPerCard = times.length >= 20 ? Math.round(times[Math.floor(times.length / 2)] / 1000) : null;
  const lastConvs = [...convs].filter((c) => c.data.talkShare !== undefined).sort((a, b) => b.data.startedAt - a.data.startedAt).slice(0, 5);
  const talkShare = lastConvs.length ? Math.round(lastConvs.reduce((a, c) => a + (c.data.talkShare ?? 0), 0) / lastConvs.length) : null;
  const repeatCounts = new Map<string, number>();
  for (const m of mistakes) repeatCounts.set(m.data.corrected, (repeatCounts.get(m.data.corrected) ?? 0) + 1);
  const repeats = [...repeatCounts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const leeches = srs
    .filter((s) => s.data.lapses >= 3)
    .sort((a, b) => b.data.lapses - a.data.lapses)
    .slice(0, 6)
    .map((s) => ({ it: cards.find((c) => c.id === s.id)?.data.it ?? s.id, lapses: s.data.lapses }));

  // Mistake trend: last 4 weeks vs the 4 weeks before, by type.
  const types = Object.keys(MISTAKE_LABELS) as MistakeType[];
  const counts = types
    .map((t) => ({ label: MISTAKE_LABELS[t], value: mistakes.filter((m) => m.data.type === t).length }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const last7 = mistakes.filter((m) => m.data.date > addDays(app.today, -7)).length;
  const prev7 = mistakes.filter((m) => m.data.date <= addDays(app.today, -7) && m.data.date > addDays(app.today, -14)).length;

  const byBlock = new Map<string, number>();
  for (const l of logs) byBlock.set(l.data.block, (byBlock.get(l.data.block) ?? 0) + l.data.minutes);

  return (
    <div className="screen">
      <Header title="Progress" sub="Are you learning efficiently? These numbers tell you." />
      <div className="tiles">
        <div className="tile">
          <b>{canSay}</b>
          <span>words you can say (EN→IT learned)</span>
        </div>
        <div className="tile">
          <b>{wordsPerHour ? wordsPerHour.toFixed(0) : "–"}</b>
          <span>words per study hour</span>
        </div>
        <div className="tile">
          <b>
            {thisWeek.toFixed(1)}
            <small>/{app.settings.weeklyTargetHours}h</small>
          </b>
          <span>this week</span>
        </div>
        <div className={`tile ${recall !== null && (recall < 80 || recall > 95) ? "warn" : ""}`}>
          <b>{recall ?? "–"}{recall !== null && <small>%</small>}</b>
          <span>recall, last 7 days</span>
        </div>
        <div className={`tile ${secPerCard !== null && secPerCard > 15 ? "warn" : ""}`}>
          <b>{secPerCard ?? "–"}{secPerCard !== null && <small>s</small>}</b>
          <span>per card (median)</span>
        </div>
        <div className={`tile ${talkShare !== null && talkShare < 50 ? "warn" : ""}`}>
          <b>{talkShare ?? "–"}{talkShare !== null && <small>%</small>}</b>
          <span>you talked (last 5 chats)</span>
        </div>
      </div>
      <div className="tiles small-tiles">
        <div className="tile">
          <b>🔥 {streak(byDate, app.today)}</b>
          <span>day streak</span>
        </div>
        <div className="tile">
          <b>{(total / 60).toFixed(1)}h</b>
          <span>total</span>
        </div>
        <div className="tile">
          <b>{fmtMinutes(speaking)}</b>
          <span>speaking</span>
        </div>
      </div>

      <section className="card">
        <b>What to do about it</b>
        <ul className="advice">
          {recall !== null && recall < 80 && <li>Recall is under 80%: lower new cards per day (Settings) until it recovers.</li>}
          {recall !== null && recall > 95 && recent.length > 50 && <li>Recall is over 95%: you can raise new cards per day.</li>}
          {secPerCard !== null && secPerCard > 15 && <li>Cards are taking over 15s: if you don't know it in ~8s, tap Forgot and move on.</li>}
          {talkShare !== null && talkShare < 50 && <li>You're talking less than half the time: answer in full sentences, and ask your partner questions back.</li>}
          {app.n > 0 && thisWeek < (app.settings.weeklyTargetHours * ((daysBetween(app.settings.startDate, app.today) % 7) + 1)) / 7 - 1 && (
            <li>You're behind this week's {app.settings.weeklyTargetHours}h pace.</li>
          )}
          {repeats.length > 0 && <li>Repeated mistakes below are your highest-value fixes: run the weak-spot drill.</li>}
          <li className="muted">Healthy targets: recall 85–92%, under 10s per card, you talking 60%+ of the time.</li>
        </ul>
      </section>

      {(repeats.length > 0 || leeches.length > 0) && (
        <section className="card">
          <b>Your repeat offenders</b>
          {repeats.map(([form, n]) => (
            <div key={form} className="skill-row">
              <span className="grow it">{form}</span>
              <span className="pill">{n}× mistake</span>
            </div>
          ))}
          {leeches.map((l) => (
            <div key={l.it} className="skill-row">
              <span className="grow it">{l.it}</span>
              <span className="pill">forgot {l.lapses}×</span>
            </div>
          ))}
          <a className="chip-btn" href="#/drill">
            🎯 Drill these now
          </a>
        </section>
      )}

      <section className="card skills-card">
        <div className="row between">
          <b>🗣️ What you can say</b>
          <span className="pill c-green">
            {earned}/{skills.length}
          </span>
        </div>
        <p className="muted small">Earned in real conversations, not by tapping tiles. Each solid session (6+ replies) adds a star.</p>
        {skills.map((k) => (
          <a key={k.id} className="skill-row" href={k.scenario ? "#/talk" : "#/talk"}>
            <span className="skill-emoji">{k.emoji}</span>
            <span className="grow">
              <b>{k.label}</b>
              <small>{k.detail}</small>
            </span>
            <Stars n={k.stars} />
          </a>
        ))}
        <a className="chip-btn" href="#/path">
          🗺️ See your 9-week path
        </a>
      </section>

      <section className="card">
        <div className="row between">
          <b>Hours per week</b>
          <button className="btn tiny ghost" onClick={() => setTable(!table)}>
            {table ? "Chart" : "Table"}
          </button>
        </div>
        {table ? (
          <table className="table">
            <thead>
              <tr>
                <th>Week</th>
                <th>Hours</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.week}>
                  <td>{w.week}</td>
                  <td>{w.hours.toFixed(1)}</td>
                  <td>{app.settings.weeklyTargetHours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <WeeksChart weeks={weeks} target={app.settings.weeklyTargetHours} current={app.n} />
        )}
      </section>

      <section className="card">
        <b>Mistakes by type</b>
        {counts.length ? <HBar rows={counts} /> : <p className="muted small">No mistakes logged yet.</p>}
      </section>

      <section className="card">
        <b>Time by activity</b>
        <HBar
          rows={[...byBlock.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => ({ label: k, value: Math.round(v) }))}
        />
        <p className="muted small">Minutes</p>
      </section>
    </div>
  );
}
