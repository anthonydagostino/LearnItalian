import { api, lastServerConfig } from "./api";
import type { Settings } from "./types";

// ---------------- Text-to-speech (browser it-IT voice) ----------------

let voices: SpeechSynthesisVoice[] = [];
function loadVoices() {
  if (!("speechSynthesis" in window)) return;
  voices = speechSynthesis.getVoices();
}
if ("speechSynthesis" in window) {
  loadVoices();
  speechSynthesis.addEventListener?.("voiceschanged", loadVoices);
}

export function italianVoices(): SpeechSynthesisVoice[] {
  loadVoices();
  return voices.filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith("it"));
}

function pickVoice(uri?: string) {
  const it = italianVoices();
  return it.find((v) => v.voiceURI === uri) ?? it.find((v) => v.localService) ?? it[0];
}

let ttsPrefs = { voiceURI: "", rate: 0.9 };
export function setTtsPrefs(p: { voiceURI?: string; rate?: number }) {
  ttsPrefs = { ...ttsPrefs, ...p };
}

/** Strip hints like "(why)" and dialogue separators so TTS reads only Italian. */
export function cleanForSpeech(text: string) {
  return text.replace(/\([^)]*\)/g, " ").replace(/\s+—\s+/g, ". ").replace(/…/g, "...").replace(/\s+/g, " ").trim();
}

export function speak(text: string, opts: { rate?: number } = {}): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window) || !text.trim()) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(cleanForSpeech(text));
    u.lang = "it-IT";
    const v = pickVoice(ttsPrefs.voiceURI);
    if (v) u.voice = v;
    u.rate = opts.rate ?? ttsPrefs.rate;
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    u.onend = finish;
    u.onerror = finish;
    // Safety net: some iOS versions never fire onend.
    setTimeout(finish, 2000 + text.length * 150);
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

/** iOS only allows speech after a user gesture; call once from a tap handler. */
let unlocked = false;
export function unlockAudio() {
  if (unlocked || !("speechSynthesis" in window)) return;
  unlocked = true;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  speechSynthesis.speak(u);
}

// ---------------- Speech-to-text ----------------

export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone =
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;

const SR: any = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
export const browserSttSupported = !!SR;
export const recordingSupported = !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

export type SttEngine = "browser" | "server" | "none";

/**
 * Which engine to use. "auto" prefers server-side Whisper when it's configured: it's more reliable in iOS
 * standalone PWAs and doesn't silently "autocorrect" a learner's mistakes the way dictation does.
 */
export function resolveEngine(mode: Settings["sttMode"]): SttEngine {
  const server = !!lastServerConfig()?.sttServer && recordingSupported;
  if (mode === "server") return server ? "server" : browserSttSupported ? "browser" : "none";
  if (mode === "browser") return browserSttSupported ? "browser" : server ? "server" : "none";
  if (server) return "server";
  return browserSttSupported ? "browser" : "none";
}

export interface Listening {
  /** Stop and get the result. */
  stop(): Promise<{ text: string; audio?: Blob }>;
  cancel(): void;
  engine: SttEngine;
}

function pickMime() {
  const types = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"];
  return types.find((t) => (MediaRecorder as any).isTypeSupported?.(t)) ?? "";
}

/** Record raw audio with MediaRecorder. The mic is released on stop so playback isn't routed to the earpiece on iOS. */
export async function startRecording(): Promise<{ stop(): Promise<Blob>; cancel(): void }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  const release = () => stream.getTracks().forEach((t) => t.stop());
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          release();
          resolve(new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" }));
        };
        if (rec.state !== "inactive") rec.stop();
        else {
          release();
          resolve(new Blob(chunks, { type: rec.mimeType || mime }));
        }
      }),
    cancel: () => {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
      release();
    },
  };
}

export async function transcribeOnServer(audio: Blob): Promise<string> {
  const fd = new FormData();
  const ext = audio.type.includes("mp4") ? "m4a" : audio.type.includes("ogg") ? "ogg" : "webm";
  fd.append("audio", audio, `speech.${ext}`);
  const r = await api<{ text: string }>("/api/stt", fd);
  return r.text;
}

function startBrowserRecognition(onInterim?: (t: string) => void): Listening {
  const rec = new SR();
  rec.lang = "it-IT";
  rec.interimResults = true;
  rec.continuous = true;
  rec.maxAlternatives = 1;
  let finalText = "";
  let interim = "";
  let ended = false;
  let endResolve: (() => void) | null = null;
  let error: string | null = null;
  rec.onresult = (e: any) => {
    interim = "";
    finalText = "";
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + " ";
      else interim += r[0].transcript + " ";
    }
    onInterim?.((finalText + interim).trim());
  };
  rec.onerror = (e: any) => {
    if (e.error !== "no-speech" && e.error !== "aborted") error = e.error;
  };
  rec.onend = () => {
    ended = true;
    endResolve?.();
  };
  rec.start();
  return {
    engine: "browser",
    stop: () =>
      new Promise((resolve, reject) => {
        const done = () => {
          if (error && !finalText && !interim) reject(new Error(`Speech recognition error: ${error}`));
          else resolve({ text: (finalText + interim).trim() });
        };
        if (ended) return done();
        endResolve = done;
        try {
          rec.stop();
        } catch {
          done();
        }
        setTimeout(done, 2500); // iOS sometimes never fires onend
      }),
    cancel: () => {
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    },
  };
}

/** Start listening with the configured engine. Call stop() to get the transcript. */
export async function startListening(mode: Settings["sttMode"], onInterim?: (t: string) => void): Promise<Listening> {
  stopSpeaking();
  const engine = resolveEngine(mode);
  if (engine === "none") throw new Error("No speech recognition available. Type instead, or set up server speech-to-text.");
  if (engine === "browser") return startBrowserRecognition(onInterim);
  const r = await startRecording();
  return {
    engine: "server",
    stop: async () => {
      const audio = await r.stop();
      const text = await transcribeOnServer(audio);
      return { text, audio };
    },
    cancel: r.cancel,
  };
}

export function playBlob(blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    a.onended = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    a.onerror = () => resolve();
    a.play().catch(() => resolve());
  });
}
