// Per-user cooldown shared across slash commands and @mentions, so the boys
// can't machine-gun Johnny. In-memory only, and deliberately NOT persisted:
// after any restart every window is already expired, so there's nothing worth
// writing to disk.
//
// Two layers: a short GLOBAL window per user (the machine-gun guard, spanning all
// commands + @mentions), and an optional per-command window (`scope`) so the
// expensive LLM/fetch commands can rest longer without slowing down /roll.
const COOLDOWN_MS = 4000;
const lastUsed = new Map(); // `${userId}:${scope}` -> last-used timestamp

const keyFor = (userId, scope) => `${userId}:${scope}`;

// Pure check: is the user still inside `ms` of their last recorded use of `scope`?
// Deliberately does NOT record — so the caller can peek several windows and commit
// only once it's decided to actually run (see index.js), instead of a rejected
// command burning an unrelated window.
function check(userId, ms = COOLDOWN_MS, scope = 'global') {
  return Date.now() - (lastUsed.get(keyFor(userId, scope)) || 0) < ms;
}

// Record a use now. Call only when the interaction is actually going ahead.
function mark(userId, scope = 'global') {
  lastUsed.set(keyFor(userId, scope), Date.now());
}

module.exports = { check, mark };
