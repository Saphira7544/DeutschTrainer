# DeutschTrainer

A phone-first study app for getting from "I know the rules" to "I can just say it": spaced-repetition vocab, grammar drills from A1.2 to B1.2, and speaking practice with friendly, meaning-first feedback.

It's a static web app (PWA) hosted on GitHub Pages. You install it on your Android home screen and it runs on the phone; there is no server.

## What it does

- **Words**: the Goethe A1–B1 word list (2,859 words with native audio, examples, plurals, conjugations). You import it from your Anki deck file (`.apkg`) right on the phone. You can also import other Anki text exports or add words by hand. Reviews use FSRS, the scheduler modern Anki uses. You type the German from the English, because producing words is what makes them stick. Missing or wrong articles count as "almost".
- **Grammar**: 42 topics from A1.2 to B1.2 with **806 built-in exercises** (multiple choice, fill-in-the-gap, rewrite the sentence). Works offline and costs nothing. Unseen exercises come first, then the ones you got wrong. Mixed practice serves more of your weak topics, filtered by the levels you pick.
- **📖 Rules**: every grammar topic has an explicit explanation, a comparison with English and with European Portuguese, and examples translated into both. After each answer, the correct sentence is shown in 🇬🇧 English and 🇵🇹 Portuguese.
- **Gender colours** like the Goethe deck: **der** blue, **die** red, **das** green.
- **Tap any word** in a grammar exercise to see its meaning from the Goethe list. Inflected forms are recognised (fährt → fahren, Kollegen → der Kollege, hätte → haben). One tap adds it to your words, and it comes **first in your next review**.
- **Speak**: answer a question out loud (or type). The AI restates what you meant, shows the minimal correction, gives a more natural local version, and picks **at most 3** fixes that matter. Fixes go to the **Notebook** and steer your grammar exercises.
- **Reminders** (More → Reminders): daily Google Calendar events with dramatic titles (exact times), plus guilt-trip notifications from the installed app, but only when you haven't reached today's goal.
- **Streak** with a daily XP goal (1 per card, 2 per exercise, 5 per spoken answer).

All your progress lives **on the phone** (IndexedDB). Use *More → Download backup* now and then.

## Using it on your phone

1. Open **https://saphira7544.github.io/DeutschTrainer/** in Chrome on Android.
2. Chrome menu ⋮ → **Install app** (or *Add to Home screen*).
3. **Words** → *Choose the .apkg file* → pick the Goethe deck. It takes a few seconds; the words and recordings are stored on the phone.
4. **More → Settings** → paste your **OpenAI API key** → Save. Saving tests the key.
5. **More → Reminders** → add the Google Calendar events and turn on notifications.

### The OpenAI key

The AI features (speaking feedback, transcription, *Is mine right too?*, AI exercises and word lookups) call OpenAI directly from your phone with **your own key**. The key is stored only in the app on your phone. It's never in the code, on GitHub, or in backup files.

Create it at platform.openai.com → API keys, ideally in a separate project with a **monthly budget limit**. Words and grammar make no AI calls unless you tap an AI button, so speaking is the only regular cost. The defaults are `gpt-5.4-mini` and `gpt-4o-mini-transcribe`; you can change the model in Settings → Advanced.

## Developing

No build step and no dependencies: the app is plain HTML, CSS and JavaScript modules in `static/`.

```powershell
python tools/serve.py
```

Open http://localhost:8010/DeutschTrainer/. The local server serves the app under `/DeutschTrainer/` exactly like GitHub Pages does, so a wrong absolute path breaks locally first. Chrome DevTools' device toolbar (Ctrl+Shift+M) shows it at phone size.

```powershell
node --test "tests/js/*.test.mjs"
```

The tests cover answer checking, the Anki/deck parsing, streaks, word lookup, reminders, the AI instructions, and the whole grammar bank (every exercise answerable, translated and with a rule).

## Publishing

Every push to `main` runs the tests and publishes `static/` to GitHub Pages (`.github/workflows/pages.yml`).

One-time setup on GitHub: the repo must be **public** (free accounts), and **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Where things are

```text
static/
  index.html, sw.js, manifest.webmanifest, css/, icons/
  data/grammar_topics.json     the 42 grammar topics and their levels
  data/grammar_rules.json      rule, EN/PT comparison and translated examples per topic
  data/grammar/<level>.json    the exercise bank. Compact format: t = type (c choice / g gap / r rewrite),
                               s = sentence (___ marks the gap), o = options, a = answer(s), h = hint,
                               i = instruction, e = explanation
  data/grammar/<level>.tr.json [English, Portuguese] translation of each exercise's answer, same order
  data/speaking_prompts.json   built-in speaking questions
  data/goethe_fixes.json       corrections applied when the Goethe deck is imported
  js/app.js          router + bottom tabs
  js/views/          one file per screen
  js/ai.js           OpenAI calls (with the key stored on the phone)
  js/deckimport.js   imports the Goethe .apkg on the phone (JSZip + sql.js), stores words and audio
  js/srs.js          vocab cards + FSRS scheduling
  js/wordsheet.js    tap-to-translate panel
  js/reminders.js    Google Calendar links + notification settings (the nagging itself runs in sw.js)
  js/lib/            pure logic, unit-tested: answer checking, deck parsing, AI instructions (prompts.js),
                     streaks, word lookup, reminder messages
  js/vendor/         ts-fsrs (MIT), JSZip (MIT), sql.js (MIT)
tools/serve.py       local server that mimics GitHub Pages
tests/js/            node tests
```

The Goethe deck is someone else's content, so it's never in this repo: you import your own copy on the phone.

## Ideas for next versions

- "Fast switch" drills: timed EN→DE sentence prompts to train answering without translating in your head
- Shadowing: listen to a sentence and repeat it
- Free conversation mode
- Turn notebook fixes into review cards
- Lesson import: photograph a tutor worksheet → cards and exercises
- Swiss German listening help
