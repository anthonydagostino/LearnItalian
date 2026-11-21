import { useState } from "react";
import { createNote } from "../cards";
import { patch, useCollection } from "../db";
import type { AppCtx } from "../state";
import { prettyDate } from "../time";
import { MISTAKE_LABELS, type MistakeData, type MistakeType } from "../types";
import { Empty, SpeakBtn } from "../ui";

export default function Mistakes({ app }: { app: AppCtx; params: URLSearchParams }) {
  const rows = useCollection<MistakeData>("mistakes");
  const [filter, setFilter] = useState<"review" | "today" | "all">("review");
  const [type, setType] = useState<MistakeType | "">("");
  if (!rows) return <div className="screen">Loading…</div>;

  const sorted = [...rows].sort((a, b) => b.data.ts - a.data.ts);
  const base = sorted.filter((m) =>
    filter === "today" ? m.data.date === app.today : filter === "review" ? !m.data.reviewedAt : true,
  );
  const counts = new Map<string, number>();
  for (const m of base) counts.set(m.data.type, (counts.get(m.data.type) ?? 0) + 1);
  const list = type ? base.filter((m) => m.data.type === type) : base;

  async function addCard(id: string, m: MistakeData) {
    const cardId = await createNote({ it: m.corrected, en: m.meaningEn || m.explanation || m.corrected, notes: m.explanation, source: "mistake" });
    await patch<MistakeData>("mistakes", id, (old) => ({ ...(old as MistakeData), cardId }));
  }
  async function markReviewed(id: string) {
    await patch<MistakeData>("mistakes", id, (old) => ({ ...(old as MistakeData), reviewedAt: Date.now() }));
  }

  return (
    <div className="screen">
      <h2>Mistakes journal</h2>
      <div className="mode-toggle">
        {(["review", "today", "all"] as const).map((f) => (
          <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
            {f === "review" ? "To review" : f === "today" ? "Today" : "All"}
          </button>
        ))}
      </div>
      <div className="chips">
        <button className={!type ? "chip on" : "chip"} onClick={() => setType("")}>
          All {base.length}
        </button>
        {[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => (
          <button key={t} className={type === t ? "chip on" : "chip"} onClick={() => setType(t as MistakeType)}>
            {MISTAKE_LABELS[t as MistakeType] ?? t} {n}
          </button>
        ))}
      </div>
      {!list.length && <Empty>{filter === "review" ? "Nothing to review. 🎉" : "No mistakes here yet."}</Empty>}
      <div className="list">
        {list.map((m) => (
          <div key={m.id} className={`list-item mistake ${m.data.reviewedAt ? "reviewed" : ""}`}>
            <div className="grow">
              <div>
                <s>{m.data.original}</s> → <b className="it">{m.data.corrected}</b> <SpeakBtn text={m.data.corrected} rate={app.ttsRate} />
              </div>
              {m.data.explanation && <div className="small">{m.data.explanation}</div>}
              <div className="muted small">
                {MISTAKE_LABELS[m.data.type] ?? m.data.type} · {m.data.source} · {prettyDate(m.data.date)}
              </div>
              <div className="row">
                {m.data.cardId ? (
                  <span className="muted small">✓ in flashcards</span>
                ) : (
                  <button className="btn tiny" onClick={() => addCard(m.id, m.data)}>
                    + Flashcard
                  </button>
                )}
                {!m.data.reviewedAt && (
                  <button className="btn tiny ghost" onClick={() => markReviewed(m.id)}>
                    Got it ✓
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
