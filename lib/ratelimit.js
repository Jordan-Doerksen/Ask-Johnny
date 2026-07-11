// A tiny in-house rate limiter for Groq calls — no dependency (SGrondin/bottleneck
// was the reference; a friends'-server bot doesn't need it or a native module).
// It serializes Groq calls, enforces a minimum gap between them, and caps how many
// start within a rolling window, so a burst of @mentions QUEUES instead of tripping
// Groq's free-tier ~30 req/min limit and erroring in the channel.
//
// Tunable via env (all optional): GROQ_MIN_TIME_MS, GROQ_RESERVOIR,
// GROQ_WINDOW_MS, GROQ_MAX_WAIT_MS.

const MIN_TIME_MS = Number(process.env.GROQ_MIN_TIME_MS) || 1200; // min gap between call starts
const RESERVOIR = Number(process.env.GROQ_RESERVOIR) || 20;       // max starts per window
const WINDOW_MS = Number(process.env.GROQ_WINDOW_MS) || 60_000;   // rolling window
const MAX_WAIT_MS = Number(process.env.GROQ_MAX_WAIT_MS) || 15_000; // over this, callers should bail with a flat line

const starts = []; // timestamps of recent call starts (pruned to the window)
let pending = 0;   // scheduled but not yet settled — what a fresh call would wait behind
let chain = Promise.resolve(); // serializes scheduled calls so only one waits at a time

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Prune anything older than the window, then compute how long until the next call
// may start given the min-gap and reservoir constraints.
function waitNeeded(now) {
  while (starts.length && now - starts[0] >= WINDOW_MS) starts.shift();
  const gapWait = starts.length ? Math.max(0, starts[starts.length - 1] + MIN_TIME_MS - now) : 0;
  const resWait = starts.length >= RESERVOIR ? Math.max(0, starts[starts.length - RESERVOIR] + WINDOW_MS - now) : 0;
  return Math.max(gapWait, resWait);
}

// Best-effort read of how long the NEXT call would wait right now — used by the
// @mention path to bail with an honest "cooling down" line instead of queueing a
// reply that lands a minute late. Counts the queue DEPTH (`pending`), not just the
// window/gap, so a burst that hasn't started running yet still trips the bail —
// each queued call needs at least MIN_TIME_MS to clear. (A perfectly synchronized
// microburst can slip a few past before `pending` climbs; fine at this scale.)
// Does not reserve a slot.
function projectedWaitMs() {
  return Math.max(waitNeeded(Date.now()), pending * MIN_TIME_MS);
}

// Run fn() through the limiter; resolves with fn()'s result (or rejects with its
// error). Calls run in submission order, one waiting at a time.
function schedule(fn) {
  pending++;
  const run = chain.then(async () => {
    for (;;) {
      const wait = waitNeeded(Date.now());
      if (wait <= 0) break;
      await sleep(wait);
    }
    starts.push(Date.now());
    return fn();
  });
  // Decrement once this call settles, and keep the chain alive even if it threw,
  // so one failure neither wedges the queue nor leaks a pending slot.
  chain = run.then(() => { pending--; }, () => { pending--; });
  return run;
}

module.exports = { schedule, projectedWaitMs, MAX_WAIT_MS };
