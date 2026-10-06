import { timingSafeEqual, createHash } from "node:crypto";

// Keeps the tutor safe to share: only people with an access code get in,
// each code has a daily message limit (so nobody can hog your computer), and
// repeated wrong codes from one address are locked out for a while.

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 10;

// ACCESS_CODES looks like "alex:7fq2-k9dm-w3xp,sam:h4rt-2bnc-q8ze".
// The name is just a label for you; it shows up in the server log.
export function parseAccessCodes(text = "") {
  const codes = new Map();
  for (const entry of text.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const split = trimmed.lastIndexOf(":");
    const name = split > 0 ? trimmed.slice(0, split).trim() : `friend${codes.size + 1}`;
    const code = split > 0 ? trimmed.slice(split + 1).trim() : trimmed;
    if (code) codes.set(code, name);
  }
  return codes;
}

// Hashing first makes both sides the same length, so the comparison takes
// the same time whether the guess is close or not.
function sameCode(a, b) {
  const hash = (s) => createHash("sha256").update(s).digest();
  return timingSafeEqual(hash(a), hash(b));
}

export function createGuard({ codes, dailyMessagesPerCode = 150, now = Date.now }) {
  let day = "";
  const messagesToday = new Map(); // code -> count
  const failedLogins = new Map(); // ip -> { count, since }

  // Counters reset at midnight UTC.
  function rollDay() {
    const today = new Date(now()).toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      messagesToday.clear();
    }
  }

  function lockedOut(ip) {
    const entry = failedLogins.get(ip);
    if (!entry) return false;
    if (now() - entry.since > LOGIN_WINDOW_MS) {
      failedLogins.delete(ip);
      return false;
    }
    return entry.count >= MAX_FAILED_LOGINS;
  }

  return {
    // Returns { ok: true, name } or { ok: false, status, error }.
    checkCode(code, ip) {
      if (lockedOut(ip)) return { ok: false, status: 429, error: "Too many wrong codes. Wait 15 minutes and try again." };
      let name = null;
      if (typeof code === "string" && code) {
        for (const [known, label] of codes) if (sameCode(code, known)) name = label;
      }
      if (name) return { ok: true, name };
      const entry = failedLogins.get(ip) || { count: 0, since: now() };
      entry.count += 1;
      failedLogins.set(ip, entry);
      return { ok: false, status: 401, error: "That access code isn't right. Ask whoever shared Sage with you for yours." };
    },

    canSend(code) {
      rollDay();
      if ((messagesToday.get(code) || 0) >= dailyMessagesPerCode) {
        return { ok: false, error: "You've used all your messages for today. Nice work studying! Come back tomorrow." };
      }
      return { ok: true };
    },

    recordMessage(code) {
      rollDay();
      messagesToday.set(code, (messagesToday.get(code) || 0) + 1);
    },

    remaining(code) {
      rollDay();
      return Math.max(0, dailyMessagesPerCode - (messagesToday.get(code) || 0));
    },
  };
}
