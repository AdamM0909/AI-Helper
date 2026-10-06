const $ = (sel) => document.querySelector(sel);
const LEVEL_NAMES = ["new", "learning", "getting it", "mastered"];
const LEVEL_WIDTH = [4, 35, 70, 100];

// localStorage can throw in private windows; Sage still works, it just won't remember you.
const store = {
  get: (key) => { try { return localStorage.getItem(key); } catch { return null; } },
  set: (key, value) => { try { localStorage.setItem(key, value); } catch {} },
  remove: (key) => { try { localStorage.removeItem(key); } catch {} },
};

let accessCode = store.get("sageCode") || "";
let sessionId = store.get("sageSession");
let busy = false;

function api(url, body) {
  return fetch(url, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "X-Access-Code": accessCode },
    body: body && JSON.stringify(body),
  });
}

function render(markdown) {
  return DOMPurify.sanitize(marked.parse(markdown));
}

function addMessage(role, text) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  if (role === "tutor") el.innerHTML = render(text);
  else el.textContent = text;
  $("#messages").append(el);
  el.scrollIntoView({ block: "end" });
  return el;
}

function showRemaining(remaining) {
  if (typeof remaining === "number") $("#remaining").textContent = `${remaining} messages left today`;
}

function showProgress(progress) {
  if (progress.topic) $("#topic").textContent = progress.topic;
  $("#plan-empty").hidden = progress.concepts.length > 0;
  $("#concepts").replaceChildren(
    ...progress.concepts.map((c) => {
      const li = document.createElement("li");
      li.className = "concept";
      li.innerHTML = `
        <div class="concept-name"><span></span><span class="concept-level"></span></div>
        <div class="bar"><span></span></div>`;
      li.querySelector(".concept-name span").textContent = c.name;
      li.querySelector(".concept-level").textContent = LEVEL_NAMES[c.level];
      const bar = li.querySelector(".bar span");
      bar.className = `l${c.level}`;
      bar.style.width = `${LEVEL_WIDTH[c.level]}%`;
      return li;
    }),
  );
}

// ---- Start screen ----
const startForm = $("#start-form");
startForm.code.value = accessCode;

function showStartError(message) {
  $("#start-error").textContent = message;
  $("#start-error").hidden = false;
}

$("#subject-chips").addEventListener("click", (e) => {
  if (!e.target.matches(".chip")) return;
  document.querySelectorAll("#subject-chips .chip").forEach((c) => c.classList.remove("selected"));
  e.target.classList.add("selected");
  startForm.subject.value = e.target.textContent;
});

startForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#start-error").hidden = true;
  const { code, ...profile } = Object.fromEntries(new FormData(e.target));
  accessCode = code.trim();
  try {
    const res = await api("/api/session", profile);
    const data = await res.json();
    if (!res.ok) return showStartError(data.error || "Couldn't start. Try again.");
    store.set("sageCode", accessCode);
    sessionId = data.sessionId;
    store.set("sageSession", sessionId);
    showRemaining(data.remaining);
    openChat();
    send(`Hi! I'm working on ${profile.subject}. ${profile.goal}`);
  } catch {
    showStartError("Couldn't reach Sage. Check your internet and try again.");
  }
});

$("#new-session").addEventListener("click", () => {
  store.remove("sageSession");
  location.reload();
});

function openChat() {
  $("#start").hidden = true;
  $("#app").hidden = false;
  $("#input").focus();
}

// ---- Chat ----
async function send(text) {
  if (busy || !text.trim()) return;
  busy = true;
  $("#send").disabled = true;
  addMessage("student", text);

  const bubble = addMessage("tutor", "");
  bubble.classList.add("typing");
  let reply = "";

  try {
    const res = await api("/api/chat", { sessionId, message: text });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      throw new Error(error || `Request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split("\n");
      buffered = lines.pop();
      for (const line of lines) {
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === "text") {
          reply += event.text;
          bubble.classList.remove("typing");
          bubble.innerHTML = render(reply);
          bubble.scrollIntoView({ block: "end" });
        } else if (event.type === "progress") {
          showProgress(event.progress);
        } else if (event.type === "done") {
          showRemaining(event.remaining);
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }
    }
    if (!reply) bubble.remove();
  } catch (err) {
    if (!reply) bubble.remove();
    addMessage("error", err.message);
  } finally {
    busy = false;
    $("#send").disabled = false;
    $("#input").focus();
  }
}

$("#chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("#input").value;
  $("#input").value = "";
  $("#input").style.height = "";
  send(text);
});

$("#input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#chat-form").requestSubmit();
  }
});

$("#input").addEventListener("input", (e) => {
  e.target.style.height = "";
  e.target.style.height = `${e.target.scrollHeight}px`;
});

document.querySelector(".quick").addEventListener("click", (e) => {
  if (e.target.dataset.say) send(e.target.dataset.say);
});

// Resume an existing session if the server still has it.
(async () => {
  if (!sessionId || !accessCode) return;
  const res = await api(`/api/session/${sessionId}`).catch(() => null);
  if (!res?.ok) {
    store.remove("sageSession");
    return;
  }
  const { progress, transcript, remaining } = await res.json();
  openChat();
  showProgress(progress);
  showRemaining(remaining);
  for (const m of transcript) addMessage(m.role, m.text);
})();
