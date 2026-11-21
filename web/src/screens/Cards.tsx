import { useEffect, useMemo, useRef, useState } from "react";
import { all, get, put, useCollection } from "../db";
import { createNote } from "../cards";
import { buildQueue, checkAnswer, newSrs, previewIntervals, rate, Rating, type Grade, type Verdict } from "../srs";
import { speak, startListening, unlockAudio, type Listening } from "../speech";
import { addMistake, type AppCtx } from "../state";
import { uid } from "../time";
import type { CardData, MistakeData, ReviewData, SrsData } from "../types";
import { Empty, Header, SpeakBtn } from "../ui";
import { celebrate, cheer, Icon, toast } from "../look";

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

  const total = info.due.length + info.fresh.length;
  return (
    <div className="screen">
      <Header title="Flashcards" sub="A few minutes a day, every day." />
      <div className="stat-bubbles">
        <div className="stat-bubble c-purple">
          <b>{info.due.length}</b>
          <span>to review</span>
        </div>
        <div className="stat-bubble c-blue">
          <b>{info.fresh.length}</b>
          <span>new words</span>
        </div>
        <div className="stat-bubble c-green">
          <b>{info.learned}</b>
          <span>learned</span>
        </div>
      </div>
      {total > 0 ? (
        <button className="next-card c-purple" onClick={start}>
          <div className="next-top">
            <span className="next-label">Ready</span>
            <span className="next-time">~{Math.max(1, Math.round(total * 0.25))} min</span>
          </div>
          <div className="next-emoji">🃏</div>
          <h2>Study {total} cards</h2>
          <p>
            {info.due.length ? `${info.due.length} reviews` : "No reviews"}
            {info.fresh.length ? ` + ${info.fresh.length} new from this week's topics` : ""}
          </p>
          <span className="next-cta">
            Start <Icon name="play" size={16} />
          </span>
        </button>
      ) : (
        <Empty emoji="🌟" title="All caught up!">
          {info.reviewsToday} reviews and {info.newToday} new words today. Come back tomorrow.
        </Empty>
      )}
      <p className="muted small center">
        {app.settings.newPerDay} new words a day · English→Italian cards {app.settings.speakAnswers ? "ask you to say the answer out loud 🎤" : "are flip cards"}
      </p>
      <a className="btn ghost full" href="#/cards?browse=1">
        🔎 Browse & add your own cards
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
    if (!item && count > 0) celebrate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!item]);

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
        <Empty emoji="🏆" title={`${cheer()} Session complete`}>
          You reviewed {count} cards.
        </Empty>
        <button className="btn primary big full" onClick={onDone}>
          Back to flashcards
        </button>
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

  const labels = ["", "Forgot", "Hard", "Got it", "Easy"];
  return (
    <div className="screen study">
      <div className="study-top">
        <button className="icon-btn round" onClick={onDone} aria-label="End session">
          <Icon name="close" size={20} />
        </button>
        <div className="study-progress">
          <div style={{ width: `${(idx / Math.max(queue.length, 1)) * 100}%` }} />
        </div>
        <span className="muted small">{remaining}</span>
      </div>

      <div className="study-tags">
        <span className={`tag ${isProd ? "c-tomato" : "c-blue"}`}>{isProd ? "🇺🇸 → 🇮🇹 Say it in Italian" : "🇮🇹 → 🇺🇸 What does it mean?"}</span>
        {item.isNew && <span className="tag c-amber">✨ New</span>}
      </div>

      <div
        key={`${item.id}-${idx}-${revealed}`}
        className={`flashcard ${revealed ? "revealed flip-in" : "pop-in"}`}
        onClick={() => !revealed && reveal()}
      >
        <div className="front">
          {isProd ? (
            <div className="prompt">{card.en}</div>
          ) : (
            <div className="prompt it">
              {card.it} <SpeakBtn text={card.it} rate={app.ttsRate} />
            </div>
          )}
          {!revealed && <div className="tap-hint">Tap to flip</div>}
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
                <div>
                  <span className="it">{card.ex}</span> <SpeakBtn text={card.ex} rate={app.ttsRate} />
                </div>
                <div className="muted small">{card.exEn}</div>
              </div>
            )}
            {card.notes && <div className="notes small">💡 {card.notes}</div>}
            {card.flag && <div className="flag small">⚠️ Unverified: {card.flag}</div>}
          </div>
        )}
      </div>

      {heard && (
        <div className={`heard ${heard.verdict}`}>
          <span className="heard-emoji">{heard.verdict === "correct" ? "🎯" : heard.verdict === "close" ? "👌" : "🤔"}</span>
          <div>
            <b>{heard.verdict === "correct" ? "Correct!" : heard.verdict === "close" ? "Almost!" : "Not quite"}</b> I heard “{heard.text || "…"}”
            <div className="small muted">Misheard? Just pick the right button below.</div>
          </div>
        </div>
      )}
      {listening && <div className="interim">{interim || "Listening… tap stop when you're done"}</div>}
      {err && <div className="error">{err}</div>}

      {!revealed ? (
        canSpeak ? (
          <div className="speak-zone">
            <button className={`mic big-mic ${listening ? "on" : ""}`} onClick={micToggle} disabled={busy} aria-label={listening ? "Stop" : "Speak the answer"}>
              {busy ? <span className="spinner" /> : <Icon name={listening ? "stop" : "mic"} size={34} />}
            </button>
            <span className="muted small">{listening ? "Tap to stop" : "Tap & say it in Italian"}</span>
            <button className="linkish" onClick={reveal}>
              or just show me
            </button>
          </div>
        ) : (
          <button className="btn primary big full" onClick={reveal}>
            Show answer
          </button>
        )
      ) : (
        <div className="grades">
          {([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Grade[]).map((g) => (
            <button key={g} className={`grade g${g} ${suggested === g ? "suggested" : ""}`} onClick={() => grade(g)}>
              <b>{labels[g]}</b>
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
      <Header
        title="Your deck"
        sub={`${notes.length} words & phrases`}
        right={
          <button className="btn small" onClick={onClose}>
            Done
          </button>
        }
      />
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
              toast("Card added ✓");
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
