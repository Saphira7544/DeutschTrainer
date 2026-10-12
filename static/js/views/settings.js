import { checkKey, DEFAULT_MODEL } from "../ai.js";
import { exportBackup, getSettings, importBackup, setSetting, wipeAll } from "../store.js";
import { remindersCard } from "../reminders.js";
import { h, mount, toast } from "../ui.js";

export async function render(root) {
  const s = await getSettings();

  const token = h("input", { type: "password", value: s.openaiKey, placeholder: "sk-…", autocomplete: "off", spellcheck: false });
  const model = h("input", { value: s.openaiModel, placeholder: DEFAULT_MODEL, autocomplete: "off", spellcheck: false });
  const goal = numberInput(s.dailyGoal, 5, 200);
  const newCards = numberInput(s.newCardsPerDay, 0, 50);
  const direction = h("select",
    [["production", "English → German (best for speaking)"], ["recognition", "German → English"], ["mixed", "Mixed"]].map(([v, label]) =>
      h("option", { value: v, selected: s.vocabDirection === v }, label),
    ),
  );
  const autoSpeak = h("input", { type: "checkbox", checked: s.autoSpeak });

  async function save(e) {
    e.preventDefault();
    await setSetting("openaiKey", token.value.trim());
    await setSetting("openaiModel", model.value.trim());
    await setSetting("dailyGoal", clamp(goal.value, 5, 200));
    await setSetting("newCardsPerDay", clamp(newCards.value, 0, 50));
    await setSetting("vocabDirection", direction.value);
    await setSetting("autoSpeak", autoSpeak.checked);
    window.dispatchEvent(new Event("xp")); // refresh the streak badge (goal may have changed)
    if (token.value.trim()) {
      try {
        await checkKey();
        toast("Saved ✓ OpenAI accepted the key.");
      } catch (err) {
        toast(`Saved, but: ${err.message}`, "error");
      }
    } else {
      toast("Saved ✓");
    }
  }

  async function download() {
    const backup = await exportBackup();
    const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: `deutsch-trainer-${backup.exported.slice(0, 10)}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const restoreInput = h("input", { type: "file", accept: "application/json,.json", hidden: true });
  restoreInput.addEventListener("change", async () => {
    const file = restoreInput.files[0];
    if (!file || !confirm("Replace everything in the app with this backup?")) return;
    try {
      await importBackup(JSON.parse(await file.text()));
      toast("Backup restored ✓");
      location.hash = "#/";
    } catch (err) {
      toast(err.message, "error");
    }
  });

  const reminders = await remindersCard();

  mount(root,
    h("h1", "More"),
    h("a.tile", { href: "#/notebook" }, h("span.tile-icon", "📒"), h("div", h("h3", "Notebook"), h("p.muted", "Your corrections from speaking"))),
    reminders,
    h("form.card", { onsubmit: save },
      h("h3", "Settings"),
      h("label", "OpenAI API key", token,
        h("small.muted", "Stored only on this phone. Create one at platform.openai.com → API keys, ideally in a project with a monthly budget limit.")),
      h("details.more",
        h("summary", "Advanced"),
        h("label", "AI model", model, h("small.muted", `Leave empty for ${DEFAULT_MODEL}.`)),
      ),
      h("label", "Daily goal (XP)", goal, h("small.muted", "1 XP per card · 2 per grammar exercise · 5 per spoken answer")),
      h("label", "New words per day", newCards),
      h("label", "Vocab direction", direction),
      h("label.check", autoSpeak, " Read German words aloud automatically"),
      h("button.btn.primary.block", { type: "submit" }, "Save"),
    ),
    h("div.card",
      h("h3", "Backup"),
      h("p.muted.small", "Your progress lives only on this phone. Download a backup now and then."),
      h("div.row",
        h("button.btn", { type: "button", onclick: download }, "⬇️ Download backup"),
        h("button.btn", { type: "button", onclick: () => restoreInput.click() }, "⬆️ Restore"),
        restoreInput,
      ),
    ),
    h("div.card",
      h("h3", "Danger zone"),
      h("button.btn.danger", {
        type: "button",
        onclick: async () => {
          if (!confirm("Delete ALL words, progress and settings on this phone?")) return;
          await wipeAll();
          toast("Everything deleted.");
          location.hash = "#/";
        },
      }, "Delete all data"),
    ),
  );
}

function numberInput(value, min, max) {
  return h("input", { type: "number", inputmode: "numeric", min: String(min), max: String(max), value: String(value) });
}

function clamp(v, min, max) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}
