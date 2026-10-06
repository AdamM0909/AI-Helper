# Sage: an AI tutor that teaches instead of answering

Sage is a tutor for high school students who are stuck on something, like diagramming sentences, French verb tenses, algebra or chemistry. Unlike a general chatbot, it won't just give the answer. It:

- **Finds out where you are first.** It asks a couple of questions before explaining anything.
- **Teaches in small steps** and checks after each one with a question you have to answer.
- **Gives hints instead of answers.** When you're wrong, it gives a hint so you can find the answer yourself.
- **Adapts to your pace.** Every answer is graded and tracked per concept. Get a few right in a row and it speeds up. Miss twice and it slows down and explains it a different way.
- **Won't do your homework.** If you paste assignment questions, it teaches the skill with its own similar examples, then lets you do the real ones.

A sidebar shows the lesson plan and how far you've got on each concept (new → learning → getting it → mastered). Progress is saved in your browser, so you can come back days later, and Sage doesn't take up your storage (see below).

**It's free, and it doesn't need a server.** Sage is a web page hosted on GitHub Pages. The AI (an open model run with [WebLLM](https://webllm.mlc.ai)) runs inside each student's own browser, on their own device. There's no account, no API key and no subscription, nobody's laptop has to stay on, and nothing a student types leaves their device.

## Using Sage

Open the link, for example `https://adamm0909.github.io/AI-Helper/`, fill in what you're stuck on, pick an AI size, and start.

Each visit, the AI downloads (1 to 5 GB depending on size) and loads into your device's memory.

| AI size | Download | Good for |
|---|---|---|
| Light | 1 GB | Phones, Chromebooks, older laptops |
| Standard | 2 GB | Most laptops |
| Strong | 5 GB | Gaming PCs, newer Macs. Teaches best. |

### Storage: Sage cleans up after itself

By default, **Sage uses none of your storage.** The AI only needs to be on disk while it loads. Once it's in memory, Sage deletes the downloaded copy, and the chat keeps working until you close the tab. (You do need enough free space for that download while it loads.) The catch is that it downloads again on every visit, which takes a few minutes, so use Wi-Fi.

If you'd rather have Sage load in seconds, tick **"Keep the AI on this device"** on the start screen. Then:

- The sidebar and start screen show how much space Sage is using, with a **Remove it** button.
- When you master everything in a lesson plan, Sage offers to **free up the space**.
- If you switch AI sizes, the old one is deleted automatically.
- Anything left behind (for example, if you closed the tab mid-download) is cleaned up the next time you open Sage.

Your chat progress is tiny (a few kilobytes) and is saved either way.

**What it needs:** a browser with WebGPU. That means recent Chrome or Edge (Windows, Mac, Chromebook, Android) or Safari on an up-to-date iPhone or Mac. Sage tells you if your browser can't run it. If a size crashes or runs slowly, click **New topic** and choose a smaller one.

**School networks** sometimes block the AI download (it comes from huggingface.co). If it won't download at school, tick **"Keep the AI on this device"** and do the first load at home. After that, it loads from the device without downloading.

**Sage can make mistakes.** Free models that fit in a browser are much smaller than ChatGPT or Claude. Sage is good for practice and explanations, but double-check anything important with your teacher or textbook.

## Publishing it (one-time setup)

1. In this repo on GitHub, go to **Settings → Pages**, and under **Source** choose **GitHub Actions**.
2. Merge the code into `main`. GitHub automatically runs the tests, builds the site and publishes it. It takes about two minutes; follow along in the **Actions** tab.
3. Your link appears in **Settings → Pages** (it will be `https://adamm0909.github.io/AI-Helper/`). Send it to your friends.

Every time you change something on `main`, the site updates by itself.

## How it works

| File | What it does |
|---|---|
| `public/js/tutor.js` | The teaching rules and each turn's steps (grade, reply, check) |
| `public/js/subjects.js` | Teaching notes and common mistakes for each subject. Add your own here. |
| `public/js/learner.js` | Tracks progress per concept and decides the pacing advice. Plain code, no AI, so the rules are predictable and easy to change |
| `public/js/engine.js` | Loads the AI in the browser and talks to it |
| `public/app.js`, `index.html`, `styles.css` | The web page |
| `scripts/build.js` | Assembles the site, with its libraries, into `_site/` |

### What makes a small AI teach well

Browser-sized models are small, so Sage gives them extra structure:

1. **Grade first.** A short call returns structured data: what question the tutor asked, the correct answer (worked out *before* judging, which makes grading more accurate), and whether the student was right. On the first message it also builds the lesson plan.
2. **Pacing in code.** `learner.js` records the result and works out concrete advice such as *"SLOW DOWN, try a new angle"* or *"On a roll, ask a harder question"*. Three correct answers in a row without hints counts as mastered.
3. **Situation detection.** If a student begs for the answer, pastes a list of homework questions, or sounds frustrated, the tutor gets a specific instruction for that reply.
4. **Subject notes.** The tutor gets teaching tips and common mistakes for the subject (sentence diagram layout, DR MRS VANDERTRAMP for French, sign errors in algebra, and so on).
5. **Short, clear rules plus an example reply.** Small models copy examples much better than they follow long instructions.
6. **Answer-leak check.** If the tutor's reply gives away the answer the student got wrong, Sage throws it out and writes a hint instead.
7. **Fits the model's memory.** Only as much recent conversation as fits is sent, so the instructions never get cut off.

## Working on the code

You need [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
npm start      # builds the site and serves it at http://localhost:8080
npm test       # runs the tests (they use a fake AI, so no download needed)
```

GitHub runs the tests automatically on every push. The repo also opens in GitHub Codespaces for editing.

## Ideas for next steps

- Upload a photo of a worksheet (needs a vision model)
- Spaced review: bring back old concepts after a few days so they stick
- Several saved topics instead of one
- Work offline completely by caching the page itself, not just the AI
