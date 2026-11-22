# Deploying Parla on your homelab

This guide sets Parla up on an Ubuntu box with Docker and exposes it to your phone over Tailscale with HTTPS. Follow it top to bottom; every command is meant to be copied and run as-is. It takes about 20 minutes, most of it waiting for the first build.

**What you end up with**

- Parla running in Docker, restarting automatically on reboot.
- Reachable only on your tailnet at `https://<your-machine>.<your-tailnet>.ts.net` (HTTPS is required for the microphone on iPhone).
- Data in one SQLite file (`./data/parla.db`) with a nightly backup.
- Optional: self-hosted Whisper for speech-to-text.

> Already running LockIn the same way? You can skip steps 1–2 and go straight to step 3. Check step 6 for running two apps behind Tailscale Serve.

---

## 0. What you need

| Thing | Where to get it |
|---|---|
| Ubuntu server (22.04 or 24.04) with `sudo` | Your homelab box |
| ~4 GB free disk (≈6 GB more if you add Whisper) | |
| A Tailscale account, with the Tailscale app on your iPhone | https://tailscale.com |
| A Claude API key | https://console.anthropic.com → **API Keys** (add billing credits; setting a monthly spend limit there is a good idea) |
| Access to this repo from the server (SSH key or HTTPS token for GitHub) | |

---

## 1. Install Docker

Skip if `docker compose version` already prints a version.

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker
```

Log out and back in (so the `docker` group applies), then check:

```bash
docker run --rm hello-world
docker compose version
```

---

## 2. Install Tailscale and turn on HTTPS

Skip the install if `tailscale status` already works on this box.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Then, in the Tailscale admin console (https://login.tailscale.com/admin/dns):

1. Make sure **MagicDNS** is enabled.
2. Under **HTTPS Certificates**, click **Enable HTTPS**.

Check your version (the commands below need 1.52 or newer; `sudo apt-get update && sudo apt-get install tailscale` upgrades it):

```bash
tailscale version
```

---

## 3. Get the code

```bash
cd ~
git clone https://github.com/anthonydagostino/LearnItalian.git parla
cd parla
```

> **Branch:** until the work is merged into `main`, check out the branch it lives on:
> ```bash
> git checkout claude/parla-italian-trainer-s6halt
> ```

---

## 4. Configure `.env`

```bash
cp .env.example .env
```

Generate the secrets:

```bash
echo "APP_PASSWORD=$(openssl rand -base64 18)"
echo "SESSION_SECRET=$(openssl rand -hex 32)"
echo "STATS_TOKEN=$(openssl rand -hex 24)"
```

Open the file (`nano .env`) and set at least these:

| Variable | Set it to |
|---|---|
| `APP_PASSWORD` | The generated password. **Save it in your password manager**: you type it once per device. |
| `SESSION_SECRET` | Add this line with the generated value. It signs your login cookie; changing it signs out every device. |
| `ANTHROPIC_API_KEY` | Your Claude API key (`sk-ant-...`). |
| `TZ` | Your time zone, e.g. `America/New_York` (list them with `timedatectl list-timezones`). Used for "today" in `/api/stats`. |
| `STATS_TOKEN` | Optional. Set it if your dashboard will read `/api/stats`; otherwise that endpoint is open to your tailnet. |

Leave `MOCK_AI=0`. Leave `STT_URL` empty for now (step 8 adds speech-to-text on the server).

Lock the file down, since it holds your API key:

```bash
chmod 600 .env
```

> **Port:** Parla listens on `127.0.0.1:8080` on the host. If something else (LockIn?) already uses 8080, edit the `ports:` line in `docker-compose.yml`, e.g. `"127.0.0.1:8081:8080"`, and use `8081` in step 6.

---

## 5. Build and start

```bash
docker compose up -d --build
```

The first build takes a few minutes. Then check it:

```bash
docker compose ps                     # STATUS should become "healthy" within ~1 minute
curl -s localhost:8080/api/health     # → {"ok":true}
docker compose logs --tail=20 parla   # should show "Seed: 18 deck files, ... cards"
```

The log lists some `seed warning: duplicate ...` lines. Those are expected (the same word appearing in two topic files is imported once).

If you see `APP_PASSWORD is weak or still the example value`, go back to step 4.

---

## 6. Expose it over HTTPS with Tailscale Serve

```bash
sudo tailscale serve --bg 8080
tailscale serve status
```

`status` prints your URL, something like `https://homelab.tail1234.ts.net`. The `--bg` setting is saved, so it survives reboots.

**Running LockIn (or anything else) on the root already?** Give Parla its own HTTPS port instead. Don't mount it under a path like `/parla`: the app expects to live at `/`.

```bash
sudo tailscale serve --bg --https=8443 8080
# → https://homelab.tail1234.ts.net:8443
```

To undo later: `sudo tailscale serve --https=8443 off` (or `sudo tailscale serve reset` to clear everything).

Check from the server itself:

```bash
curl -s https://$(tailscale status --json | python3 -c "import json,sys; print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))")/api/health
```

The first HTTPS request can take a few seconds while Tailscale issues the certificate.

---

## 7. Set it up on your iPhone

1. Open the **Tailscale** app and make sure it's connected.
2. In **Safari** (not Chrome), open your URL from step 6 and sign in with `APP_PASSWORD`.
3. Tap **Share → Add to Home Screen**, then open Parla from the home screen.
4. Go through the welcome tour: tap **Play an Italian voice** and **Allow the microphone**.
   - No Italian voice? iPhone **Settings → Accessibility → Spoken Content → Voices → Italian**, download one (e.g. *Alice*, or an Enhanced voice), then pick it in Parla under **More → Settings → Italian voice**.
5. **More → Settings → Mic test**: run **Test browser STT**. If it returns the sentence correctly, you're done. If it fails or is unreliable in the home-screen app (common on iOS), set up step 8.

Then run through "What to test on your iPhone" in the README.

---

## 8. Optional: speech-to-text on the server (Whisper)

iOS speech recognition is often unreliable inside home-screen apps, and dictation tends to "fix" your mistakes. Server-side Whisper avoids both. Pick **one** option.

### Option A: self-hosted (free, private)

Start the Whisper container (it's in `docker-compose.yml` under a profile):

```bash
docker compose --profile whisper up -d
docker compose logs --tail=20 whisper
```

Download the model once (≈500 MB; this asks Whisper to fetch it, from inside the Parla container):

```bash
docker compose exec parla node -e "fetch('http://whisper:8000/v1/models/Systran/faster-whisper-small',{method:'POST'}).then(async r=>console.log(r.status, await r.text()))"
```

A `200` or `201` (or a message that it already exists) means it worked. Then add to `.env`:

```
STT_URL=http://whisper:8000/v1/audio/transcriptions
STT_MODEL=Systran/faster-whisper-small
```

Apply it and confirm Parla sees it:

```bash
docker compose up -d
curl -s localhost:8080/api/config    # "sttServer": true
```

> If the model download call fails, check the [speaches docs](https://github.com/speaches-ai/speaches) for the current download command: the image and its API change from time to time. Any server with an OpenAI-compatible `/v1/audio/transcriptions` endpoint works.
> If transcription is too inaccurate, try `Systran/faster-whisper-medium` (slower, ~1.5 GB).

### Option B: hosted (OpenAI Whisper)

Add to `.env`, then `docker compose up -d`:

```
STT_URL=https://api.openai.com/v1/audio/transcriptions
STT_MODEL=whisper-1
STT_API_KEY=sk-...
```

### Check it on the phone

**Settings → Mic test → Test server STT** should return the sentence. Leave **Speech-to-text** on **Auto**: it uses the server whenever it's configured.

---

## 9. Backups

The database is one file, but it's in WAL mode, so don't just copy `parla.db` while the app is running. Use this, which takes a consistent snapshot:

```bash
docker compose exec parla sh -c 'mkdir -p /data/backups && node -e "require(\"better-sqlite3\")(\"/data/parla.db\",{readonly:true}).backup(\"/data/backups/parla-$(date +%F).db\").then(()=>console.log(\"backup ok\"))"'
ls -lh data/backups/
```

**Nightly, keeping 14 days.** Run `crontab -e` and add (adjust the path if you cloned somewhere else):

```cron
15 3 * * * cd $HOME/parla && docker compose exec -T parla sh -c 'mkdir -p /data/backups && node -e "require(\"better-sqlite3\")(\"/data/parla.db\",{readonly:true}).backup(\"/data/backups/parla-$(date +\%F).db\")"' && find $HOME/parla/data/backups -name 'parla-*.db' -mtime +14 -delete
```

Copy `data/backups/` off the box now and then (NAS, cloud drive). You can also export a JSON copy from the app: **More → Settings → Export JSON**.

**Restore:**

```bash
docker compose stop parla
cp data/backups/parla-YYYY-MM-DD.db data/parla.db
rm -f data/parla.db-wal data/parla.db-shm
docker compose start parla
```

Then on each phone or browser: **Settings → Full re-sync**.

---

## 10. Updating

```bash
cd ~/parla
git pull
docker compose up -d --build
docker compose logs --tail=20 parla
```

Your data (`./data`) and your edits to `seed/` are kept. If you've edited the seed files and `git pull` reports a conflict, commit your edits first (`git commit -am "my deck edits"`) and pull again.

**Editing the deck or curriculum:** change files in `seed/`, then either `docker compose restart parla` or tap **Settings → Reload seed files**. A broken file is reported in the logs and skipped; it won't delete cards.

---

## 11. Your dashboard (stats API)

```bash
curl -s -H "Authorization: Bearer $STATS_TOKEN" https://<your-url>/api/stats
```

It returns streak, hours, speaking minutes, cards learned, and today's completion. Without `STATS_TOKEN` set, it's readable by anything on your tailnet.

---

## 12. Troubleshooting

| Symptom | Fix |
|---|---|
| Page won't load on the phone | Is the Tailscale app connected? Does `tailscale serve status` list the URL? Does `curl localhost:8080/api/health` work on the server? |
| Microphone does nothing / never asks for permission | You must use the `https://...ts.net` URL (not an IP or `http://`). iPhone **Settings → Safari → Microphone** → Ask/Allow. Re-add the home-screen icon after changing the URL. |
| "The AI partner isn't set up" | `ANTHROPIC_API_KEY` is missing in `.env`. Fix it, then `docker compose up -d`. |
| Conversation shows "Claude API key is invalid" / "Rate limited" / "Model not found" | Check the key and billing credits in the Anthropic console, and `CLAUDE_MODEL` in `.env`. Details: `docker compose logs --tail=50 parla`. |
| Replies feel slow | Set `CLAUDE_MODEL=claude-sonnet-5-5` in `.env` (faster and cheaper), then `docker compose up -d`. |
| "Transcription service unreachable" | `docker compose --profile whisper ps`. Is `whisper` running? Did you download the model (step 8)? |
| Login keeps failing | After 10 wrong attempts, logins are blocked for 15 minutes. `APP_PASSWORD` is case-sensitive; restart after editing `.env`. |
| Signed out on every device | `SESSION_SECRET` or `APP_PASSWORD` changed. Sign in again. |
| Stats say the wrong "today" | Set `TZ` in `.env`, then `docker compose up -d`. |
| `port is already allocated` | Change the host port in `docker-compose.yml` (step 4 note) and in your `tailscale serve` command. |
| Phone shows old data | **Settings → Sync now**, or **Full re-sync**. The banner says when you're offline; changes sync when you're back. |
| Container keeps restarting | `docker compose logs parla`. A broken `seed/curriculum.json` falls back to the last good copy, but on the very first run it must be valid JSON. |

---

## 13. Uninstall

```bash
cd ~/parla
docker compose --profile whisper down
sudo tailscale serve reset        # or: sudo tailscale serve --https=8443 off
# Your data is still in ./data. Delete the folder only if you're sure:
# cd ~ && rm -rf parla
```
