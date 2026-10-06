const $ = (sel) => document.querySelector(sel);
const LEVEL_NAMES = ["new", "learning", "getting it", "mastered"];
const LEVEL_WIDTH = [4, 35, 70, 100];

let sessionId = localStorage.getItem("sageSession");
let busy = false;

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

function showProgress(progress) {
  if (progress.topic) $("#topic").textContent = progress.topic;
  $("#plan-empty").hidden = progress.concepts.length > 0;
  $("#concepts").replaceChildren(
    ...progress.concepts.map((c) => {
      const li = document.createElement("li");
      li.className = "concept";
      li.innerHTML = `
        <div class="concept-name"><span></span><span class="concept-level">${LEVEL_NAMES[c.level]}</span></div>
        <div class="bar"><span class="l${c.level}" style="width:${LEVEL_WIDTH[c.level]}%"></span></div>`;
      li.querySelector(".concept-name span").textContent = c.name;
      return li;
    }),
  );
}

// ---- Start screen ----
$("#subject-chips").addEventListener("click", (e) => {
  if (!e.target.matches(".chip")) return;
  document.querySelectorAll("#subject-chips .chip").forEach((c) => c.classList.remove("selected"));
  e.target.classList.add("selected");
  $("#start-form").subject.value = e.target.textContent;
});

$("#start-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = Object.fromEntries(new FormData(e.target));
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(form),
  });
  sessionId = (await res.json()).sessionId;
  localStorage.setItem("sageSession", sessionId);
  openChat();
  send(`Hi! I'm working on ${form.subject}. ${form.goal}`);
});

$("#new-session").addEventListener("click", () => {
  localStorage.removeItem("sageSession");
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
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message: text }),
    });
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
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }
    }
    if (!reply) bubble.remove();
  } catch (err) {
    if (!reply) bubble.remove();
    addMessage("error", err.message).className = "msg error";
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
  if (!sessionId) return;
  const res = await fetch(`/api/session/${sessionId}`);
  if (!res.ok) {
    localStorage.removeItem("sageSession");
    return;
  }
  const { progress, transcript } = await res.json();
  openChat();
  showProgress(progress);
  for (const m of transcript) addMessage(m.role, m.text);
})();
