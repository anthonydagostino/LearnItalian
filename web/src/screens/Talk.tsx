import { useEffect, useRef, useState } from "react";
import { api, lastServerConfig } from "../api";
import { createNote } from "../cards";
import { all, cacheServerDoc, patch, put, useCollection, useDoc } from "../db";
import { speak, startListening, stopSpeaking, unlockAudio, type Listening } from "../speech";
import { logTime, setActiveBlock, type AppCtx } from "../state";
import { sync } from "../sync";
import type { ChatMessage, ConversationData, Correction, MistakeData } from "../types";
import { activeFor, Header, Modal, SpeakBtn } from "../ui";
import { celebrate, cheer, Icon, SCENARIO_EMOJI, toast } from "../look";
import { computeSkills, Stars } from "../skills";
import { buildFocus } from "../focus";

const KEY = "parla.activeConversation";

export default function Talk({ app }: { app: AppCtx }) {
  const [convId, setConvId] = useState<string | null>(() => localStorage.getItem(KEY));
  const conv = useDoc<ConversationData>("conversations", convId ?? "-");

  useEffect(() => {
    if (convId) localStorage.setItem(KEY, convId);
    else localStorage.removeItem(KEY);
  }, [convId]);

  if (convId && conv === undefined) {
    // Conversation not synced yet (or removed).
    return <Picker app={app} onStart={setConvId} />;
  }
  if (convId && conv) return <Chat app={app} id={convId} conv={conv} onClose={() => setConvId(null)} />;
  return <Picker app={app} onStart={setConvId} />;
}

function Picker({ app, onStart }: { app: AppCtx; onStart: (id: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const cfg = lastServerConfig();
  const suggested = app.week.scenarios;
  const others = Object.keys(app.cur.scenarios).filter((s) => !suggested.includes(s));

  async function start(scenario: string) {
    unlockAudio();
    setBusy(scenario);
    setErr("");
    try {
      const focus = await buildFocus();
      const r = await api<{ id: string; conversation: ConversationData }>("/api/chat/start", { scenario, week: Math.max(app.n, 1), focus });
      // Show it immediately (no waiting on a sync that may already be in progress → no duplicate taps).
      await cacheServerDoc("conversations", r.id, r.conversation);
      onStart(r.id);
      void sync();
      if (app.settings.autoplay) void speak(r.conversation.messages[0].text, { rate: app.ttsRate });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const colors = ["tomato", "blue", "amber", "teal", "purple", "pink", "green"];
  const convs = useCollection<ConversationData>("conversations") ?? [];
  const stars = new Map(computeSkills(convs).map((k) => [k.scenario, k.stars]));
  const Tile = ({ s, i, suggested: sug }: { s: string; i: number; suggested?: boolean }) => (
    <button className={`scenario-tile c-${colors[i % colors.length]} ${busy === s ? "loading" : ""}`} disabled={!!busy} onClick={() => start(s)}>
      {sug && <span className="tile-badge">This week</span>}
      <span className="tile-emoji">{busy === s ? <span className="spinner" /> : SCENARIO_EMOJI[s] ?? "💬"}</span>
      <b>{app.cur.scenarios[s].label}</b>
      {s !== "free" && <Stars n={stars.get(s) ?? 0} />}
    </button>
  );

  return (
    <div className="screen">
      <Header title="Let's talk" sub={<>Pick a situation. Your partner speaks at your level ({app.level.label.toLowerCase()}).</>} />
      {cfg && !cfg.ai && <div className="error">The AI partner isn't set up yet. Add ANTHROPIC_API_KEY on the server.</div>}
      {!navigator.onLine && <div className="error">You're offline. Conversations need a connection.</div>}
      {err && <div className="error">{err}</div>}
      <div className="scenario-grid">
        {suggested.filter((s) => app.cur.scenarios[s]).map((s, i) => (
          <Tile key={s} s={s} i={i} suggested />
        ))}
        {others.map((s, i) => (
          <Tile key={s} s={s} i={i + suggested.length} />
        ))}
      </div>
      <p className="muted small center">Tip: don't worry about mistakes. Corrections show up quietly under your messages.</p>
    </div>
  );
}

function Chat({ app, id, conv, onClose }: { app: AppCtx; id: string; conv: ConversationData; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>(conv.messages);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState<Listening | null>(null);
  const listeningRef = useRef<Listening | null>(null);
  listeningRef.current = listening;
  // Release the microphone if the user leaves the conversation mid-recording.
  useEffect(() => () => listeningRef.current?.cancel(), []);
  const [transcribing, setTranscribing] = useState(false);
  const [interim, setInterim] = useState("");
  const [err, setErr] = useState("");
  const [showEn, setShowEn] = useState<Record<number, boolean>>({});
  const [help, setHelp] = useState<null | { hint_en: string; say_it: string; say_it_en: string; last_reply_en: string }>(null);
  const [helpBusy, setHelpBusy] = useState(false);
  const [summary, setSummary] = useState<ConversationData | null>(conv.endedAt ? conv : null);
  const [ending, setEnding] = useState(false);
  const [typing, setTyping] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Keep local view in sync with the stored doc (e.g. resumed on another device).
    if (conv.messages.length > messages.length) setMessages(conv.messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.messages.length]);

  useEffect(() => {
    if (messages.length > 1 || sending) bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length, sending, interim]);

  async function send(t = text) {
    const msg = t.trim();
    if (!msg || sending) return;
    unlockAudio();
    setSending(true);
    setErr("");
    setText("");
    const optimistic: ChatMessage = { role: "user", text: msg, ts: Date.now() };
    setMessages((m) => [...m, optimistic]);
    try {
      const r = await api<{ user: ChatMessage; assistant: ChatMessage; mistakes: (MistakeData & { id: string })[] }>(`/api/chat/${id}/message`, { text: msg });
      if (app.settings.autoCards) {
        // Every correction becomes a flashcard right away: your own mistakes are the highest-value material.
        for (const m of r.mistakes ?? []) {
          const { id: mid, ...data } = m;
          const cardId = await createNote({ it: m.corrected, en: m.meaningEn || m.explanation || m.corrected, notes: m.explanation, source: "mistake" });
          await put<MistakeData>("mistakes", mid, { ...data, cardId });
        }
      }
      setMessages((m) => [...m.slice(0, -1), r.user, r.assistant]);
      setTyping(false);
      if (app.settings.autoplay) void speak(r.assistant.text, { rate: app.ttsRate });
      void sync();
    } catch (e) {
      setErr((e as Error).message);
      setMessages((m) => m.slice(0, -1));
      setText(msg);
    } finally {
      setSending(false);
    }
  }

  async function mic() {
    unlockAudio();
    if (listening) {
      setTranscribing(true);
      try {
        const r = await listening.stop();
        const t = r.text.trim();
        if (t) setText((prev) => (prev ? prev + " " : "") + t);
        else setErr("Didn't catch that. Try again, a bit closer to the mic.");
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setListening(null);
        setTranscribing(false);
        setInterim("");
      }
      return;
    }
    try {
      stopSpeaking();
      setErr("");
      setListening(await startListening(app.settings.sttMode, setInterim));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function askHelp() {
    setHelpBusy(true);
    try {
      setHelp(await api(`/api/chat/${id}/help`, { draft: text }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setHelpBusy(false);
    }
  }

  async function end() {
    setEnding(true);
    stopSpeaking();
    try {
      const r = await api<{ conversation: ConversationData }>(`/api/chat/${id}/end`, {});
      setSummary(r.conversation);
      celebrate(true);
      const minutes = Math.max(1, Math.round((r.conversation.speakingSeconds ?? 0) / 60));
      const active = activeFor("speaking");
      if (r.conversation.messages.some((m) => m.role === "user")) {
        if (active) {
          // The speaking block's timer is running: log the whole block (practice time, not just talk time).
          const blockMin = Math.max(minutes, Math.round((Date.now() - active.startedAt) / 60000));
          await logTime({ block: "speaking", blockId: active.date === app.today ? active.blockId : undefined, minutes: blockMin, note: r.conversation.scenarioLabel });
          setActiveBlock(null);
        } else {
          await logTime({ block: "speaking", minutes, note: r.conversation.scenarioLabel });
        }
      }
      void sync();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setEnding(false);
    }
  }

  if (summary) return <Summary app={app} conv={summary} onClose={onClose} />;

  const showText = typing || !!text.trim();
  return (
    <div className="screen chat">
      <div className="chat-head">
        <button className="icon-btn round" onClick={() => confirm("Leave this conversation? You can come back to it.") && onClose()} aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <span className="chat-avatar">{SCENARIO_EMOJI[conv.scenario] ?? "💬"}</span>
        <div className="grow">
          <b>{conv.scenarioLabel}</b>
          <small className="muted">Week {conv.week} · {messages.filter((m) => m.role === "user").length} replies</small>
        </div>
        <button className="btn small" onClick={end} disabled={ending}>
          {ending ? <span className="spinner" /> : "Finish"}
        </button>
      </div>

      <div className="messages">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role} pop-in`}>
            <div className="bubble">
              <span className={m.role === "assistant" ? "it" : ""}>{m.text}</span>
              {m.role === "assistant" && (
                <div className="bubble-tools">
                  <SpeakBtn text={m.text} rate={app.ttsRate} />
                  <button className={`tool-chip ${showEn[i] ? "on" : ""}`} onClick={() => setShowEn({ ...showEn, [i]: !showEn[i] })}>
                    🇺🇸 English
                  </button>
                </div>
              )}
              {m.role === "assistant" && showEn[i] && <div className="en">{m.en}</div>}
              {m.role === "assistant" && m.help && <div className="help-note">💡 {m.help}</div>}
            </div>
            {m.corrections?.map((c, j) => <CorrectionNote key={j} c={c} convId={id} auto={app.settings.autoCards} />)}
          </div>
        ))}
        {sending && (
          <div className="msg assistant">
            <div className="bubble typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        <div ref={bottom} />
      </div>

      {err && <div className="error">{err}</div>}

      <div className="composer">
        {listening || transcribing ? (
          <div className="listening-panel">
            <div className="wave">
              {Array.from({ length: 5 }).map((_, k) => (
                <span key={k} style={{ animationDelay: `${k * 0.12}s` }} />
              ))}
            </div>
            <p>{transcribing ? "Transcribing…" : interim || "Listening… speak Italian"}</p>
            <button className="mic big-mic on" onClick={mic} disabled={transcribing} aria-label="Stop">
              {transcribing ? <span className="spinner" /> : <Icon name="stop" size={30} />}
            </button>
          </div>
        ) : showText ? (
          <div className="text-row">
            <button className="icon-btn round" onClick={askHelp} disabled={helpBusy} aria-label="Help">
              {helpBusy ? <span className="spinner dark" /> : <Icon name="bulb" size={20} />}
            </button>
            <textarea
              rows={1}
              autoFocus={typing && !text}
              value={text}
              placeholder="Scrivi in italiano…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            {text.trim() ? (
              <button className="send-btn" onClick={() => send()} disabled={sending} aria-label="Send">
                <Icon name="send" size={20} />
              </button>
            ) : (
              <button className="icon-btn round" onClick={() => (setTyping(false), void mic())} aria-label="Speak instead">
                <Icon name="mic" size={20} />
              </button>
            )}
          </div>
        ) : (
          <div className="voice-row">
            <button className="side-btn" onClick={askHelp} disabled={helpBusy || sending}>
              {helpBusy ? <span className="spinner dark" /> : <Icon name="bulb" size={22} />}
              <span>Help</span>
            </button>
            <div className="mic-wrap">
              <button className="mic big-mic" onClick={mic} disabled={sending} aria-label="Tap to speak">
                <Icon name="mic" size={34} />
              </button>
              <span>{sending ? "Thinking…" : "Tap to speak"}</span>
            </div>
            <button className="side-btn" onClick={() => setTyping(true)}>
              <Icon name="keyboard" size={22} />
              <span>Type</span>
            </button>
          </div>
        )}
        {showText && text.trim() && !listening && (
          <p className="muted small center">Check what I heard, fix it if needed, then send.</p>
        )}
      </div>

      {help && (
        <Modal title="Need a hand? 💡" onClose={() => setHelp(null)}>
          {help.last_reply_en && (
            <div className="help-block">
              <small>They said</small>
              <p>{help.last_reply_en}</p>
            </div>
          )}
          <div className="help-block">
            <small>Tip</small>
            <p>{help.hint_en}</p>
          </div>
          <div className="say-this">
            <small>You could say</small>
            <div className="it big-it">
              {help.say_it} <SpeakBtn text={help.say_it} rate={app.ttsRate} />
            </div>
            <div className="muted small">{help.say_it_en}</div>
          </div>
          <button
            className="btn primary big full"
            onClick={() => {
              setText(help.say_it);
              setHelp(null);
            }}
          >
            Use this
          </button>
        </Modal>
      )}
    </div>
  );
}

function CorrectionNote({ c, convId, auto }: { c: Correction; convId: string; auto: boolean }) {
  const [state, setState] = useState<"idle" | "added">(auto ? "added" : "idle");
  return (
    <div className="correction pop-in">
      <div className="correction-label">{c.recurring ? "🔁 Repeated mistake" : "💡 More natural"}</div>
      <div className="correction-line">
        <s>{c.original}</s>
      </div>
      <div className="correction-line">
        <b className="it">{c.corrected}</b> <SpeakBtn text={c.corrected} />
      </div>
      <div className="muted small">{c.explanation_en}</div>
      <button
        className={`tool-chip ${state === "added" ? "on" : ""}`}
        disabled={state === "added"}
        onClick={async () => {
          const cardId = await createNote({ it: c.corrected, en: c.meaning_en || c.explanation_en, notes: c.explanation_en, source: "mistake" });
          const ms = await all<MistakeData>("mistakes");
          const m = ms.find((x) => x.data.conversationId === convId && x.data.corrected === c.corrected && !x.data.cardId);
          if (m) await patch<MistakeData>("mistakes", m.id, (old) => ({ ...(old as MistakeData), cardId }));
          setState("added");
          toast("Added to your flashcards 🃏");
        }}
      >
        {state === "added" ? "✓ In your flashcards" : "+ Make it a flashcard"}
      </button>
    </div>
  );
}

function Summary({ app, conv, onClose }: { app: AppCtx; conv: ConversationData; onClose: () => void }) {
  const s = conv.summary;
  const minutes = Math.max(1, Math.round((conv.speakingSeconds ?? 0) / 60));
  const turns = conv.messages.filter((m) => m.role === "user").length;
  return (
    <div className="screen">
      <div className="summary-hero">
        <div className="empty-emoji">🏆</div>
        <h1>{cheer()}</h1>
        <p className="muted">{conv.scenarioLabel}</p>
        <div className="stat-bubbles">
          <div className="stat-bubble c-tomato">
            <b>{minutes}</b>
            <span>minutes</span>
          </div>
          <div className="stat-bubble c-blue">
            <b>{turns}</b>
            <span>replies</span>
          </div>
          <div className="stat-bubble c-amber">
            <b>{conv.talkShare ?? 0}%</b>
            <span>you talked</span>
          </div>
        </div>
      </div>
      {s?.went_well && (
        <div className="card soft c-green">
          <b>✅ What went well</b>
          <p>{s.went_well}</p>
        </div>
      )}
      {s && s.top_mistakes.length > 0 && (
        <div className="card">
          <b>🔧 Your top fixes</b>
          {s.top_mistakes.map((m, i) => (
            <div key={i} className="fix-row">
              <span className="fix-num">{i + 1}</span>
              <div>
                <div>
                  <s>{m.original}</s>
                </div>
                <div>
                  <b className="it">{m.corrected}</b> <SpeakBtn text={m.corrected} rate={app.ttsRate} />
                </div>
                <div className="muted small">{m.explanation_en}</div>
              </div>
            </div>
          ))}
          <p className="muted small">All of these are saved in your Mistakes journal.</p>
        </div>
      )}
      {s?.focus_next && (
        <div className="card soft c-blue">
          <b>🎯 Next time, focus on</b>
          <p>{s.focus_next}</p>
        </div>
      )}
      <button className="btn primary big full" onClick={onClose}>
        Talk again 💬
      </button>
      <a className="btn ghost full" href="#/today" onClick={onClose}>
        Back to today
      </a>
    </div>
  );
}
