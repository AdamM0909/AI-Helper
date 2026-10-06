import { recordCheck, setLessonPlan, summary } from "./learner.js";

export const MODEL = process.env.TUTOR_MODEL || "claude-opus-5-5";

const TUTOR_RULES = `You are Sage, a patient tutor for high school students who are stuck on something in school: diagramming sentences, French, algebra, chemistry, essay structure, whatever comes up. You are not an answer machine. Your job is to make the student able to do the work on their own.

How you teach:
- Find out where they are first. Before explaining anything, ask a question or two that shows what they already understand and where it breaks down. Build from what they know.
- Teach in small pieces. One idea at a time, explained in plain language with a short example. Keep each message brief, a few short paragraphs at most; long walls of text lose students.
- Check after every piece. End each teaching step with one question that makes them use the idea (not "does that make sense?"). Wait for their answer before moving on.
- When they're wrong, don't correct it for them. Figure out what misconception produced the answer, then give the smallest hint that lets them fix it themselves. Hints escalate: a nudge, then a more specific pointer, then a worked example of a similar (not identical) problem.
- When they're right, say specifically what they did well, then raise the difficulty a little.
- Use examples from their world (sports, music, games, food, friends) and match their energy. Be warm and encouraging, never condescending. Struggling with something is normal and you say so.

Homework and answers:
- Never do their assignment for them. If they paste homework questions, don't answer them. Teach the skill using your own similar practice examples, then let them do their real questions and offer to check their reasoning.
- If they ask you to just give the answer, kindly explain that you'll get them there faster by working through it together, and give a hint instead. If they've genuinely tried several times, you may walk through a worked example of a similar problem step by step, then hand them back their own.
- You can confirm whether an answer they came up with is right, and explain why.

Your tools (the student never sees these calls):
- set_lesson_plan: once you understand what they need, break the topic into 2 to 6 concepts in teaching order. Update it if the plan changes.
- record_check: every time the student answers one of your check questions, record how they did. It returns pacing guidance based on their history. Follow that guidance; it is how you adapt to their pace.
- Always make your tool calls first, then write your reply to the student as one message after them. Don't write to the student before or between tool calls.

Formatting: use Markdown. For anything visual, such as a sentence diagram, verb conjugation table or step-by-step equation, use a table or a monospace code block so the layout stays intact. For sentence diagrams, use a clear text layout like this and explain the parts:
\`\`\`
 dog      | barked
----------+--------
  \\ The   |   \\ loudly
\`\`\`

Privacy: never ask for personal details like their full name, address, phone number, school name or social media, and if they share them, gently suggest they don't need to.

Stay on schoolwork and learning. If a student seems upset or mentions something serious going on in their life, be kind, and encourage them to talk to a trusted adult such as a parent, teacher or school counselor.`;

function systemPrompt(learner) {
  const p = learner.profile;
  const about = [
    p.name && `Name: ${p.name}`,
    p.grade && `Grade: ${p.grade}`,
    p.subject && `Subject: ${p.subject}`,
    p.goal && `What they said they're stuck on: ${p.goal}`,
  ]
    .filter(Boolean)
    .join("\n");
  return [
    { type: "text", text: TUTOR_RULES },
    { type: "text", text: `About this student:\n${about || "(they didn't say yet; ask)"}` },
  ];
}

const TOOLS = [
  {
    name: "set_lesson_plan",
    description:
      "Set or replace the list of concepts this student needs to learn, in teaching order. Progress on concepts that stay in the plan is kept.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Short name for the overall topic, e.g. 'Diagramming compound sentences'" },
        concepts: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 8,
          description: "2 to 6 concept names, each a single learnable idea, e.g. 'Finding the subject and verb'",
        },
      },
      required: ["topic", "concepts"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "record_check",
    description:
      "Record how the student did on a check-for-understanding question. Call this every time they answer one. Returns their progress on the concept and pacing guidance to follow.",
    input_schema: {
      type: "object",
      properties: {
        concept: { type: "string", description: "The concept the question tested; use the same name as in the lesson plan" },
        result: { type: "string", enum: ["correct", "partial", "incorrect"] },
        hints_used: { type: "integer", minimum: 0, description: "How many hints you gave before this answer" },
        misconception: { type: "string", description: "If not fully correct, what misunderstanding the answer shows" },
      },
      required: ["concept", "result", "hints_used"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
];

// Eager input streaming means the API doesn't validate tool input for us,
// so check it here before acting on it.
function validateInput(name, input) {
  if (!input || typeof input !== "object") return "input must be an object";
  if (name === "set_lesson_plan") {
    if (typeof input.topic !== "string" || !input.topic.trim()) return "topic must be a non-empty string";
    if (!Array.isArray(input.concepts) || input.concepts.length === 0) return "concepts must be a non-empty array";
    if (!input.concepts.every((c) => typeof c === "string" && c.trim())) return "every concept must be a non-empty string";
    return null;
  }
  if (name === "record_check") {
    if (typeof input.concept !== "string" || !input.concept.trim()) return "concept must be a non-empty string";
    if (!["correct", "partial", "incorrect"].includes(input.result)) return "result must be correct, partial or incorrect";
    if (!Number.isInteger(input.hints_used) || input.hints_used < 0) return "hints_used must be a non-negative integer";
    return null;
  }
  return `unknown tool ${name}`;
}

function runTool(learner, block, emit) {
  const error = validateInput(block.name, block.input);
  if (error) return { type: "tool_result", tool_use_id: block.id, content: `Invalid input: ${error}`, is_error: true };

  if (block.name === "set_lesson_plan") {
    setLessonPlan(learner, block.input.topic.trim(), block.input.concepts.map((c) => c.trim()));
    emit({ type: "progress", progress: summary(learner) });
    return { type: "tool_result", tool_use_id: block.id, content: JSON.stringify(summary(learner)) };
  }

  const { concept, pacing } = recordCheck(learner, block.input.concept.trim(), block.input.result, block.input.hints_used);
  emit({ type: "progress", progress: summary(learner) });
  return {
    type: "tool_result",
    tool_use_id: block.id,
    content: JSON.stringify({ concept: concept.name, level: concept.levelName, streak: concept.streak, pacing }),
  };
}

// After a model falls back mid-turn, blocks it produced before the switch
// must not be echoed back except plain text and paired server-tool blocks.
function contentToKeep(content) {
  const lastFallback = content.map((b) => b.type).lastIndexOf("fallback");
  if (lastFallback === -1) return content;
  const resultIds = new Set(content.filter((b) => b.tool_use_id).map((b) => b.tool_use_id));
  return content.filter((b, i) => {
    if (i > lastFallback) return true;
    if (b.type === "text" || b.type === "fallback") return true;
    if (b.type === "server_tool_use") return resultIds.has(b.id);
    return b.tool_use_id !== undefined; // server-tool results
  });
}

const MAX_TOOL_ROUNDS = 6;

// Runs one student turn: streams the tutor's reply through `emit`, runs any
// tool calls, and appends everything to session.messages.
//   signal: aborts the request (e.g. the student closed the tab)
//   onUsage: called with each response's token usage, for spending limits
export async function tutorTurn(client, session, studentText, emit, { signal, onUsage } = {}) {
  session.messages.push({ role: "user", content: studentText });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      system: systemPrompt(session.learner),
      tools: TOOLS,
      messages: session.messages,
    }, { signal });

    stream.on("text", (text) => emit({ type: "text", text }));
    const message = await stream.finalMessage();
    onUsage?.(message.usage);

    const content = contentToKeep(message.content);
    session.messages.push({ role: "assistant", content });

    if (message.stop_reason === "refusal") {
      emit({ type: "text", text: "\n\nI can't help with that one. Want to get back to what we were working on?" });
      return;
    }
    const toolUses = content.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) return;
    if (message.stop_reason === "max_tokens") {
      // A cut-off tool call may be incomplete; answer it with an error rather than acting on it.
      session.messages.push({
        role: "user",
        content: toolUses.map((b) => ({ type: "tool_result", tool_use_id: b.id, content: "Tool input was cut off.", is_error: true })),
      });
      return;
    }

    session.messages.push({ role: "user", content: toolUses.map((b) => runTool(session.learner, b, emit)) });
  }
}
