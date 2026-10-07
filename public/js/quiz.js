// Multiple-choice questions. The tutor writes them inside its reply as a
// small block, which the page turns into answer buttons:
//
//   ```quiz
//   question: Which helper verb does "aller" use?
//   a) avoir
//   b) être
//   c) faire
//   answer: b
//   ```
//
// Because the block includes the answer, the page grades clicks itself,
// which is faster and more reliable than asking a small model to grade.

const LETTERS = ["a", "b", "c", "d", "e"];
const OPEN = /```\s*quiz[^\n]*\n?/i;

// Splits a reply into the text to show and the quiz (if any).
// While a reply is still streaming, an unfinished block is hidden.
// A block that can't be understood is shown as plain text, minus the answer.
export function parseQuiz(reply) {
  const start = reply.search(OPEN);
  if (start === -1) return { text: reply, quiz: null };
  const afterOpen = reply.slice(start).replace(OPEN, "");
  const close = afterOpen.indexOf("```");
  const before = reply.slice(0, start).trimEnd();
  if (close === -1) return { text: before, quiz: null, pending: true };

  const body = afterOpen.slice(0, close);
  const after = afterOpen.slice(close + 3).trim();
  const text = [before, after].filter(Boolean).join("\n\n");
  const quiz = readBlock(body);
  if (quiz) return { text, quiz };

  // Couldn't read it: show the question and options as text, never the answer.
  const visible = body
    .split("\n")
    .filter((line) => line.trim() && !/^\s*(correct\s*)?answer\s*[:=]/i.test(line))
    .join("\n");
  return { text: [before, visible, after].filter(Boolean).join("\n\n"), quiz: null };
}

function readBlock(body) {
  let question = "";
  let concept = "";
  let answerLetter = "";
  const options = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^(?:question|q)\s*[:=]\s*(.+)$/i))) question = m[1].trim();
    else if ((m = line.match(/^concept\s*[:=]\s*(.+)$/i))) concept = m[1].trim();
    else if ((m = line.match(/^(?:correct\s*)?answer\s*[:=]\s*\(?([a-e])\)?\b/i))) answerLetter = m[1].toLowerCase();
    else if ((m = line.match(/^[-*]?\s*\(?([a-e])[).:]\s*(.+)$/i))) options.push({ letter: m[1].toLowerCase(), text: m[2].trim() });
    else if (!question) question = line; // a bare first line is the question
  }
  // Options must be a, b, c... in order, with no duplicates.
  const ordered = options.every((o, i) => o.letter === LETTERS[i]);
  const answer = LETTERS.indexOf(answerLetter);
  if (!question || options.length < 2 || !ordered || answer < 0 || answer >= options.length) return null;
  return { question, options: options.map((o) => o.text), answer, concept };
}

export const letterFor = (index) => LETTERS[index].toUpperCase();
