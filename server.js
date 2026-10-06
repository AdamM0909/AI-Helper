import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { createLearner, summary } from "./src/learner.js";
import { tutorTurn } from "./src/tutor.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const client = new Anthropic();

// Sessions live in memory: restarting the server starts everyone fresh.
const sessions = new Map();

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(here, "public")));
// Serve the browser libraries from node_modules so the app works offline
// and on school networks that block CDNs.
app.get("/vendor/marked.js", (req, res) => res.sendFile(path.join(here, "node_modules/marked/lib/marked.umd.js")));
app.get("/vendor/purify.js", (req, res) => res.sendFile(path.join(here, "node_modules/dompurify/dist/purify.min.js")));

app.post("/api/session", (req, res) => {
  const { name, grade, subject, goal } = req.body || {};
  const id = crypto.randomUUID();
  sessions.set(id, { learner: createLearner({ name, grade, subject, goal }), messages: [], busy: false });
  res.json({ sessionId: id });
});

app.get("/api/session/:id", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  // Only the visible conversation: student messages and the tutor's text.
  const transcript = session.messages.flatMap((m) => {
    if (typeof m.content === "string") return [{ role: "student", text: m.content }];
    const text = m.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return m.role === "assistant" && text ? [{ role: "tutor", text }] : [];
  });
  res.json({ profile: session.learner.profile, progress: summary(session.learner), transcript });
});

// Streams the tutor's reply back as newline-delimited JSON events.
app.post("/api/chat", async (req, res) => {
  const { sessionId, message } = req.body || {};
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: "Session not found. Start a new session." });
  if (typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "Message is empty." });
  if (session.busy) return res.status(409).json({ error: "Still answering your last message." });

  session.busy = true;
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  const emit = (event) => res.write(JSON.stringify(event) + "\n");

  try {
    await tutorTurn(client, session, message.trim().slice(0, 8000), emit);
    emit({ type: "done" });
  } catch (err) {
    console.error(err);
    emit({ type: "error", message: errorMessage(err) });
  } finally {
    session.busy = false;
    res.end();
  }
});

function errorMessage(err) {
  if (err instanceof Anthropic.AuthenticationError) return "The server's API key is missing or invalid. Check ANTHROPIC_API_KEY in .env.";
  if (err instanceof Anthropic.RateLimitError) return "Too many requests right now. Wait a moment and try again.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the AI service. Check your internet connection.";
  if (err instanceof Anthropic.APIError) return `The AI service returned an error (${err.status}). Try again.`;
  return "Something went wrong. Try again.";
}

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Sage tutor running at http://localhost:${port}`));
