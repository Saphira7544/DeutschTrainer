# DeutschTrainer

A phone-first study app for getting from "I know the rules" to "I can just say it": spaced-repetition vocab, quick B1.2 grammar drills, and speaking practice with friendly, meaning-first feedback.

**What's in version 1**

- **Words**: the Goethe A1–B1 word list (2,859 words with native audio, examples, plurals, conjugations), one tap to add. You can also import other Anki text exports or add words by hand. Reviews use FSRS, the scheduler modern Anki uses. You type the German from the English, because producing words is what makes them stick. Missing or wrong articles count as "almost".
- **Grammar**: 42 topics from A1.2 to B1.2 with **806 built-in exercises** (multiple choice, fill-in-the-gap, rewrite the sentence). Practice works offline and costs nothing. Unseen exercises come first, then the ones you got wrong. Mixed practice serves more of your weak topics, filtered by the levels you pick. The AI is used only when you ask: *Is mine right too?* for an answer that differs from the key, or *Make 8 new ones* once a topic's bank is used up.
- **Speak**: answer a question out loud (or type). The AI first restates what you meant, shows the minimal correction as a diff, gives a more natural local version, and picks **at most 3** fixes that matter. Then *Say it again*. Fixes go to the **Notebook** and steer your grammar exercises, and new words can become cards with one tap.
- **Streak** with a daily XP goal (1 per card, 2 per exercise, 5 per spoken answer).
- Installable on Android as an app (PWA). Words and grammar reviews work offline.

All your progress lives **on the phone** (IndexedDB). The server only holds the OpenAI key and makes the AI calls. Use *More → Download backup* now and then.

## Setup

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
copy .env.example .env   # then fill in OPENAI_API_KEY and APP_ACCESS_TOKEN
```

Build the word list from your Goethe Anki deck. The output is git-ignored because it's third-party content (word list, texts, recordings):

```powershell
.\.venv\Scripts\python.exe -I tools\import_apkg.py "C:\path\to\Goethe_A1-B1_Anki_Deck.apkg"
```

It writes `static/data/goethe_deck.json` and `static/audio/goethe/` (about 30 MB). It also cleans up the deck: adds missing articles (`tools/goethe_article_fixes.json`), tidies plural notes, and recovers words the deck lost.

Create the access token with `.\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(24))"`, then enter the same value in the app under **More → Settings**.

## Run

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8010
```

Open http://localhost:8010. Chrome DevTools' device toolbar (Ctrl+Shift+M) shows it at phone size.

### On your phone, before it's hosted

The microphone and "install app" only work over HTTPS or on `localhost`. Two ways to use the PC server from your Android phone:

1. **USB (most reliable)**: turn on USB debugging on the phone, connect it, run `adb reverse tcp:8010 tcp:8010`, then open `http://localhost:8010` in Chrome on the phone.
2. **Same Wi-Fi**: start the server with `--host 0.0.0.0` and allow it through the Windows firewall. On the phone, open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add `http://<your-PC-IP>:8010`, relaunch Chrome, and open that address.

Then use Chrome's menu → **Add to Home screen / Install app**.

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest      # API (AI calls are faked: no key or network needed)
node --test "tests/js/*.test.mjs"         # answer checking, Anki parsing, streaks, diff
```

## Where things are

```text
app/
  main.py          FastAPI app: /api routes + serves the PWA from static/
  api.py           endpoints: transcribe, speaking feedback, new prompt, grammar exercises, answer check
  prompts.py       all AI instructions and JSON schemas (tune the teaching style here)
  llm.py           OpenAI calls (structured JSON + transcription)
  config.py        settings from .env
static/
  index.html, sw.js, manifest.webmanifest, css/, icons/
  data/grammar_topics.json     the 42 grammar topics and their levels
  data/grammar/<level>.json    the exercise bank. Compact format: t = type (c choice / g gap / r rewrite),
                               s = sentence (___ marks the gap), o = options, a = answer(s), h = hint,
                               i = instruction, e = explanation. tests/test_grammar_bank.py validates it.
  data/speaking_prompts.json   built-in speaking questions
  data/goethe_deck.json        word list built by tools/import_apkg.py (not in git)
  audio/goethe/                native recordings for the word list (not in git)
  js/app.js        router + bottom tabs
  js/views/        one file per screen
  js/srs.js        vocab cards + FSRS scheduling (js/vendor/ts-fsrs.mjs, MIT)
  js/lib/          pure logic: answer checking, Anki import, streaks (unit-tested)
tools/
  import_apkg.py   converts the Goethe Anki deck into the app's word list + audio
tests/
```

## Costs

Defaults are `gpt-5.4-mini` for feedback and `gpt-4o-mini-transcribe` for speech. Both can be changed in `.env`. Words and grammar make no AI calls unless you tap an AI button, so speaking is the only regular cost. The API rejects recordings over about 2 minutes and very long texts.

## Ideas for next versions

- Hosting so it works anywhere (Railway, Render or Vercel)
- "Fast switch" drills: timed EN→DE sentence prompts to train answering without translating in your head
- Shadowing: listen to a sentence and repeat it
- Free conversation mode
- Turn notebook fixes into review cards
- Lesson import: photograph a tutor worksheet → cards and exercises
- Swiss German listening help
