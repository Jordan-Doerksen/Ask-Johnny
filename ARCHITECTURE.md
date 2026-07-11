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
  johnny.js             the persona + askJohnny() Groq wrapper (temp ~0.95, rate-limited)
  mention.js            the @mention brain — awareness (recent chat + speaker facts + AFK + server lore)
  ratelimit.js          homegrown Groq call limiter — serialized, min-gap + reservoir, no dep
  db.js                 the JSON store: one live object, atomic debounced flush
  memory.js             last-seen, facts, AFK (+ afkNames for the mention brain)
  quotes.js             the quote book (per-guild)
  lore.js               server canon, folded into Johnny's LLM context
  trivia.js             OpenTDB question fetch + the per-guild leaderboard
  birthdays.js          birthday storage + date parsing (announced by the scheduler)
  scheduler.js          20s poll — fires due reminders, closes polls, daily backup
  starboard.js          the ⭐ reaction watcher → board post
  activity.js           per-guild message tallies (counts only, never content)
  cooldown.js           in-memory 4s per-user anti-spam
  embeds.js             shared colors + vote/verdict embed helpers
  weather / wiki / define / tldr / youtube / convert / util   small single-purpose helpers
fun-police/             vendored ban-list bot, co-launched as a child process (own creds)
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
Every Groq call funnels through `ratelimit.js` — one global in-process limiter that serializes calls,
spaces them by a min gap, and caps starts per rolling window. A burst of @mentions queues rather than
tripping Groq's free-tier limit. Two guards sit in front of it: the short per-user global cooldown
(`cooldown.js`, the machine-gun guard) plus longer per-command cooldowns (`cmd.cooldownMs`) on the
expensive fetch+LLM commands. When the limiter is saturated, the @mention path bails with a flat
"cooling down" line instead of queueing a reply that lands a minute late.
