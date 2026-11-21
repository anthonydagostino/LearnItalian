import { useMemo, useRef, useState } from "react";
import { lastServerConfig } from "../api";
import { useCollection } from "../db";
import { unlockedTopics } from "../plan";
import { wordMatches } from "../srs";
import { playBlob, speak, startRecording, transcribeOnServer, unlockAudio } from "../speech";
import type { AppCtx } from "../state";
import type { CardData, SrsData } from "../types";
import { Empty } from "../ui";

interface Sentence {
  it: string;
  en: string;
}

function pickSentences(cards: { id: string; data: CardData }[], srs: Map<string, SrsData>, app: AppCtx): Sentence[] {
  const topics = new Set(unlockedTopics(app.cur, app.n).slice(0, 6));
  const maxLevel = app.week.level;
  const seen = new Set<string>();
  const known: Sentence[] = [];
  const week: Sentence[] = [];
  for (const c of cards) {
    if (c.data.dir !== "it2en" || c.data.suspended) continue;
    const text = c.data.ex || (c.data.kind === "phrase" ? c.data.it : "");
    if (!text || text.length > 90 || seen.has(text)) continue;
    seen.add(text);
    const s = { it: text, en: c.data.ex ? c.data.exEn : c.data.en };
    if (srs.has(c.id)) known.push(s);
    else if (topics.has(c.data.topic) && c.data.level <= maxLevel) week.push(s);
  }
  // Mix: sentences from cards you've seen, plus this week's topics.
  const shuffle = <T,>(a: T[]) => a.map((x) => [Math.random(), x] as const).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  const a = shuffle(known).slice(0, 30);
  const b = shuffle(week).slice(0, 30);
  const out: Sentence[] = [];
  while (a.length || b.length) {
    if (b.length) out.push(b.shift()!);
    if (a.length) out.push(a.shift()!);
  }
  return out;
}

export default function Shadow({ app }: { app: AppCtx }) {
  const cards = useCollection<CardData>("cards");
  const srsRows = useCollection<SrsData>("srs");
  const [seed, setSeed] = useState(0);
  const sentences = useMemo(
    () => (cards && srsRows ? pickSentences(cards, new Map(srsRows.map((r) => [r.id, r.data])), app) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards?.length, srsRows?.length, app.n, seed],
  );
  const [i, setI] = useState(0);
  const [hideText, setHideText] = useState(false);
  const [showEn, setShowEn] = useState(false);
  const [recording, setRecording] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [reps, setReps] = useState(0);
  const [err, setErr] = useState("");
  const rec = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null);
  const [slow, setSlow] = useState(false);

  if (!cards) return <div className="screen">Loading…</div>;
  if (!sentences.length) return <Empty>No sentences yet.</Empty>;
  const s = sentences[i % sentences.length];
  const rate = slow ? Math.max(0.6, app.ttsRate - 0.2) : app.ttsRate;
  const canTranscribe = !!lastServerConfig()?.sttServer;

  async function toggleRecord() {
    unlockAudio();
    setErr("");
    if (recording && rec.current) {
      const b = await rec.current.stop();
      rec.current = null;
      setRecording(false);
      setBlob(b);
      setReps((n) => n + 1);
      // Play back: model first, then you.
      await speak(s.it, { rate });
      await playBlob(b);
      if (canTranscribe) {
        try {
          setHeard(await transcribeOnServer(b));
        } catch (e) {
          setHeard(null);
        }
      }
      return;
    }
    try {
      setBlob(null);
      setHeard(null);
      rec.current = await startRecording();
      setRecording(true);
    } catch (e) {
      setErr(`Microphone unavailable: ${(e as Error).message}`);
    }
  }

  function next() {
    rec.current?.cancel();
    rec.current = null;
    setRecording(false);
    setBlob(null);
    setHeard(null);
    setShowEn(false);
    const n = i + 1;
    if (n >= sentences.length) {
      setSeed(seed + 1);
      setI(0);
    } else setI(n);
    setTimeout(() => void speak(sentences[n % sentences.length]?.it ?? "", { rate }), 50);
  }

  return (
    <div className="screen shadow">
      <div className="row between">
        <h2>Shadowing</h2>
        <span className="muted small">{reps} reps</span>
      </div>
      <p className="muted small">Listen, then repeat out loud, copying the rhythm and melody. You'll hear the model and then yourself.</p>

      <div className="flashcard">
        {hideText ? (
          <div className="prompt muted">🎧 Listen-only mode</div>
        ) : heard !== null ? (
          <div className="prompt it">
            {wordMatches(heard, s.it).map((w, k) => (
              <span key={k} className={w.ok ? "w-ok" : "w-miss"}>
                {w.word}{" "}
              </span>
            ))}
          </div>
        ) : (
          <div className="prompt it">{s.it}</div>
        )}
        {showEn && <div className="muted">{s.en}</div>}
        {heard !== null && (
          <div className="muted small">
            Heard: “{heard || "…"}” — words in red weren't recognized (could be pronunciation or just transcription).
          </div>
        )}
      </div>

      {err && <div className="error">{err}</div>}

      <div className="row center">
        <button className="btn big" onClick={() => (unlockAudio(), speak(s.it, { rate }))}>
          ▶ Listen
        </button>
        <button className={`mic ${recording ? "on" : ""}`} onClick={toggleRecord}>
          {recording ? "■" : "🎤"}
        </button>
        <button className="btn big" onClick={next}>
          Next →
        </button>
      </div>
      {blob && (
        <div className="row center">
          <button className="btn small" onClick={async () => (await speak(s.it, { rate }), await playBlob(blob))}>
            ↻ Compare again
          </button>
          <button className="btn small ghost" onClick={() => playBlob(blob)}>
            ▶ Just me
          </button>
        </div>
      )}
      <div className="row center">
        <label className="check-inline">
          <input type="checkbox" checked={slow} onChange={(e) => setSlow(e.target.checked)} /> Slower
        </label>
        <label className="check-inline">
          <input type="checkbox" checked={hideText} onChange={(e) => setHideText(e.target.checked)} /> Hide text
        </label>
        <label className="check-inline">
          <input type="checkbox" checked={showEn} onChange={(e) => setShowEn(e.target.checked)} /> English
        </label>
      </div>
    </div>
  );
}
