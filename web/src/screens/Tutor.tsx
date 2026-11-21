import { useState } from "react";
import { createNote } from "../cards";
import { put, useCollection } from "../db";
import { logTime, type AppCtx } from "../state";
import { prettyDate, uid } from "../time";
import type { TutorData } from "../types";
import { Header, Stepper } from "../ui";
import { celebrate, toast } from "../look";

/** Parse lines like "la scadenza = deadline" or "la scadenza - deadline". */
function parseWords(text: string) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(.+?)\s*(?:=|—|–|:|\s-\s)\s*(.+)$/);
      return m ? { it: m[1].trim(), en: m[2].trim() } : null;
    })
    .filter((x): x is { it: string; en: string } => !!x);
}

export default function Tutor({ app }: { app: AppCtx }) {
  const rows = useCollection<TutorData>("tutor") ?? [];
  const [date, setDate] = useState(app.today);
  const [minutes, setMinutes] = useState(50);
  const [platform, setPlatform] = useState(localStorage.getItem("parla.tutorPlatform") ?? "iTalki");
  const [notes, setNotes] = useState("");
  const [words, setWords] = useState("");
  const [saved, setSaved] = useState("");
  const parsed = parseWords(words);

  async function save() {
    localStorage.setItem("parla.tutorPlatform", platform);
    const timelogId = await logTime({ block: "tutor", minutes, note: `${platform} tutor`, date });
    await put<TutorData>("tutor", uid(), { date, minutes, platform, notes, newWords: parsed, timelogId });
    for (const w of parsed) await createNote({ it: w.it, en: w.en, source: "tutor" });
    setSaved(`Saved. ${parsed.length} new word${parsed.length === 1 ? "" : "s"} added to flashcards.`);
    celebrate();
    toast("Tutor session logged 🎉");
    setNotes("");
    setWords("");
  }

  return (
    <div className="screen">
      <Header title="Tutor sessions 👩‍🏫" sub="Log your iTalki/Preply lessons. New words become flashcards." />
      <div className="card">
        <label className="field">
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Length</span>
          <Stepper value={minutes} onChange={setMinutes} />
        </label>
        <label className="field">
          <span>Platform</span>
          <input value={platform} onChange={(e) => setPlatform(e.target.value)} />
        </label>
        <label className="field">
          <span>Notes</span>
          <textarea rows={3} value={notes} placeholder="What did you talk about? What to work on?" onChange={(e) => setNotes(e.target.value)} />
        </label>
        <label className="field">
          <span>New words (one per line: italiano = English)</span>
          <textarea rows={4} value={words} placeholder={"la scadenza = deadline\nfare una pausa = to take a break"} onChange={(e) => setWords(e.target.value)} />
        </label>
        {words && <div className="muted small">{parsed.length} word(s) recognized</div>}
        <button className="btn primary big full" onClick={save} disabled={minutes <= 0}>
          Save session
        </button>
        {saved && <p className="ok">{saved}</p>}
      </div>
      <h3>History</h3>
      <div className="list">
        {[...rows].sort((a, b) => b.data.date.localeCompare(a.data.date)).map((r) => (
          <div key={r.id} className="list-item">
            <div className="grow">
              <b>
                {prettyDate(r.data.date)} · {r.data.minutes} min · {r.data.platform}
              </b>
              {r.data.notes && <div className="small">{r.data.notes}</div>}
              {r.data.newWords.length > 0 && <div className="muted small">{r.data.newWords.map((w) => w.it).join(", ")}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
