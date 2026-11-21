import { useEffect, useRef, useState } from "react";
import { api, lastServerConfig } from "../api";
import { createNote } from "../cards";
import { all, patch, useDoc } from "../db";
import { speak, startListening, stopSpeaking, unlockAudio, type Listening } from "../speech";
import { logTime, setActiveBlock, type AppCtx } from "../state";
import { sync } from "../sync";
import type { ChatMessage, ConversationData, Correction, MistakeData } from "../types";
import { MISTAKE_LABELS } from "../types";
import { activeFor, Modal, SpeakBtn } from "../ui";

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
      const r = await api<{ id: string; conversation: ConversationData }>("/api/chat/start", { scenario, week: Math.max(app.n, 1) });
      await sync();
      onStart(r.id);
      if (app.settings.autoplay) void speak(r.conversation.messages[0].text, { rate: app.ttsRate });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const Btn = ({ s }: { s: string }) => (
    <button className="scenario" disabled={!!busy} onClick={() => start(s)}>
      <b>{app.cur.scenarios[s].label}</b>
      <span className="muted small">{busy === s ? "Starting…" : app.cur.scenarios[s].role}</span>
    </button>
  );

  return (
    <div className="screen">
      <h2>Talk</h2>
      <p className="muted">
        Level: {app.level.label} (week {Math.max(app.n, 1)}). Your partner adapts to your curriculum week.
      </p>
      {cfg && !cfg.ai && <div className="error">The AI partner isn't configured. Set ANTHROPIC_API_KEY on the server.</div>}
      {!navigator.onLine && <div className="error">Conversations need a connection.</div>}
      {err && <div className="error">{err}</div>}
      <h3>This week</h3>
      <div className="scenarios">
        {suggested.map((s) => app.cur.scenarios[s] && <Btn key={s} s={s} />)}
      </div>
      <h3>All scenarios</h3>
      <div className="scenarios">
        {others.map((s) => (
          <Btn key={s} s={s} />
        ))}
      </div>
    </div>
  );
}

function Chat({ app, id, conv, onClose }: { app: AppCtx; id: string; conv: ConversationData; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>(conv.messages);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState<Listening | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [interim, setInterim] = useState("");
  const [err, setErr] = useState("");
  const [showEn, setShowEn] = useState<Record<number, boolean>>({});
  const [help, setHelp] = useState<null | { hint_en: string; say_it: string; say_it_en: string; last_reply_en: string }>(null);
  const [helpBusy, setHelpBusy] = useState(false);
  const [summary, setSummary] = useState<ConversationData | null>(conv.endedAt ? conv : null);
  const [ending, setEnding] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Keep local view in sync with the stored doc (e.g. resumed on another device).
    if (conv.messages.length > messages.length) setMessages(conv.messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.messages.length]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
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
      const r = await api<{ user: ChatMessage; assistant: ChatMessage }>(`/api/chat/${id}/message`, { text: msg });
      setMessages((m) => [...m.slice(0, -1), r.user, r.assistant]);
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

  return (
    <div className="screen chat">
      <div className="row between chat-head">
        <div>
          <b>{conv.scenarioLabel}</b>
          <div className="muted small">Week {conv.week} · tap 🔊 to replay, EN to translate</div>
        </div>
        <button className="btn small" onClick={end} disabled={ending}>
          {ending ? "Summarizing…" : "End"}
        </button>
      </div>

      <div className="messages">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="bubble">
              <span className={m.role === "assistant" ? "it" : ""}>{m.text}</span>
              {m.role === "assistant" && (
                <div className="bubble-tools">
                  <SpeakBtn text={m.text} rate={app.ttsRate} />
                  <button className="icon-btn" onClick={() => setShowEn({ ...showEn, [i]: !showEn[i] })}>
                    EN
                  </button>
                </div>
              )}
              {m.role === "assistant" && showEn[i] && <div className="en">{m.en}</div>}
              {m.role === "assistant" && m.help && <div className="help-note">💡 {m.help}</div>}
            </div>
            {m.corrections?.map((c, j) => <CorrectionNote key={j} c={c} convId={id} />)}
          </div>
        ))}
        {sending && (
          <div className="msg assistant">
            <div className="bubble typing">…</div>
          </div>
        )}
        <div ref={bottom} />
      </div>

      {err && <div className="error">{err}</div>}
      {listening && <div className="interim">{interim || "🎙 Listening… tap ■ when you're done"}</div>}
      {transcribing && <div className="interim">Transcribing…</div>}

      <div className="composer">
        <button className="btn small ghost" onClick={askHelp} disabled={helpBusy}>
          {helpBusy ? "…" : "Help"}
        </button>
        <textarea
          rows={1}
          value={text}
          placeholder="Parla o scrivi…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {text.trim() ? (
          <button className="btn primary" onClick={() => send()} disabled={sending}>
            Send
          </button>
        ) : (
          <button className={`mic ${listening ? "on" : ""}`} onClick={mic} disabled={transcribing || sending}>
            {listening ? "■" : "🎤"}
          </button>
        )}
      </div>
      {text.trim() && !listening && (
        <div className="row center">
          <button className="btn ghost small" onClick={mic} disabled={transcribing || sending}>
            🎤 add more
          </button>
        </div>
      )}

      {help && (
        <Modal title="Help" onClose={() => setHelp(null)}>
          {help.last_reply_en && (
            <p>
              <span className="muted small">They said:</span>
              <br />
              {help.last_reply_en}
            </p>
          )}
          <p>{help.hint_en}</p>
          <div className="card">
            <div className="it big-it">
              {help.say_it} <SpeakBtn text={help.say_it} rate={app.ttsRate} />
            </div>
            <div className="muted small">{help.say_it_en}</div>
          </div>
          <div className="row end">
            <button
              className="btn primary"
              onClick={() => {
                setText(help.say_it);
                setHelp(null);
              }}
            >
              Use this
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CorrectionNote({ c, convId }: { c: Correction; convId: string }) {
  const [state, setState] = useState<"idle" | "added">("idle");
  return (
    <div className="correction">
      <div>
        <s>{c.original}</s> → <b className="it">{c.corrected}</b> <SpeakBtn text={c.corrected} />
      </div>
      <div className="muted small">
        {MISTAKE_LABELS[c.type] ?? c.type}: {c.explanation_en}
      </div>
      <button
        className="btn tiny"
        disabled={state === "added"}
        onClick={async () => {
          const cardId = await createNote({ it: c.corrected, en: c.meaning_en || c.explanation_en, notes: c.explanation_en, source: "mistake" });
          // Link the matching mistake journal entry to the card.
          const ms = await all<MistakeData>("mistakes");
          const m = ms.find((x) => x.data.conversationId === convId && x.data.corrected === c.corrected && !x.data.cardId);
          if (m) await patch<MistakeData>("mistakes", m.id, (old) => ({ ...(old as MistakeData), cardId }));
          setState("added");
        }}
      >
        {state === "added" ? "✓ Card added" : "+ Flashcard"}
      </button>
    </div>
  );
}

function Summary({ app, conv, onClose }: { app: AppCtx; conv: ConversationData; onClose: () => void }) {
  const s = conv.summary;
  const minutes = Math.round((conv.speakingSeconds ?? 0) / 60);
  return (
    <div className="screen">
      <h2>Nice work! 🎉</h2>
      <p className="muted">
        {conv.scenarioLabel} · {minutes} min of speaking practice logged · {conv.messages.filter((m) => m.role === "user").length} turns
      </p>
      {s?.went_well && (
        <div className="card">
          <b>What went well</b>
          <p>{s.went_well}</p>
        </div>
      )}
      {s && s.top_mistakes.length > 0 && (
        <div className="card">
          <b>Top mistakes</b>
          {s.top_mistakes.map((m, i) => (
            <div key={i} className="correction">
              <div>
                <s>{m.original}</s> → <b className="it">{m.corrected}</b> <SpeakBtn text={m.corrected} rate={app.ttsRate} />
              </div>
              <div className="muted small">
                {MISTAKE_LABELS[m.type] ?? m.type}: {m.explanation_en}
              </div>
            </div>
          ))}
          <p className="muted small">All corrections are in your Mistakes journal.</p>
        </div>
      )}
      {s?.focus_next && (
        <div className="card">
          <b>Focus next time</b>
          <p>{s.focus_next}</p>
        </div>
      )}
      <div className="row">
        <button className="btn primary" onClick={onClose}>
          New conversation
        </button>
        <a className="btn ghost" href="#/today" onClick={onClose}>
          Back to today
        </a>
      </div>
    </div>
  );
}
