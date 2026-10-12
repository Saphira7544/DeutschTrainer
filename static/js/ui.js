// Small DOM helpers shared by the views.

/** h("div.card", { onclick }, "text", child) - tag may carry .classes */
export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split(".");
  const el = document.createElement(name || "div");
  if (classes.length) el.className = classes.join(" ");
  if (props != null && (typeof props !== "object" || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className += (el.className ? " " : "") + v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function mount(root, ...children) {
  root.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
}

let toastTimer;
export function toast(message, kind = "info") {
  let el = document.getElementById("toast");
  if (!el) {
    el = h("div", { id: "toast", role: "status" });
    document.body.append(el);
  }
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = "toast"), kind === "error" ? 5000 : 2500);
}

export function spinner(label = "Loading…") {
  return h("div.loading", h("div.spinner"), h("span", label));
}

// ---------------------------------------------------------------- text-to-speech

let germanVoice;
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  germanVoice =
    voices.find((v) => v.lang === "de-CH") ?? voices.find((v) => v.lang === "de-DE") ?? voices.find((v) => v.lang?.startsWith("de"));
}
if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
}

export function speak(text, rate = 0.95) {
  if (!("speechSynthesis" in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = germanVoice?.lang ?? "de-DE";
  if (germanVoice) u.voice = germanVoice;
  u.rate = rate;
  speechSynthesis.speak(u);
}

/**
 * A German word with its gender colour-coded like the Goethe deck: der blue, die red, das green.
 * "die Straße" → <span.g-die>die Straße</span>; "der/die Verwandte" colours each article.
 */
export function germanWord(de) {
  const m = /^((?:der|die|das)(?:\/(?:der|die|das))*)\s+(.+)$/i.exec(String(de ?? ""));
  if (!m) return document.createTextNode(String(de ?? ""));
  const articles = m[1].toLowerCase().split("/");
  if (articles.length === 1) return h(`span.g-${articles[0]}`, de);
  return h("span", articles.flatMap((a, i) => [i ? "/" : "", h(`span.g-${a}`, a)]), " ", m[2]);
}

let player;
/** Play a recorded clip (native speaker), falling back to text-to-speech if it can't load. */
export function say(text, audioUrl) {
  if (!audioUrl) return speak(text);
  speechSynthesis?.cancel();
  player?.pause();
  player = new Audio(audioUrl);
  player.play().catch(() => speak(text));
}

export function speakButton(text, audioUrl) {
  return h("button.icon-btn", { type: "button", title: "Listen", "aria-label": "Listen", onclick: (e) => (e.stopPropagation(), say(text, audioUrl)) }, "🔊");
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Couldn't load ${path}`);
  return res.json();
}
