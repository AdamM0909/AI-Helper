// Rules for when Sage tidies up after itself, kept separate so they're easy
// to test and change.

// After this many days without opening Sage, it removes the stored AI and the
// old chat the next time it's opened, to give the space back.
export const IDLE_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export function idleTooLong(lastUsed, now = Date.now(), days = IDLE_DAYS) {
  return typeof lastUsed === "number" && now - lastUsed > days * DAY_MS;
}

// A pathway is complete when every concept in the lesson plan is mastered.
export function pathwayComplete(progress) {
  return progress.concepts.length > 0 && progress.concepts.every((c) => c.level === 3);
}
