import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { aiEnabled, config } from "./config.js";
import { db, getDoc, putDoc } from "./db.js";
import { curriculum } from "./seed.js";
import { localDate } from "./time.js";

export const MISTAKE_TYPES = [
  "gender_articles",
  "verb_conjugation",
  "word_order",
  "prepositions",
  "vocabulary",
  "spelling",
  "other",
] as const;

const Correction = z.object({
  original: z.string().describe("The learner's exact wording that was wrong or unnatural"),
  corrected: z.string().describe("The natural Italian way to say it"),
  meaning_en: z.string().describe("Short English meaning of the corrected phrase"),
  explanation_en: z.string().describe("One short sentence in English explaining the fix"),
  type: z.enum(MISTAKE_TYPES),
  recurring: z.boolean().describe("True if this repeats one of the learner's recent mistakes listed in the system prompt"),
});

const TurnSchema = z.object({
  corrections: z
    .array(Correction)
    .describe("0 to 2 corrections of the learner's LAST message. Empty if it was fine or there was no learner message."),
  reply_it: z.string().describe("Your in-character reply in Italian"),
  reply_en: z.string().describe("English translation of reply_it"),
  help_en: z
    .string()
    .describe("Optional very short English support for hard words in reply_it, per the support level. Empty string if none."),
});
type Turn = z.infer<typeof TurnSchema>;

const HelpSchema = z.object({
  hint_en: z.string().describe("A short hint in English on how the learner could answer"),
  say_it: z.string().describe("One simple Italian sentence the learner could say next"),
  say_it_en: z.string().describe("English translation of say_it"),
  last_reply_en: z.string().describe("English translation of the partner's last message, or empty"),
});

const SummarySchema = z.object({
  top_mistakes: z
    .array(
      z.object({
        original: z.string(),
        corrected: z.string(),
        explanation_en: z.string(),
        type: z.enum(MISTAKE_TYPES),
      }),
    )
    .describe("The 3 to 5 most important recurring or instructive mistakes, most important first"),
  went_well: z.string().describe("One or two sentences in English on what went well"),
  focus_next: z.string().describe("One concrete thing to practice next time, in English"),
});

export interface DisplayMessage {
  role: "user" | "assistant";
  text: string;
  en?: string;
  help?: string;
  corrections?: z.infer<typeof Correction>[];
  ts: number;
}

export interface Conversation {
  scenario: string;
  scenarioLabel: string;
  week: number;
  level: number;
  startedAt: number;
  endedAt?: number;
  messages: DisplayMessage[];
  summary?: z.infer<typeof SummarySchema>;
  speakingSeconds?: number;
  talkShare?: number;
  focus?: Focus;
  date: string;
}

export interface Focus {
  words: string[];
  mistakes: string[];
}

export function cleanFocus(f: unknown): Focus {
  const list = (x: unknown) =>
    (Array.isArray(x) ? x : [])
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.replace(/[\n\r]+/g, " ").trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 12);
  const o = (f ?? {}) as Record<string, unknown>;
  return { words: list(o.words), mistakes: list(o.mistakes) };
}

let client: Anthropic | null = null;
function anthropic() {
  if (!client) client = new Anthropic({ apiKey: config.anthropicKey, maxRetries: config.claudeMaxRetries });
  return client;
}

function weekInfo(weekNum: number) {
  const cur = curriculum();
  const weeks: any[] = cur.weeks;
  const n = Number.isFinite(weekNum) ? Math.floor(weekNum) : 1;
  const week = weeks.find((w) => w.week === n) ?? weeks[Math.min(Math.max(n, 1), weeks.length) - 1];
  const level = cur.levels[String(week.level)];
  return { week, level };
}

function systemPrompt(scenarioKey: string, weekNum: number, focus?: Focus) {
  const cur = curriculum();
  const scenario = cur.scenarios[scenarioKey] ?? cur.scenarios.free;
  const { week, level } = weekInfo(weekNum);
  const support =
    level.englishSupport === "high"
      ? "HIGH: put a short English gloss of any word a beginner might not know in help_en. If the learner writes in English, warmly show them how to say it in Italian (as a correction) and continue."
      : level.englishSupport === "some"
        ? "SOME: help_en only for a single genuinely hard word, otherwise empty. Stay in Italian even if the learner uses English, but include the Italian version of their English as a correction."
        : "NONE: help_en must be an empty string unless the learner explicitly asks for English. Stay fully in Italian.";

  return `You are a patient, encouraging Italian conversation partner for an American software engineer learning to speak Italian. The learner's goal is to hold real, simple conversations by late January, and to travel in Italy next summer.

## Your role in this conversation
You play ${scenario.role}.
Scenario goal: ${scenario.goal}
Stay in character for the whole conversation. Never break role to lecture; corrections go only in the "corrections" field, not in your reply.

## Learner level (curriculum week ${week.week}: ${week.theme})
- Level: ${level.label}
- Reply length: ${level.replySentences} short sentences, at most about ${level.maxWords} words per sentence.
- Grammar to use: ${level.tenses}.
- This week's grammar focus (use it naturally so the learner hears it): ${week.grammar.join("; ")}.
- English support: ${support}
- ${level.notes}

## How to reply
- Always end your reply with a question or prompt that makes the learner speak, unless the scenario has naturally finished (then say goodbye in character and suggest starting a new scenario).
- Use standard, contemporary Italian. Use the register that fits the role (a waiter or clerk uses Lei; a peer at a meetup uses tu).
- Keep the conversation flowing. Do not ask more than one question at a time.

## Maximize the learner's speaking time (this is the whole point)
- The learner should do most of the talking. Keep your own turns short.
- Ask open questions that need a full-sentence answer, not yes/no questions. Follow up on what they actually said.
- If the learner answers with a single word, nudge them to say a full sentence.
${
  focus && (focus.words.length || focus.mistakes.length)
    ? `
## Recycle what they're learning
Over the conversation, naturally create situations where the learner needs to use these. Don't list them and don't quiz; just steer the conversation.
${focus.words.length ? `- Words and phrases they're learning: ${focus.words.join("; ")}` : ""}
${focus.mistakes.length ? `- Correct forms of their recent mistakes (set "recurring": true if they make one of these mistakes again): ${focus.mistakes.join("; ")}` : ""}
`
    : ""
}
## Corrections
- Look only at the learner's latest message. Report at most the 2 most useful corrections, focusing on grammar, word choice, gender/articles, prepositions and word order.
- The learner's message usually comes from speech recognition. Ignore capitalization, punctuation and missing accents, and do not correct something that is plausibly a transcription error.
- Don't correct things that are already natural. A message with small style differences that a native speaker would accept needs no correction.
- If the learner wrote English (or mixed English), give the Italian version as a "vocabulary" correction.
- "original" is the learner's wording, "corrected" is the natural Italian, "meaning_en" is the English meaning of the corrected phrase, "explanation_en" is one short sentence.`;
}

const OPENING_DIRECTIVE = (scenarioKey: string) => {
  const s = curriculum().scenarios[scenarioKey] ?? curriculum().scenarios.free;
  return `[The learner just arrived. Start the scenario in character: ${s.opening} There is no learner message to correct yet.]`;
};

type ApiMessage = Anthropic.Beta.BetaMessageParam;

function loadApi(id: string): ApiMessage[] {
  const row = db.prepare("SELECT messages FROM chat_api WHERE id = ?").get(id) as { messages: string } | undefined;
  return row ? JSON.parse(row.messages) : [];
}
function saveApi(id: string, messages: ApiMessage[]) {
  db.prepare(
    "INSERT INTO chat_api (id, messages) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET messages = excluded.messages",
  ).run(id, JSON.stringify(messages));
}

/** Content blocks from a parsed response, cleaned so they can be sent back unchanged in the next request. */
function replayableContent(content: any[]): any[] {
  return content.map((b) => {
    const copy = { ...b };
    delete copy.parsed_output;
    return copy;
  });
}

class AiError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

async function callClaude<T extends z.ZodType>(opts: {
  system: string;
  messages: ApiMessage[];
  schema: T;
  effort: typeof config.claudeEffort;
}): Promise<{ parsed: z.infer<T>; content: any[] }> {
  const params: any = {
    model: config.claudeModel,
    max_tokens: 16000,
    system: opts.system,
    messages: opts.messages,
    output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
  };
  if (config.claudeFallbacks !== "off") {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = config.claudeFallbacks;
  }
  try {
    const res = await anthropic().beta.messages.parse(params);
    if (res.stop_reason === "refusal") throw new AiError("The model declined to answer. Try rephrasing.");
    if (res.stop_reason === "max_tokens") throw new AiError("The reply was cut off. Try again.");
    const parsed = (res as any).parsed_output as z.infer<T> | null;
    if (!parsed) throw new AiError("Could not parse the model's reply. Try again.");
    return { parsed, content: replayableContent(res.content as any[]) };
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new AiError("Claude API key is invalid (check ANTHROPIC_API_KEY).", 500);
    if (e instanceof Anthropic.NotFoundError) throw new AiError(`Model not found: ${config.claudeModel} (check CLAUDE_MODEL).`, 500);
    if (e instanceof Anthropic.RateLimitError) throw new AiError("Rate limited by the Claude API. Wait a moment and try again.", 429);
    if (e instanceof Anthropic.APIConnectionError) throw new AiError("Can't reach the Claude API. Is the server online?");
    if (e instanceof Anthropic.APIError) throw new AiError(`Claude API error ${e.status}: ${e.message}`);
    // Anything else from the SDK here is a malformed or schema-violating response.
    throw new AiError("Got an unexpected reply from Claude. Try again.");
  }
}

// ---------- Mock mode (MOCK_AI=1) for development without an API key ----------
function mockTurn(userText: string | null, n: number): Turn {
  const lines = [
    ["Ciao! Benvenuto. Come ti chiami?", "Hi! Welcome. What's your name?"],
    ["Piacere! Di dove sei?", "Nice to meet you! Where are you from?"],
    ["Che bello! E che lavoro fai?", "How nice! And what do you do for work?"],
    ["Interessante! Ti piace il tuo lavoro?", "Interesting! Do you like your job?"],
  ];
  const [it, en] = lines[n % lines.length];
  const corrections =
    userText && /\bio sono (\d+) anni\b/i.test(userText)
      ? [{ original: userText, corrected: userText.replace(/io sono (\d+) anni/i, "ho $1 anni"), meaning_en: "I am N years old", explanation_en: "Italian uses avere (to have) for age.", type: "verb_conjugation" as const, recurring: false }]
      : userText && /\bil acqua\b/i.test(userText)
        ? [{ original: "il acqua", corrected: "l'acqua", meaning_en: "the water", explanation_en: "Use l' before a vowel.", type: "gender_articles" as const, recurring: false }]
        : [];
  return { corrections, reply_it: it, reply_en: en, help_en: n === 0 ? "come ti chiami = what's your name" : "" };
}

// ---------- Mistake persistence ----------
function saveMistakes(convId: string, corrections: Turn["corrections"], source = "conversation") {
  const now = Date.now();
  const saved: any[] = [];
  corrections.forEach((c, i) => {
    const id = `conv-${convId}-${now}-${i}`;
    const data = {
      source,
      conversationId: convId,
      type: c.type,
      original: c.original,
      corrected: c.corrected,
      meaningEn: c.meaning_en,
      explanation: c.explanation_en,
      recurring: c.recurring,
      date: localDate(),
      ts: now,
    };
    putDoc({ collection: "mistakes", id, data, updated_at: now });
    saved.push({ id, ...data });
  });
  return saved;
}

export function speakingSeconds(conv: Pick<Conversation, "startedAt" | "messages">, end: number) {
  const ts = [conv.startedAt, ...conv.messages.map((m) => m.ts), end].sort((a, b) => a - b);
  let total = 0;
  for (let i = 1; i < ts.length; i++) total += Math.min(ts[i] - ts[i - 1], 3 * 60_000);
  return Math.round(total / 1000);
}

function sendError(reply: FastifyReply, e: unknown) {
  if (e instanceof AiError) return reply.code(e.status).send({ error: e.message });
  reply.log.error(e);
  return reply.code(500).send({ error: (e as Error).message ?? "Unknown error" });
}

const MAX_MESSAGE = 2000;

/** One request at a time per conversation: overlapping read-modify-write would drop turns. */
const inFlight = new Set<string>();
function lock(id: string) {
  if (inFlight.has(id)) return false;
  inFlight.add(id);
  return true;
}
function unlock(id: string) {
  inFlight.delete(id);
}

export function registerChat(app: FastifyInstance) {
  app.post("/api/chat/start", async (req, reply) => {
    if (!aiEnabled()) return reply.code(503).send({ error: "AI is not configured. Set ANTHROPIC_API_KEY in .env." });
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as { scenario?: unknown; week?: unknown; focus?: unknown };
    const scenario = typeof body.scenario === "string" ? body.scenario : "free";
    const week = Number(body.week ?? 1);
    const rawFocus = body.focus;
    const focus = cleanFocus(rawFocus);
    const cur = curriculum();
    const scenarioKey = Object.hasOwn(cur.scenarios, scenario) ? scenario : "free";
    const { week: w } = weekInfo(Number(week));
    const id = crypto.randomUUID();
    const now = Date.now();
    try {
      const apiMessages: ApiMessage[] = [{ role: "user", content: OPENING_DIRECTIVE(scenarioKey) }];
      let turn: Turn;
      if (config.mockAi) {
        turn = mockTurn(null, 0);
        apiMessages.push({ role: "assistant", content: JSON.stringify(turn) });
      } else {
        const r = await callClaude({ system: systemPrompt(scenarioKey, w.week, focus), messages: apiMessages, schema: TurnSchema, effort: config.claudeEffort });
        turn = r.parsed;
        apiMessages.push({ role: "assistant", content: r.content });
      }
      const conv: Conversation = {
        scenario: scenarioKey,
        scenarioLabel: cur.scenarios[scenarioKey].label,
        week: w.week,
        level: w.level,
        startedAt: now,
        date: localDate(),
        focus,
        messages: [{ role: "assistant", text: turn.reply_it, en: turn.reply_en, help: turn.help_en, ts: Date.now() }],
      };
      saveApi(id, apiMessages);
      putDoc({ collection: "conversations", id, data: conv, updated_at: Date.now() });
      return { id, conversation: conv };
    } catch (e) {
      return sendError(reply, e);
    }
  });

  app.post("/api/chat/:id/message", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { text } = (req.body && typeof req.body === "object" ? req.body : {}) as { text?: unknown };
    const doc = getDoc<Conversation>("conversations", id);
    if (!doc) return reply.code(404).send({ error: "Conversation not found" });
    if (typeof text !== "string" || !text.trim()) return reply.code(400).send({ error: "Empty message" });
    if (text.length > MAX_MESSAGE) return reply.code(400).send({ error: `Message too long (max ${MAX_MESSAGE} characters)` });
    if (doc.data.endedAt) return reply.code(409).send({ error: "This conversation has ended. Start a new one." });
    if (!lock(id)) return reply.code(409).send({ error: "Still working on your last message." });
    const conv = doc.data;
    const apiMessages = loadApi(id);
    const userMsg: DisplayMessage = { role: "user", text: text.trim(), ts: Date.now() };
    try {
      apiMessages.push({ role: "user", content: userMsg.text });
      let turn: Turn;
      if (config.mockAi) {
        turn = mockTurn(userMsg.text, conv.messages.length);
        apiMessages.push({ role: "assistant", content: JSON.stringify(turn) });
      } else {
        const r = await callClaude({ system: systemPrompt(conv.scenario, conv.week, conv.focus), messages: apiMessages, schema: TurnSchema, effort: config.claudeEffort });
        turn = r.parsed;
        apiMessages.push({ role: "assistant", content: r.content });
      }
      userMsg.corrections = turn.corrections;
      const mistakes = saveMistakes(id, turn.corrections);
      const aiMsg: DisplayMessage = { role: "assistant", text: turn.reply_it, en: turn.reply_en, help: turn.help_en, ts: Date.now() };
      conv.messages.push(userMsg, aiMsg);
      saveApi(id, apiMessages);
      putDoc({ collection: "conversations", id, data: conv, updated_at: Date.now() });
      return { user: userMsg, assistant: aiMsg, mistakes };
    } catch (e) {
      return sendError(reply, e);
    } finally {
      unlock(id);
    }
  });

  app.post("/api/chat/:id/help", async (req, reply) => {
    const { id } = req.params as { id: string };
    const raw = (req.body && typeof req.body === "object" ? (req.body as { draft?: unknown }).draft : "") ?? "";
    const draft = typeof raw === "string" ? raw.slice(0, MAX_MESSAGE) : "";
    const doc = getDoc<Conversation>("conversations", id);
    if (!doc) return reply.code(404).send({ error: "Conversation not found" });
    const conv = doc.data;
    if (config.mockAi) {
      return { hint_en: "Say your name with 'mi chiamo…'.", say_it: "Mi chiamo Anthony.", say_it_en: "My name is Anthony.", last_reply_en: conv.messages.at(-1)?.en ?? "" };
    }
    const transcript = conv.messages
      .slice(-10)
      .map((m) => `${m.role === "user" ? "Learner" : "Partner"}: ${m.text}`)
      .join("\n");
    const { level } = weekInfo(conv.week);
    try {
      const r = await callClaude({
        system:
          "You help an American beginner-to-intermediate Italian learner who is stuck in a spoken role-play. Be brief and practical. Suggest Italian the learner can actually say at their level.",
        messages: [
          {
            role: "user",
            content: `Learner level: ${level.label} (${level.tenses}).\nRecent conversation:\n${transcript}\n\n${
              draft.trim() ? `The learner is trying to say (may be English or broken Italian): "${draft.trim()}"` : "The learner doesn't know what to say next."
            }\n\nGive a hint, one Italian sentence they could say, and translate the partner's last message.`,
          },
        ],
        schema: HelpSchema,
        effort: config.claudeEffort,
      });
      return r.parsed;
    } catch (e) {
      return sendError(reply, e);
    }
  });

  app.post("/api/chat/:id/end", async (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = getDoc<Conversation>("conversations", id);
    if (!doc) return reply.code(404).send({ error: "Conversation not found" });
    // Idempotent: a retried "end" returns the existing summary; if summarizing failed before, try again.
    if (doc.data.endedAt && doc.data.summary) return { conversation: doc.data };
    if (!lock(id)) return reply.code(409).send({ error: "Still working on your last message." });
    const conv = doc.data;
    const end = Date.now();
    conv.endedAt = end;
    conv.speakingSeconds = speakingSeconds(conv, end);
    const words = (role: string) => conv.messages.filter((m) => m.role === role).reduce((n, m) => n + m.text.split(/\s+/).filter(Boolean).length, 0);
    const mine = words("user");
    conv.talkShare = mine ? Math.round((mine / (mine + words("assistant"))) * 100) : 0;
    const corrections = conv.messages.flatMap((m) => m.corrections ?? []);
    const userTurns = conv.messages.filter((m) => m.role === "user").length;
    try {
      if (userTurns === 0) {
        conv.summary = { top_mistakes: [], went_well: "", focus_next: "" };
      } else if (config.mockAi) {
        conv.summary = {
          top_mistakes: corrections.slice(0, 5).map((c) => ({ original: c.original, corrected: c.corrected, explanation_en: c.explanation_en, type: c.type })),
          went_well: "You kept the conversation going.",
          focus_next: "Practice using avere for age.",
        };
      } else {
        const transcript = conv.messages.map((m) => `${m.role === "user" ? "Learner" : "Partner"}: ${m.text}`).join("\n");
        const r = await callClaude({
          system: "You are an expert Italian teacher reviewing a learner's spoken role-play (transcribed by speech recognition — ignore punctuation, capitalization and missing accents). Be encouraging, specific and brief. Write explanations in English.",
          messages: [
            {
              role: "user",
              content: `Scenario: ${conv.scenarioLabel}. Curriculum week ${conv.week}.\n\nTranscript:\n${transcript}\n\nInline corrections already given:\n${
                corrections.map((c) => `- "${c.original}" → "${c.corrected}" (${c.type})`).join("\n") || "(none)"
              }\n\nSummarize the learner's top 3 to 5 mistakes (fewer if there weren't that many), what went well, and one focus for next time.`,
            },
          ],
          schema: SummarySchema,
          effort: config.claudeSummaryEffort,
        });
        conv.summary = r.parsed;
      }
      putDoc({ collection: "conversations", id, data: conv, updated_at: Date.now() });
      return { conversation: conv };
    } catch (e) {
      // Still save the end time even if the summary failed.
      putDoc({ collection: "conversations", id, data: conv, updated_at: Date.now() });
      return sendError(reply, e);
    } finally {
      unlock(id);
    }
  });
}
