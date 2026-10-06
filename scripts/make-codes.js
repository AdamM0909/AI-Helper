// Prints an ACCESS_CODES line with one random code per friend.
// Usage: npm run make-codes -- alex sam jordan
import { randomInt } from "node:crypto";

const letters = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o or 1/l/i, so codes are easy to read out
const chunk = () => Array.from({ length: 4 }, () => letters[randomInt(letters.length)]).join("");
const names = process.argv.slice(2);
if (names.length === 0) names.push("friend1", "friend2", "friend3");

const entries = names.map((name) => `${name.replace(/[,:]/g, "")}:${chunk()}-${chunk()}-${chunk()}`);
console.log("Give each friend their own code:\n");
for (const entry of entries) console.log(`  ${entry.replace(":", "  →  ")}`);
console.log("\nThen put this line in .env (or in your host's environment settings):\n");
console.log(`ACCESS_CODES=${entries.join(",")}`);
