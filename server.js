import "dotenv/config";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createLearner, summary } from "./src/learner.js";
import { tutorTurn } from "./src/tutor.js";
import { createGuard, parseAccessCodes } from "./src/guard.js";
import { createLLM, LLMError } from "./src/llm.js";

const codes = parseAccessCodes(process.env.ACCESS_CODES);
if (codes.size === 0) {
  console.error("No ACCESS_CODES set, so nobody could log in. Run `npm run make-codes` and add them to .env (see README).");
  process.exit(1);
}

const llm = createLLM({
  baseUrl: process.env.AI_BASE_URL || "http://localhost:11434/v1", // Ollama's default address
  model: process.env.AI_MODEL || "qwen2.5:7b",
  apiKey: process.env.AI_API_KEY, // only needed for cloud providers
});

const guard = createGuard({
  codes,
  dailyMessagesPerCode: Number(process.env.DAILY_MESSAGES_PER_FRIEND) || 150,
});

const MAX_MESSAGE_CHARS = 4000;
const MAX_TURNS_PER_SESSION = 150;
const MAX_SESSIONS = 500;
const SESSION_IDLE_MS = 24 * 60 * 60 * 1000;

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Sessions live in memory: restarting the server starts everyone fresh.
const sessions = new Map();

app.disable("x-powered-by");
// Only trust forwarded addresses from this computer (e.g. a Cloudflare tunnel),
// so people on your network can't fake their address to dodge the lockout.
app.set("trust proxy", "loopback");

app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(here, "public")));
// Serve the browser libraries from node_modules so the app works offline.
app.get("/vendor/marked.js", (req, res) => res.sendFile(path.join(here, "node_modules/marked/lib/marked.umd.js")));
app.get("/vendor/purify.js", (req, res) => res.sendFile(path.join(here, "node_modules/dompurify/dist/purify.min.js")));
app.get("/healthz", (req, res) => res.send("ok"));

// Every API call needs a valid access code.
app.use("/api", (req, res, next) => {
  const check = guard.checkCode(req.get("x-access-code"), req.ip);
  if (!check.ok) return res.status(check.status).json({ error: check.error });
  req.code = req.get("x-access-code");
  req.friend = check.name;
  next();
});

function ownSession(req) {
  const session = sessions.get(req.params.id ?? req.body?.sessionId);
  return session && session.code === req.code ? session : null;
}

const field = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

app.post("/api/session", (req, res) => {
  const body = req.body || {};
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions].sort((a, b) => a[1].lastActive - b[1].lastActive)[0];
    sessions.delete(oldest[0]);
  }
  const id = crypto.randomUUID();
  sessions.set(id, {
    code: req.code,
    learner: createLearner({
      name: field(body.name, 40),
      grade: field(body.grade, 20),
      subject: field(body.subject, 60),
      goal: field(body.goal, 500),
    }),
    messages: [],
    turns: 0,
    busy: false,
    lastActive: Date.now(),
  });
  res.json({ sessionId: id, remaining: guard.remaining(req.code) });
});

app.get("/api/session/:id", (req, res) => {
  const session = ownSession(req);
  if (!session) return res.status(404).json({ error: "Session not found" });
  const transcript = session.messages.map((m) => ({ role: m.role === "user" ? "student" : "tutor", text: m.content }));
  res.json({ progress: summary(session.learner), transcript, remaining: guard.remaining(req.code) });
});

// Streams the tutor's reply back as newline-delimited JSON events.
app.post("/api/chat", async (req, res) => {
  const session = ownSession(req);
  const message = field(req.body?.message, MAX_MESSAGE_CHARS);
  if (!session) return res.status(404).json({ error: "Session not found. Start a new topic." });
  if (!message) return res.status(400).json({ error: "Message is empty." });
  if (session.busy) return res.status(409).json({ error: "Still answering your last message." });
  if (session.turns >= MAX_TURNS_PER_SESSION) {
    return res.status(429).json({ error: "This chat is getting really long. Click \"New topic\" to start a fresh one." });
  }
  const allowed = guard.canSend(req.code);
  if (!allowed.ok) return res.status(429).json({ error: allowed.error });

  session.busy = true;
  session.turns += 1;
  session.lastActive = Date.now();
  guard.recordMessage(req.code);
  console.log(`${req.friend} sent a message`); // never log what students write

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  const emit = (event) => res.write(JSON.stringify(event) + "\n");

  // Free up the computer if the student leaves mid-reply.
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });

  try {
    await tutorTurn(llm, session, message, emit, { signal: controller.signal });
    emit({ type: "done", remaining: guard.remaining(req.code) });
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error(err.message);
      emit({
        type: "error",
        message: err instanceof LLMError ? "Sage's AI isn't running right now. Let whoever runs Sage know." : "Something went wrong. Try again.",
      });
    }
  } finally {
    session.busy = false;
    res.end();
  }
});

setInterval(() => {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  for (const [id, session] of sessions) if (session.lastActive < cutoff && !session.busy) sessions.delete(id);
}, 60 * 60 * 1000).unref();

function networkAddresses(port) {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => `http://${a.address}:${port}`);
}

const port = Number(process.env.PORT) || 3000;
app.listen(port, async () => {
  console.log(`Sage is running for ${codes.size} access code(s).`);
  console.log(`  On this computer:      http://localhost:${port}`);
  for (const url of networkAddresses(port)) console.log(`  Friends on your Wi-Fi: ${url}`);

  const ready = await llm.checkReady();
  if (ready.reason === "unreachable") {
    console.warn(`\n⚠ Can't reach the AI at ${process.env.AI_BASE_URL || "http://localhost:11434/v1"}. Install Ollama from https://ollama.com and make sure it's running.`);
  } else if (ready.reason === "model_missing") {
    console.warn(`\n⚠ The model "${llm.model}" isn't downloaded yet. Run:  ollama pull ${llm.model}`);
  } else {
    console.log(`  AI model:              ${llm.model}`);
  }
});
