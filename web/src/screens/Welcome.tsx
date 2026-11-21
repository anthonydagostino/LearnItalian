import { useState } from "react";
import { Icon } from "../look";
import { speak, unlockAudio, startRecording, italianVoices } from "../speech";
import { saveSettings, type AppCtx } from "../state";

export default function Welcome({ app, onDone }: { app: AppCtx; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(app.settings.name);
  const [start, setStart] = useState(app.settings.startDate);
  const [voiceOk, setVoiceOk] = useState<null | boolean>(null);
  const [micOk, setMicOk] = useState<null | boolean>(null);

  async function finish() {
    await saveSettings({ name: name.trim() || "Anthony", startDate: start });
    localStorage.setItem("parla.welcomed", "1");
    onDone();
  }

  const steps = [
    <>
      <div className="welcome-emoji wave-hand">👋</div>
      <h1>Benvenuto!</h1>
      <p>Parla is your daily Italian coach. The goal: hold real conversations by your deadline.</p>
      <div className="welcome-list">
        <div>
          <span>☀️</span> Open the app, tap the big button
        </div>
        <div>
          <span>🗣️</span> Speak out loud every single day
        </div>
        <div>
          <span>🔥</span> Busy? A 30-minute day keeps your streak
        </div>
      </div>
    </>,
    <>
      <div className="welcome-emoji">🎤</div>
      <h1>Let's check your sound</h1>
      <p>You'll hear Italian and speak back. Make sure both work.</p>
      <button
        className={`check-btn ${voiceOk ? "ok" : ""}`}
        onClick={async () => {
          unlockAudio();
          await speak("Ciao! Benvenuto. Iniziamo?", { rate: 0.9 });
          setVoiceOk(true);
        }}
      >
        <Icon name="speaker" size={22} /> {voiceOk ? "Heard it ✓" : "Play an Italian voice"}
      </button>
      {voiceOk && !italianVoices().length && (
        <p className="small muted">No Italian voice installed? iPhone Settings → Accessibility → Spoken Content → Voices → Italian.</p>
      )}
      <button
        className={`check-btn ${micOk ? "ok" : micOk === false ? "bad" : ""}`}
        onClick={async () => {
          try {
            const r = await startRecording();
            r.cancel();
            setMicOk(true);
          } catch {
            setMicOk(false);
          }
        }}
      >
        <Icon name="mic" size={22} /> {micOk ? "Microphone ready ✓" : micOk === false ? "Mic blocked — check permissions" : "Allow the microphone"}
      </button>
    </>,
    <>
      <div className="welcome-emoji">🗓️</div>
      <h1>Almost there</h1>
      <label className="field">
        <span>What should I call you?</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Day 1 of your 9-week plan</span>
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <p className="small muted">You can change these any time in Settings.</p>
    </>,
  ];

  return (
    <div className="welcome">
      <div className="welcome-body" key={step}>
        {steps[step]}
      </div>
      <div className="dots">
        {steps.map((_, i) => (
          <span key={i} className={i === step ? "on" : ""} />
        ))}
      </div>
      <button className="btn primary big full" onClick={() => (step < steps.length - 1 ? setStep(step + 1) : finish())}>
        {step === 0 ? "Let's start" : step < steps.length - 1 ? "Next" : "Andiamo! 🇮🇹"}
      </button>
      {step < steps.length - 1 && (
        <button className="linkish center-block" onClick={finish}>
          Skip
        </button>
      )}
    </div>
  );
}
