// Persistent structured logging.
//
// Why this exists: when Groq retired llama-3.3-70b-versatile, every LLM call started
// returning 404 and the ONLY trace was a console.error on a host console nobody reads.
// The server just saw "brain buffered for a sec" and Johnny looked broken for no reason.
// A silent failure is a defect — so failures now land in a file that survives a restart.
//
// Deliberately tiny: JSONL to logs/johnny.log, size-capped with one rollover, no deps.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'logs');
const FILE = path.join(DIR, 'johnny.log');
const PREV = path.join(DIR, 'johnny.log.1');
const MAX_BYTES = Number(process.env.LOG_MAX_BYTES) || 2_000_000; // ~2MB, then roll once
const TO_FILE = process.env.LOG_TO_FILE !== '0'; // set LOG_TO_FILE=0 on a read-only disk

let warnedFileFailure = false;

// Roll the log when it gets big, keeping exactly one previous file. On a host with a
// small disk quota (Wispbyte free is 8GB but shared) unbounded logs are their own bug.
function rollIfNeeded() {
  try {
    const { size } = fs.statSync(FILE);
    if (size < MAX_BYTES) return;
    fs.rmSync(PREV, { force: true });
    fs.renameSync(FILE, PREV);
  } catch (_) {
    /* no file yet, or the rename raced — either way the next append recreates it */
  }
}

function write(level, event, fields) {
  const line = { t: new Date().toISOString(), level, event, ...fields };

  // Console first: on Wispbyte this is the live console pane, and it must never be
  // blocked by a disk problem.
  const summary = Object.entries(fields || {})
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  const out = `[${line.t}] ${level.toUpperCase()} ${event}${summary ? ' ' + summary : ''}`;
  if (level === 'error') console.error(out);
  else console.log(out);

  if (!TO_FILE) return;
  try {
    fs.mkdirSync(DIR, { recursive: true });
    rollIfNeeded();
    fs.appendFileSync(FILE, JSON.stringify(line) + '\n');
  } catch (err) {
    // Never let logging take the bot down. Say so once, then stay quiet about it.
    if (!warnedFileFailure) {
      warnedFileFailure = true;
      console.error(`[log] file logging disabled — ${err.message}`);
    }
  }
}

const info = (event, fields) => write('info', event, fields);
const warn = (event, fields) => write('warn', event, fields);
const error = (event, fields) => write('error', event, fields);

module.exports = { info, warn, error, FILE, PREV };
