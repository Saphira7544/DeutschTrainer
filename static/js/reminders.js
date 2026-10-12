// Reminders: Google Calendar events (exact times) and the app's own notifications (only when you haven't practised).
import { calendarLink, DEFAULT_TIMES } from "./lib/nag.js";
import { getSettings, setSetting } from "./store.js";
import { h, mount, toast } from "./ui.js";

const PERIODIC_TAG = "nag";

/** The service worker registration, or null. Never hangs (serviceWorker.ready would wait forever if registering failed). */
async function registration() {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  if (reg?.active) return reg;
  return Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(() => resolve(null), 3000))]);
}

/** What this browser can do: notification permission, background checks, installed or not. */
async function capabilities() {
  const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
  let periodic = "unsupported";
  if (reg && "periodicSync" in reg) {
    try {
      periodic = (await navigator.permissions.query({ name: "periodic-background-sync" })).state;
    } catch {
      periodic = "unsupported";
    }
  }
  return {
    notifications: "Notification" in window ? Notification.permission : "unsupported",
    periodic, // "granted" only for an installed app
    installed: matchMedia("(display-mode: standalone)").matches,
  };
}

/** Ask Chrome to wake the app every few hours (it decides the real timing). */
export async function registerBackgroundCheck() {
  const reg = await registration();
  if (!reg || !("periodicSync" in reg)) return false;
  try {
    await reg.periodicSync.register(PERIODIC_TAG, { minInterval: 3 * 60 * 60 * 1000 });
    return true;
  } catch {
    return false;
  }
}

async function turnOn() {
  if (!("Notification" in window)) throw new Error("This browser can't show notifications.");
  if ((await Notification.requestPermission()) !== "granted") {
    throw new Error("Notifications are blocked. Allow them in Chrome: ⋮ → Settings → Site settings → Notifications.");
  }
  const reg = await registration();
  if (!reg) throw new Error("The app's background worker isn't running here, so it can't show notifications. Open the app in Chrome.");
  await setSetting("notifications", true);
  const background = await registerBackgroundCheck();
  await reg.showNotification("🔔 This is what guilt feels like.", {
    body: "Notifications are on. Skip German and I will find you.",
    icon: "icons/icon-192.png",
    tag: "nag",
  });
  return background;
}

async function turnOff() {
  await setSetting("notifications", false);
  const reg = await registration();
  await reg?.periodicSync?.unregister(PERIODIC_TAG).catch(() => {});
}

/** The "Reminders" card for the More screen. */
export async function remindersCard() {
  const settings = await getSettings();
  let times = settings.reminderTimes ?? DEFAULT_TIMES;
  const card = h("div.card");

  async function draw() {
    const caps = await capabilities();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const appUrl = new URL("./", location.href).href; // works under /DeutschTrainer/ too
    const on = (await getSettings()).notifications && caps.notifications === "granted";

    const inputs = times.map((t, i) =>
      h("input", {
        type: "time",
        value: t,
        "aria-label": `Reminder ${i + 1}`,
        onchange: async (e) => {
          times = times.map((x, j) => (j === i ? e.target.value : x)).filter(Boolean).sort();
          await setSetting("reminderTimes", times);
          draw();
        },
      }),
    );

    const backgroundNote =
      caps.notifications === "unsupported"
        ? "This browser can't show notifications."
        : !caps.installed
          ? "Install the app first (Chrome ⋮ → Install app / Add to Home screen) – background checks only work for installed apps."
          : caps.periodic === "granted"
            ? "Chrome wakes the app every few hours (it decides exactly when) and I nag you only if today's goal isn't reached yet."
            : "Chrome isn't allowing background checks yet. They unlock once you use the installed app regularly; notifications still work when the app runs.";

    mount(card,
      h("h3", "Reminders 🔔"),
      h("p.muted.small", "Your reminder times:"),
      h("div.times", inputs,
        times.length < 4 && h("button.btn.small", { type: "button", onclick: async () => {
          times = [...times, "18:00"].sort();
          await setSetting("reminderTimes", times);
          draw();
        } }, "+ Add"),
        times.length > 1 && h("button.btn.small", { type: "button", onclick: async () => {
          times = times.slice(0, -1);
          await setSetting("reminderTimes", times);
          draw();
        } }, "− Remove"),
      ),

      h("h4", "📅 Google Calendar – exact times, most reliable"),
      h("p.muted.small", "Tap each button, then Save in Google Calendar. It repeats every day. Tip: set the event's notification to “at time of event”."),
      h("div.row",
        times.map((t, i) =>
          h("a.btn.small", { href: calendarLink({ time: t, index: i, total: times.length, appUrl, timeZone }), target: "_blank", rel: "noopener" }, `📅 ${t}`),
        ),
      ),

      h("h4", "🔔 App notifications – only when you haven't practised"),
      h("p.muted.small", backgroundNote),
      h("button.btn", {
        type: "button",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            if (on) {
              await turnOff();
              toast("Notifications off. Your German is relieved. For now.");
            } else {
              const background = await turnOn();
              toast(background ? "Notifications on 😈" : "Notifications on – background checks need the installed app.");
            }
          } catch (err) {
            toast(err.message, "error");
          }
          draw();
        },
      }, on ? "Turn off notifications" : "Turn on notifications"),
    );
  }

  await draw();
  return card;
}
