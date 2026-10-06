# Sage: an AI tutor that teaches instead of answering

Sage is a tutor for high school students who are stuck on something, like diagramming sentences, French verb tenses, algebra or chemistry. It's built on Claude, but unlike a general chatbot it won't just give the answer. It:

- **Finds out where you are first.** It asks a couple of questions before explaining anything.
- **Teaches in small steps** and checks after each one with a question you have to answer.
- **Gives hints instead of answers.** When you're wrong, it looks for the misconception and nudges you. Hints get more specific if you keep struggling.
- **Adapts to your pace.** Every answer is recorded per concept. Get a few right in a row and it speeds up. Miss twice and it slows down and explains it a different way.
- **Won't do your homework.** If you paste assignment questions, it teaches the skill with its own similar examples, then lets you do the real ones and checks your thinking.

A sidebar shows the lesson plan and how far you've got on each concept (new → learning → getting it → mastered).

## Running it

You need [Node.js](https://nodejs.org/) 20 or newer and an Anthropic API key from <https://console.anthropic.com/>.

```bash
npm install
cp .env.example .env      # then put your API key in .env
npm start
```

Open <http://localhost:3000>.

`npm test` runs the tests (they use a fake Claude client, so they don't need a key or cost anything).

## How it works

| File | What it does |
|---|---|
| `src/tutor.js` | The tutor's instructions (the teaching rules), the two tools Claude uses, and the loop that talks to Claude |
| `src/learner.js` | Tracks progress per concept and decides the pacing advice. Plain code, no AI, so the rules are predictable and easy to change |
| `server.js` | Small Express server: creates sessions and streams replies to the browser |
| `public/` | The web page |

How pacing works: Claude has two tools the student never sees.

1. `set_lesson_plan`: once Claude knows what the student needs, it breaks the topic into a few concepts.
2. `record_check`: every time the student answers a check question, Claude records whether it was correct, partly correct or wrong, and how many hints it took. `learner.js` updates that concept's progress and sends back instructions such as *"SLOW DOWN, try a new angle"* or *"On a roll, ask a harder question"*, which Claude follows.

Three correct answers in a row without hints counts as mastered. Right answers that needed hints don't count toward mastery. To change these rules, edit `src/learner.js`.

## Good to know

- **Cost:** it uses the `claude-opus-5-5` model. Each student message costs a little API usage. Set `TUTOR_MODEL` in `.env` to use a different model.
- **Sessions are stored in memory.** Restarting the server clears them. Reloading the page keeps your conversation while the server is running.
- **Not for public hosting yet.** There are no logins or usage limits, so anyone who can reach the server can use your API key. Fine for running on your own computer. Add accounts and rate limits before putting it online.

## Ideas for next steps

- Upload a photo of a worksheet so Sage can see the exact problem (Claude can read images)
- Save progress to a database so students can come back days later
- Spaced review: bring back old concepts after a few days so they stick
- A teacher or parent view showing which concepts a student struggles with
