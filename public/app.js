import { createLearner, summary } from "./js/learner.js";
import { tutorTurn } from "./js/tutor.js";
import { MODEL_SIZES, checkDevice, isDownloaded, loadEngine, removeDownloads, storageUsed } from "./js/engine.js";

const $ = (sel) => document.querySelector(sel);
const LEVEL_NAMES = ["new", "learning", "getting it", "mastered"];
const LEVEL_WIDTH = [4, 35, 70, 100];
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

let session = store.get("sageSession"); // { learner, messages }
let device = null; // result of checkDevice()
let llm = null;
let llmSize = null;
let loadingEngine = null;
let busy = false;
let controller = null;

function save() {
  if (!session) return;
  store.set("sageSession", { learner: session.learner, messages: session.messages.slice(-SAVED_MESSAGES) });
}

// ---- Rendering ----

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
  $("#topic").textContent = progress.topic || "Your plan";
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

// ---- Storage ----

// Whether to keep the AI stored on this device between visits. Off by default
// so Sage doesn't take up students' storage.
const keepAI = () => store.get("sageKeep") === true;

function formatBytes(bytes) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

async function anythingStored() {
  if (!device?.ok) return false;
  for (const size of Object.keys(MODEL_SIZES)) if (await isDownloaded(size, device.fast)) return true;
  return false;
}

// Shows or hides the "taking up X GB / Remove it" messages.
async function refreshStorage() {
  const stored = await anythingStored();
  const used = stored ? await storageUsed() : null;
  const amount = used ? formatBytes(used) : "some space";
  document.querySelectorAll(".storage-amount").forEach((el) => (el.textContent = amount));
  $("#storage-start").hidden = !stored;
  $("#storage-sidebar").hidden = !stored;
  if (!stored) $("#finished").hidden = true;
  return stored;
}

document.addEventListener("click", async (e) => {
  if (!e.target.closest(".remove-ai")) return;
  await removeDownloads();
  store.set("sageKeep", false);
  startForm.keep.checked = false;
  await refreshStorage();
  await renderSizes();
  $("#finished").hidden = true;
  if (!$("#app").hidden) addMessage("tutor", "Done! Sage's AI has been removed from this device. You can keep chatting until you close this tab. Next time, it will download again.");
});

function setSendEnabled(enabled) {
  $("#send").disabled = !enabled;
  document.querySelectorAll(".quick .chip").forEach((b) => (b.disabled = !enabled));
}

// ---- Loading the AI ----

function selectedSize() {
  return document.querySelector("input[name=size]:checked")?.value || device?.suggested || "standard";
}

async function renderSizes() {
  const saved = store.get("sageSize");
  const current = MODEL_SIZES[saved] ? saved : device?.suggested || "standard";
  const rows = await Promise.all(
    Object.entries(MODEL_SIZES).map(async ([key, size]) => {
      const downloaded = device?.ok && (await isDownloaded(key, device.fast));
      const label = document.createElement("label");
      label.className = "size";
      label.innerHTML = `<input type="radio" name="size"><span><b></b> <span class="muted"></span></span>`;
      label.querySelector("input").value = key;
      label.querySelector("input").checked = key === current;
      label.querySelector("b").textContent = size.label + (key === device?.suggested ? " (suggested)" : "");
      label.querySelector(".muted").textContent = downloaded ? "already downloaded" : size.detail;
      return label;
    }),
  );
  $("#sizes").replaceChildren(...rows);
}

// Loads (or reuses) the model, reporting progress to the given bar and text.
async function ensureEngine(size, bar, text) {
  if (llm && llmSize === size) return llm;
  if (loadingEngine) return loadingEngine;
  const cached = await isDownloaded(size, device.fast);
  const verb = cached ? "Loading Sage from your device" : "Downloading Sage's brain";
  $("#loading-hint").textContent = cached
    ? "Almost ready…"
    : keepAI()
      ? "This takes a few minutes the first time. Keep this tab open. After that it loads in seconds."
      : "This takes a few minutes. Keep this tab open. Sage deletes the download from your device as soon as it's loaded.";
  text.textContent = `${verb}…`;
  bar.style.width = "2%";
  loadingEngine = loadEngine(size, device.fast, ({ progress }) => {
    const percent = Math.round(progress * 100);
    bar.style.width = `${Math.max(2, percent)}%`;
    text.textContent = `${verb}… ${percent}%`;
  })
    .then(async (engine) => {
      llm = engine;
      llmSize = size;
      store.set("sageSize", size);
      // The model is in memory now, so the stored copy is only needed for next time.
      await (keepAI() ? removeDownloads({ keep: size, fast: device.fast }) : removeDownloads());
      refreshStorage();
      return engine;
    })
    .finally(() => (loadingEngine = null));
  return loadingEngine;
}

function friendlyError(err) {
  const message = String(err?.message || err);
  if (/out of memory|device.*lost|allocat/i.test(message)) {
    return "Your device ran out of memory for this AI size. Reload the page, click \"New topic\" and choose a smaller size.";
  }
  if (/fetch|network|Failed to load/i.test(message)) {
    return "Couldn't download the AI. Check your internet connection. Some school networks block the download; try another network.";
  }
  return `Something went wrong: ${message}`;
}

// ---- Start screen ----

const startForm = $("#start-form");

$("#subject-chips").addEventListener("click", (e) => {
  if (!e.target.matches(".chip")) return;
  document.querySelectorAll("#subject-chips .chip").forEach((c) => c.classList.remove("selected"));
  e.target.classList.add("selected");
  startForm.subject.value = e.target.textContent;
});

startForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#start-error").hidden = true;
  const { size, keep, ...profile } = Object.fromEntries(new FormData(startForm));
  store.set("sageKeep", Boolean(keep));
  startForm.hidden = true;
  $("#loading").hidden = false;
  try {
    await ensureEngine(size, $("#loading-bar"), $("#loading-text"));
  } catch (err) {
    console.error(err);
    $("#loading").hidden = true;
    startForm.hidden = false;
    $("#start-error").textContent = friendlyError(err);
    $("#start-error").hidden = false;
    return;
  }
  session = { learner: createLearner(profile), messages: [] };
  save();
  $("#loading").hidden = true;
  openChat();
  send(`Hi! I'm working on ${profile.subject}. ${profile.goal}`);
});

$("#new-session").addEventListener("click", () => {
  controller?.abort();
  store.remove("sageSession");
  session = null;
  $("#messages").replaceChildren();
  showProgress({ topic: "", concepts: [] });
  startForm.reset();
  startForm.keep.checked = keepAI();
  startForm.hidden = false;
  $("#finished").hidden = true;
  $("#app").hidden = true;
  $("#start").hidden = false;
  renderSizes();
  refreshStorage();
});

function openChat() {
  $("#start").hidden = true;
  $("#app").hidden = false;
  setSendEnabled(Boolean(llm));
  $("#input").focus();
}

// ---- Chat ----

async function send(text) {
  if (busy || !llm || !text.trim()) return;
  busy = true;
  controller = new AbortController();
  setSendEnabled(false);
  addMessage("student", text);

  const bubble = addMessage("tutor", "");
  bubble.classList.add("typing");
  let reply = "";
  const emit = (event) => {
    if (event.type === "text") {
      reply += event.text;
      bubble.classList.remove("typing");
      bubble.innerHTML = render(reply);
      bubble.scrollIntoView({ block: "end" });
    } else if (event.type === "reset") {
      reply = "";
      bubble.innerHTML = "";
      bubble.classList.add("typing");
    } else if (event.type === "progress") {
      showProgress(event.progress);
      const done = event.progress.concepts.length > 0 && event.progress.concepts.every((c) => c.level === 3);
      if (done) refreshStorage().then((stored) => ($("#finished").hidden = !stored));
    }
  };

  const current = session;
  try {
    await tutorTurn(llm, current, text.trim().slice(0, 4000), emit, { signal: controller.signal });
    save();
  } catch (err) {
    bubble.remove();
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
  if (e.target.dataset.say) send(e.target.dataset.say);
});

// ---- Startup ----

(async () => {
  device = await checkDevice().catch(() => ({ ok: false }));
  if (!device.ok) {
    $("#unsupported").hidden = false;
    $("#start-button").disabled = true;
  }
  startForm.keep.checked = keepAI();
  // Clean up anything left behind, e.g. a download interrupted by closing the tab.
  if (device.ok && !keepAI()) await removeDownloads();
  await renderSizes();
  await refreshStorage();
  if (!device.ok || !session?.learner) return;

  // Pick up where the student left off.
  openChat();
  showProgress(summary(session.learner));
  for (const m of session.messages) addMessage(m.role === "user" ? "student" : "tutor", m.content);
  $("#chat-loading").hidden = false;
  try {
    await ensureEngine(store.get("sageSize") || device.suggested, $("#chat-loading-bar"), $("#chat-loading-text"));
    setSendEnabled(true);
    if (session.messages.length === 0) addMessage("tutor", "Welcome back! What would you like to work on?");
  } catch (err) {
    console.error(err);
    addMessage("error", friendlyError(err));
  } finally {
    $("#chat-loading").hidden = true;
  }
})();
