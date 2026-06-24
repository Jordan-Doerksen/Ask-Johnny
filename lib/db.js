const fs = require('fs');
const path = require('path');

// A dead-simple persistent store: the whole dataset lives in memory as one
// object and is written to data/johnny.json via an atomic, debounced flush.
// No native modules, no build step — so `npm install && npm start` stays green
// on a free host. Scale is tiny (a friends' server), and the only real risks —
// partial writes and lost-on-crash writes — are handled below.

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'johnny.json');

const EMPTY = {
  version: 1,
  reminders: [],
  facts: [],
  lastSeen: {},
  polls: [],
  stories: {},
  afk: {},
  stats: { commandCounts: {} },
  starboard: {},
  starred: {},
  activity: {},
};

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      return { ...JSON.parse(JSON.stringify(EMPTY)), ...parsed };
    }
  } catch (err) {
    // Corrupt file: back it up and start fresh rather than crash-loop.
    console.error('db: failed to read johnny.json, starting fresh:', err.message);
    try { fs.renameSync(FILE, `${FILE}.corrupt`); } catch (_) { /* ignore */ }
  }
  return JSON.parse(JSON.stringify(EMPTY));
}

// `data` is the single live object every other module reads and mutates
// directly. It is never reassigned after this point, so the exported reference
// stays valid.
const data = load();

let flushTimer = null;

// Debounced write — coalesces bursts (e.g. last-seen updates) into one write.
function flush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushNow();
  }, 1000);
}

// Synchronous atomic write: tmp file + rename, so a crash mid-write leaves the
// previous good file intact. Used on shutdown and by flush().
function flushNow() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.error('db: flush failed:', err.message);
  }
}

module.exports = { data, flush, flushNow };
