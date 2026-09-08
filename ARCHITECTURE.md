# ARCHITECTURE — ask-johnny

The map. How a message becomes a Johnny reply. See `DECISIONS.md` for *why*.

## Shape
```
index.js                boot + client + the two event routers (interactions, messages)
                        — thin: it dispatches, it doesn't implement
commands/               one file per category; each exports { data, execute } (or an array)
  _loader.js            discovers every command/*.js and builds the registration + handler map
  fun.js                ask, roast, debate, rate, hottake, whatwouldyoudo, wouldyourather, haiku
  polls.js              judge, warcrime, poll  (persistent reaction votes)
  memory.js             catchup, summary, remember, facts, afk
  reminders.js          remind (me / list / cancel)
  settle.js             settle, coinflip, pick, roll
  quickfacts.js         weather, convert, wiki, tldr, yt, define  (real data, flat delivery)
  games.js              story
  quotes.js             quote (add / random / search / authors / remove) — the quote book
  lore.js               lore (add / list / remove) — server canon
  trivia.js             trivia (play / leaderboard)
  birthday.js           birthday (set / remove / list / channel)
  meta.js               help, stats, activity
  links.js              links (show / add / remove)
  starboard.js          starboard config (set / threshold / off)
lib/                    the engines the commands lean on
  johnny.js             the persona + an askJohnny() wrapper over lib/llm.js (temp ~0.95,
                        rate-limited) — it holds no model ID and no provider client
  llm.js                the OpenAI-compatible chat client — walks the provider chain, retries a
                        transient failure, falls over, strips <think> blocks from a reply
  log.js                JSON-lines log to logs/johnny.log (about 2 MB, one rollover) + console mirror
  mention.js            the @mention brain — awareness (recent chat + speaker facts + AFK + server lore)
  ratelimit.js          homegrown LLM call limiter — serialized, min-gap + reservoir, no dep
  db.js                 the JSON store: one live object, atomic debounced flush
  memory.js             last-seen, facts, AFK (+ afkNames for the mention brain)
  quotes.js             the quote book (per-guild)
  lore.js               server canon, folded into Johnny's LLM context
  trivia.js             loads content/trivia.json (Johnny's fact-checked bank) + OpenTDB + leaderboard
content/trivia.json     the committed trivia bank — 120 questions across his 15 special interests
  birthdays.js          birthday storage + date parsing (announced by the scheduler)
  scheduler.js          20s poll — fires due reminders, closes polls, daily backup
  starboard.js          the ⭐ reaction watcher → board post
  activity.js           per-guild message tallies (counts only, never content)
  cooldown.js           in-memory 4s per-user anti-spam
  embeds.js             shared colors + vote/verdict embed helpers
  weather / wiki / define / tldr / youtube / convert / util   small single-purpose helpers
config/llm.json         the provider chain — order, defaults, and per-provider baseUrl / apiKeyEnv /
                        model / modelEnv / tokenParam / extraBody
scripts/probe-llm.js    `npm run probe` — an end-to-end test of the model path, without Discord
scripts/check-voice.js  `npm run lint:voice` — scans every string for the rejected voice. Johnny's
                        voice lives in THREE places (the persona, ~44 canned replies, ~15 per-command
                        extraSystem prompts); this catches the two that are easy to forget
data/johnny.json        the whole persistent state (gitignored)
```

## The two paths in
1. **Slash command** → `interactionCreate` (index.js) → cooldown gate → `defer` →
   `handlers[name].execute(interaction, ctx)`. `ctx` hands every command the shared engines so
   command files stay thin. Success bumps the stat counter and flushes the store.
2. **@mention** → `messageCreate` (index.js) does the passive bookkeeping (last-seen, activity,
   AFK clear/notify), then hands off to `lib/mention.js`, which assembles Johnny's *awareness*
   (recent messages + what he knows about the speaker + who's away) and calls `askJohnny`.

## Time & persistence
Nothing time-based uses `setTimeout` for delivery. Reminders and polls (incl. trivia questions) are DB
rows; the single `scheduler.js` poller fires/closes them every 20s, so they survive a restart and even
fire late (with a wry apology) if the bot was down when they came due. The same poller runs the once-a-day
jobs — the birthday announcement and the data backup — each gated by a persisted stamp so a restart can't
double-fire them.

## Cost & rate limits
Every LLM call funnels through `ratelimit.js` — one global in-process limiter that serializes calls,
spaces them by a min gap (2000 ms), and caps starts per rolling window (reservoir 7). A burst of
@mentions queues rather than tripping the free-tier limit. Two guards sit in front of it: the short
per-user global cooldown (`cooldown.js`, the machine-gun guard) plus longer per-command cooldowns
(`cmd.cooldownMs`) on the expensive fetch+LLM commands. When the limiter is saturated, the @mention
path bails with a flat "cooling down" line instead of queueing a reply that lands a minute late.

The measured Groq free-tier limits are 30 requests/min, 1,000 requests/day, 8,000 tokens/min, and
200,000 tokens/day. Tokens are the binding constraint, not requests: the persona costs about 900 input
tokens per call, thus the real ceiling is about 8 calls per minute and **about 190 replies per day**.

The arrangement has two layers. The limiter shapes bursts before a call starts. `lib/llm.js` handles a
call that still fails: it retries a transient failure, then falls over to the next provider.

### The call path
`askJohnny()` → `ratelimit.schedule()` → `llm.chat()` → provider 1 (Groq `openai/gpt-oss-120b`, up to
2 retries) → provider 2 (Cloudflare Workers AI, only if its keys are set) → throw
`allProvidersFailed`. `lib/llm.js` retries a transient failure only (network error, timeout, 429, 5xx),
with 400 ms then 800 ms backoff. A permanent failure (404, 401) goes to the next provider immediately,
with no retry. `lib/log.js` records every outcome.
