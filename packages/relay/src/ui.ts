/**
 * Self-contained mobile chat UI served at `/r/:code`. Inlined as a string so
 * the relay has no build step and ships as a single Bun process. The page:
 *  1. Reads the pairing code from the URL, POSTs `/claim`, stores the
 *     resulting clientToken in localStorage (scoped to the relay origin).
 *  2. Lists and creates sessions via `/t/session`.
 *  3. Sends prompts via `/t/session/:id/prompt_async` and re-fetches
 *     messages whenever `/t/event?token=...` emits a relevant bus event.
 *
 * Deliberately framework-free so the page is tiny and forks cleanly. Tool
 * and file parts render as compact stubs; the text chat is the happy path.
 */
export const UI_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="color-scheme" content="dark light" />
  <title>opencode remote</title>
  <style>
    :root {
      --bg: #0b0d10;
      --bg-2: #14171c;
      --bg-3: #1c2028;
      --fg: #e6e9ef;
      --fg-2: #9aa3b2;
      --fg-3: #626b7a;
      --accent: #7dd3fc;
      --accent-2: #38bdf8;
      --danger: #fca5a5;
      --ok: #86efac;
      --warn: #fcd34d;
      --border: #23272f;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f8fafc;
        --bg-2: #ffffff;
        --bg-3: #f1f5f9;
        --fg: #0f172a;
        --fg-2: #475569;
        --fg-3: #64748b;
        --accent: #0284c7;
        --accent-2: #0369a1;
        --border: #e2e8f0;
      }
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { display: flex; flex-direction: column; overscroll-behavior-y: contain; }
    header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--bg-2); position: sticky; top: 0; z-index: 2; }
    header .title { flex: 1; font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    header button { font-size: 13px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-3); color: var(--fg); }
    header button:active { transform: scale(0.97); }
    #status { font-size: 11px; color: var(--fg-3); padding: 4px 14px; border-bottom: 1px solid var(--border); background: var(--bg-2); }
    #status .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; background: var(--fg-3); }
    #status.ok .dot { background: var(--ok); }
    #status.warn .dot { background: var(--warn); }
    #status.err .dot { background: var(--danger); }
    main { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
    .msg { max-width: 92%; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--border); background: var(--bg-2); white-space: pre-wrap; word-wrap: break-word; }
    .msg.user { align-self: flex-end; background: var(--bg-3); }
    .msg.assistant { align-self: flex-start; }
    .msg .role { font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--fg-3); margin-bottom: 4px; }
    .msg .tool { display: inline-block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; padding: 2px 6px; margin: 2px 4px 2px 0; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--fg-2); }
    .msg .tool.ok { border-color: rgba(134,239,172,0.3); color: var(--ok); }
    .msg .tool.err { border-color: rgba(252,165,165,0.3); color: var(--danger); }
    .empty { color: var(--fg-3); text-align: center; margin-top: 40px; font-size: 13px; }
    footer { padding: 8px 10px 14px; padding-bottom: max(14px, env(safe-area-inset-bottom)); border-top: 1px solid var(--border); background: var(--bg-2); display: flex; gap: 8px; align-items: flex-end; position: sticky; bottom: 0; }
    textarea { flex: 1; resize: none; min-height: 40px; max-height: 40vh; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); font: inherit; }
    textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
    footer button { padding: 10px 14px; border-radius: 10px; border: 1px solid var(--accent); background: var(--accent); color: #00171f; font-weight: 600; min-width: 64px; }
    footer button:disabled { opacity: 0.4; }
    .sheet { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: none; z-index: 10; align-items: flex-end; }
    .sheet.open { display: flex; }
    .sheet-inner { background: var(--bg-2); color: var(--fg); width: 100%; max-height: 75vh; border-radius: 18px 18px 0 0; padding: 16px; overflow-y: auto; }
    .sheet-inner h2 { margin: 0 0 10px; font-size: 14px; color: var(--fg-2); font-weight: 600; }
    .session { display: flex; justify-content: space-between; padding: 12px 10px; border-top: 1px solid var(--border); cursor: pointer; }
    .session:first-child { border-top: 0; }
    .session .when { color: var(--fg-3); font-size: 12px; }
    .fatal { margin: 40px 16px; padding: 14px; border: 1px solid var(--danger); border-radius: 10px; background: rgba(252,165,165,0.08); color: var(--danger); }
  </style>
</head>
<body>
  <header>
    <div class="title" id="title">opencode remote</div>
    <button id="sessions-btn" type="button">Sessions</button>
    <button id="new-btn" type="button">New</button>
  </header>
  <div id="status"><span class="dot"></span><span id="status-text">claiming…</span></div>
  <main id="log" role="log" aria-live="polite"></main>
  <footer>
    <textarea id="input" placeholder="Message…" rows="1" autocomplete="off" autocapitalize="sentences"></textarea>
    <button id="send" type="button" disabled>Send</button>
  </footer>
  <div class="sheet" id="sheet" role="dialog" aria-modal="true">
    <div class="sheet-inner">
      <h2>Sessions</h2>
      <div id="session-list"></div>
    </div>
  </div>

<script>
(() => {
  const relay = window.location.origin;
  const codeFromUrl = decodeURIComponent(window.location.pathname.replace(/^\\/r\\//, "")).toUpperCase();
  const storageKey = "opencode-remote:" + relay;
  const statusEl = document.getElementById("status");
  const statusText = document.getElementById("status-text");
  const title = document.getElementById("title");
  const log = document.getElementById("log");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("send");
  const sheet = document.getElementById("sheet");
  const sessionList = document.getElementById("session-list");

  let token = null;
  let sessionId = null;
  let eventSource = null;
  let knownMessages = new Map(); // messageID -> Message record

  function setStatus(text, cls) {
    statusText.textContent = text;
    statusEl.className = cls || "";
  }
  function fatal(message) {
    document.body.innerHTML = "";
    const box = document.createElement("div");
    box.className = "fatal";
    box.textContent = message;
    document.body.appendChild(box);
  }

  async function api(path, init) {
    const options = init || {};
    const headers = new Headers(options.headers || {});
    if (token) headers.set("authorization", "Bearer " + token);
    const res = await fetch(relay + "/t" + path, Object.assign({}, options, { headers }));
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error("HTTP " + res.status + ": " + body);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async function claim() {
    // Prefer a stored token for this relay; fall back to claiming the URL code.
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed.expiresAt > Date.now() + 60_000) {
          token = parsed.clientToken;
          return;
        }
      } catch { /* ignore */ }
    }
    if (!codeFromUrl || codeFromUrl.length < 8) {
      fatal("No pairing code in URL. Open the /r/<CODE> link printed by 'opencode remote'.");
      throw new Error("no code");
    }
    setStatus("claiming…", "warn");
    const res = await fetch(relay + "/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: codeFromUrl }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      fatal("Pairing failed: " + res.status + " " + body);
      throw new Error("claim failed");
    }
    const data = await res.json();
    token = data.clientToken;
    localStorage.setItem(storageKey, JSON.stringify(data));
  }

  function openEvents() {
    if (eventSource) try { eventSource.close(); } catch {}
    const url = relay + "/t/event?token=" + encodeURIComponent(token);
    eventSource = new EventSource(url);
    eventSource.onopen = () => setStatus("connected", "ok");
    eventSource.onerror = () => setStatus("reconnecting…", "warn");
    eventSource.onmessage = (evt) => {
      let payload; try { payload = JSON.parse(evt.data); } catch { return; }
      // We only care that *something* changed for our session. Refetch.
      const type = payload && payload.type;
      if (!type) return;
      if (type.startsWith("message") || type.startsWith("session") || type === "message.part_updated") {
        refreshMessages();
      }
    };
  }

  async function pickOrCreateSession() {
    const list = await api("/session");
    if (Array.isArray(list) && list.length > 0) {
      // Default to the most recent session (server returns in created order; take the last).
      const latest = list[list.length - 1];
      sessionId = latest.id;
      title.textContent = latest.title || "opencode";
    } else {
      const created = await api("/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      sessionId = created.id;
      title.textContent = created.title || "opencode";
    }
    await refreshMessages();
  }

  async function refreshMessages() {
    if (!sessionId) return;
    let messages;
    try {
      messages = await api("/session/" + sessionId + "/message");
    } catch (err) {
      setStatus(String(err.message || err), "err");
      return;
    }
    knownMessages = new Map(messages.map((m) => [m.info.id, m]));
    render(messages);
  }

  function render(messages) {
    log.innerHTML = "";
    if (!messages || messages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Say something to start.";
      log.appendChild(empty);
      return;
    }
    for (const m of messages) {
      const info = m.info;
      const parts = m.parts || [];
      const div = document.createElement("div");
      div.className = "msg " + info.role;
      const role = document.createElement("div");
      role.className = "role";
      role.textContent = info.role;
      div.appendChild(role);
      for (const part of parts) {
        if (part.type === "text") {
          const span = document.createElement("span");
          span.textContent = part.text || "";
          div.appendChild(span);
        } else if (part.type === "tool") {
          const stub = document.createElement("span");
          stub.className = "tool " + (part.state && part.state.error ? "err" : part.state && part.state.output ? "ok" : "");
          stub.textContent = part.tool || "tool";
          div.appendChild(stub);
        } else if (part.type === "file") {
          const stub = document.createElement("span");
          stub.className = "tool";
          stub.textContent = part.filename || "file";
          div.appendChild(stub);
        }
      }
      log.appendChild(div);
    }
    log.scrollTop = log.scrollHeight;
  }

  async function send() {
    const text = input.value.trim();
    if (!text || !sessionId) return;
    sendBtn.disabled = true;
    const body = { parts: [{ type: "text", text }] };
    try {
      await api("/session/" + sessionId + "/prompt_async", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      input.value = "";
      autoGrow();
      // Optimistic: show user message immediately; the event stream will backfill.
      const optimistic = document.createElement("div");
      optimistic.className = "msg user";
      const role = document.createElement("div"); role.className = "role"; role.textContent = "user";
      optimistic.appendChild(role);
      const span = document.createElement("span"); span.textContent = text;
      optimistic.appendChild(span);
      log.appendChild(optimistic);
      log.scrollTop = log.scrollHeight;
    } catch (err) {
      setStatus(String(err.message || err), "err");
    } finally {
      sendBtn.disabled = !input.value.trim();
    }
  }

  function autoGrow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, window.innerHeight * 0.4) + "px";
  }
  input.addEventListener("input", () => {
    sendBtn.disabled = !input.value.trim();
    autoGrow();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  sendBtn.addEventListener("click", send);

  document.getElementById("new-btn").addEventListener("click", async () => {
    try {
      const created = await api("/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      sessionId = created.id;
      title.textContent = created.title || "opencode";
      await refreshMessages();
    } catch (err) {
      setStatus(String(err.message || err), "err");
    }
  });
  document.getElementById("sessions-btn").addEventListener("click", async () => {
    sheet.classList.add("open");
    sessionList.innerHTML = "Loading…";
    try {
      const list = await api("/session");
      sessionList.innerHTML = "";
      for (const s of [...list].reverse()) {
        const row = document.createElement("div");
        row.className = "session";
        const label = document.createElement("div"); label.textContent = s.title || s.id;
        const when = document.createElement("div"); when.className = "when"; when.textContent = new Date(s.time && s.time.updated ? s.time.updated : Date.now()).toLocaleString();
        row.appendChild(label); row.appendChild(when);
        row.addEventListener("click", async () => {
          sheet.classList.remove("open");
          sessionId = s.id;
          title.textContent = s.title || "opencode";
          await refreshMessages();
        });
        sessionList.appendChild(row);
      }
    } catch (err) {
      sessionList.textContent = String(err.message || err);
    }
  });
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.classList.remove("open"); });

  (async () => {
    try {
      await claim();
      openEvents();
      await pickOrCreateSession();
    } catch (err) {
      setStatus(String(err.message || err), "err");
    }
  })();
})();
</script>
</body>
</html>`
