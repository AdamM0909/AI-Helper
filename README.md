# Sage: an AI tutor that teaches instead of answering

Sage is a tutor for high school students who are stuck on something, like diagramming sentences, French verb tenses, algebra or chemistry. It's built on Claude, but unlike a general chatbot it won't just give the answer. It:

- **Finds out where you are first.** It asks a couple of questions before explaining anything.
- **Teaches in small steps** and checks after each one with a question you have to answer.
- **Gives hints instead of answers.** When you're wrong, it looks for the misconception and nudges you. Hints get more specific if you keep struggling.
- **Adapts to your pace.** Every answer is recorded per concept. Get a few right in a row and it speeds up. Miss twice and it slows down and explains it a different way.
- **Won't do your homework.** If you paste assignment questions, it teaches the skill with its own similar examples, then lets you do the real ones and checks your thinking.

A sidebar shows the lesson plan and how far you've got on each concept (new → learning → getting it → mastered).

## Put it online for your friends (free, from GitHub)

GitHub stores the code, but it can't run a server that keeps your API key secret. So Sage runs on **[Render](https://render.com)**, a hosting service with a free plan that deploys straight from your GitHub repo. Every time you push to GitHub, Render updates the site automatically.

**1. Get an API key and cap your spending**
- Make an account at <https://console.anthropic.com/> and create an API key.
- In the Console's billing settings, set a **monthly spend limit** (for example $10). This is your hard safety net: Anthropic stops all requests once it's reached, no matter what.
- Anthropic API accounts are for adults, and Anthropic has extra rules for apps that people under 18 use. Have a parent or teacher own the account and read the [usage policy](https://www.anthropic.com/legal/aup).

**2. Make an access code for each friend**

Open the repo in a Codespace (see below) or on any computer with Node, and run:

```bash
npm run make-codes -- alex sam jordan
```

It prints a code for each friend and an `ACCESS_CODES=...` line to copy. (You can also write codes yourself in the form `name:code,name:code`. Make them long and random.)

**3. Deploy on Render**
1. Sign up at <https://render.com> using your GitHub account.
2. Click **New → Blueprint** and pick this repository (and the branch the code is on). Render reads `render.yaml` and sets everything up.
3. When it asks, paste in your `ANTHROPIC_API_KEY` and the `ACCESS_CODES` line.
4. Click **Deploy**. After a few minutes you get a link like `https://sage-tutor-xxxx.onrender.com`.

**4. Share it.** Send each friend the link and *their own* code. To cut someone off, delete their code from `ACCESS_CODES` in Render's **Environment** settings.

About the free plan: the site goes to sleep after 15 minutes with nobody using it, so the first visit after that takes about a minute to load. Each restart also clears open chats and resets the daily counters, which is one more reason to set the spend limit in step 1.

### Safety features

| Protection | What it does |
|---|---|
| Access codes | Nobody can use Sage (or your API key) without a code you gave them. Each friend's chats are private to their code. |
| Wrong-code lockout | 10 wrong codes from one address locks it out for 15 minutes, so codes can't be guessed. |
| Daily message limit | Each friend gets `DAILY_MESSAGES_PER_FRIEND` messages a day (default 150). |
| Daily spending cap | Sage pauses for everyone once its estimated spend for the day reaches `DAILY_BUDGET_USD` (default $3). |
| Chat length limit | Very long chats get expensive, so after 150 messages Sage asks the student to start a new topic. |
| Stops unread replies | If a student closes the tab mid-reply, the request to Claude is cancelled so you don't pay for it. |
| Privacy | The server logs who sent a message, never what they wrote. Sage won't ask for personal details. Chats live only in memory and are deleted after a day of inactivity. |
| Browser security | Security headers (Content Security Policy and others) and sanitized output block malicious scripts. |

## Run it from GitHub with Codespaces

Codespaces runs the app inside GitHub, which is handy for trying changes. It's not meant for friends to use, because it shuts down when you're not using it.

1. In your repo on GitHub, go to **Settings → Secrets and variables → Codespaces** and add `ANTHROPIC_API_KEY` and `ACCESS_CODES`.
2. Click **Code → Codespaces → Create codespace**. It installs everything automatically.
3. In the terminal, run `npm start`. A browser tab opens with Sage.

## Run it on your own computer

You need [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
cp .env.example .env      # then add your API key and access codes to .env
npm start
```

Open <http://localhost:3000>.

`npm test` runs the tests. They use a fake Claude client, so they don't need a key or cost anything. GitHub also runs them automatically on every push (see the **Actions** tab).

## How it works

| File | What it does |
|---|---|
| `src/tutor.js` | The tutor's instructions (the teaching rules), the two tools Claude uses, and the loop that talks to Claude |
| `src/learner.js` | Tracks progress per concept and decides the pacing advice. Plain code, no AI, so the rules are predictable and easy to change |
| `src/guard.js` | Access codes, daily limits, spending cap and wrong-code lockout |
| `server.js` | Small Express server: checks access, creates sessions and streams replies to the browser |
| `public/` | The web page |

How pacing works: Claude has two tools the student never sees.

1. `set_lesson_plan`: once Claude knows what the student needs, it breaks the topic into a few concepts.
2. `record_check`: every time the student answers a check question, Claude records whether it was correct, partly correct or wrong, and how many hints it took. `learner.js` updates that concept's progress and sends back instructions such as *"SLOW DOWN, try a new angle"* or *"On a roll, ask a harder question"*, which Claude follows.

Three correct answers in a row without hints counts as mastered. Right answers that needed hints don't count toward mastery. To change these rules, edit `src/learner.js`.

## Good to know

- **Cost:** it uses the `claude-opus-5-5` model. Set `TUTOR_MODEL` to use a different one, and update the prices in `src/guard.js` to match so the spending cap stays accurate.
- **The daily spending cap is an estimate.** It's calculated from token counts. The Console spend limit is the real hard limit.

## Ideas for next steps

- Upload a photo of a worksheet so Sage can see the exact problem (Claude can read images)
- Save progress to a database so students can come back days later
- Spaced review: bring back old concepts after a few days so they stick
- A teacher or parent view showing which concepts a student struggles with
