// AI features, called straight from the phone to OpenAI with your own key.
// The key is stored only on this device (IndexedDB settings) – never in the code or on GitHub.
import * as P from "./lib/prompts.js";
import { getSettings } from "./store.js";
import { loadJSON } from "./ui.js";

const API = "https://api.openai.com/v1";
export const DEFAULT_MODEL = "gpt-5.4-mini";
const TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
const MAX_AUDIO_BYTES = 6 * 1024 * 1024; // roughly 2–3 minutes of speech

let topicsPromise;
const topics = () => (topicsPromise ??= loadJSON("data/grammar_topics.json").then((d) => d.topics));

async function key() {
  const { openaiKey, openaiModel } = await getSettings();
  if (!openaiKey) throw new Error("Add your OpenAI API key in More → Settings to use the AI features.");
  return { apiKey: openaiKey, model: openaiModel || DEFAULT_MODEL };
}

async function call(path, init) {
  if (!navigator.onLine) throw new Error("You're offline. AI features need internet.");
  let res;
  try {
    res = await fetch(`${API}${path}`, init);
  } catch {
    // OpenAI's error replies to POSTs (bad key, no credit) carry no CORS header, so the browser only sees a failed request.
    throw new Error(
      "Couldn't get an answer from OpenAI. Check your internet, your API key (Save in More → Settings tests it) and that your OpenAI account has credit.",
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body.error?.message ?? `OpenAI error (${res.status})`;
    if (res.status === 401) throw new Error("OpenAI rejected the API key. Check it in More → Settings.");
    if (res.status === 429) throw new Error(`OpenAI says: ${msg} (rate limit or no credit left)`);
    throw new Error(`OpenAI says: ${msg}`);
  }
  return body;
}

/** Ask the model and get back JSON matching `schema` (strict structured output). */
async function askJson(system, user, name, schema, maxTokens = 4000) {
  const { apiKey, model } = await key();
  const body = await call("/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
      // Generous because newer models spend part of this budget on reasoning.
      max_completion_tokens: maxTokens,
    }),
  });
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("The AI returned an empty answer. Try again.");
  return JSON.parse(content);
}

/** Check the key works (listing models is free). */
export async function checkKey() {
  const { apiKey } = await key();
  await call("/models", { headers: { Authorization: `Bearer ${apiKey}` } });
}

export async function transcribe(blob) {
  if (blob.size > MAX_AUDIO_BYTES) throw new Error("Recording is too long. Keep answers under about 2 minutes.");
  if (!blob.size) throw new Error("The recording is empty.");
  const { apiKey } = await key();
  const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("file", blob, `answer.${ext}`);
  form.append("model", TRANSCRIBE_MODEL);
  form.append("language", "de");
  // Learners need to see their own mistakes, so ask for a literal transcript.
  form.append("prompt", "Wörtliche Transkription einer Deutschlernerin. Grammatikfehler nicht korrigieren.");
  const body = await call("/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
  return (body.text ?? "").trim();
}

export async function speakingFeedback({ prompt, answer, mode, targetTopic }) {
  const list = await topics();
  const result = await askJson(P.feedbackSystem(list), P.feedbackUser(list, { prompt, answer, mode, targetTopic }), "speaking_feedback", P.FEEDBACK_SCHEMA);
  const ids = new Set(list.map((t) => t.id));
  for (const fix of result.key_fixes) if (!ids.has(fix.topic_id)) fix.topic_id = null;
  return result;
}

export async function newPrompt(targetTopic, avoid = []) {
  const list = await topics();
  const result = await askJson(P.PROMPT_SYSTEM, P.promptUser(list, targetTopic, avoid.map((a) => a.slice(0, 200))), "speaking_prompt", P.PROMPT_SCHEMA, 1500);
  return { ...result, target: targetTopic ?? null };
}

export async function makeExercises(topicId, count = 8, recentMistakes = []) {
  const topic = (await topics()).find((t) => t.id === topicId);
  if (!topic) throw new Error("Unknown grammar topic.");
  const result = await askJson(P.EXERCISES_SYSTEM, P.exercisesUser(topic, count, recentMistakes.map((m) => m.slice(0, 300))), "grammar_exercises", P.EXERCISES_SCHEMA, 8000);
  return P.validExercises(result.exercises, topicId);
}

export function checkAnswer(exercise, answer) {
  return askJson(P.CHECK_SYSTEM, P.checkUser(exercise, answer), "answer_check", P.CHECK_SCHEMA, 1500);
}

export function lookupWord(word, sentence) {
  return askJson(P.LOOKUP_SYSTEM, P.lookupUser(word, sentence), "word_lookup", P.LOOKUP_SCHEMA, 800);
}
