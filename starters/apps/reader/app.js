// The Reader: each feed's newest posts as Filament reads them (its "posts" source), in one list, newest first; a post
// marked read is kept in filament.db's "read" collection, so it stays read beside the chat, full size and in a browser
// tab. Preact and htm from Filament's shelf, so it loads with no network. A post's link opens in a new browser tab.
import { html, render, useEffect, useState } from "/_filament/lib/preact@11/preact.js";

const f = window.filament;

/** A post's day, short. @param {string} iso */
const dayOf = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

function App() {
  const [posts, setPosts] = useState(/** @type {any[] | null} */ (null));
  const [why, setWhy] = useState("");
  const [read, setRead] = useState(/** @type {Set<string>} */ (new Set()));
  const [all, setAll] = useState(false);

  const readPosts = () =>
    f.source("posts").then(
      (s) => {
        setPosts(s.rows || []);
        setWhy(s.error ? `Its last read failed: ${s.error}` : "");
      },
      (e) => {
        setPosts([]);
        setWhy(e.off === "draft" ? "A draft: Keep… on its page reads the feeds, and nothing reads before." : e.off === "paused" ? "Paused: Resume on its page reads it again." : String(e.message || e));
      },
    );
  const readMarks = () => f.db.list("read").then((r) => setRead(new Set(r.map((x) => String(x.id)))), () => {});

  useEffect(() => {
    readPosts();
    readMarks();
    const offSource = f.onSource(() => readPosts());
    const offData = f.db.onChange(({ collection }) => collection === "read" && readMarks());
    return () => {
      offSource();
      offData();
    };
  }, []);

  /** A post marked read, or not. @param {any} p */
  const mark = async (p) => {
    const was = read.has(p.__key);
    setRead((s) => {
      const n = new Set(s);
      if (was) n.delete(p.__key);
      else n.add(p.__key);
      return n;
    });
    try {
      if (was) await f.db.delete("read", p.__key);
      else await f.db.set("read", { id: p.__key, at: Date.now() });
    } catch {
      readMarks();
    }
  };

  if (posts === null) return html`<p class="quiet">Reading your feeds…</p>`;
  const shown = all ? posts : posts.filter((p) => !read.has(p.__key));
  return html`
    <div class="head">
      <h1>Reader</h1>
      <span class="quiet">${posts.length - posts.filter((p) => read.has(p.__key)).length} unread</span>
      <button class="ghost" onClick=${() => setAll(!all)}>${all ? "Unread only" : "Show all"}</button>
    </div>
    ${why && html`<p class="quiet">${why}</p>`}
    ${!shown.length && !why ? html`<p class="quiet">${posts.length ? "All read." : "No posts yet."}</p>` : null}
    <ul class="posts">
      ${shown.map(
        (p) => html`<li class=${read.has(p.__key) ? "is-read" : ""}>
          <a href=${/^https?:\/\//i.test(String(p.link)) ? p.link : undefined} target="_blank" rel="noopener" onClick=${() => !read.has(p.__key) && mark(p)}>${p.title}</a>
          <span class="quiet">${p.feed}${p.date ? ` · ${dayOf(p.date)}` : ""}</span>
          ${p.text && html`<p class="text">${p.text}</p>`}
          <button class="ghost mark" onClick=${() => mark(p)}>${read.has(p.__key) ? "Mark unread" : "Mark read"}</button>
        </li>`,
      )}
    </ul>
  `;
}

render(html`<${App} />`, /** @type {HTMLElement} */ (document.getElementById("app")));
