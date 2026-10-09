// Calls to the Python backend (AI features). Everything else works offline.
import { getSettings } from "./store.js";

async function request(path, init) {
  if (!navigator.onLine) throw new Error("You're offline. AI features need internet.");
  const { accessToken } = await getSettings();
  if (!accessToken) throw new Error("Add your access token in Settings first.");
  let res;
  try {
    res = await fetch(path, { ...init, headers: { ...init.headers, "X-Access-Token": accessToken } });
  } catch {
    throw new Error("Couldn't reach the server.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof body.detail === "string" ? body.detail : `Server error (${res.status})`;
    throw new Error(detail);
  }
  return body;
}

export function post(path, payload) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function postAudio(path, blob) {
  const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("audio", blob, `answer.${ext}`);
  return request(path, { method: "POST", headers: {}, body: form });
}

export function checkToken() {
  return request("/api/auth-check", { method: "GET", headers: {} });
}
