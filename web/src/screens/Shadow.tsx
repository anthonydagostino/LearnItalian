import { useMemo, useRef, useState } from "react";
import { lastServerConfig } from "../api";
import { useCollection } from "../db";
import { unlockedTopics } from "../plan";
import { wordMatches } from "../srs";
import { playBlob, speak, startRecording, transcribeOnServer, unlockAudio } from "../speech";
import type { AppCtx } from "../state";
import type { CardData, SrsData } from "../types";
import { Empty, Header } from "../ui";
import { Icon } from "../look";

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
  if (!sentences.length) return <Empty emoji="🎧" title="No sentences yet" />;
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
      <Header title="Shadowing" sub="Listen, then say it out loud the same way." right={<span className="pill c-teal">🔁 {reps}</span>} />

      <div className="steps">
        <span className={!recording && !blob ? "on" : ""}>1 · Listen</span>
        <span className={recording ? "on" : ""}>2 · Repeat</span>
        <span className={blob && !recording ? "on" : ""}>3 · Compare</span>
      </div>

      <div key={i} className="flashcard shadow-card pop-in">
        {hideText ? (
          <div className="prompt muted">🎧 Just listen…</div>
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
        {heard !== null && <div className="muted small">I heard “{heard || "…"}”. Red words didn't come through clearly.</div>}
      </div>

      {err && <div className="error">{err}</div>}

      <div className="control-row">
        <button className="ctrl c-blue" onClick={() => (unlockAudio(), speak(s.it, { rate }))}>
          <span className="ctrl-circle">
            <Icon name="play" size={28} />
          </span>
          Listen
        </button>
        <button className={`ctrl c-tomato ${recording ? "rec" : ""}`} onClick={toggleRecord}>
          <span className="ctrl-circle big">
            <Icon name={recording ? "stop" : "mic"} size={34} />
          </span>
          {recording ? "Stop" : "Repeat"}
        </button>
        <button className="ctrl c-gray" onClick={next}>
          <span className="ctrl-circle">
            <Icon name="next" size={26} />
          </span>
          Next
        </button>
      </div>
      {blob && (
        <div className="row center">
          <button className="chip-btn" onClick={async () => (await speak(s.it, { rate }), await playBlob(blob))}>
            <Icon name="repeat" size={16} /> Compare again
          </button>
          <button className="chip-btn" onClick={() => playBlob(blob)}>
            <Icon name="play" size={14} /> Just me
          </button>
        </div>
      )}
      <div className="toggles">
        <button className={`toggle ${slow ? "on" : ""}`} onClick={() => setSlow(!slow)}>
          🐢 Slower
        </button>
        <button className={`toggle ${hideText ? "on" : ""}`} onClick={() => setHideText(!hideText)}>
          🙈 Hide text
        </button>
        <button className={`toggle ${showEn ? "on" : ""}`} onClick={() => setShowEn(!showEn)}>
          🇺🇸 English
        </button>
      </div>
    </div>
  );
}
