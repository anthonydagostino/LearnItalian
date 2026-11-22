import { afterEach, describe, expect, test, vi } from "vitest";

/** Load speech.ts fresh with a given browser/server capability mix. */
async function load(opts: { browserStt: boolean; recorder: boolean; serverStt: boolean }) {
  vi.resetModules();
  const w = window as any;
  if (opts.browserStt) w.webkitSpeechRecognition = function () {};
  else delete w.webkitSpeechRecognition;
  delete w.SpeechRecognition;
  Object.defineProperty(navigator, "mediaDevices", { value: opts.recorder ? { getUserMedia: vi.fn() } : undefined, configurable: true });
  (globalThis as any).MediaRecorder = opts.recorder ? function () {} : undefined;
  vi.doMock("./api", () => ({ lastServerConfig: () => ({ sttServer: opts.serverStt }), api: vi.fn() }));
  return import("./speech");
}

afterEach(() => vi.doUnmock("./api"));

describe("resolveEngine", () => {
  test("auto prefers server Whisper when configured and recording works", async () => {
    const s = await load({ browserStt: true, recorder: true, serverStt: true });
    expect(s.resolveEngine("auto")).toBe("server");
  });
  test("auto falls back to the browser when the server has no STT", async () => {
    const s = await load({ browserStt: true, recorder: true, serverStt: false });
    expect(s.resolveEngine("auto")).toBe("browser");
  });
  test("an explicit choice falls back to whatever is available", async () => {
    const noBrowser = await load({ browserStt: false, recorder: true, serverStt: true });
    expect(noBrowser.resolveEngine("browser")).toBe("server");
    const noRecorder = await load({ browserStt: true, recorder: false, serverStt: true });
    expect(noRecorder.resolveEngine("server")).toBe("browser");
  });
  test("nothing available → none (UI tells the user to type)", async () => {
    const s = await load({ browserStt: false, recorder: false, serverStt: false });
    expect(s.resolveEngine("auto")).toBe("none");
    await expect(s.startListening("auto")).rejects.toThrow(/No speech recognition/);
  });
});

describe("cleanForSpeech", () => {
  test("drops hints and turns dialogue dashes into pauses", async () => {
    const s = await load({ browserStt: false, recorder: false, serverStt: false });
    expect(s.cleanForSpeech("perché (why) — Ciao!")).toBe("perché. Ciao!");
    expect(s.cleanForSpeech("Allora…  vediamo")).toBe("Allora... vediamo");
  });
});
