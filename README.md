# Parla: personal Italian speaking trainer

A self-hosted PWA that runs a daily Italian study session and makes you speak out loud every day. It's built for one person, sits on a homelab behind Tailscale, and works offline on an iPhone home screen.

**What it does**

- **Today:** the day's checklist, built from your curriculum week. A Full day is about 2 hours; a **Short day** is 30 minutes and still keeps your streak. Shows a countdown to your target date, your streak, and total hours. Tapping a block starts a timer, and **Finish** logs the time.
- **Flashcards:** the FSRS scheduler with a seed deck of about 1,340 notes (roughly 940 words and 400 phrases) in 18 topics. Every note has Italian↔English cards, an example sentence, and it-IT text-to-speech. English→Italian cards use **speak the answer**: you say it, the app transcribes and grades it, and you can override the grade.
- **Talk:** a voice conversation with Claude in 10 role-play scenarios. Difficulty follows your curriculum week. Corrections appear inline under your messages. There's a **Help** button, and an end-of-session summary of your top 3 to 5 mistakes. Each correction is one tap away from becoming a flashcard.
- **Built for learning speed, not fun:**
  - Cards are English→Italian only by default (production first). That halves the review load, and production practice also builds recognition. Italian→English is optional.
  - The most-forgotten cards come first, so stopping early still covers what matters most.
  - Two buttons (Forgot / Knew it). The app moves on automatically when you say the answer right.
  - Every conversation correction becomes a flashcard automatically.
  - The AI partner keeps its own turns short so you do most of the talking. It deliberately steers toward your weak words and recent mistakes, and flags a mistake you've made before.
  - Progress shows efficiency numbers (production words learned, words per study hour, 7-day recall, seconds per card, your share of the talking) with advice on what to change.
  - Confetti and sounds are off by default.
- **Weak-spot drills (formerly Quick drills):** 5-minute rounds aimed at the cards you keep forgetting and your mistakes, mostly production: build the sentence from word tiles, **say it out loud**, tap what you hear, and what does it mean. Instant feedback with sounds, and missed items come back at the end of the round. The time is logged automatically.
- **Your path:** a 9-week map from "ciao" to the goal (a 20 to 30 minute conversation), showing where you are and what each week covers.
- **What you can say:** a skill tracker for each real-world situation (introducing yourself, your job, restaurant, hotel, trains, directions, shopping, pharmacy, small talk, long conversations). You earn stars only by holding real conversations (6+ replies per session), not by tapping tiles. The stars also appear on the Talk tiles.
- **Shadowing:** hear a sentence, repeat it, then hear the model and your recording back to back. If server speech-to-text is set up, words it couldn't match are highlighted.
- **Mistakes journal:** collects corrections from conversations and failed English→Italian cards automatically, grouped by type, with one tap to make a card.
- **Tutor log:** iTalki/Preply sessions. Each counts toward your hours, and the new words you list become flashcards.
- **Progress:** streak, hours, hours per week against the 14-hour target, speaking minutes, cards learned, and mistake trends.
- **`/api/stats`:** a read-only JSON endpoint for your dashboard.

## Stack and why

| Part | Choice | Why |
|---|---|---|
| Frontend | React + Vite + `vite-plugin-pwa`, Dexie (IndexedDB) | An installable PWA. The app shell is precached and all data lives in IndexedDB, so the Today plan and flashcards work offline. |
| SRS | `ts-fsrs` running **in the browser** | Reviews have to work offline, so scheduling happens on the device and syncs later. |
| Backend | Node 22 + Fastify + TypeScript | One language end to end, so client and server share types and the FSRS library. That's why it isn't FastAPI. |
| DB | SQLite (`better-sqlite3`), one file in `./data` | Simple, fast, and backed up by copying one file. |
| AI | Claude API (`@anthropic-ai/sdk`) with structured outputs | Each turn returns `{reply_it, reply_en, corrections[], help_en}` as validated JSON. |
| STT | Web Speech API **or** MediaRecorder → server → any OpenAI-compatible Whisper endpoint (self-hosted faster-whisper via `speaches`, or OpenAI) | iOS Web Speech is unreliable in standalone PWAs, so there's a server fallback. |

**Sync:** the server stores every record in one `docs` table with a revision counter. The client pushes local changes and pulls anything newer than its last revision. If the same record changed in two places, the newer edit wins. Sync runs on app open, when you come back online, after edits, and every 60 seconds.

```
server/src/   index (routes, static), db (docs store), sync, seed (deck import), chat (Claude), stt, stats, auth
web/src/      App, db (Dexie), sync, srs (FSRS + queue), speech (TTS/STT), plan (curriculum), screens/*
seed/         deck/*.json (flashcards, edit freely), curriculum.json (weeks, plans, scenarios, AI levels)
```

## Local development

```bash
npm install
cp .env.example .env        # put ANTHROPIC_API_KEY in it, or set MOCK_AI=1 to try it without a key
npm run dev                 # server on :8080, Vite dev server on :5173 (proxies /api)
npm test                    # server tests
npm run typecheck
```

Open http://localhost:5173. The microphone needs HTTPS or localhost, so to test on your phone, use the deployed Tailscale URL.

## Checks and tests

```bash
npm run lint        # ESLint with type-aware rules (TypeScript + React hooks)
npm run typecheck   # tsc for server, web, and the e2e suite
npm test            # server (node:test) + web (Vitest) unit and integration tests
npm run e2e         # Playwright end-to-end tests against a real server with mock AI
npm run check       # all of the above
```

- **Server tests** (`server/src/__tests__`) run against a temporary SQLite database. They cover auth (including encoded-path bypass attempts and rate limiting), sync conflict rules and pagination, the seed importer's edge cases, stats, speech-to-text against a fake Whisper server, and the Claude call path against a fake Anthropic API (request shape, history replay, refusals, error mapping, concurrency).
- **Web tests** (`web/src/*.test.ts`) cover the scheduler and queue, answer checking, drills, the plan, dates, skills, focus words, the local database, offline sync against a scripted server, the API client, timers and logging, and the speech wrappers using fake browser APIs.
- **End-to-end tests** (`e2e/`) drive the built app on an iPhone-sized viewport: login, the Today flow, flashcards, drills, a conversation, two-device sync, offline edits, and settings.
- The e2e suite downloads its own Chromium (`npx playwright install chromium`). To use a preinstalled one, set `PW_CHROMIUM_PATH`.
- CI (`.github/workflows/ci.yml`) runs everything on each push.

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `APP_PASSWORD` | (none) | Single-user login. If it's unset, the app is open, which is OK on a trusted tailnet but not recommended. |
| `ANTHROPIC_API_KEY` | (none) | Required for the conversation partner. |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Any Claude model ID. `claude-sonnet-5-5` or `claude-haiku-5-5` are faster and cheaper. |
| `CLAUDE_EFFORT` | `low` | Thinking effort per conversation turn. Low keeps replies quick. |
| `CLAUDE_SUMMARY_EFFORT` | `medium` | Effort for end-of-session summaries. |
| `CLAUDE_FALLBACKS` | `default` | Server-side refusal fallback (beta `server-side-fallback-2026-07-01`): if the model declines a turn, the API retries it on a fallback model. Set to `off` to disable. |
| `TZ` | `UTC` | Your time zone, so "today" in `/api/stats` is correct. The app itself uses the phone's time zone. |
| `STT_URL` | (none) | OpenAI-compatible `/v1/audio/transcriptions` URL. Leave it empty to use browser speech recognition only. |
| `STT_MODEL` | `Systran/faster-whisper-small` | Use `whisper-1` for OpenAI. |
| `STT_API_KEY` | (none) | Only needed for hosted STT. |
| `STATS_TOKEN` | (none) | If set, `/api/stats` requires `Authorization: Bearer <token>` (or the app cookie). |
| `PORT`, `DATA_DIR`, `SEED_DIR`, `WEB_DIR` | `8080`, `./data`, `./seed`, `./web/dist` | You normally don't need to change these. |
| `MOCK_AI` | `0` | `1` = canned AI replies, for development. |

## Deploy on the homelab (Docker + Tailscale Serve)

```bash
git clone <this repo> parla && cd parla
cp .env.example .env && nano .env          # APP_PASSWORD, ANTHROPIC_API_KEY, TZ
docker compose up -d --build
curl -s localhost:8080/api/health          # {"ok":true}
```

The container listens on `127.0.0.1:8080` only. Expose it to your tailnet over HTTPS (iOS requires HTTPS for microphone access):

```bash
sudo tailscale serve --bg 8080
tailscale serve status                     # shows https://<machine>.<tailnet>.ts.net
```

If another app (like LockIn) already uses the root of that hostname, give Parla its own HTTPS port. Don't mount it under a path, because the PWA expects to live at `/`:

```bash
sudo tailscale serve --bg --https=8443 8080   # → https://<machine>.<tailnet>.ts.net:8443
```

You need HTTPS certificates enabled for your tailnet (Tailscale admin console → DNS → HTTPS Certificates).

**Updating:** `git pull && docker compose up -d --build`. Your data lives in `./data/parla.db`; back it up by copying that file (or use Settings → Export JSON).

### Optional: self-hosted Whisper (speech-to-text fallback)

```bash
docker compose --profile whisper up -d
# download the model once (speaches doesn't auto-download in recent versions):
docker compose exec whisper curl -s -X POST http://localhost:8000/v1/models/Systran/faster-whisper-small
```

Then set `STT_URL=http://whisper:8000/v1/audio/transcriptions` in `.env` and run `docker compose up -d`. `faster-whisper-small` runs fine on a CPU for short utterances (about 1 to 3 seconds). If it isn't accurate enough, try `Systran/faster-whisper-medium`. If the `speaches` image or its model-download command has changed, see its docs; any OpenAI-compatible transcription server works, including OpenAI itself (`STT_URL=https://api.openai.com/v1/audio/transcriptions`, `STT_MODEL=whisper-1`).

## Install on your iPhone

1. Open the Tailscale URL in **Safari** (with Tailscale connected) and sign in.
2. Tap Share → **Add to Home Screen**.
3. Open it from the home screen, then go to **More → Settings → Mic test** and run both tests (see below).
4. If you don't hear an Italian voice: iPhone Settings → Accessibility → Spoken Content → Voices → Italian, then download *Alice* (or an Enhanced voice). Choose it under Settings → Italian voice.

## Editing content

- **Flashcards:** `seed/deck/<topic>.json`. Each item is `{"it","en","ex","ex_en","kind","level","notes","flag"}`. Edit, then restart the container or tap **Settings → Reload seed files**. Your review history is kept, because scheduling state is stored separately from card content. Items with a `flag` show an "Unverified" note on the card. Use **Browse → Flagged only** to find them.
- Two review passes have already been done on the seed deck. Their notes and the remaining flags are in `seed/REVIEW-1.md` and `seed/REVIEW-2.md`. When the same word appears in two topic files, the importer keeps the first one and logs a warning.
- **Curriculum:** `seed/curriculum.json` holds the weeks (theme, grammar, topics, scenarios), the daily plans per phase, the AI difficulty levels, and the scenario role descriptions. The start and target dates can also be changed in Settings.

## Stats API

`GET /api/stats` returns, for example:

```json
{
  "date": "2026-12-02", "curriculumWeek": 2, "streakDays": 9, "totalHours": 17.5,
  "speakingMinutes": 260, "cardsLearned": 140, "thisWeekHours": 4.2, "weeklyTargetHours": 14,
  "daysUntilTarget": 55, "weeks": [{"week": 1, "hours": 13.1, "targetHours": 14}, "..."],
  "mistakes": {"total": 52, "byType": {"gender_articles": 18}},
  "today": {"mode": "full", "minutesLogged": 45, "blocksDone": 2, "blocksTotal": 6, "complete": false, "streakSafe": true}
}
```

A day counts toward the streak when at least 30 minutes are logged.

## What to test on your iPhone

### MVP
1. **Install:** Add to Home Screen. The app opens full screen to the Today page with the countdown, streak, and the week 1 plan.
2. **Today:** tap *Structured lesson* and log lesson 1. Switch to Short day and back. Undo a block by tapping it.
3. **Flashcards:** start the flashcard block. The timer bar appears. Study a few cards and check that you **hear Italian audio** (if it's silent, check the ringer switch and the Italian voice). Tap **Finish** in the timer bar to log the time.
4. **Offline:** turn on Airplane Mode, force-quit, and reopen. Today and Flashcards should still work. Review a few cards, go back online, and check that **More → Settings → Sync** shows 0 pending.
5. **Talk (text):** pick "Introducing myself" and type a reply with a deliberate mistake ("io sono 35 anni"). You should get a reply, hear it read aloud, and see an inline correction. Tap **+ Flashcard**, try **Help**, then **End** and read the summary.

### V2 (voice)
6. **Mic test** (Settings): run *Test browser STT* and *Test server STT* from the home-screen app (not a Safari tab). Note which one returns the sentence correctly, then set **Speech-to-text** to that one. *Auto* already prefers server Whisper when it's configured.
7. **Talk by voice:** tap 🎤, speak, tap ■, check the transcript, and send.
8. **Speak the answer:** on an English→Italian card (these appear from day 2, after the Italian→English side has been introduced), tap 🎤 and say the answer. The suggested grade is outlined, and you can override it.
9. **Shadowing:** Listen → 🎤 → ■. You should hear the model, then your recording, **through the speaker** (not quietly through the earpiece).
10. **Mistakes:** the journal lists today's corrections. Tap *+ Flashcard* and *Got it*.

### V3
11. **Tutor log:** add a session with two "italiano = English" lines. Check that the time appears on Today and Progress, and the words appear in Browse.
12. **Progress:** check the tiles and the hours-per-week chart (tap a bar).
13. **Stats API:** `curl https://<host>/api/stats` (add `-H "Authorization: Bearer $STATS_TOKEN"` if you set one).

## Known limitations

- On iOS, Web Speech recognition in a home-screen app may fail or stop early, and it's dictation, so it tends to "fix" your mistakes. That's why Whisper on the server is the recommended default once it's set up.
- Browser text-to-speech can't be recorded, so shadowing plays the TTS model and then your recording, rather than mixing them into one clip.
- Conversations need a connection. Everything else works offline and syncs later.
