// Boot, hash router and the bottom navigation.
import { requestPersistence } from "./db.js";
import { registerBackgroundCheck } from "./reminders.js";
import { getSettings, streakInfo } from "./store.js";
import { h, mount } from "./ui.js";

const routes = [
  [/^\/$/, () => import("./views/home.js")],
  [/^\/vocab$/, () => import("./views/vocab.js")],
  [/^\/vocab\/(review)$/, () => import("./views/vocab.js")],
  [/^\/vocab\/(import)$/, () => import("./views/vocab.js")],
  [/^\/vocab\/(list)$/, () => import("./views/vocab.js")],
  [/^\/grammar$/, () => import("./views/grammar.js")],
  [/^\/grammar\/([\w-]+)$/, () => import("./views/grammar.js")],
  [/^\/speak$/, () => import("./views/speaking.js")],
  [/^\/notebook$/, () => import("./views/notebook.js")],
  [/^\/settings$/, () => import("./views/settings.js")],
];

const tabs = [
  ["/", "🏠", "Home"],
  ["/vocab", "🃏", "Words"],
  ["/grammar", "🧩", "Grammar"],
  ["/speak", "🎙️", "Speak"],
  ["/settings", "⚙️", "More"],
];

const main = document.getElementById("view");
const nav = document.getElementById("tabs");
const streakBadge = document.getElementById("streak");
let cleanup = null;

async function render() {
  const path = location.hash.replace(/^#/, "") || "/";
  if (typeof cleanup === "function") cleanup();
  cleanup = null;

  const match = routes.find(([re]) => re.test(path));
  if (!match) {
    location.hash = "#/";
    return;
  }
  const params = path.match(match[0]).slice(1);
  const section = "/" + (path.split("/")[1] ?? "");
  for (const a of nav.querySelectorAll("a")) a.classList.toggle("active", a.dataset.path === section || (a.dataset.path === "/settings" && section === "/notebook"));

  try {
    const view = await match[1]();
    main.scrollTo?.(0, 0);
    window.scrollTo(0, 0);
    cleanup = await view.render(main, ...params);
  } catch (err) {
    console.error(err);
    mount(main, h("div.card.error", h("h2", "Something went wrong"), h("p", String(err.message ?? err))));
  }
}

async function refreshStreak() {
  const { streak, todayDone } = await streakInfo();
  streakBadge.textContent = `🔥 ${streak}`;
  streakBadge.classList.toggle("done", todayDone);
  streakBadge.title = todayDone ? "Daily goal reached" : "Reach your daily goal to keep the streak";
}

mount(
  nav,
  tabs.map(([path, icon, label]) => h("a", { href: `#${path}`, "data-path": path }, h("span.tab-icon", icon), h("span.tab-label", label))),
);

window.addEventListener("hashchange", render);
window.addEventListener("xp", refreshStreak);
render();
refreshStreak();
requestPersistence();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { type: "module" }).catch((err) => console.warn("Service worker not registered", err));
  // Re-ask for background checks on every start: Chrome only grants them to installed, regularly used apps.
  getSettings().then((s) => s.notifications && registerBackgroundCheck());
}
