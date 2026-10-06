# Sage: an AI tutor that teaches instead of answering

Sage is a tutor for high school students who are stuck on something, like diagramming sentences, French verb tenses, algebra or chemistry. Unlike a general chatbot, it won't just give the answer. It:

- **Finds out where you are first.** It asks a couple of questions before explaining anything.
- **Teaches in small steps** and checks after each one with a question you have to answer.
- **Gives hints instead of answers.** When you're wrong, it gives a hint so you can find the answer yourself.
- **Adapts to your pace.** Every answer is graded and tracked per concept. Get a few right in a row and it speeds up. Miss twice and it slows down and explains it a different way.
- **Won't do your homework.** If you paste assignment questions, it teaches the skill with its own similar examples, then lets you do the real ones.

A sidebar shows the lesson plan and how far you've got on each concept (new → learning → getting it → mastered). Progress is saved in your browser, so you can come back later, and Sage cleans up its storage when you're done (see below). There's a light and dark mode, too.

**It's free, and it doesn't need a server.** Sage is a web page hosted on GitHub Pages. The AI (an open model run with [WebLLM](https://webllm.mlc.ai)) runs inside each student's own browser, on their own device. There's no account, no API key and no subscription, nobody's laptop has to stay on, and nothing a student types leaves their device.

## Using Sage

Open the link, for example `https://adamm0909.github.io/AI-Helper/`, fill in what you're stuck on, pick an AI size, and start.

The first time, the AI downloads (1 to 5 GB depending on size), which takes a few minutes. After that, it stays ready on the device, **even after closing the tab or the browser** (for example, when students have to close everything before a test), so Sage opens in seconds.

| AI size | Download | Good for |
|---|---|---|
| Light | 1 GB | Phones, Chromebooks, older laptops |
| Standard | 2 GB | Most laptops |
| Strong | 5 GB | Gaming PCs, newer Macs. Teaches best. |

### Storage: Sage tidies up after itself

- **When a pathway is finished,** Sage celebrates, then asks if you'd like to delete the chat and free up the space. You can say yes or keep going.
- **After 5 days without using Sage,** the next time you open it, Sage clears the old chat and the downloaded AI to give your storage back, and lets you know.
- **Anytime,** the start screen and sidebar show how much space Sage is using, with a **Free up space** button.
- Switching AI sizes deletes the old one automatically.

A web page can't run when it's closed, so the 5-day cleanup happens the next time Sage is opened. Browsers also clear site storage by themselves when a device runs low on space.

**What it needs:** a browser with WebGPU. That means recent Chrome or Edge (Windows, Mac, Chromebook, Android) or Safari on an up-to-date iPhone or Mac. Sage tells you if your browser can't run it. If a size crashes or runs slowly, click **New topic** and choose a smaller one.

**School networks** sometimes block the AI download (it comes from huggingface.co). If it won't download at school, do the first load at home. After that, it loads from the device without downloading.

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
| `public/js/housekeeping.js` | When Sage tidies up: after a finished pathway, or after 5 days without use |
| `public/app.js`, `index.html`, `styles.css`, `theme.js` | The web page, including light and dark mode |
| `scripts/build.js` | Assembles the site, with its libraries, into `_site/` |

### What makes a small AI teach well

Browser-sized models are small, so Sage gives them extra structure:

1. **Grade first.** A short call returns structured data: what question the tutor asked, the correct answer (worked out *before* judging, which makes grading more accurate), and whether the student was right. On the first message it also builds the lesson plan.
2. **Pacing in code.** `learner.js` records the result and works out concrete advice such as *"SLOW DOWN, try a new angle"* or *"On a roll, ask a harder question"*. Three correct answers in a row without hints counts as mastered.
3. **Situation detection.** If a student begs for the answer, pastes a list of homework questions, or sounds frustrated, the tutor gets a specific instruction for that reply.
4. **Subject notes.** The tutor gets teaching tips and common mistakes for the subject (sentence diagram layout, DR MRS VANDERTRAMP for French, sign errors in algebra, and so on).
5. **Short, clear rules plus an example reply.** Small models copy examples much better than they follow long instructions.
6. **Answer-leak check.** If the tutor's reply gives away the answer the student got wrong, Sage throws it out and writes a hint instead.
7. **A warm voice, with a kindness check.** Sage is told to be nurturing: praise effort, treat mistakes as normal, and never say things like "wrong", "obviously" or "it's easy". If a reply still sounds harsh, Sage rewrites it in a gentler way.
8. **Fits the model's memory.** Only as much recent conversation as fits is sent, so the instructions never get cut off.

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
