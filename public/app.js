import { createLearner, summary } from "./js/learner.js";
import { tutorTurn } from "./js/tutor.js";
import { DOWNLOAD_SIZE, checkDevice, isDownloaded, loadEngine, removeDownloads, storageUsed } from "./js/engine.js";
import { IDLE_DAYS, idleTooLong, pathwayComplete } from "./js/housekeeping.js";

const $ = (sel) => document.querySelector(sel);
const LEVEL_NAMES = ["not started", "learning", "getting it", "mastered"];
const SAVED_MESSAGES = 80;

// Progress is saved in this browser only. localStorage can throw in private
// windows; Sage still works there, it just won't remember the session.
const store = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

let session = store.get("sageSession"); // { learner, messages, celebrated }
let device = null; // result of checkDevice()
let llm = null;
let loadingEngine = null;
let busy = false;
let controller = null;
let knownLevels = new Map(); // concept id -> level, to notice new masteries

function save() {
  if (!session) return;
  store.set("sageSession", { ...session, messages: session.messages.slice(-SAVED_MESSAGES) });
}

function markUsed() {
  store.set("sageLastUsed", Date.now());
}

// ---- Theme ----

function currentTheme() {
  return document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

// The buttons say what they switch to: "Dark" in light mode, "Light" in dark mode.
function syncThemeButtons() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.querySelectorAll(".theme-toggle").forEach((button) => {
    button.querySelector(".theme-label").textContent = next === "dark" ? "Dark" : "Light";
    button.setAttribute("aria-label", `Switch to ${next} mode`);
  });
}

document.querySelectorAll(".theme-toggle").forEach((button) =>
  button.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("sageTheme", next);
    } catch {}
    syncThemeButtons();
  }),
);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeButtons);
syncThemeButtons();

// ---- Rendering ----

function render(markdown) {
  return DOMPurify.sanitize(marked.parse(markdown));
}

function scrollToEnd(el) {
  el.scrollIntoView({ block: "end", behavior: "smooth" });
}

// Tutor messages get Sage's avatar; returns the bubble to fill in.
function addMessage(role, text, { html = false } = {}) {
  const el = document.createElement("div");
  el.className = `msg ${role === "student" ? "student" : "tutor"}${role === "error" ? " error" : ""}`;
  if (role === "student") {
    el.textContent = text;
    $("#messages").append(el);
    scrollToEnd(el);
    return el;
  }
  el.innerHTML = `<div class="avatar"><svg><use href="#i-leaf"/></svg></div><div class="bubble"></div>`;
  const bubble = el.querySelector(".bubble");
  if (html) bubble.innerHTML = text;
  else if (role === "tutor") bubble.innerHTML = render(text);
  else bubble.textContent = text;
  $("#messages").append(el);
  scrollToEnd(el);
  return bubble;
}

let toastTimer;
function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.hidden = false;
  el.style.animation = "none";
  void el.offsetWidth; // restart the animation
  el.style.animation = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

function showProgress(progress, { celebrate = false } = {}) {
  $("#topic").textContent = progress.topic || "Getting to know you";
  const total = progress.concepts.length;
  const mastered = progress.concepts.filter((c) => c.level === 3).length;
  $("#plan-empty").hidden = total > 0;
  $("#path-summary").hidden = total === 0;
  $("#path-bar").style.width = `${total ? Math.max(4, (mastered / total) * 100) : 0}%`;
  $("#path-count").textContent = mastered === total && total > 0 ? "Pathway complete! 🎉" : `${mastered} of ${total} mastered`;

  const current = progress.concepts.findIndex((c) => c.level < 3);
  $("#concepts").replaceChildren(
    ...progress.concepts.map((c, i) => {
      const li = document.createElement("li");
      li.className = `step lvl${c.level}${c.level === 3 ? " done" : ""}${i === current ? " current" : ""}`;
      li.innerHTML = `<div class="step-dot"></div><div><div class="step-name"></div><span class="pill"></span></div>`;
      li.querySelector(".step-dot").innerHTML = c.level === 3 ? `<svg><use href="#i-check"/></svg>` : String(i + 1);
      li.querySelector(".step-name").textContent = c.name;
      li.querySelector(".pill").textContent = i === current && c.level === 0 ? "up next" : LEVEL_NAMES[c.level];
      return li;
    }),
  );

  // A little celebration when a concept becomes mastered.
  for (const c of progress.concepts) {
    if (celebrate && c.level === 3 && knownLevels.get(c.id) !== 3 && !pathwayComplete(progress)) toast(`🌱 You mastered "${c.name}"! Nice work.`);
  }
  knownLevels = new Map(progress.concepts.map((c) => [c.id, c.level]));
}

function setSendEnabled(enabled) {
  $("#send").disabled = !enabled;
  document.querySelectorAll(".quick .chip").forEach((b) => (b.disabled = !enabled));
}

// ---- Storage ----

function formatBytes(bytes) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

async function anythingStored() {
  if (!device?.ok) return false;
  return isDownloaded(device.fast);
}

// Shows or hides the "using X GB / free up space" messages.
async function refreshStorage() {
  const stored = await anythingStored();
  const used = stored ? await storageUsed() : null;
  const amount = used ? formatBytes(used) : null;
  document.querySelectorAll(".storage-amount").forEach((el) => (el.textContent = amount || "some space"));
  $("#storage-start").hidden = !stored;
  $("#storage-sidebar").hidden = !stored;
  return { stored, amount };
}

// Deletes the chat and the stored AI, then returns to the start screen.
async function clearEverything(message) {
  controller?.abort();
  await removeDownloads();
  store.remove("sageSession");
  session = null;
  showStart(message);
}

document.addEventListener("click", async (e) => {
  if (!e.target.closest(".remove-ai")) return;
  await removeDownloads();
  await refreshStorage();
  if (!$("#app").hidden) {
    addMessage("tutor", "All done, the AI has been removed from this device and the space is free again. We can keep going until you close this tab. Next time, Sage will download it again.");
  }
});

// ---- Loading the AI ----

// Loads (or reuses) the model, reporting progress to the given bar and text.
async function ensureEngine(bar, text) {
  if (llm) return llm;
  if (loadingEngine) return loadingEngine;
  const cached = await isDownloaded(device.fast);
  const verb = cached ? "Waking Sage up" : "Downloading Sage's brain";
  $("#loading-hint").textContent = cached
    ? "Almost ready…"
    : `The first time, Sage downloads its AI (${DOWNLOAD_SIZE}), which takes a few minutes, so keep this tab open. After that, it stays ready on your device, even after you close the tab.`;
  text.textContent = `${verb}…`;
  bar.style.width = "2%";
  loadingEngine = loadEngine(device.fast, ({ progress }) => {
    const percent = Math.round(progress * 100);
    bar.style.width = `${Math.max(2, percent)}%`;
    text.textContent = `${verb}… ${percent}%`;
  })
    .then(async (engine) => {
      llm = engine;
      await removeDownloads({ keepCurrent: true, fast: device.fast }); // drop older models
      refreshStorage();
      return engine;
    })
    .finally(() => (loadingEngine = null));
  return loadingEngine;
}

function friendlyError(err) {
  const message = String(err?.message || err);
  if (/out of memory|device.*lost|allocat/i.test(message)) {
    return "This device ran out of memory while running Sage's AI. Try closing other tabs and apps, then reload the page.";
  }
  if (/fetch|network|Failed to load/i.test(message)) {
    return "Sage couldn't download its AI. Check your internet connection. Some school networks block the download, so you might need to try at home.";
  }
  return `Something went wrong on Sage's side, not yours: ${message}`;
}

// ---- Start screen ----

const startForm = $("#start-form");

function showStart(notice) {
  $("#messages").replaceChildren();
  showProgress({ topic: "", concepts: [] });
  startForm.reset();
  document.querySelectorAll("#subject-chips .chip").forEach((c) => c.classList.remove("selected"));
  startForm.hidden = false;
  $("#loading").hidden = true;
  $("#tidy-notice").hidden = !notice;
  $("#tidy-notice").textContent = notice || "";
  $("#app").hidden = true;
  $("#start").hidden = false;
  refreshStorage();
}

$("#subject-chips").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  document.querySelectorAll("#subject-chips .chip").forEach((c) => c.classList.remove("selected"));
  chip.classList.add("selected");
  startForm.subject.value = chip.dataset.subject;
});

startForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#start-error").hidden = true;
  $("#tidy-notice").hidden = true;
  const profile = Object.fromEntries(new FormData(startForm));
  startForm.hidden = true;
  $("#loading").hidden = false;
  try {
    await ensureEngine($("#loading-bar"), $("#loading-text"));
  } catch (err) {
    console.error(err);
    $("#loading").hidden = true;
    startForm.hidden = false;
    $("#start-error").textContent = friendlyError(err);
    $("#start-error").hidden = false;
    return;
  }
  session = { learner: createLearner(profile), messages: [], celebrated: false };
  knownLevels = new Map();
  save();
  markUsed();
  $("#loading").hidden = true;
  openChat();
  send(`Hi! I'm working on ${profile.subject}. ${profile.goal}`);
});

$("#new-session").addEventListener("click", () => {
  controller?.abort();
  store.remove("sageSession");
  session = null;
  showStart();
});

function openChat() {
  $("#start").hidden = true;
  $("#app").hidden = false;
  setSendEnabled(Boolean(llm));
  $("#input").focus();
}

// ---- Pathway complete ----

async function offerCleanup() {
  if (!session || session.celebrated) return;
  session.celebrated = true;
  save();
  $("#toast").hidden = true;
  const { amount } = await refreshStorage();
  const name = session.learner.profile.name;
  const bubble = addMessage(
    "tutor",
    `<h3>You did it${name ? `, ${escapeHtml(name)}` : ""}! 🎉</h3>
     <p>You worked through every step of <b>${escapeHtml(session.learner.topic)}</b>. That took real effort, and you should be proud of how far you've come.</p>
     <p>Would you like to close out this chat? Sage will delete it and free up the space it's using on your device${amount ? ` (about ${amount})` : ""}. You can always come back and start something new.</p>
     <div class="actions">
       <button type="button" class="primary" data-cleanup="yes">Yes, clear it and free up space</button>
       <button type="button" class="ghost" data-cleanup="no">Keep going for now</button>
     </div>`,
    { html: true },
  );
  bubble.parentElement.classList.add("celebrate");
  bubble.addEventListener("click", async (e) => {
    const choice = e.target.closest("[data-cleanup]")?.dataset.cleanup;
    if (choice === "yes") {
      await clearEverything("All cleaned up! Your chat is deleted and the space is free again. Come back anytime you're stuck. 🌱");
    } else if (choice === "no") {
      bubble.querySelector(".actions").remove();
      addMessage("tutor", "Sounds good! We can keep practicing or explore something related. You can free up the space anytime from the sidebar.");
    }
  });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ---- Chat ----

async function send(text) {
  if (busy || !llm || !text.trim()) return;
  busy = true;
  controller = new AbortController();
  setSendEnabled(false);
  markUsed();
  addMessage("student", text);

  const current = session;
  const bubble = addMessage("tutor", "");
  const row = bubble.parentElement;
  row.classList.add("typing");
  let reply = "";
  const emit = (event) => {
    if (event.type === "text") {
      reply += event.text;
      row.classList.remove("typing");
      bubble.innerHTML = render(reply);
      scrollToEnd(row);
    } else if (event.type === "reset") {
      reply = "";
      bubble.innerHTML = "";
      row.classList.add("typing");
    } else if (event.type === "progress") {
      showProgress(event.progress, { celebrate: true });
      if (!pathwayComplete(event.progress)) current.celebrated = false; // a new plan can be celebrated again
    }
  };

  try {
    await tutorTurn(llm, current, text.trim().slice(0, 4000), emit, { signal: controller.signal });
    save();
    if (session === current && pathwayComplete(summary(current.learner))) offerCleanup();
  } catch (err) {
    row.remove();
    if (err.name !== "AbortError") {
      console.error(err);
      addMessage("error", friendlyError(err));
    }
  } finally {
    busy = false;
    setSendEnabled(true);
    if (session === current) $("#input").focus();
  }
}

$("#chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("#input").value;
  if (!text.trim() || busy || !llm) return;
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
  const chip = e.target.closest("[data-say]");
  if (chip) send(chip.dataset.say);
});

// ---- Startup ----

(async () => {
  device = await checkDevice().catch(() => ({ ok: false }));
  if (!device.ok) {
    $("#unsupported").hidden = false;
    $("#start-button").disabled = true;
  }

  // Not used for a while? Give the space back.
  if (idleTooLong(store.get("sageLastUsed"))) {
    await removeDownloads();
    store.remove("sageSession");
    session = null;
    $("#tidy-notice").textContent = `Welcome back! 👋 It's been more than ${IDLE_DAYS} days, so Sage tidied up to give your storage back: your old chat and the downloaded AI were cleared. Let's start fresh whenever you're ready.`;
    $("#tidy-notice").hidden = false;
  }
  markUsed();

  await refreshStorage();
  if (!device.ok || !session?.learner) return;

  // Pick up where the student left off.
  openChat();
  showProgress(summary(session.learner));
  for (const m of session.messages) addMessage(m.role === "user" ? "student" : "tutor", m.content);
  $("#chat-loading").hidden = false;
  try {
    await ensureEngine($("#chat-loading-bar"), $("#chat-loading-text"));
    setSendEnabled(true);
    addMessage("tutor", session.messages.length ? "Welcome back! 😊 Ready to pick up where we left off? Tell me what you remember, or ask me anything." : "Welcome back! What would you like to work on?");
  } catch (err) {
    console.error(err);
    addMessage("error", friendlyError(err));
  } finally {
    $("#chat-loading").hidden = true;
  }
})();
