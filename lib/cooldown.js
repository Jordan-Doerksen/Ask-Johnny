// Per-user cooldown shared across slash commands and @mentions, so the boys
// can't machine-gun Johnny. In-memory only, and deliberately NOT persisted:
// after any restart every 4-second window is already expired, so there's
// nothing worth writing to disk.
const COOLDOWN_MS = 4000;
const lastUsed = new Map();

function onCooldown(userId) {
  const now = Date.now();
  if (now - (lastUsed.get(userId) || 0) < COOLDOWN_MS) return true;
  lastUsed.set(userId, now);
  return false;
}

module.exports = { onCooldown };
