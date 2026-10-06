# Sage: an AI tutor that teaches instead of answering

Sage is a tutor for high school students who are stuck on something, like diagramming sentences, French verb tenses, algebra or chemistry. Unlike a general chatbot, it won't just give the answer. It:

- **Finds out where you are first.** It asks a couple of questions before explaining anything.
- **Teaches in small steps** and checks after each one with a question you have to answer.
- **Gives hints instead of answers.** When you're wrong, it looks for the misconception and nudges you. Hints get more specific if you keep struggling.
- **Adapts to your pace.** Every answer is graded and recorded per concept. Get a few right in a row and it speeds up. Miss twice and it slows down and explains it a different way.
- **Won't do your homework.** If you paste assignment questions, it teaches the skill with its own similar examples, then lets you do the real ones and checks your thinking.

A sidebar shows the lesson plan and how far you've got on each concept (new → learning → getting it → mastered).

**It's completely standalone and free.** The AI runs on your own computer using [Ollama](https://ollama.com) and a free, open model. There's no account, no API key and no subscription, and once the model is downloaded it doesn't need the internet.

## Set it up

You need a computer with **8 GB of memory or more** (16 GB is better). It works on Windows, Mac and Linux.

**1. Install the tools (once)**
- [Node.js](https://nodejs.org/) (the LTS version)
- [Ollama](https://ollama.com/download)

**2. Download an AI model (once)**

Open a terminal (on Windows: Command Prompt or PowerShell) and run:

```bash
ollama pull qwen2.5:7b
```

It's about a 5 GB download. Pick a different model if your computer is weaker or stronger:

| Your computer | Model | Set in `.env` |
|---|---|---|
| 8 GB memory or an older laptop | `llama3.2:3b` (2 GB) | `AI_MODEL=llama3.2:3b` |
| 16 GB memory (most laptops) | `qwen2.5:7b` (5 GB), the default | (nothing to change) |
| 32 GB memory, a gaming PC or a newer Mac | `qwen2.5:14b` (9 GB) | `AI_MODEL=qwen2.5:14b` |

Bigger models teach better and make fewer mistakes, but they answer more slowly.

**3. Get Sage**

On this repo's GitHub page, click **Code → Download ZIP** and unzip it (or `git clone` it). In a terminal, go into the folder and run:

```bash
npm install
cp .env.example .env            # on Windows: copy .env.example .env
npm run make-codes -- alex sam  # one code per person, including you
```

Copy the `ACCESS_CODES=...` line it prints into `.env`, replacing the example one.

**4. Start it**

Make sure Ollama is running (it starts with your computer by default), then:

```bash
npm start
```

Open <http://localhost:3000> and enter your code.

**Tip:** Sage remembers more of the conversation if you raise Ollama's context length to 8k or more, in Ollama's settings or by starting it with `OLLAMA_CONTEXT_LENGTH=8192 ollama serve`.

## Share it with friends

Sage runs on your computer, so your computer has to be on and running `npm start` while friends use it. Give each friend **their own** code.

- **Friends on the same Wi-Fi** (at your house, for example): when Sage starts, it prints an address like `http://192.168.1.20:3000`. Friends open that on their phone or laptop. If your computer asks whether to allow network access, say yes.
- **Friends anywhere**, using a free Cloudflare tunnel (no account needed): install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), then in a second terminal run:

  ```bash
  cloudflared tunnel --url http://localhost:3000
  ```

  It prints a link like `https://some-random-words.trycloudflare.com`. Send that to your friends. The link changes every time you restart the tunnel.

To cut someone off, delete their code from `.env` and restart Sage.

One computer can answer one person at a time, so if several friends use it at once, they take turns and replies are slower.

### Safety features

| Protection | What it does |
|---|---|
| Access codes | Nobody can use Sage without a code you gave them. Each friend's chats are private to their code. |
| Wrong-code lockout | 10 wrong codes from one address locks it out for 15 minutes, so codes can't be guessed. |
| Daily message limit | Each friend gets `DAILY_MESSAGES_PER_FRIEND` messages a day (default 150), so nobody can hog your computer. |
| Chat length limit | After 150 messages, Sage asks the student to start a new topic. |
| Stops unread replies | If a student closes the tab mid-reply, Sage stops working on it. |
| Privacy | Everything stays on your computer. The server logs who sent a message, never what they wrote. Sage won't ask for personal details. Chats live only in memory and are deleted after a day of inactivity. |
| Browser security | Security headers (Content Security Policy and others) and sanitized output block malicious scripts. |

**Free models make more mistakes than big paid ones.** Sage is good for practice and explanations, but tell your friends to double-check anything important with their teacher or textbook.

## How it works

| File | What it does |
|---|---|
| `src/tutor.js` | The tutor's teaching rules, and each turn's two steps (grade the answer, then reply) |
| `src/learner.js` | Tracks progress per concept and decides the pacing advice. Plain code, no AI, so the rules are predictable and easy to change |
| `src/llm.js` | Talks to the AI model |
| `src/guard.js` | Access codes, daily limits and wrong-code lockout |
| `server.js` | Small web server: checks access, creates sessions and streams replies to the browser |
| `public/` | The web page |

Each time a student sends a message, Sage makes two calls to the AI:

1. **Grade:** a short call that returns structured data. Did the student just answer a check question? Which concept was it, was it right, and how many hints did it take? On the first message, this call also builds the lesson plan. `learner.js` records the result and works out pacing advice such as *"SLOW DOWN, try a new angle"* or *"On a roll, ask a harder question"*.
2. **Reply:** the tutor writes its response, with the lesson plan, progress and pacing advice included in its instructions.

Splitting it up this way makes even small models adapt reliably. Three correct answers in a row without hints counts as mastered, and answers that needed hints don't count toward mastery. To change these rules, edit `src/learner.js`.

**Other AI servers:** Sage uses the standard OpenAI-compatible chat API, so it also works with [LM Studio](https://lmstudio.ai) (`AI_BASE_URL=http://localhost:1234/v1`), llama.cpp, or a cloud service (set `AI_BASE_URL`, `AI_MODEL` and `AI_API_KEY`). You're never locked into one company.

**Tests:** `npm test` runs them using fake AI servers, so they don't need a model. GitHub also runs them automatically on every push (see the **Actions** tab). The repo opens in GitHub Codespaces for editing code, but Codespaces is too slow to run the AI model itself.

## Ideas for next steps

- Upload a photo of a worksheet (some Ollama models, like `llama3.2-vision`, can read images)
- Save progress to a file so students can come back days later
- Spaced review: bring back old concepts after a few days so they stick
- A teacher or parent view showing which concepts a student struggles with
