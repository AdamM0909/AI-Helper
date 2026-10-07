// Interactive questions. The tutor writes them inside its reply as a small
// block, which the page turns into something to click or type in:
//
//   ```quiz            multiple choice
//   question: Which helper verb does "aller" use?
//   a) avoir
//   b) être
//   answer: b
//   ```
//   ```blank           fill in the blank
//   question: Hier, je ___ allé au cinéma.
//   answer: suis
//   ```
//   ```order           put in order (listed in the CORRECT order; the page shuffles)
//   question: Put the steps in order to solve 2x + 3 = 7
//   - Subtract 3 from both sides
//   - Divide both sides by 2
//   ```
//   ```match           matching pairs
//   question: Match each word to its meaning
//   chien = dog
//   chat = cat
//   ```
//
// Every block carries its own answer, so the page grades it itself, which
// is faster and more reliable than asking a small model to grade.

const LETTERS = ["a", "b", "c", "d", "e"];
const KINDS = { quiz: "choice", choice: "choice", mc: "choice", blank: "blank", fill: "blank", order: "order", steps: "order", match: "match", matching: "match" };
const OPEN = /```\s*(quiz|choice|mc|blank|fill|order|steps|matching|match)\b[^\n]*\n?/i;

export const KIND_LABELS = { choice: "multiple-choice question", blank: "fill-in-the-blank question", order: "put-in-order question", match: "matching question" };

// Splits a reply into the text to show and the question (if any).
// While a reply is still streaming, an unfinished block is hidden.
// A block that can't be understood is shown as plain text, minus the answer.
export function parseQuiz(reply) {
  const found = reply.match(OPEN);
  if (!found) return { text: reply, quiz: null };
  const start = found.index;
  const afterOpen = reply.slice(start + found[0].length);
  const close = afterOpen.indexOf("```");
  const before = reply.slice(0, start).trimEnd();
  if (close === -1) return { text: before, quiz: null, pending: true };

  const body = afterOpen.slice(0, close);
  const after = afterOpen.slice(close + 3).trim();
  const text = [before, after].filter(Boolean).join("\n\n");
  const quiz = readBlock(KINDS[found[1].toLowerCase()], body);
  if (quiz) return { text, quiz };

  // Couldn't read it: show it as text, never the answer.
  const visible = body
    .split("\n")
    .filter((line) => line.trim() && !/^\s*(correct\s*)?answers?\s*[:=]/i.test(line))
    .join("\n");
  return { text: [before, visible, after].filter(Boolean).join("\n\n"), quiz: null };
}

function readBlock(kind, body) {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  let question = "";
  let concept = "";
  let answerText = "";
  const rest = [];
  for (const line of lines) {
    let m;
    if ((m = line.match(/^(?:question|q)\s*[:=]\s*(.+)$/i))) question = m[1].trim();
    else if ((m = line.match(/^concept\s*[:=]\s*(.+)$/i))) concept = m[1].trim();
    else if ((m = line.match(/^(?:correct\s*)?answers?\s*[:=]\s*(.+)$/i))) answerText = m[1].trim();
    else if (/^(items|steps|pairs|options)\s*:?\s*$/i.test(line)) continue;
    else rest.push(line);
  }
  // A block labeled "quiz" that's really a matching list.
  if (kind === "choice" && !rest.some((l) => /^[-*]?\s*\(?[a-e][).:]\s/i.test(l)) && rest.filter((l) => l.includes("=")).length >= 2) kind = "match";
  // No "question:" label? Use the first line, unless it looks like an option, pair or step.
  const looksLikeItem = { choice: /^[-*]?\s*\(?[a-e][).:]\s/i, match: /=|→|->/, order: /^(?:[-*•]|\d+[.)])\s/ }[kind];
  if (!question && rest.length && looksLikeItem && !looksLikeItem.test(rest[0])) question = rest.shift();
  if (!question) return null;
  const base = { kind, question, concept };

  if (kind === "choice") {
    const options = [];
    for (const line of rest) {
      const m = line.match(/^[-*]?\s*\(?([a-e])[).:]\s*(.+)$/i);
      if (m) options.push({ letter: m[1].toLowerCase(), text: m[2].trim() });
    }
    const letter = answerText.match(/^\(?([a-e])\)?\b/i)?.[1]?.toLowerCase();
    const answer = LETTERS.indexOf(letter);
    const ordered = options.every((o, i) => o.letter === LETTERS[i]);
    if (options.length < 2 || !ordered || answer < 0 || answer >= options.length) return null;
    return { ...base, options: options.map((o) => o.text), answer };
  }
  if (kind === "blank") {
    const answers = answerText.split(/\s*(?:\||\bor\b|;)\s*/i).map((a) => a.trim()).filter(Boolean);
    if (!/_{2,}/.test(question) || answers.length === 0) return null;
    return { ...base, answers };
  }
  if (kind === "order") {
    const items = rest.map((l) => l.replace(/^(?:[-*•]|\d+[.)]|[a-e][.)])\s*/i, "").trim()).filter(Boolean);
    if (items.length < 3 || items.length > 7 || new Set(items).size !== items.length) return null;
    return { ...base, items };
  }
  if (kind === "match") {
    const pairs = rest
      .map((l) => l.replace(/^(?:[-*•]|\d+[.)])\s*/, "").match(/^(.+?)\s*(?:=|→|->|:|\s-\s)\s*(.+)$/))
      .filter(Boolean)
      .map((m) => ({ left: m[1].trim(), right: m[2].trim() }));
    const rights = new Set(pairs.map((p) => p.right));
    if (pairs.length < 2 || pairs.length > 6 || rights.size !== pairs.length) return null;
    return { ...base, pairs };
  }
  return null;
}

export const letterFor = (index) => LETTERS[index].toUpperCase();

// ---- Grading (returns "correct", "partial" or "incorrect") ----

const clean = (s) => s.toLowerCase().trim().replace(/[.!?,;]+$/, "").replace(/\s+/g, " ").trim();
const noAccents = (s) => s.normalize("NFD").replace(/\p{M}/gu, "");

// Right word with missing accents counts as "partial", so the tutor can
// point out the accent instead of calling it wrong.
export function gradeBlank(quiz, input) {
  const typed = clean(input);
  if (!typed) return "incorrect";
  if (quiz.answers.some((a) => clean(a) === typed)) return "correct";
  if (quiz.answers.some((a) => noAccents(clean(a)) === noAccents(typed))) return "partial";
  return "incorrect";
}

// order: indexes into quiz.items, in the order the student put them.
export function gradeOrder(quiz, order) {
  const right = order.filter((item, position) => item === position).length;
  if (right === quiz.items.length) return "correct";
  return right >= quiz.items.length / 2 ? "partial" : "incorrect";
}

// chosen[i]: index of the right-hand item the student matched to pair i.
export function gradeMatch(quiz, chosen) {
  const right = chosen.filter((choice, i) => choice === i).length;
  if (right === quiz.pairs.length) return "correct";
  return right >= quiz.pairs.length / 2 ? "partial" : "incorrect";
}

// Shuffled indexes 0..n-1, never left in the original order (that would give
// away an ordering question).
export function shuffled(n, random = Math.random) {
  const out = [...Array(n).keys()];
  for (let tries = 0; tries < 10; tries++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    if (out.some((v, i) => v !== i)) return out;
  }
  return out.reverse();
}
