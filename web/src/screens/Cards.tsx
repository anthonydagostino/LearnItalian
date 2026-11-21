import { useEffect, useMemo, useRef, useState } from "react";
import { all, get, put, useCollection } from "../db";
import { createNote } from "../cards";
import { buildQueue, checkAnswer, newSrs, previewIntervals, rate, Rating, type Grade, type Verdict } from "../srs";
import { speak, startListening, unlockAudio, type Listening } from "../speech";
import { addMistake, type AppCtx } from "../state";
import { uid } from "../time";
import type { CardData, MistakeData, ReviewData, SrsData } from "../types";
import { Empty, SpeakBtn } from "../ui";

interface QItem {
  id: string;
  isNew: boolean;
}

export default function Cards({ app, params }: { app: AppCtx; params: URLSearchParams }) {
  const cards = useCollection<CardData>("cards");
  const srsRows = useCollection<SrsData>("srs");
  const reviews = useCollection<ReviewData>("reviews");
  const [session, setSession] = useState<QItem[] | null>(null);
  const [browse, setBrowse] = useState(params.get("browse") === "1");

  useEffect(() => setBrowse(params.get("browse") === "1"), [params]);

  const info = useMemo(() => {
    if (!cards || !srsRows || !reviews) return null;
    const srs = new Map(srsRows.map((r) => [r.id, r.data]));
    const reviewsToday = reviews.filter((r) => r.data.date === app.today).length;
    return buildQueue({
      cards,
      srs,
      reviewsToday,
      today: app.today,
      now: Date.now(),
      cur: app.cur,
      week: app.n,
      newPerDay: app.settings.newPerDay,
      reviewCap: app.settings.reviewCap,
    });
  }, [cards, srsRows, reviews, app.today, app.n, app.settings.newPerDay, app.settings.reviewCap, app.cur]);

  if (browse) return <Browse cards={cards ?? []} onClose={() => (location.hash = "#/cards")} />;
  if (!info) return <div className="screen">Loading…</div>;

  if (session)
    return (
      <Study
        app={app}
        initial={session}
        cards={new Map((cards ?? []).map((c) => [c.id, c.data]))}
        onDone={() => setSession(null)}
      />
    );

  const start = () => {
    unlockAudio();
    // Interleave: one new card after every 3 reviews.
    const q: QItem[] = [];
    const due = info.due.map((c) => ({ id: c.id, isNew: false }));
    const fresh = info.fresh.map((c) => ({ id: c.id, isNew: true }));
    while (due.length || fresh.length) {
      for (let i = 0; i < 3 && due.length; i++) q.push(due.shift()!);
      if (fresh.length) q.push(fresh.shift()!);
    }
    setSession(q);
  };

  return (
    <div className="screen">
      <h2>Flashcards</h2>
      <div className="stats-row">
        <div className="stat">
          <b>{info.due.length}</b>
          <span>due</span>
        </div>
        <div className="stat">
          <b>{info.fresh.length}</b>
          <span>new today</span>
        </div>
        <div className="stat">
          <b>{info.learned}</b>
          <span>learned</span>
        </div>
      </div>
      {info.due.length + info.fresh.length > 0 ? (
        <button className="btn primary big" onClick={start}>
          ▶ Study {info.due.length + info.fresh.length} cards
        </button>
      ) : (
        <Empty>
          All done for today. 🎉
          <br />
          <span className="muted small">
            {info.reviewsToday} reviews and {info.newToday} new cards today.
          </span>
        </Empty>
      )}
      <p className="muted small">
        New cards come from this week's topics first. Limits: {app.settings.newPerDay} new/day, {app.settings.reviewCap} reviews/day
        (change in Settings). English→Italian cards {app.settings.speakAnswers ? "use speak-the-answer" : "are flip cards"}.
      </p>
      <a className="btn ghost" href="#/cards?browse=1">
        🔎 Browse & add cards
      </a>
    </div>
  );
}

function Study({ app, initial, cards, onDone }: { app: AppCtx; initial: QItem[]; cards: Map<string, CardData>; onDone: () => void }) {
  const [queue, setQueue] = useState<QItem[]>(initial);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [srs, setSrs] = useState<SrsData | null>(null);
  const [listening, setListening] = useState<Listening | null>(null);
  const [heard, setHeard] = useState<{ text: string; verdict: Verdict } | null>(null);
  const [interim, setInterim] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [count, setCount] = useState(0);
  const shownAt = useRef(Date.now());

  const item = queue[idx];
  const card = item ? cards.get(item.id) : undefined;

  useEffect(() => {
    if (!item) return;
    setRevealed(false);
    setHeard(null);
    setInterim("");
    setErr("");
    shownAt.current = Date.now();
    void get<SrsData>("srs", item.id).then((s) => setSrs(s ?? newSrs(app.today)));
    const c = cards.get(item.id);
    if (c && c.dir === "it2en" && app.settings.autoplay) void speak(c.it, { rate: app.ttsRate });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, idx]);

  if (!item || !card) {
    return (
      <div className="screen">
        <Empty>
          Session complete: {count} cards reviewed. 🎉
          <br />
          <button className="btn primary" onClick={onDone}>
            Back
          </button>
        </Empty>
      </div>
    );
  }

  const reveal = () => {
    setRevealed(true);
    if (app.settings.autoplay) void speak(card.dir === "en2it" ? card.it : card.ex || card.it, { rate: app.ttsRate });
  };

  async function micToggle() {
    unlockAudio();
    if (listening) {
      setBusy(true);
      try {
        const r = await listening.stop();
        const v = checkAnswer(r.text, card!.it);
        setHeard({ text: r.text, verdict: v.verdict });
        reveal();
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setListening(null);
        setBusy(false);
      }
      return;
    }
    try {
      setErr("");
      setInterim("");
      setListening(await startListening(app.settings.sttMode, setInterim));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function grade(g: Grade) {
    if (!srs || !card) return;
    const now = new Date();
    const next = rate(srs, g, now);
    await put("srs", item.id, next);
    await put<ReviewData>("reviews", uid(), {
      cardId: item.id,
      rating: g,
      date: app.today,
      ts: now.getTime(),
      mode: heard ? "speak" : "flip",
      heard: heard?.text,
    });
    if (g === Rating.Again && card.dir === "en2it") {
      const existing = (await all<MistakeData>("mistakes")).some((m) => m.data.cardId === item.id && m.data.date === app.today);
      if (!existing)
        await addMistake({
          source: "flashcard",
          type: "vocabulary",
          original: heard?.text || "(couldn't remember)",
          corrected: card.it,
          meaningEn: card.en,
          explanation: `Flashcard: "${card.en}"`,
          cardId: item.id,
        });
    }
    setCount((n) => n + 1);
    const q = [...queue];
    // Short-term learning steps: show it again later in this session.
    if (next.due - now.getTime() < 20 * 60_000) q.push({ id: item.id, isNew: false });
    setQueue(q);
    setIdx(idx + 1);
  }

  const intervals = srs ? previewIntervals(srs) : null;
  const isProd = card.dir === "en2it";
  const remaining = queue.length - idx;
  const suggested: Grade | null = heard ? (heard.verdict === "correct" ? Rating.Good : heard.verdict === "close" ? Rating.Hard : Rating.Again) : null;
  const canSpeak = isProd && app.settings.speakAnswers;

  return (
    <div className="screen study">
      <div className="row between">
        <button className="btn ghost small" onClick={onDone}>
          ← End
        </button>
        <span className="muted small">
          {remaining} left{item.isNew ? " · new" : ""} · {isProd ? "English → Italian" : "Italian → English"}
        </span>
      </div>

      <div className={`flashcard ${revealed ? "revealed" : ""}`} onClick={() => !revealed && !canSpeak && reveal()}>
        <div className="front">
          {isProd ? (
            <div className="prompt">{card.en}</div>
          ) : (
            <div className="prompt it">
              {card.it} <SpeakBtn text={card.it} rate={app.ttsRate} />
            </div>
          )}
          {isProd && !revealed && <div className="muted small">Say it in Italian{canSpeak ? " — tap the mic" : ""}</div>}
        </div>
        {revealed && (
          <div className="back">
            {isProd ? (
              <div className="answer it">
                {card.it} <SpeakBtn text={card.it} rate={app.ttsRate} />
              </div>
            ) : (
              <div className="answer">{card.en}</div>
            )}
            {card.ex && (
              <div className="example">
                <span className="it">{card.ex}</span> <SpeakBtn text={card.ex} rate={app.ttsRate} />
                <div className="muted small">{card.exEn}</div>
              </div>
            )}
            {card.notes && <div className="notes small">{card.notes}</div>}
            {card.flag && <div className="flag small">⚠️ Unverified: {card.flag}</div>}
          </div>
        )}
      </div>

      {heard && (
        <div className={`heard ${heard.verdict}`}>
          You said: <b>{heard.text || "(nothing heard)"}</b> —{" "}
          {heard.verdict === "correct" ? "✓ correct" : heard.verdict === "close" ? "≈ close" : "✗ not quite"}
          <div className="muted small">If transcription got it wrong, just pick the right grade below.</div>
        </div>
      )}
      {listening && <div className="interim">{interim || "Listening…"}</div>}
      {err && <div className="error">{err}</div>}

      {!revealed ? (
        <div className="row center">
          {canSpeak && (
            <button className={`mic ${listening ? "on" : ""}`} onClick={micToggle} disabled={busy}>
              {busy ? "…" : listening ? "■" : "🎤"}
            </button>
          )}
          <button className="btn big" onClick={reveal}>
            Show answer
          </button>
        </div>
      ) : (
        <div className="grades">
          {([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Grade[]).map((g) => (
            <button key={g} className={`grade g${g} ${suggested === g ? "suggested" : ""}`} onClick={() => grade(g)}>
              <b>{["", "Again", "Hard", "Good", "Easy"][g]}</b>
              <span>{intervals?.[g]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Browse({ cards, onClose }: { cards: { id: string; data: CardData }[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ it: "", en: "", ex: "", exEn: "" });
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const notes = cards.filter((c) => c.data.dir === "it2en");
  const ql = q.trim().toLowerCase();
  const results = notes
    .filter((c) => (!flaggedOnly || c.data.flag) && (!ql || c.data.it.toLowerCase().includes(ql) || c.data.en.toLowerCase().includes(ql) || c.data.topic.includes(ql)))
    .slice(0, 80);

  async function toggleSuspend(c: { id: string; data: CardData }) {
    const sus = !c.data.suspended;
    for (const id of [c.id, c.id.replace(/:it2en$/, ":en2it")]) {
      const d = await get<CardData>("cards", id);
      if (d) await put("cards", id, { ...d, suspended: sus });
    }
  }

  return (
    <div className="screen">
      <div className="row between">
        <h2>Browse cards</h2>
        <button className="btn ghost small" onClick={onClose}>
          Done
        </button>
      </div>
      <input className="search" placeholder={`Search ${notes.length} notes…`} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="row">
        <label className="check-inline">
          <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} /> Flagged only
        </label>
        <button className="btn small" onClick={() => setAdding(!adding)}>
          + Add card
        </button>
      </div>
      {adding && (
        <div className="card">
          {(["it", "en", "ex", "exEn"] as const).map((k) => (
            <label className="field" key={k}>
              <span>{{ it: "Italian", en: "English", ex: "Example (Italian)", exEn: "Example (English)" }[k]}</span>
              <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
          <button
            className="btn primary"
            disabled={!form.it || !form.en}
            onClick={async () => {
              await createNote({ ...form, source: "manual" });
              setForm({ it: "", en: "", ex: "", exEn: "" });
              setAdding(false);
            }}
          >
            Save card
          </button>
        </div>
      )}
      <div className="list">
        {results.map((c) => (
          <div key={c.id} className={`list-item ${c.data.suspended ? "suspended" : ""}`}>
            <div className="grow">
              <div>
                <b className="it">{c.data.it}</b> — {c.data.en}
              </div>
              <div className="muted small">
                {c.data.topic} · level {c.data.level}
                {c.data.flag ? ` · ⚠️ ${c.data.flag}` : ""}
              </div>
            </div>
            <SpeakBtn text={c.data.it} />
            <button className="btn small ghost" onClick={() => toggleSuspend(c)}>
              {c.data.suspended ? "Unsuspend" : "Suspend"}
            </button>
          </div>
        ))}
      </div>
      <p className="muted small">To fix seed cards permanently, edit the JSON files in seed/deck/ and restart the server.</p>
    </div>
  );
}
