// The interactive cards that appear in the chat: questions (multiple choice,
// fill in the blank, put in order, matching), practice tests and recaps.
// Cards grade answers themselves and report back through callbacks.
import { gradeBlank, gradeMatch, gradeOrder, letterFor, shuffled } from "./quiz.js";
import { recapText } from "./recap.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---- Questions ----

//   interactive: whether it can still be answered
//   canAnswer(): false while Sage is busy
//   onAnswer(answer, displayText): answer = { kind, question, concept, result, given, correct, wrongTries }
//   announce(text): for screen readers
export function questionCard(quiz, { interactive, canAnswer, onAnswer, announce = () => {} }) {
  const card = el("div", `quiz quiz-${quiz.kind}`);
  card.setAttribute("role", "group");
  card.setAttribute("aria-label", quiz.question);
  card.append(el("p", "quiz-q", quiz.question));
  const body = el("div", "quiz-body");
  const hint = el("p", "quiz-hint muted fine");
  card.append(body, hint);
  const state = { wrongTries: 0, solved: false };

  const finish = (result, given, correct, displayText, messages) => {
    const answer = { kind: quiz.kind, question: quiz.question, concept: quiz.concept, result, given, correct, wrongTries: state.wrongTries };
    if (result === "correct") {
      state.solved = true;
      card.classList.add("solved");
      card.querySelectorAll("button, input, select").forEach((c) => (c.disabled = true));
    } else {
      state.wrongTries += 1;
    }
    hint.textContent = messages[result];
    announce(messages[result]);
    onAnswer(answer, displayText);
  };
  const ready = () => interactive && !state.solved && canAnswer();

  const builders = { choice: buildChoice, blank: buildBlank, order: buildOrder, match: buildMatch };
  builders[quiz.kind](quiz, body, { interactive, ready, finish, hint, state });
  if (!interactive) card.querySelectorAll("button, input, select").forEach((c) => (c.disabled = true));
  return card;
}

const MESSAGES = {
  correct: "Nailed it! 🎉",
  partial: "So close! Read Sage's tip, then try again.",
  incorrect: "Not quite yet. Read Sage's hint, then give it another try.",
};

function buildChoice(quiz, body, { interactive, ready, finish, hint, state }) {
  const options = el("div", "quiz-options");
  quiz.options.forEach((option, i) => {
    const button = el("button", "quiz-opt");
    button.type = "button";
    const letter = el("span", "quiz-letter", letterFor(i));
    button.append(letter, el("span", "quiz-text", option));
    button.addEventListener("click", () => {
      if (!ready() || button.disabled) return;
      const right = i === quiz.answer;
      button.classList.add(right ? "right" : "wrong");
      button.disabled = true;
      letter.textContent = right ? "✓" : "↺";
      const label = (n) => `${letterFor(n)}) "${quiz.options[n]}"`;
      finish(right ? "correct" : "incorrect", label(i), label(quiz.answer), `I chose ${letterFor(i)}) ${option}`, {
        ...MESSAGES,
        correct: state.wrongTries ? "You got there! 🌱" : MESSAGES.correct,
      });
    });
    options.append(button);
  });
  body.append(options);
  if (interactive) hint.textContent = "Tap the answer you think is right.";
}

function buildBlank(quiz, body, { interactive, ready, finish, hint }) {
  const form = el("form", "quiz-blank-form");
  const input = el("input", "quiz-input");
  input.placeholder = "Type the missing part";
  input.setAttribute("aria-label", "Your answer");
  input.autocomplete = "off";
  input.spellcheck = false;
  const check = el("button", "primary small", "Check");
  check.type = "submit";
  form.append(input, check);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!ready() || !input.value.trim()) return;
    const result = gradeBlank(quiz, input.value);
    input.classList.remove("right", "wrong", "close");
    input.classList.add({ correct: "right", partial: "close", incorrect: "wrong" }[result]);
    finish(result, `"${input.value.trim()}"`, `"${quiz.answers[0]}"`, `My answer: ${input.value.trim()}`, {
      ...MESSAGES,
      partial: "Almost! Check the accents.",
    });
  });
  body.append(form);
  if (interactive) hint.textContent = "Fill in the blank, then press Check.";
}

function buildOrder(quiz, body, { interactive, ready, finish, hint }) {
  const pool = el("div", "order-pool");
  const answer = el("ol", "order-answer");
  const check = el("button", "primary small", "Check my order");
  check.type = "button";
  check.disabled = true;
  let placed = [];

  const render = (marks = null) => {
    answer.replaceChildren(
      ...placed.map((item, position) => {
        const li = el("li");
        const button = el("button", `order-item placed${marks ? (marks[position] ? " right" : " wrong") : ""}`, quiz.items[item]);
        button.type = "button";
        button.title = "Tap to take it back out";
        button.addEventListener("click", () => {
          if (!ready()) return;
          placed.splice(position, 1);
          render();
        });
        li.append(button);
        return li;
      }),
    );
    pool.replaceChildren(
      ...order.filter((item) => !placed.includes(item)).map((item) => {
        const button = el("button", "order-item", quiz.items[item]);
        button.type = "button";
        button.addEventListener("click", () => {
          if (!ready()) return;
          placed.push(item);
          render();
        });
        return button;
      }),
    );
    answer.hidden = placed.length === 0;
    check.disabled = placed.length !== quiz.items.length;
  };
  const order = shuffled(quiz.items.length);

  check.addEventListener("click", () => {
    if (!ready() || placed.length !== quiz.items.length) return;
    const result = gradeOrder(quiz, placed);
    render(placed.map((item, position) => item === position));
    const text = (list) => list.map((item, n) => `${n + 1}. ${quiz.items[item]}`).join(" → ");
    finish(result, text(placed), text(quiz.items.map((_, i) => i)), `My order: ${text(placed)}`, {
      ...MESSAGES,
      partial: "Some are in the right spot (green). Tap the others to move them, then check again.",
      incorrect: "Not quite yet. Tap steps to take them out and try a new order.",
    });
  });
  body.append(answer, pool, check);
  render();
  if (interactive) hint.textContent = "Tap the steps in the order you think is right.";
}

function buildMatch(quiz, body, { interactive, ready, finish, hint }) {
  const rights = shuffled(quiz.pairs.length);
  const table = el("div", "match-rows");
  const selects = quiz.pairs.map((pair, i) => {
    const row = el("label", "match-row");
    const select = el("select", "match-select");
    select.append(new Option("Choose…", ""));
    for (const r of rights) select.append(new Option(quiz.pairs[r].right, String(r)));
    select.addEventListener("change", () => {
      row.classList.remove("right", "wrong");
      check.disabled = selects.some((s) => s.value === "");
    });
    row.append(el("span", "match-left", pair.left), el("span", "match-arrow", "→"), select);
    table.append(row);
    return select;
  });
  const check = el("button", "primary small", "Check matches");
  check.type = "button";
  check.disabled = true;
  check.addEventListener("click", () => {
    if (!ready() || selects.some((s) => s.value === "")) return;
    const chosen = selects.map((s) => Number(s.value));
    const result = gradeMatch(quiz, chosen);
    selects.forEach((s, i) => {
      s.parentElement.classList.remove("right", "wrong");
      s.parentElement.classList.add(chosen[i] === i ? "right" : "wrong");
    });
    const text = (list) => list.map((r, i) => `${quiz.pairs[i].left} = ${quiz.pairs[r].right}`).join(", ");
    finish(result, text(chosen), text(quiz.pairs.map((_, i) => i)), `My matches: ${text(chosen)}`, {
      ...MESSAGES,
      partial: "Some matches are right (green). Change the others and check again.",
    });
  });
  body.append(table, check);
  if (interactive) hint.textContent = "Pick a match for each one, then press Check.";
}

// ---- Practice test ----

//   onDone(picks): called once with the chosen option for every question
export function practiceCard(questions, { onDone, announce = () => {} }) {
  const card = el("div", "practice");
  const picks = [];
  let index = 0;

  const show = () => {
    card.replaceChildren();
    const q = questions[index];
    const head = el("div", "practice-head");
    head.append(el("span", "eyebrow", `Practice test · question ${index + 1} of ${questions.length}`));
    const dots = el("div", "practice-dots");
    questions.forEach((_, i) => dots.append(el("span", `dot${i < index ? (picks[i] === questions[i].answer ? " right" : " wrong") : i === index ? " now" : ""}`)));
    head.append(dots);
    card.append(head, el("p", "quiz-q", q.question));
    const options = el("div", "quiz-options");
    const after = el("div", "practice-after");
    q.options.forEach((option, i) => {
      const button = el("button", "quiz-opt");
      button.type = "button";
      button.append(el("span", "quiz-letter", letterFor(i)), el("span", "quiz-text", option));
      button.addEventListener("click", () => {
        if (picks.length > index) return;
        picks.push(i);
        options.querySelectorAll("button").forEach((b, n) => {
          b.disabled = true;
          if (n === q.answer) b.classList.add("right");
        });
        const right = i === q.answer;
        if (!right) button.classList.add("wrong");
        const feedback = right ? "Right! " : `Not quite. The answer is ${letterFor(q.answer)}. `;
        after.append(el("p", "practice-why", feedback + (q.why || "")));
        announce(feedback);
        const next = el("button", "primary small", index + 1 < questions.length ? "Next question" : "See my results");
        next.type = "button";
        next.addEventListener("click", () => {
          index += 1;
          if (index < questions.length) show();
          else {
            card.replaceChildren(el("p", "muted", "Scoring your test…"));
            onDone(picks, card);
          }
        });
        after.append(next);
        next.focus();
      });
      options.append(button);
    });
    card.append(options, after);
  };
  show();
  return card;
}

//   onReview(): student wants to go over what they missed
export function practiceResults(card, { score, total, toReview, results }, { onReview }) {
  card.replaceChildren();
  const great = score === total;
  card.append(
    el("p", "eyebrow", "Practice test results"),
    el("h3", "practice-score", `${score} of ${total}${great ? " 🎉" : ""}`),
    el("p", "", great ? "Every single one! You really know this." : score >= total / 2 ? "Nice work! You're getting there." : "Good effort! Practice tests are for finding what to work on, and now we know."),
  );
  if (toReview.length) {
    card.append(el("p", "muted", `Worth reviewing: ${toReview.join(", ")}`));
    const missed = el("ul", "practice-missed");
    for (const r of results.filter((x) => !x.right)) {
      missed.append(el("li", "", `${r.question} → ${letterFor(r.answer)}) ${r.options[r.answer]}${r.why ? `. ${r.why}` : ""}`));
    }
    card.append(missed);
    const review = el("button", "primary small", "Go over these with Sage");
    review.type = "button";
    review.addEventListener("click", () => {
      review.disabled = true;
      onReview();
    });
    card.append(review);
  }
}

// ---- Recap ----

export function recapCard(recap) {
  const card = el("div", "recap");
  card.append(el("p", "eyebrow", `Recap · ${recap.date}`), el("h3", "", recap.topic));
  const section = (title, items) => {
    if (!items.length) return;
    card.append(el("p", "recap-title", title));
    const ul = el("ul");
    items.forEach((i) => ul.append(el("li", "", i)));
    card.append(ul);
  };
  section("What I learned", recap.learned);
  if (recap.keyExample) {
    card.append(el("p", "recap-title", "Key example"));
    card.append(el("pre", "recap-example", recap.keyExample));
  }
  section("Mastered ✓", recap.mastered);
  section("Still practicing", recap.inProgress);
  section("Practice next", recap.practiceNext.length ? recap.practiceNext : recap.inProgress.concat(recap.notStarted).slice(0, 3));

  const actions = el("div", "actions");
  const copy = el("button", "ghost", "Copy");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(recapText(recap));
      copy.textContent = "Copied ✓";
    } catch {
      copy.textContent = "Couldn't copy";
    }
  });
  const save = el("a", "ghost", "Download");
  save.href = URL.createObjectURL(new Blob([recapText(recap)], { type: "text/plain" }));
  save.download = `Sage recap - ${recap.topic}.txt`;
  actions.append(copy, save);
  card.append(actions, el("p", "muted fine", "Tip: take a screenshot to look over right before your test."));
  return card;
}
