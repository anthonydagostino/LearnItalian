import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---- Fakes for the browser speech and recording APIs ----
class FakeRecognition {
  static last: FakeRecognition;
  lang = "";
  interimResults = false;
  continuous = false;
  maxAlternatives = 1;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  aborted = false;
  endsOnStop = true;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {
    if (this.endsOnStop) setTimeout(() => this.onend?.(), 0);
  }
  abort() {
    this.aborted = true;
  }
  emit(parts: [string, boolean][]) {
    const results = parts.map(([t, isFinal]) => Object.assign([{ transcript: t }], { isFinal }));
    this.onresult?.({ results });
  }
}

const tracks = () => [{ stop: vi.fn() }];
let currentTracks = tracks();
class FakeRecorder {
  static throwOnCreate = false;
  static isTypeSupported = (t: string) => t === "audio/mp4";
  mimeType: string;
  state = "inactive";
  ondataavailable: ((e: any) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_s: unknown, opts?: { mimeType?: string }) {
    if (FakeRecorder.throwOnCreate) throw new Error("NotSupportedError");
    this.mimeType = opts?.mimeType ?? "";
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["x".repeat(2000)], { type: this.mimeType }) });
    this.onstop?.();
  }
}

async function load(serverStt = true) {
  vi.resetModules();
  (window as any).webkitSpeechRecognition = FakeRecognition;
  (globalThis as any).MediaRecorder = FakeRecorder;
  currentTracks = tracks();
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => currentTracks })) },
    configurable: true,
  });
  vi.doMock("./api", () => ({
    lastServerConfig: () => ({ sttServer: serverStt }),
    api: vi.fn(async () => ({ text: "ciao dal server" })),
  }));
  return import("./speech");
}

beforeEach(() => {
  FakeRecorder.throwOnCreate = false;
  vi.useRealTimers();
});
afterEach(() => vi.doUnmock("./api"));

describe("browser recognition", () => {
  test("streams interim text and returns final + interim on stop", async () => {
    const s = await load(false);
    const interim = vi.fn();
    const l = await s.startListening("browser", interim);
    expect(FakeRecognition.last.lang).toBe("it-IT");
    FakeRecognition.last.emit([["vorrei", true], [" un caffè", false]]);
    expect(interim).toHaveBeenLastCalledWith("vorrei un caffè");
    const r = await l.stop();
    expect(r.text).toBe("vorrei un caffè");
  });

  test("if iOS never fires 'end', stop() still resolves and aborts recognition (regression)", async () => {
    const s = await load(false);
    const l = await s.startListening("browser");
    FakeRecognition.last.endsOnStop = false;
    FakeRecognition.last.emit([["ciao", true]]);
    vi.useFakeTimers();
    const p = l.stop();
    await vi.advanceTimersByTimeAsync(2600);
    expect((await p).text).toBe("ciao");
    expect(FakeRecognition.last.aborted).toBe(true);
  });

  test("a real recognition error with no text rejects; 'no-speech' just returns empty", async () => {
    const s = await load(false);
    let l = await s.startListening("browser");
    FakeRecognition.last.onerror?.({ error: "not-allowed" });
    await expect(l.stop()).rejects.toThrow(/not-allowed/);
    l = await s.startListening("browser");
    FakeRecognition.last.onerror?.({ error: "no-speech" });
    expect((await l.stop()).text).toBe("");
  });
});

describe("recording + server transcription", () => {
  test("records audio/mp4 on iOS-like browsers, transcribes, and releases the mic", async () => {
    const s = await load(true);
    const l = await s.startListening("server");
    const r = await l.stop();
    expect(r.text).toBe("ciao dal server");
    expect(r.audio!.type).toBe("audio/mp4");
    expect(currentTracks[0].stop).toHaveBeenCalled();
  });

  test("cancel releases the mic without transcribing", async () => {
    const s = await load(true);
    const l = await s.startListening("server");
    l.cancel();
    expect(currentTracks[0].stop).toHaveBeenCalled();
  });

  test("if MediaRecorder can't start, the mic stream is released (regression)", async () => {
    const s = await load(true);
    FakeRecorder.throwOnCreate = true;
    await expect(s.startRecording()).rejects.toThrow("NotSupportedError");
    expect(currentTracks[0].stop).toHaveBeenCalled();
  });
});
