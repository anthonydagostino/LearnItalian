import { useEffect, useState } from "react";
import { api, lastServerConfig, serverConfig } from "../api";
import { db } from "../db";
import { browserSttSupported, isIOS, isStandalone, italianVoices, recordingSupported, resolveEngine, speak, startListening, startRecording, transcribeOnServer, unlockAudio } from "../speech";
import { saveSettings, type AppCtx } from "../state";
import { resetAndResync, sync, useSyncState } from "../sync";
import type { Settings } from "../types";

function MicTest({ app }: { app: AppCtx }) {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const add = (s: string) => setLog((l) => [...l, s]);
  const phrase = "Buongiorno, vorrei un caffè e un cornetto, per favore.";

  async function testBrowser() {
    unlockAudio();
    setBusy("browser");
    try {
      const t0 = Date.now();
      const l = await startListening("browser", () => {});
      add("Browser: listening for 5 seconds — say the sentence…");
      await new Promise((r) => setTimeout(r, 5000));
      const r = await l.stop();
      add(`Browser (${l.engine}, ${Date.now() - t0}ms): “${r.text || "(nothing)"}”`);
    } catch (e) {
      add(`Browser: ✗ ${(e as Error).message}`);
    } finally {
      setBusy("");
    }
  }
  async function testServer() {
    unlockAudio();
    setBusy("server");
    try {
      const rec = await startRecording();
      add("Server: recording 5 seconds — say the sentence…");
      await new Promise((r) => setTimeout(r, 5000));
      const blob = await rec.stop();
      const t0 = Date.now();
      const text = await transcribeOnServer(blob);
      add(`Server (${blob.type}, ${Math.round(blob.size / 1024)}KB, ${Date.now() - t0}ms): “${text || "(nothing)"}”`);
    } catch (e) {
      add(`Server: ✗ ${(e as Error).message}`);
    } finally {
      setBusy("");
    }
  }
  const cfg = lastServerConfig();
  return (
    <section className="card">
      <b>Mic test</b>
      <p className="small">
        Say: <i className="it">{phrase}</i>
      </p>
      <p className="muted small">
        {isIOS ? "iOS" : "Not iOS"} · {isStandalone ? "home-screen app" : "browser tab"} · Web Speech {browserSttSupported ? "available" : "missing"} ·
        recorder {recordingSupported ? "available" : "missing"} · server STT {cfg?.sttServer ? "configured" : "not configured"} · using{" "}
        <b>{resolveEngine(app.settings.sttMode)}</b>
      </p>
      <div className="row">
        <button className="btn small" disabled={!!busy || !browserSttSupported} onClick={testBrowser}>
          {busy === "browser" ? "Listening…" : "Test browser STT"}
        </button>
        <button className="btn small" disabled={!!busy || !cfg?.sttServer} onClick={testServer}>
          {busy === "server" ? "Recording…" : "Test server STT"}
        </button>
        <button className="btn small ghost" onClick={() => (unlockAudio(), speak(phrase, { rate: app.ttsRate }))}>
          🔊 TTS
        </button>
      </div>
      {log.map((l, i) => (
        <div key={i} className="small mono">
          {l}
        </div>
      ))}
    </section>
  );
}

export default function SettingsScreen({ app }: { app: AppCtx }) {
  const s = app.settings;
  const sync$ = useSyncState();
  const [voices, setVoices] = useState(italianVoices());
  const [msg, setMsg] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setVoices(italianVoices()), 500);
    void serverConfig(true);
    return () => clearTimeout(t);
  }, []);
  const set = (p: Partial<Settings>) => void saveSettings(p);
  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => set({ [k]: Number(e.target.value) || 0 } as any);
  const cfg = lastServerConfig();

  async function exportData() {
    const docs = await db.docs.toArray();
    const blob = new Blob([JSON.stringify(docs, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `parla-export-${app.today}.json`;
    a.click();
  }

  return (
    <div className="screen settings">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
        </div>
      </header>
      <section className="card">
        <b>You</b>
        <label className="field">
          <span>Your name</span>
          <input value={s.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <button className="btn small ghost" onClick={() => (localStorage.removeItem("parla.welcomed"), location.reload())}>
          Show the welcome tour again
        </button>
      </section>
      <section className="card">
        <b>Schedule</b>
        <label className="field">
          <span>Start date (week 1)</span>
          <input type="date" value={s.startDate} onChange={(e) => set({ startDate: e.target.value })} />
        </label>
        <label className="field">
          <span>Target date</span>
          <input type="date" value={s.targetDate} onChange={(e) => set({ targetDate: e.target.value })} />
        </label>
        <label className="field">
          <span>Weekly target (hours)</span>
          <input type="number" value={s.weeklyTargetHours} onChange={num("weeklyTargetHours")} />
        </label>
      </section>
      <section className="card">
        <b>Flashcards</b>
        <label className="field">
          <span>New cards per day</span>
          <input type="number" value={s.newPerDay} onChange={num("newPerDay")} />
        </label>
        <label className="field">
          <span>Max reviews per day</span>
          <input type="number" value={s.reviewCap} onChange={num("reviewCap")} />
        </label>
        <label className="check-inline">
          <input type="checkbox" checked={s.speakAnswers} onChange={(e) => set({ speakAnswers: e.target.checked })} /> Speak the answer on English → Italian cards
        </label>
        <label className="check-inline">
          <input type="checkbox" checked={s.autoplay} onChange={(e) => set({ autoplay: e.target.checked })} /> Auto-play Italian audio
        </label>
      </section>
      <section className="card">
        <b>Voice</b>
        <label className="field">
          <span>Speech-to-text</span>
          <select value={s.sttMode} onChange={(e) => set({ sttMode: e.target.value as Settings["sttMode"] })}>
            <option value="auto">Auto (server Whisper if configured, else browser)</option>
            <option value="server">Server (record + Whisper)</option>
            <option value="browser">Browser (Web Speech API)</option>
          </select>
        </label>
        <label className="field">
          <span>Italian voice</span>
          <select value={s.voiceURI} onChange={(e) => set({ voiceURI: e.target.value })}>
            <option value="">Default</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </label>
        {!voices.length && <p className="muted small">No Italian voice found. On iPhone: Settings → Accessibility → Spoken Content → Voices → Italian.</p>}
        <label className="field">
          <span>Speech rate ({s.ttsRate ? s.ttsRate.toFixed(2) : `auto: ${app.level.ttsRate}`})</span>
          <input type="range" min={0} max={1.2} step={0.05} value={s.ttsRate} onChange={num("ttsRate")} />
        </label>
        <p className="muted small">Rate 0 = follow your curriculum level (slower in early weeks).</p>
      </section>
      <MicTest app={app} />
      <section className="card">
        <b>Lessons</b>
        <label className="field">
          <span>Course</span>
          <input value={s.lessonCourse} onChange={(e) => set({ lessonCourse: e.target.value })} />
        </label>
        <label className="field">
          <span>Next lesson #</span>
          <input type="number" value={s.lessonNext} onChange={num("lessonNext")} />
        </label>
      </section>
      <section className="card">
        <b>Sync & data</b>
        <p className="small">
          Status: {sync$.status}
          {sync$.lastSync ? ` · last ${new Date(sync$.lastSync).toLocaleTimeString()}` : ""}
          {sync$.pending ? ` · ${sync$.pending} pending` : ""}
          {sync$.error ? ` · ${sync$.error}` : ""}
        </p>
        <p className="muted small">
          Server: AI {cfg?.ai ? `on (${cfg.model}${cfg.mockAi ? ", mock" : ""})` : "off"} · STT {cfg?.sttServer ? "on" : "off"}
        </p>
        <div className="row">
          <button className="btn small" onClick={() => sync()}>
            Sync now
          </button>
          <button className="btn small ghost" onClick={() => resetAndResync()}>
            Full re-sync
          </button>
          <button
            className="btn small ghost"
            onClick={async () => {
              const r = await api<{ cards: number; changed: number; warnings: string[] }>("/api/reseed", {});
              setMsg(`Seed reloaded: ${r.cards} cards, ${r.changed} changed${r.warnings.length ? `, ${r.warnings.length} warnings` : ""}.`);
              await sync();
            }}
          >
            Reload seed files
          </button>
          <button className="btn small ghost" onClick={exportData}>
            Export JSON
          </button>
        </div>
        {msg && <p className="small">{msg}</p>}
      </section>
    </div>
  );
}
