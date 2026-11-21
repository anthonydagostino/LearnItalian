import { useEffect, useMemo, useRef, useState } from "react";
import { useCollection } from "../db";
import { buildDrill, sameSentence, type Exercise } from "../drill";
import { celebrate, cheer, Icon } from "../look";
import { unlockedTopics } from "../plan";
import { checkAnswer } from "../srs";
import { sfx, unlockSfx } from "../sfx";
import { resolveEngine, speak, startListening, unlockAudio, type Listening } from "../speech";
import { autoLog, go, type AppCtx } from "../state";
import type { CardData, ReviewData, SrsData } from "../types";
import { Empty, SpeakBtn } from "../ui";

type Submit = (correct: boolean, solution?: string, english?: boolean) => void;

export default function Drill({ app }: { app: AppCtx }) {
  const cards = useCollection<CardData>("cards");
  const srsRows = useCollection<SrsData>("srs");
  const reviews = useCollection<ReviewData>("reviews");
  const [seed, setSeed] = useState(0);
  const ready = !!cards && !!srsRows && !!reviews;
  const initial = useMemo(
    () =>
      ready
        ? buildDrill({
            cards: cards!,
            srs: new Map(srsRows!.map((r) => [r.id, r.data])),
            recentAgain: new Set(reviews!.filter((r) => r.data.rating === 1 && r.data.ts > Date.now() - 7 * 86_400_000).map((r) => r.data.cardId)),
            topics: unlockedTopics(app.cur, app.n),
            maxLevel: app.week.level,
            canSpeak: resolveEngine(app.settings.sttMode) !== "none",
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, seed],
  );
  if (!ready) return <div className="screen">Loading…</div>;
  if (!initial.length) return <Empty emoji="🃏" title="Not enough cards yet" />;
  return <DrillRun key={seed} app={app} initial={initial} onAgain={() => setSeed(seed + 1)} />;
}

function DrillRun({ app, initial, onAgain }: { app: AppCtx; initial: Exercise[]; onAgain: () => void }) {
  const [queue, setQueue] = useState<{ ex: Exercise; retry: boolean }[]>(() => initial.map((ex) => ({ ex, retry: false })));
  const [idx, setIdx] = useState(0);
  const [feedback, setFeedback] = useState<null | { correct: boolean; solution?: string; english?: boolean }>(null);
  const [right, setRight] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [loggedMin, setLoggedMin] = useState<number | null>(null);
  const startedAt = useRef(Date.now());
  const done = idx >= queue.length;

  useEffect(() => {
    if (!done) return;
    sfx.complete();
    if (right / Math.max(1, right + wrong) >= 0.6) celebrate(true);
    void autoLog("flashcards", startedAt.current, "Weak-spot drill").then(setLoggedMin);
  }, [done]);

  const submit: Submit = (correct, solution, english) => {
    if (feedback) return;
    if (correct) {
      sfx.correct();
      setRight((n) => n + 1);
    } else {
      sfx.wrong();
      setWrong((n) => n + 1);
      const cur = queue[idx];
      if (!cur.retry) setQueue((q) => [...q, { ex: cur.ex, retry: true }]);
    }
    setFeedback({ correct, solution, english });
  };
  const next = () => {
    setFeedback(null);
    setIdx((i) => i + 1);
  };
  const skip = () => {
    setFeedback(null);
    setIdx((i) => i + 1);
  };

  if (done) {
    const acc = Math.round((right / Math.max(1, right + wrong)) * 100);
    const mins = Math.max(1, Math.round((Date.now() - startedAt.current) / 60000));
    return (
      <div className="screen">
        <div className="summary-hero">
          <div className="empty-emoji">{acc >= 90 ? "🏆" : acc >= 70 ? "🌟" : "💪"}</div>
          <h1>{acc >= 70 ? cheer() : "Keep going!"}</h1>
          <p className="muted">Weak-spot drill complete</p>
          <div className="stat-bubbles">
            <div className="stat-bubble c-green">
              <b>{acc}%</b>
              <span>accuracy</span>
            </div>
            <div className="stat-bubble c-blue">
              <b>{right}</b>
              <span>correct</span>
            </div>
            <div className="stat-bubble c-amber">
              <b>{mins}</b>
              <span>minutes</span>
            </div>
          </div>
          {loggedMin ? <p className="muted small">{loggedMin} min added to today ✓</p> : null}
        </div>
        <button className="btn primary big full" onClick={onAgain}>
          Another round 🔁
        </button>
        <button className="btn ghost full" onClick={() => go("/cards")}>
          Done
        </button>
      </div>
    );
  }

  const { ex, retry } = queue[idx];
  return (
    <div className="screen drill">
      <div className="study-top">
        <button className="icon-btn round" onClick={() => confirm("Quit this drill?") && go("/cards")} aria-label="Quit">
          <Icon name="close" size={20} />
        </button>
        <div className="study-progress drill-progress">
          <div style={{ width: `${(idx / queue.length) * 100}%` }} />
        </div>
      </div>
      {retry && <div className="retry-tag">🔁 Let's try this one again</div>}
      <div key={idx} className="drill-body page-enter">
        {ex.type === "match" && <Match ex={ex} submit={submit} />}
        {ex.type === "meaning" && <Choice ex={ex} submit={submit} rate={app.ttsRate} mode="meaning" />}
        {ex.type === "listen" && <Choice ex={ex} submit={submit} rate={app.ttsRate} mode="listen" />}
        {ex.type === "build" && <Build ex={ex} submit={submit} rate={app.ttsRate} />}
        {ex.type === "speak" && <Speak ex={ex} submit={submit} skip={skip} app={app} />}
      </div>

      {feedback && (
        <div className={`feedback ${feedback.correct ? "good" : "bad"}`}>
          <div className="feedback-head">
            <span className="feedback-emoji">{feedback.correct ? "🎉" : "💡"}</span>
            <b>{feedback.correct ? cheer() : "Correct answer:"}</b>
          </div>
          {!feedback.correct && feedback.solution && (
            <div className="feedback-sol">
              {feedback.english ? (
                <b>{feedback.solution}</b>
              ) : (
                <>
                  <span className="it">{feedback.solution}</span> <SpeakBtn text={feedback.solution} rate={app.ttsRate} />
                </>
              )}
            </div>
          )}
          <button className="btn big full feedback-btn" onClick={next}>
            Continue
          </button>
        </div>
      )}
    </div>
  );
}

function CheckBar({ disabled, onCheck, label = "Check" }: { disabled: boolean; onCheck: () => void; label?: string }) {
  return (
    <div className="check-bar">
      <button className="btn primary big full" disabled={disabled} onClick={onCheck}>
        {label}
      </button>
    </div>
  );
}

function Choice({ ex, submit, rate, mode }: { ex: Extract<Exercise, { type: "meaning" | "listen" }>; submit: Submit; rate: number; mode: "meaning" | "listen" }) {
  const [pick, setPick] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    void speak(ex.it, { rate });
  }, [ex.it, rate]);
  return (
    <>
      <h2 className="drill-q">{mode === "meaning" ? "What does this mean?" : "Tap what you hear"}</h2>
      {mode === "meaning" ? (
        <div className="drill-prompt">
          <SpeakBtn text={ex.it} rate={rate} />
          <span className="it">{ex.it}</span>
        </div>
      ) : (
        <div className="listen-big">
          <button className="ctrl c-blue" onClick={() => (unlockAudio(), speak(ex.it, { rate }))}>
            <span className="ctrl-circle big">
              <Icon name="speaker" size={36} />
            </span>
          </button>
          <button className="chip-btn" onClick={() => speak(ex.it, { rate: Math.max(0.55, rate - 0.3) })}>
            🐢 Slower
          </button>
        </div>
      )}
      <div className="options">
        {ex.options.map((o) => (
          <button
            key={o}
            className={`option ${pick === o ? "picked" : ""} ${checked && o === ex.answer ? "right" : ""} ${checked && pick === o && o !== ex.answer ? "wrong" : ""} ${mode === "listen" ? "it" : ""}`}
            onClick={() => {
              if (checked) return;
              sfx.tap();
              setPick(o);
            }}
          >
            {o}
          </button>
        ))}
      </div>
      <CheckBar
        disabled={!pick || checked}
        onCheck={() => {
          setChecked(true);
          submit(pick === ex.answer, ex.answer, mode === "meaning");
        }}
      />
    </>
  );
}

function Build({ ex, submit, rate }: { ex: Extract<Exercise, { type: "build" }>; submit: Submit; rate: number }) {
  const [chosen, setChosen] = useState<number[]>([]);
  const [checked, setChecked] = useState(false);
  const sentence = chosen.map((i) => ex.tiles[i]).join(" ");
  return (
    <>
      <h2 className="drill-q">Build it in Italian</h2>
      <div className="drill-prompt en-prompt">
        <span className="speech-tail">{ex.en}</span>
      </div>
      <div className="answer-line">
        {chosen.map((i, k) => (
          <button
            key={`${i}-${k}`}
            className="word-tile placed pop-in"
            onClick={() => {
              if (checked) return;
              sfx.tap();
              setChosen(chosen.filter((x) => x !== i));
            }}
          >
            {ex.tiles[i]}
          </button>
        ))}
        {!chosen.length && <span className="muted small">Tap the words below</span>}
      </div>
      <div className="word-bank">
        {ex.tiles.map((t, i) => (
          <button
            key={i}
            className={`word-tile ${chosen.includes(i) ? "used" : ""}`}
            disabled={chosen.includes(i)}
            onClick={() => {
              if (checked) return;
              sfx.tap();
              setChosen([...chosen, i]);
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <CheckBar
        disabled={!chosen.length || checked}
        onCheck={() => {
          setChecked(true);
          const ok = sameSentence(sentence, ex.it);
          submit(ok, ex.it);
          void speak(ex.it, { rate });
        }}
      />
    </>
  );
}

function Match({ ex, submit }: { ex: Extract<Exercise, { type: "match" }>; submit: Submit }) {
  const left = useMemo(() => ex.pairs.map((p) => p.it).sort(() => Math.random() - 0.5), [ex]);
  const right = useMemo(() => ex.pairs.map((p) => p.en).sort(() => Math.random() - 0.5), [ex]);
  const [selL, setSelL] = useState<string | null>(null);
  const [selR, setSelR] = useState<string | null>(null);
  const [matched, setMatched] = useState<string[]>([]);
  const [shake, setShake] = useState<string | null>(null);
  const [misses, setMisses] = useState(0);

  useEffect(() => {
    if (!selL || !selR) return;
    const ok = ex.pairs.some((p) => p.it === selL && p.en === selR);
    if (ok) {
      sfx.match();
      void speak(selL, { rate: 0.9 });
      const m = [...matched, selL];
      setMatched(m);
      if (m.length === ex.pairs.length) setTimeout(() => submit(misses <= 1), 350);
    } else {
      sfx.wrong();
      setMisses((n) => n + 1);
      setShake(selL + selR);
      setTimeout(() => setShake(null), 400);
    }
    setSelL(null);
    setSelR(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selL, selR]);

  const enMatched = (en: string) => ex.pairs.some((p) => p.en === en && matched.includes(p.it));
  return (
    <>
      <h2 className="drill-q">Match the pairs</h2>
      <div className="match-grid">
        <div>
          {left.map((it) => (
            <button
              key={it}
              disabled={matched.includes(it)}
              className={`option it ${selL === it ? "picked" : ""} ${matched.includes(it) ? "matched" : ""} ${shake?.startsWith(it) ? "shake" : ""}`}
              onClick={() => (sfx.tap(), setSelL(it))}
            >
              {it}
            </button>
          ))}
        </div>
        <div>
          {right.map((en) => (
            <button
              key={en}
              disabled={enMatched(en)}
              className={`option ${selR === en ? "picked" : ""} ${enMatched(en) ? "matched" : ""} ${shake?.endsWith(en) ? "shake" : ""}`}
              onClick={() => (sfx.tap(), setSelR(en))}
            >
              {en}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function Speak({ ex, submit, skip, app }: { ex: Extract<Exercise, { type: "speak" }>; submit: Submit; skip: () => void; app: AppCtx }) {
  const [listening, setListening] = useState<Listening | null>(null);
  const [busy, setBusy] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    void speak(ex.it, { rate: app.ttsRate });
  }, [ex.it, app.ttsRate]);

  async function mic() {
    unlockAudio();
    unlockSfx();
    if (listening) {
      setBusy(true);
      try {
        const r = await listening.stop();
        setHeard(r.text);
        const v = checkAnswer(r.text, ex.it);
        submit(v.verdict !== "wrong", ex.it);
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
      setListening(await startListening(app.settings.sttMode));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <>
      <h2 className="drill-q">Say this out loud</h2>
      <div className="drill-prompt">
        <SpeakBtn text={ex.it} rate={app.ttsRate} />
        <span className="it">{ex.it}</span>
      </div>
      <p className="muted center">{ex.en}</p>
      {heard !== null && <p className="center small">I heard: “{heard || "…"}”</p>}
      {err && <div className="error">{err}</div>}
      <div className="speak-zone">
        <button className={`mic big-mic ${listening ? "on" : ""}`} onClick={mic} disabled={busy}>
          {busy ? <span className="spinner" /> : <Icon name={listening ? "stop" : "mic"} size={34} />}
        </button>
        <span className="muted small">{listening ? "Tap when you're done" : "Tap and speak"}</span>
        <button className="linkish" onClick={skip}>
          Can't speak right now
        </button>
      </div>
    </>
  );
}
