# Sage: an AI tutor that teaches instead of answering

Sage is a tutor for high school students who are stuck on something, like diagramming sentences, French verb tenses, algebra or chemistry. Unlike a general chatbot, it won't just give the answer. It:

- **Finds out where you are first.** It asks a couple of questions before explaining anything.
- **Teaches in small steps** and checks after each one with a question, picking whatever fits the moment: an open question, multiple choice, fill in the blank, put the steps in order, or matching.
- **Gives hints instead of answers.** When you're wrong, it gives a hint so you can find the answer yourself.
- **Adapts to your pace.** Every answer is graded and tracked per concept. Get a few right in a row and it speeds up. Miss twice and it slows down and explains it a different way.
- **Won't do your homework.** If you paste assignment questions, it teaches the skill with its own similar examples, then lets you do the real ones.

A sidebar shows the lesson plan and how far you've got on each concept (new → learning → getting it → mastered). Progress is saved in your browser, so you can come back later, and Sage cleans up its storage when you're done (see below).

**Also:**
- 📷 **Worksheet photos:** snap the problem you're stuck on. Sage reads the text (right on the device), puts it in the message box for you to check, and you send it. It reads printed text well, but it can't understand drawings or diagrams.
- 🔁 **Warm-up reviews:** concepts you've mastered come back for a quick check after 1, 2 and 4 days, so they stick.
- 🗂️ **Several topics at once:** say French and algebra, each with its own chat and pathway (up to 6).
- 📝 **Practice tests:** five mixed questions across your pathway, one at a time, with an explanation after each and a score at the end. They count toward mastery.
- 🧾 **Recap card:** what you learned, a key example, and what to practice next. Copy it, download it or screenshot it before a test.
- 🔊 **Read aloud and pronunciation:** "Listen" reads any message aloud. In French and Spanish, tap an underlined phrase to hear it pronounced.
- 🎤 **Voice typing:** talk instead of type, where the browser supports it. Sage asks first, because the browser's speech service (Google, in Chrome) hears the audio.
- **Comfort:** light and dark mode, a bigger-text button, and screen-reader announcements for answers and results.

**It's free, and it doesn't need a server.** Sage is a web page hosted on GitHub Pages. The AI (an open model run with [WebLLM](https://webllm.mlc.ai)) runs inside each student's own browser, on their own device. There's no account, no API key and no subscription, nobody's laptop has to stay on, and nothing a student types leaves their device.

## Using Sage

Open the link, for example `https://adamm0909.github.io/AI-Helper/`, fill in what you're stuck on, and start.

The first time, the AI (Qwen2.5 7B, about a 5 GB download) downloads, which takes a few minutes. After that, it stays ready on the device, **even after closing the tab or the browser** (for example, when students have to close everything before a test), so Sage opens in seconds.

It needs a reasonably capable device, such as a recent laptop or desktop with at least 8 GB of memory.

### Storage: Sage tidies up after itself

- **When a pathway is finished,** Sage celebrates, then asks if you'd like to delete the chat and free up the space. You can say yes or keep going.
- **After 5 days without using Sage,** the next time you open it, Sage clears the old chat and the downloaded AI to give your storage back, and lets you know.
- **Anytime,** the start screen and sidebar show how much space Sage is using, with a **Free up space** button.

A web page can't run when it's closed, so the 5-day cleanup happens the next time Sage is opened. Browsers also clear site storage by themselves when a device runs low on space.

**What it needs:** a browser with WebGPU. That means recent Chrome or Edge (Windows, Mac, Chromebook, Android) or Safari on an up-to-date iPhone or Mac. Sage tells you if your browser can't run it. If it runs out of memory, close other tabs and apps and reload.

**School networks** sometimes block the AI download (it comes from huggingface.co). If it won't download at school, do the first load at home. After that, it loads from the device without downloading.

**Sage can make mistakes.** Free models that run in a browser are much smaller than ChatGPT or Claude. Sage is good for practice and explanations, but double-check anything important with your teacher or textbook.

## Publishing it (one-time setup)

1. In this repo on GitHub, go to **Settings → Pages**, and under **Source** choose **GitHub Actions**.
2. Merge the code into `main`. GitHub automatically runs the tests, builds the site and publishes it. It takes about two minutes; follow along in the **Actions** tab.
3. Your link appears in **Settings → Pages** (it will be `https://adamm0909.github.io/AI-Helper/`). Send it to your friends.

Every time you change something on `main`, the site updates by itself.

## Feedback from friends

The "Tell us what you think" links open a short feedback form on GitHub (questions are in `.github/ISSUE_TEMPLATE/feedback.yml`). Friends need a GitHub account to use it. If they don't have one, make a Google Form and paste its link into `public/js/config.js`.

## How it works

| File | What it does |
|---|---|
| `public/js/tutor.js` | The teaching rules and each turn's steps (grade, reply, check) |
| `public/js/subjects.js` | Teaching notes and common mistakes for each subject. Add your own here. |
| `public/js/learner.js` | Tracks progress per concept and decides the pacing advice. Plain code, no AI, so the rules are predictable and easy to change |
| `public/js/engine.js` | Loads the AI in the browser and talks to it |
| `public/js/quiz.js` | Reads the interactive questions out of Sage's replies and grades them |
| `public/js/cards.js` | The interactive cards: the four question types, practice tests and recaps |
| `public/js/practice.js`, `public/js/recap.js` | Writing and scoring practice tests; building recaps |
| `public/js/topics.js` | Keeping several topics |
| `public/js/ocr.js` | Reading text from worksheet photos (Tesseract, on the device) |
| `public/js/speech.js` | Read-aloud, pronunciation and voice typing |
| `public/js/config.js` | Settings you might change, such as where the feedback link goes |
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
8. **Interactive questions when they fit.** Sage picks multiple choice for quick checks, spotting the right form or rule, or when a student is struggling, and open questions when they should write or explain something themselves. It writes the question as a small block (`quiz`, `blank`, `order` or `match`) that the page turns into buttons, a text box, tap-to-order steps or dropdowns. Because the block includes the answer, answers are graded instantly in code (no slow or unreliable AI grading). The right word with missing accents counts as "almost". A wrong answer gets a gentle hint and the student can try again, and a right answer that took retries counts as "needed help".
9. **Fits the model's memory.** Only as much recent conversation as fits is sent, so the instructions never get cut off.

## Working on the code

You need [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
npm start      # builds the site and serves it at http://localhost:8080
npm test       # runs the tests (they use a fake AI, so no download needed)
```

GitHub runs the tests automatically on every push. The repo also opens in GitHub Codespaces for editing.

## Ideas for next steps

- Understanding diagrams in photos (needs a vision model, which is a much bigger download)
- A teacher or parent view showing which concepts a student struggles with
