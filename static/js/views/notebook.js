import { db } from "../db.js";
import { h, mount, speakButton } from "../ui.js";

export async function render(root) {
  const mistakes = (await db.all("mistakes")).sort((a, b) => b.date.localeCompare(a.date));

  const item = (m) => {
    const el = h("li.card.mistake",
      h("p", h("span.del", { lang: "de" }, m.original), " → ", h("span.add", { lang: "de" }, m.fixed), " ", speakButton(m.fixed)),
      h("p.muted.small", m.why),
      h("div.row.small",
        h("small.muted", new Date(m.date).toLocaleDateString()),
        h("button.link.small", {
          type: "button",
          onclick: async () => {
            await db.del("mistakes", m.id);
            el.remove();
          },
        }, "Got it – remove"),
      ),
    );
    return el;
  };

  mount(root,
    h("a.back", { href: "#/settings" }, "‹ More"),
    h("h1", "Notebook"),
    h("p.muted", "The fixes from your speaking answers. They also steer which grammar exercises you get."),
    mistakes.length ? h("ul.plain", mistakes.map(item)) : h("p.card", "Nothing yet – go speak a little! 🎙️"),
  );
}
