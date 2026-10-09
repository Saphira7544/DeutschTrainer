import { post, postAudio } from "../api.js";
import { db } from "../db.js";
import { wordDiff } from "../lib/text.js";
import { addCards } from "../srs.js";
import { addActivity, getSettings, setSetting } from "../store.js";
import { h, loadJSON, mount, shuffle, speakButton, spinner, toast } from "../ui.js";

const MAX_SECONDS = 120;

const VERDICTS = {
  great: ["🟢", "Sehr gut!"],
  good: ["🟡", "Gut verstanden!"],
  keep_going: ["🟠", "Let's work on it together"],
};

export async function render(root) {
  const [{ prompts }, { topics }, settings] = await Promise.all([
    loadJSON("/data/speaking_prompts.json"),
    loadJSON("/data/grammar_topics.json"),
    getSettings(),
  ]);
  const topicTitle = Object.fromEntries(topics.map((t) => [t.id, t.title]));

  let current = await nextStaticPrompt(prompts);
  let recorder = null;
  let stream = null;
  let timer = null;
  let showEnglish = false;

  const promptBox = h("div.card.prompt-card");
  const answerBox = h("div");
  const feedbackBox = h("div");
  mount(root, h("h1", "Speak"), promptBox, answerBox, feedbackBox);

  function drawPrompt() {
    mount(promptBox,
      current.target && h("span.badge", `Try: ${topicTitle[current.target] ?? current.target}`),
      current.ai && h("span.badge.new", "✨ AI"),
      h("p.prompt-text", { lang: "de" }, current.de, " ", speakButton(current.de)),
      h("button.link", { type: "button", onclick: () => ((showEnglish = !showEnglish), drawPrompt()) }, showEnglish ? current.en : "Show in English"),
      h("div.row",
        h("button.btn.small", { type: "button", onclick: anotherPrompt }, "↻ Another question"),
        h("button.btn.small", { type: "button", onclick: aiPrompt }, "✨ New AI question"),
      ),
    );
  }

  async function anotherPrompt() {
    current = await nextStaticPrompt(prompts);
    reset();
  }

  async function aiPrompt(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const target = await weakestTopic(topics);
      const p = await post("/api/speaking/prompt", { target_topic: target, avoid: [current.de] });
      current = { ...p, ai: true };
      reset();
    } catch (err) {
      toast(err.message, "error");
      btn.disabled = false;
    }
  }

  function reset() {
    showEnglish = false;
    drawPrompt();
    drawIdle();
    mount(feedbackBox);
  }

  // ---------------------------------------------------------------- answering

  function drawIdle() {
    const supported = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
    mount(answerBox,
      h("div.mic-area",
        supported
          ? h("button.mic", { type: "button", onclick: startRecording, "aria-label": "Start recording" }, "🎙️")
          : h("p.muted", "Recording isn't available here (it needs HTTPS or localhost)."),
        h("p.muted", supported ? "Tap and answer out loud. Don't plan it – just talk." : ""),
        h("button.link", { type: "button", onclick: drawTyping }, "⌨️ Type instead"),
      ),
    );
  }

  function drawTyping() {
    const text = h("textarea.answer", { rows: 4, lang: "de", placeholder: "Schreib deine Antwort…", spellcheck: false });
    mount(answerBox,
      h("form.card", { onsubmit: (e) => (e.preventDefault(), text.value.trim() && getFeedback(text.value.trim(), "written")) },
        text,
        h("div.row",
          h("button.btn.primary", { type: "submit" }, "Get feedback"),
          h("button.btn", { type: "button", onclick: drawIdle }, "🎙️ Speak instead"),
        ),
      ),
    );
    text.focus();
  }

  async function startRecording() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      toast("Microphone access was blocked. Allow it in the browser's site settings.", "error");
      return;
    }
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder = rec;
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stopStream();
      if (recorder === rec) recorder = null;
      if (rec.cancelled) return;
      transcribe(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
    };
    rec.start();

    const started = Date.now();
    const clock = h("span.clock", "0:00");
    timer = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      if (s >= MAX_SECONDS) stopRecording();
    }, 250);

    mount(answerBox,
      h("div.mic-area",
        h("button.mic.recording", { type: "button", onclick: stopRecording, "aria-label": "Stop recording" }, "■"),
        h("p", h("span.rec-dot"), " Recording… ", clock),
        h("button.link", { type: "button", onclick: cancelRecording }, "Cancel"),
      ),
    );
  }

  function stopRecording() {
    clearInterval(timer);
    if (recorder?.state === "recording") recorder.stop();
  }

  function cancelRecording() {
    if (recorder) recorder.cancelled = true;
    stopRecording();
    drawIdle();
  }

  function stopStream() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  async function transcribe(blob) {
    mount(answerBox, spinner("Listening to your answer…"));
    try {
      const { text } = await postAudio("/api/speaking/transcribe", blob);
      if (!text) {
        toast("I couldn't hear anything. Try again a bit closer to the mic.", "error");
        return drawIdle();
      }
      getFeedback(text, "spoken");
    } catch (err) {
      toast(err.message, "error");
      drawIdle();
    }
  }

  // ---------------------------------------------------------------- feedback

  async function getFeedback(answer, mode) {
    drawAnswer(answer, mode);
    mount(feedbackBox, spinner("Understanding what you meant…"));
    try {
      const fb = await post("/api/speaking/feedback", {
        prompt: current.de,
        answer,
        mode,
        target_topic: current.target ?? null,
      });
      await addActivity("speaking");
      await saveMistakes(fb, current.de);
      drawFeedback(answer, fb);
    } catch (err) {
      mount(feedbackBox, h("div.card.error", h("p", err.message), h("button.btn", { type: "button", onclick: () => getFeedback(answer, mode) }, "Retry")));
    }
  }

  function drawAnswer(answer, mode) {
    const edit = () => {
      const text = h("textarea.answer", { rows: 3, lang: "de" });
      text.value = answer;
      mount(answerBox,
        h("form.card", { onsubmit: (e) => (e.preventDefault(), getFeedback(text.value.trim(), mode)) },
          h("p.muted.small", "Fix only what the transcription got wrong – keep your own mistakes in."),
          text,
          h("button.btn.primary", { type: "submit" }, "Resend"),
        ),
      );
    };
    mount(answerBox,
      h("div.card.you-said",
        h("p.muted.small", mode === "spoken" ? "You said:" : "You wrote:"),
        h("p", { lang: "de" }, answer),
        mode === "spoken" && h("button.link.small", { type: "button", onclick: edit }, "Heard you wrong? Edit"),
      ),
    );
  }

  function drawFeedback(answer, fb) {
    const [dot, title] = VERDICTS[fb.verdict] ?? VERDICTS.good;
    const diff = wordDiff(answer, fb.corrected);
    const changed = diff.some((d) => d.type !== "same");

    mount(feedbackBox,
      h(`div.card.feedback.${fb.verdict}`,
        h("h2", `${dot} ${title}`),
        h("p.understood", fb.understood),
        h("p", fb.encouragement),

        changed &&
          h("div.block",
            h("h4", "Corrected"),
            h("p.diff", { lang: "de" }, diff.map((d) => [h(`span.${d.type}`, d.text), " "]), speakButton(fb.corrected)),
          ),
        !changed && h("p.result.correct", "✓ No corrections needed."),

        fb.natural &&
          h("div.block",
            h("h4", "How a local might say it"),
            h("p.natural", { lang: "de" }, fb.natural, " ", speakButton(fb.natural)),
          ),

        fb.key_fixes.length > 0 &&
          h("div.block",
            h("h4", fb.key_fixes.length === 1 ? "The one thing to remember" : "Most important"),
            h("ul.fixes",
              fb.key_fixes.map((f) =>
                h("li",
                  h("span.del", { lang: "de" }, f.original), " → ", h("span.add", { lang: "de" }, f.fixed),
                  h("p.muted.small", f.why),
                ),
              ),
            ),
          ),

        fb.tip && h("p.tip", "💡 ", fb.tip),

        fb.new_words.length > 0 &&
          h("div.block",
            h("h4", "Words to learn"),
            fb.new_words.map((w) => {
              const btn = h("button.btn.small", {
                type: "button",
                onclick: async () => {
                  const added = await addCards([{ de: w.de, en: w.en, example: fb.natural ?? fb.corrected, source: "speaking" }]);
                  btn.replaceWith(h("span.muted.small", added ? "✓ added" : "already in your words"));
                },
              }, "+ Add");
              return h("div.new-word", h("span", h("strong", { lang: "de" }, w.de), " – ", w.en), btn);
            }),
          ),

        h("p.muted.small", "+5 XP"),
        h("div.row",
          h("button.btn.primary", { type: "button", onclick: () => (mount(feedbackBox), startRecording()) }, "🎙️ Say it again"),
          h("button.btn", { type: "button", onclick: anotherPrompt }, "Next question"),
        ),
      ),
    );
    feedbackBox.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  reset();

  return () => {
    // Leaving the page: release the microphone.
    if (recorder) recorder.cancelled = true;
    stopRecording();
    stopStream();
  };
}

/** Cycle through the built-in prompts in random order without repeats. */
async function nextStaticPrompt(prompts) {
  const settings = await getSettings();
  let order = (settings.promptOrder ?? []).filter((id) => prompts.some((p) => p.id === id));
  if (!order.length) order = shuffle(prompts.map((p) => p.id));
  const id = order.shift();
  await setSetting("promptOrder", order);
  return prompts.find((p) => p.id === id);
}

async function weakestTopic(topics) {
  const records = Object.fromEntries((await db.all("grammar")).map((r) => [r.topic_id, r]));
  const focus = topics.filter((t) => t.group === "focus");
  const score = (t) => {
    const r = records[t.id];
    return r?.attempts ? r.correct / r.attempts : 0.7; // untried topics sit in the middle
  };
  // Pick randomly among the three weakest so it doesn't always ask about the same thing.
  const weakest = [...focus].sort((a, b) => score(a) - score(b)).slice(0, 3);
  return weakest[Math.floor(Math.random() * weakest.length)]?.id ?? null;
}

/** Keep each fix in the notebook and feed it to grammar practice for that topic. */
async function saveMistakes(fb, prompt) {
  const date = new Date().toISOString();
  for (const f of fb.key_fixes) {
    await db.put("mistakes", { id: crypto.randomUUID(), date, prompt, original: f.original, fixed: f.fixed, why: f.why, topic_id: f.topic_id });
    if (f.topic_id) {
      const rec = (await db.get("grammar", f.topic_id)) ?? { topic_id: f.topic_id, attempts: 0, correct: 0, recent: [], queue: [] };
      rec.recent = [...rec.recent, { sentence: "(while speaking)", answer: f.original, expected: f.fixed }].slice(-5);
      await db.put("grammar", rec);
    }
  }
}
