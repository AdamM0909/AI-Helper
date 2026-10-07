import { createLearner, summary, dueForReview } from "./js/learner.js";
import { tutorTurn } from "./js/tutor.js";
import { DOWNLOAD_SIZE, checkDevice, isDownloaded, loadEngine, removeDownloads, storageUsed } from "./js/engine.js";
import { IDLE_DAYS, idleTooLong, pathwayComplete } from "./js/housekeeping.js";
import { parseQuiz } from "./js/quiz.js";
import { createTopics } from "./js/topics.js";
import { questionCard, practiceCard, practiceResults, recapCard } from "./js/cards.js";
import { buildPracticeTest, scoreTest, resultNote } from "./js/practice.js";
import { buildRecap } from "./js/recap.js";
import { readPhoto } from "./js/ocr.js";
import { canListen, canSpeak, listen, looksForeign, speak, speechLangFor, stopSpeaking, textForSpeech } from "./js/speech.js";
import { FEEDBACK_URL } from "./js/config.js";

const $ = (sel) => document.querySelector(sel);
const LEVEL_NAMES = ["not started", "learning", "getting it", "mastered"];

// Saved in this browser only. localStorage can throw in private windows;
// Sage still works there, it just won't remember anything.
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

const topics = createTopics(store);
let session = null; // the active topic: { id, learner, messages, celebrated }
let device = null; // result of checkDevice()
let llm = null;
let loadingEngine = null;
let busy = false;
let controller = null;
let knownLevels = new Map(); // concept id -> level, to notice new masteries
let pendingStart = null; // form data waiting for the download go-ahead

function save() {
  if (session) topics.save(session);
}

function markUsed() {
  store.set("sageLastUsed", Date.now());
}

function announce(text) {
  $("#sr-status").textContent = "";
  setTimeout(() => ($("#sr-status").textContent = text), 50);
}

document.querySelectorAll(".feedback-link").forEach((a) => (a.href = FEEDBACK_URL));

// ---- Theme and text size ----

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

const TEXT_SIZES = ["1", "1.15", "1.3"];
function syncTextSize() {
  const size = getComputedStyle(document.documentElement).getPropertyValue("--text-scale").trim() || "1";
  const next = TEXT_SIZES[(TEXT_SIZES.indexOf(size) + 1) % TEXT_SIZES.length];
  document.querySelectorAll(".text-size").forEach((b) => {
    b.setAttribute("aria-label", next === "1" ? "Make text normal size" : "Make text bigger");
    b.querySelector("span").textContent = next === "1" ? "−" : "+";
  });
}
document.querySelectorAll(".text-size").forEach((button) =>
  button.addEventListener("click", () => {
    const size = getComputedStyle(document.documentElement).getPropertyValue("--text-scale").trim() || "1";
    const next = TEXT_SIZES[(TEXT_SIZES.indexOf(size) + 1) % TEXT_SIZES.length];
    document.documentElement.style.setProperty("--text-scale", next);
    try {
      localStorage.setItem("sageTextSize", next);
    } catch {}
    syncTextSize();
  }),
);
syncTextSize();

// ---- Rendering messages ----

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
  el.innerHTML = `<div class="avatar"><svg width="19" height="19" aria-hidden="true"><use href="#i-leaf"/></svg></div><div class="bubble"></div>`;
  const bubble = el.querySelector(".bubble");
  if (html) bubble.innerHTML = text;
  else if (role === "tutor") fillTutor(bubble, text, { done: true });
  else bubble.textContent = text;
  $("#messages").append(el);
  scrollToEnd(el);
  return bubble;
}

let activeQuestion = null; // only the newest question can be answered

// Shows a tutor reply. Once it's finished arriving, an interactive question
// block becomes a card, and read-aloud controls are added.
function fillTutor(bubble, text, { done = false, interactive = false } = {}) {
  const { text: body, quiz } = parseQuiz(text);
  bubble.innerHTML = render(body);
  if (!done) return;
  addPronunciation(bubble);
  if (quiz) {
    const card = questionCard(quiz, {
      interactive,
      canAnswer: () => !busy && Boolean(llm),
      onAnswer: (answer, displayText) => send(displayText, { answer }),
      announce,
    });
    bubble.append(card);
    if (interactive) {
      activeQuestion?.querySelectorAll("button, input, select").forEach((c) => (c.disabled = true));
      activeQuestion = card;
    }
  }
  addListenButton(bubble, text);
}

// ---- Read aloud ----

function addListenButton(bubble, text) {
  if (!canSpeak) return;
  const words = textForSpeech(parseQuiz(text).text);
  if (!words) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "listen";
  button.innerHTML = `<svg width="15" height="15" aria-hidden="true"><use href="#i-speaker"/></svg><span>Listen</span>`;
  button.setAttribute("aria-label", "Read this message aloud");
  button.addEventListener("click", () => {
    if (button.classList.contains("playing")) {
      stopSpeaking();
      return;
    }
    document.querySelectorAll(".listen.playing").forEach((b) => b.classList.remove("playing"));
    button.classList.add("playing");
    button.querySelector("span").textContent = "Stop";
    speak(words, {
      onEnd: () => {
        button.classList.remove("playing");
        button.querySelector("span").textContent = "Listen";
      },
    });
  });
  bubble.append(button);
}

// In language subjects, bold and italic French or Spanish phrases (and table
// cells) can be tapped to hear them pronounced in that language.
function addPronunciation(bubble) {
  const lang = canSpeak && session ? speechLangFor(session.learner.profile.subject) : null;
  if (!lang) return;
  bubble.querySelectorAll("strong, em, td").forEach((node) => {
    if (node.closest(".quiz") || !looksForeign(node.textContent, lang)) return;
    node.classList.add("say");
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.title = `Hear it in ${lang.startsWith("fr") ? "French" : "Spanish"}`;
    const play = () => speak(node.textContent, { lang, rate: 0.85 });
    node.addEventListener("click", play);
    node.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), play()));
  });
}

// ---- Celebrations ----

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

// ---- Sidebar: pathway, tools and topics ----

function showProgress(progress, { celebrate = false } = {}) {
  $("#topic").textContent = progress.topic || "Getting to know you";
  const total = progress.concepts.length;
  const mastered = progress.concepts.filter((c) => c.level === 3).length;
  $("#plan-empty").hidden = total > 0;
  $("#path-summary").hidden = total === 0;
  $("#tools").hidden = total === 0;
  $("#path-bar").style.width = `${total ? Math.max(4, (mastered / total) * 100) : 0}%`;
  $("#path-count").textContent = mastered === total && total > 0 ? "Pathway complete! 🎉" : `${mastered} of ${total} mastered`;
  $("#sidebar-summary-text").textContent = total ? `${progress.topic || "Your pathway"} · ${$("#path-count").textContent}` : "Your pathway";

  const current = progress.concepts.findIndex((c) => c.level < 3);
  $("#concepts").replaceChildren(
    ...progress.concepts.map((c, i) => {
      const li = document.createElement("li");
      li.className = `step lvl${c.level}${c.level === 3 ? " done" : ""}${i === current ? " current" : ""}`;
      li.innerHTML = `<div class="step-dot"></div><div><div class="step-name"></div><span class="pill"></span></div>`;
      li.querySelector(".step-dot").innerHTML = c.level === 3 ? `<svg width="16" height="16" aria-hidden="true"><use href="#i-check"/></svg>` : String(i + 1);
      li.querySelector(".step-name").textContent = c.name;
      li.querySelector(".pill").textContent = c.due ? "review ready" : i === current && c.level === 0 ? "up next" : LEVEL_NAMES[c.level];
      if (c.due) li.classList.add("due");
      return li;
    }),
  );

  for (const c of progress.concepts) {
    if (celebrate && c.level === 3 && knownLevels.get(c.id) !== 3 && !pathwayComplete(progress)) {
      toast(`🌱 You mastered "${c.name}"! Nice work.`);
      announce(`You mastered ${c.name}.`);
    }
  }
  knownLevels = new Map(progress.concepts.map((c) => [c.id, c.level]));
  updateReviewButton();
}

function updateReviewButton() {
  const due = session ? dueForReview(session.learner) : [];
  $("#review-btn").hidden = due.length === 0;
  $("#review-btn span").textContent = `Warm-up review (${due.length})`;
}

function topicName(topic) {
  return topic.learner.topic || topic.learner.profile.subject || "New topic";
}

// Builds a list of topic buttons. Used in the sidebar and on the start screen.
function renderTopicList(container, { compact }) {
  const list = topics.list();
  container.replaceChildren(
    ...list.map((topic) => {
      const row = document.createElement("div");
      row.className = `topic-row${session?.id === topic.id ? " active" : ""}`;
      const open = document.createElement("button");
      open.type = "button";
      open.className = "topic-open";
      const mastered = topic.learner.concepts.filter((c) => c.level === 3).length;
      const due = dueForReview(topic.learner).length;
      open.innerHTML = `<span class="topic-name"></span><span class="topic-meta"></span>`;
      open.querySelector(".topic-name").textContent = topicName(topic);
      open.querySelector(".topic-meta").textContent = [
        topic.learner.concepts.length ? `${mastered}/${topic.learner.concepts.length} mastered` : "just started",
        due ? `🔁 ${due} to review` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      open.addEventListener("click", () => openTopic(topic.id));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "topic-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Delete ${topicName(topic)}`);
      remove.addEventListener("click", () => deleteTopic(topic));
      row.append(open, remove);
      return row;
    }),
  );
  if (compact) $("#topics-box").hidden = list.length < 2;
  return list.length;
}

function renderTopics() {
  renderTopicList($("#topic-list"), { compact: true });
  const count = renderTopicList($("#resume-list"), { compact: false });
  $("#resume").hidden = count === 0;
}

async function deleteTopic(topic) {
  if (!confirm(`Delete "${topicName(topic)}" and its chat? This can't be undone.`)) return;
  if (session?.id === topic.id) controller?.abort();
  topics.remove(topic.id);
  if (topics.list().length === 0) await removeDownloads(); // nothing left to study: free the space
  if (session?.id === topic.id) {
    session = null;
    showStart();
  } else renderTopics();
}

function setSendEnabled(enabled) {
  $("#send").disabled = !enabled;
  document.querySelectorAll(".quick .chip, .tool").forEach((b) => (b.disabled = !enabled));
}

// On phones the sidebar folds into one line; tap to open it.
$("#sidebar-summary").addEventListener("click", () => {
  const open = $(".sidebar").classList.toggle("open");
  $("#sidebar-summary").setAttribute("aria-expanded", String(open));
});

// ---- Storage ----

function formatBytes(bytes) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

async function anythingStored() {
  return device?.ok ? isDownloaded(device.fast) : false;
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

document.addEventListener("click", async (e) => {
  if (!e.target.closest(".remove-ai")) return;
  await removeDownloads();
  await refreshStorage();
  if (!$("#app").hidden) {
    addMessage("tutor", "All done, the AI has been removed from this device and the space is free again. We can keep going until you close this tab. Next time, Sage will download it again.");
  }
});

// ---- Loading the AI ----

// "1.2 of about 5 GB · about 8 min left", from WebLLM's progress text.
function downloadDetail(text, progress) {
  const mb = Number(text.match(/(\d+)\s*MB fetched/)?.[1]);
  const secs = Number(text.match(/(\d+)\s*secs? elapsed/)?.[1]);
  const parts = [];
  if (mb) parts.push(`${(mb / 1000).toFixed(1)} of ${DOWNLOAD_SIZE}`);
  if (secs && progress > 0.03 && progress < 1) {
    const left = Math.round((secs * (1 - progress)) / progress / 60);
    parts.push(left <= 1 ? "about a minute left" : `about ${left} min left`);
  }
  return parts.join(" · ");
}

// Loads (or reuses) the model, reporting progress to the given bar and text.
async function ensureEngine(bar, text) {
  if (llm) return llm;
  if (loadingEngine) return loadingEngine;
  const cached = await isDownloaded(device.fast);
  const verb = cached ? "Waking Sage up" : "Downloading Sage's brain";
  $("#loading-hint").textContent = cached ? "Almost ready…" : "Keep this tab open. You can come back to it while it downloads.";
  text.textContent = `${verb}…`;
  bar.style.width = "2%";
  loadingEngine = loadEngine(device.fast, ({ progress, text: detail }) => {
    const percent = Math.round(progress * 100);
    bar.style.width = `${Math.max(2, percent)}%`;
    const extra = cached ? "" : downloadDetail(detail || "", progress);
    text.textContent = `${verb}… ${percent}%${extra ? ` (${extra})` : ""}`;
  })
    .then(async (engine) => {
      llm = engine;
      await removeDownloads({ keepCurrent: true, fast: device.fast }); // drop older models
      refreshStorage();
      announce("Sage is ready.");
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

function prefillProfile() {
  const saved = store.get("sageProfile") || {};
  if (saved.name) startForm.name.value = saved.name;
  if (saved.grade) startForm.grade.value = saved.grade;
}

function showStart(notice) {
  stopSpeaking();
  session = null;
  topics.deactivate();
  $("#messages").replaceChildren();
  showProgress({ topic: "", concepts: [] });
  startForm.reset();
  prefillProfile();
  document.querySelectorAll("#subject-chips .chip").forEach((c) => c.classList.remove("selected"));
  startForm.hidden = false;
  $("#loading").hidden = true;
  $("#first-download").hidden = true;
  $("#tidy-notice").hidden = !notice;
  $("#tidy-notice").textContent = notice || "";
  $("#app").hidden = true;
  $("#start").hidden = false;
  renderTopics();
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
  if (topics.isFull()) {
    $("#start-error").textContent = "You already have 6 topics going. Delete one above (with the ×) to start a new one.";
    $("#start-error").hidden = false;
    return;
  }
  const profile = Object.fromEntries(new FormData(startForm));
  store.set("sageProfile", { name: profile.name, grade: profile.grade });
  pendingStart = profile;
  // The first time, explain the download before it starts.
  if (!llm && !(await isDownloaded(device.fast))) {
    startForm.hidden = true;
    $("#first-download").hidden = false;
    $("#download-go").focus();
    return;
  }
  beginTopic();
});

$("#download-go").addEventListener("click", () => beginTopic());
$("#download-later").addEventListener("click", () => {
  $("#first-download").hidden = true;
  startForm.hidden = false;
});

async function beginTopic() {
  const profile = pendingStart;
  $("#first-download").hidden = true;
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
  session = topics.add(createLearner(profile));
  knownLevels = new Map();
  markUsed();
  $("#loading").hidden = true;
  openChat();
  send(`Hi! I'm working on ${profile.subject}. ${profile.goal}`);
}

$("#new-session").addEventListener("click", () => {
  controller?.abort();
  showStart();
});

function openChat() {
  $("#start").hidden = true;
  $("#app").hidden = false;
  setSendEnabled(Boolean(llm));
  renderTopics();
  $("#input").focus();
}

// Shows a saved topic's chat. Loads the AI if needed.
async function openTopic(id) {
  if (session?.id === id && !$("#app").hidden) return;
  controller?.abort();
  stopSpeaking();
  session = topics.activate(id);
  knownLevels = new Map();
  $("#messages").replaceChildren();
  openChat();
  showProgress(summary(session.learner));
  session.messages.forEach((m, i) => {
    if (m.role === "user") return addMessage("student", m.content);
    // Only a question from Sage's latest message can still be answered.
    const bubble = addMessage("tutor", "");
    fillTutor(bubble, m.content, { done: true, interactive: i === session.messages.length - 1 });
  });
  if (!llm) {
    $("#chat-loading").hidden = false;
    try {
      await ensureEngine($("#chat-loading-bar"), $("#chat-loading-text"));
    } catch (err) {
      console.error(err);
      addMessage("error", friendlyError(err));
      return;
    } finally {
      $("#chat-loading").hidden = true;
    }
  }
  setSendEnabled(true);
  const due = dueForReview(session.learner);
  if (due.length) {
    addMessage("tutor", `Welcome back! 😊 It's been a little while since you mastered **${due.map((c) => c.name).join("**, **")}**. Want a quick warm-up to make sure it stuck? Tap **🔁 Warm-up review** whenever you're ready.`);
  } else if (session.messages.length) {
    addMessage("tutor", "Welcome back! 😊 Ready to pick up where we left off? Tell me what you remember, or ask me anything.");
  }
}

// ---- Pathway complete ----

async function offerCleanup() {
  if (!session || session.celebrated) return;
  session.celebrated = true;
  save();
  $("#toast").hidden = true;
  const { amount } = await refreshStorage();
  const name = session.learner.profile.name;
  const others = topics.list().length > 1;
  const bubble = addMessage(
    "tutor",
    `<h3>You did it${name ? `, ${escapeHtml(name)}` : ""}! 🎉</h3>
     <p>You worked through every step of <b>${escapeHtml(session.learner.topic)}</b>. That took real effort, and you should be proud of how far you've come.</p>
     <p>Want a recap to look over before your test? And when you're done, Sage can delete this chat${others ? "" : ` and free up the space it's using on your device${amount ? ` (about ${amount})` : ""}`}.</p>
     <div class="actions">
       <button type="button" class="ghost" data-cleanup="recap">See my recap</button>
       <button type="button" class="primary" data-cleanup="yes">${others ? "Delete this chat" : "Clear it and free up space"}</button>
       <button type="button" class="ghost" data-cleanup="no">Keep going for now</button>
     </div>`,
    { html: true },
  );
  bubble.parentElement.classList.add("celebrate");
  bubble.addEventListener("click", async (e) => {
    const choice = e.target.closest("[data-cleanup]")?.dataset.cleanup;
    if (choice === "recap") showRecap();
    else if (choice === "yes") {
      const id = session.id;
      controller?.abort();
      topics.remove(id);
      const last = topics.list().length === 0;
      if (last) await removeDownloads();
      showStart(last ? "All cleaned up! Your chat is deleted and the space is free again. Come back anytime you're stuck. 🌱" : "That chat is deleted. Nice work finishing it! 🌱");
    } else if (choice === "no") {
      bubble.querySelector(".actions").remove();
      addMessage("tutor", "Sounds good! We can keep practicing or explore something related.");
    }
  });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ---- Practice test, recap and warm-up ----

// Runs a model task that isn't a normal chat reply, with a placeholder bubble.
async function runTask(placeholder, task) {
  if (busy || !llm || !session) return;
  busy = true;
  controller = new AbortController();
  setSendEnabled(false);
  const bubble = addMessage("tutor", "");
  const row = bubble.parentElement;
  row.classList.add("typing");
  bubble.innerHTML = `<p class="muted">${placeholder}</p>`;
  const current = session;
  try {
    await task(bubble, current, controller.signal);
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error(err);
      bubble.textContent = friendlyError(err);
    } else row.remove();
  } finally {
    row.classList.remove("typing");
    busy = false;
    setSendEnabled(true);
  }
}

$("#practice-btn").addEventListener("click", () =>
  runTask("Writing a practice test for you… this takes about a minute.", async (bubble, current, signal) => {
    const questions = await buildPracticeTest(llm, current.learner, { signal });
    if (questions.length < 3) {
      bubble.innerHTML = render("I had trouble writing a good test this time. Mind trying again in a moment? We can also keep practicing here.");
      return;
    }
    bubble.replaceChildren(
      practiceCard(questions, {
        announce,
        onDone: (picks, card) => {
          const result = scoreTest(current.learner, questions, picks);
          current.messages.push({ role: "assistant", content: `📝 ${resultNote(result).replace(/[()]/g, "")}` });
          save();
          if (session === current) showProgress(summary(current.learner), { celebrate: true });
          announce(`You got ${result.score} of ${result.total}.`);
          practiceResults(card, result, {
            onReview: () => send("Can we go over what I missed on the practice test?", { extra: [`They just took a practice test and missed questions on: ${result.toReview.join(", ")}. Start with the first one: re-teach it gently with a fresh example, then check with one question.`] }),
          });
          if (pathwayComplete(summary(current.learner))) offerCleanup();
        },
      }),
    );
  }),
);

async function showRecap() {
  await runTask("Putting your recap together…", async (bubble, current, signal) => {
    const recap = await buildRecap(llm, current, { signal });
    bubble.replaceChildren(recapCard(recap));
    scrollToEnd(bubble);
  });
}
$("#recap-btn").addEventListener("click", showRecap);

$("#review-btn").addEventListener("click", () => {
  const due = dueForReview(session.learner);
  if (!due.length) return;
  send("Can we do a quick warm-up review?", {
    extra: [`Warm-up review: the student mastered "${due.map((c) => c.name).join('", "')}" a while ago. Ask ONE quick review question about "${due[0].name}" (an interactive question works well) to check it stuck. Keep it light and encouraging.`],
  });
});

// ---- Chat ----

//   answer: set when the student answered an interactive question
//   extra: additional guidance for the tutor
async function send(text, { answer, extra } = {}) {
  if (busy || !llm || !text.trim() || !session) return;
  busy = true;
  controller = new AbortController();
  setSendEnabled(false);
  stopSpeaking();
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
      fillTutor(bubble, reply);
      scrollToEnd(row);
    } else if (event.type === "reset") {
      reply = "";
      bubble.innerHTML = "";
      row.classList.add("typing");
    } else if (event.type === "progress") {
      if (session === current) showProgress(event.progress, { celebrate: true });
      if (!pathwayComplete(event.progress)) current.celebrated = false; // a new plan can be celebrated again
    }
  };

  try {
    await tutorTurn(llm, current, text.trim().slice(0, 4000), emit, { signal: controller.signal, answer, extra });
    if (reply) {
      fillTutor(bubble, reply, { done: true, interactive: true });
      scrollToEnd(row);
    }
    save();
    renderTopics();
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
  $("#composer-status").hidden = true;
  send(text);
});

$("#input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#chat-form").requestSubmit();
  }
});

function growInput() {
  const input = $("#input");
  input.style.height = "";
  input.style.height = `${input.scrollHeight}px`;
}
$("#input").addEventListener("input", () => {
  growInput();
  if (!$("#input").value.trim()) $("#composer-status").hidden = true;
});

document.querySelector(".quick").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-say]");
  if (chip) send(chip.dataset.say);
});

function composerStatus(text) {
  $("#composer-status").textContent = text;
  $("#composer-status").hidden = !text;
}

// ---- Worksheet photos ----

$("#photo-btn").addEventListener("click", () => $("#photo-input").click());
$("#photo-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !session) return;
  $("#photo-btn").disabled = true;
  composerStatus("📷 Reading your photo…");
  try {
    const text = await readPhoto(file, session.learner.profile.subject, (p) => composerStatus(`📷 Reading your photo… ${Math.round(p * 100)}%`));
    if (!text) {
      composerStatus("I couldn't find any writing in that photo. Try again closer up, with good light and the page flat.");
      return;
    }
    const input = $("#input");
    input.value = `${input.value ? `${input.value}\n\n` : ""}Here's what I'm stuck on from my worksheet:\n${text}`;
    growInput();
    input.focus();
    composerStatus("✏️ Check that I read it right and fix anything I got wrong, then press send.");
  } catch (err) {
    console.error(err);
    composerStatus("Sorry, I couldn't read that photo. Try a clear photo (JPG or PNG), or type the question instead.");
  } finally {
    $("#photo-btn").disabled = false;
  }
});

// ---- Voice typing ----

let stopListening = null;
if (canListen) $("#mic-btn").hidden = false;
$("#mic-btn").addEventListener("click", () => {
  if (stopListening) return stopListening();
  if (!store.get("sageVoiceOk")) {
    const ok = confirm("Voice typing uses your browser's speech service to turn your voice into text. In Chrome that's Google, so what you say is sent to them. Everything else in Sage stays on your device.\n\nUse voice typing?");
    if (!ok) return;
    store.set("sageVoiceOk", true);
  }
  const input = $("#input");
  const before = input.value ? `${input.value} ` : "";
  $("#mic-btn").classList.add("listening");
  composerStatus("🎤 Listening… tap the mic again to stop.");
  stopListening = listen({
    onText: (heard) => {
      input.value = before + heard;
      growInput();
    },
    onError: (error) => composerStatus(error === "not-allowed" ? "Sage needs permission to use the microphone. Check your browser settings." : "I didn't catch that. Tap the mic and try again."),
    onEnd: () => {
      stopListening = null;
      $("#mic-btn").classList.remove("listening");
      if ($("#composer-status").textContent.startsWith("🎤")) composerStatus(input.value.trim() ? "Check what I heard, then press send." : "");
      input.focus();
    },
  });
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
    topics.clearAll();
    $("#tidy-notice").textContent = `Welcome back! 👋 It's been more than ${IDLE_DAYS} days, so Sage tidied up to give your storage back: your old chats and the downloaded AI were cleared. Let's start fresh whenever you're ready.`;
    $("#tidy-notice").hidden = false;
  }
  markUsed();

  prefillProfile();
  renderTopics();
  await refreshStorage();
  const active = topics.active();
  if (device.ok && active) openTopic(active.id);
})();
