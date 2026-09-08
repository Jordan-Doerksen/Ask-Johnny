# Ask-Johnny

A Discord bot with an LLM persona. The bot is provider-agnostic: `lib/llm.js` speaks to any
OpenAI-compatible chat API. Groq is the default primary provider, and Cloudflare Workers AI is the
fallback provider. The chain is in `config/llm.json`. See **The model path** below.

Johnny is dry, deadpan, and perpetually unbothered — and now grudgingly competent. He'll remember
things, set your reminders, settle an argument, and tell you the real weather, all like it cost him a
little effort. The fun is the contrast: a guy who clearly can't be
bothered, who nonetheless gets it right.

## Commands

### The fun
| Command | What it does |
|---|---|
| `/ask <question>` | Just talk to Johnny. He answers in character. |
| `/roast <user>` | Flat, understated burns. Never actually cruel. |
| `/debate <topic>` | Johnny picks a side at random and argues it, mildly annoyed he has to. |
| `/rate <thing>` | A number out of 10 and a flat one-line reason. |
| `/hottake` | An unprompted, mildly contrarian opinion. |
| `/whatwouldyoudo` | A ridiculous hypothetical for the group to riff on. |
| `/wouldyourather` | A would-you-rather with a 🇦/🇧 vote. |
| `/judge` | A moral dilemma, the server votes ✅/❌, Johnny renders a verdict after 60s. |
| `/warcrime` | A dark historical event — vote justified or not, Johnny weighs in after 60s. |
| `/haiku <topic>` | A deadpan haiku. Anticlimax guaranteed. |
| `/roll [dice]` | Dice — `2d6`, `d20`, `3d6+1`. Shows the breakdown. |
| `/story add·show·end` | A group story, one line at a time. Johnny gives the last word. |
| `/trivia play·leaderboard` | Real trivia — pick one of Johnny's own topics (his fact-checked bank) or `the web` (OpenTDB); reaction answers, scored after 30s, with the factoid on reveal. |

### The helpful
| Command | What it does |
|---|---|
| `/catchup` | Recaps what you missed in this channel since you last spoke. Private to you. |
| `/summary [count]` | Flat recap of the last chunk of chat. |
| `/remember <subject> <fact>` | Tells Johnny a fact to hold onto (shared per server). |
| `/facts <subject>` | Asks Johnny what he knows about someone or something. |
| `/remind me <when> <what>` | Sets a reminder, e.g. `in 2h`, `30m`, `3d`. Survives restarts. |
| `/remind list` / `/remind cancel <id>` | List or cancel your pending reminders. |
| `/settle <question>` | Johnny ends the argument. He just decides. |
| `/coinflip` | Heads or tails, narrated without enthusiasm. |
| `/pick a \| b \| c` | Johnny picks one at random, with a throwaway non-reason. |
| `/poll <question> <options>` | A real multi-option vote that survives restarts; Johnny tallies it later. |
| `/weather <place>` | The real weather (Open-Meteo), delivered like a chore. |
| `/convert <value> <from> <to>` | Local, correct unit conversion (length, mass, volume, temperature). |
| `/wiki <topic>` | The real Wikipedia summary, verbatim, with a flat intro. |
| `/tldr <url>` | Johnny reads a webpage so you don't have to. |
| `/yt <url>` | Summarizes a YouTube video from its captions (best-effort; YouTube blocks some hosts). |
| `/define <word>` | A real dictionary definition (not an LLM guess). |
| `/quote add·random·search·authors·remove` | The quote book — save the dumb things people say, pull them back later. |
| `/links show·add·remove` | Jordan's links & projects; editable in Discord (add/remove need Manage Server). |

### Server & meta
| Command | What it does |
|---|---|
| `/afk [reason]` | Marks you away; Johnny tells anyone who pings you, and clears it when you talk. |
| `/starboard set·threshold·off` | Mirror messages that hit enough ⭐ to a board channel. (Manage Server only.) |
| `/lore add·list·remove` | Server canon about Johnny — folded into his replies so the server co-authors who he is. (add/remove = Manage Server.) |
| `/birthday set·remove·list·channel` | Set your birthday; Johnny announces it on the day. (channel = Manage Server.) |
| `/activity` | Who actually talks here — top posters + busiest hour. |
| `/stats` | Command usage + uptime. |
| `/help` | The whole list, in his voice. |

You can also just **@mention** Johnny to talk to him. He's *aware* when you do: he sees the last few
messages in the channel (so a reply has continuity), knows who's talking to him, and quietly pulls from
what he already remembers about them — "@johnny what do you know about Dave" answers straight from his
`/facts`, and a plain ping to Johnny may work in what he knows about you if it fits. Whatever the server sets
as **canon** with `/lore` is always in his head too, so the people who run the server co-author who he is.

## How it's built

```
index.js          boot, client, interaction router, @mention + AFK + reaction handling
config/
  llm.json        the provider chain — order, defaults, and one block for each provider
commands/         one file per category — each exports { data, execute } commands
  _loader.js      discovers and registers every command
  fun.js          ask, roast, debate, haiku, roll, … the chaos
  polls.js        judge, warcrime, poll
  memory.js       catchup, summary, remember, facts, afk
  reminders.js    remind (me / list / cancel)
  settle.js       settle, coinflip, pick
  quickfacts.js   weather, convert, wiki, tldr, define
  games.js        story
  quotes.js       quote (add / random / search / authors / remove)
  lore.js         lore (add / list / remove) — server canon
  trivia.js       trivia (play / leaderboard)
  birthday.js     birthday (set / remove / list / channel)
  meta.js         help, stats, activity
  starboard.js    starboard config
lib/
  johnny.js       the persona + the askJohnny() wrapper over lib/llm.js (rate-limited)
  llm.js          the provider client — reads config/llm.json, retries, falls over, strips <think>
  log.js          JSON-lines log to logs/johnny.log (rolls at ~2 MB, keeps johnny.log.1)
  mention.js      the @mention brain — recent-chat + who he's talking to + server lore
  ratelimit.js    homegrown LLM call limiter (queues bursts, no dep)
  db.js           the JSON store (data/johnny.json) — atomic, debounced writes
  memory.js       last-seen, remembered facts, AFK, who's away
  quotes.js       the quote book (per-guild)
  lore.js         server canon, folded into Johnny's LLM context
  trivia.js       loads the local bank (content/trivia.json) + OpenTDB + the per-guild leaderboard
  birthdays.js    birthday storage + date parsing (announced by the scheduler)
  scheduler.js    every 20s: fires reminders, closes polls + trivia, daily birthday + backup
  starboard.js    mirrors ⭐'d messages to the board
  activity.js     per-guild chat tallies
  cooldown.js     in-memory per-user anti-spam
  embeds.js       shared colors + embed helpers
  weather.js      Open-Meteo lookups (no API key)
  wiki.js         Wikipedia REST summaries
  define.js       dictionaryapi.dev lookups
  tldr.js         fetch + strip a webpage for summarizing
  youtube.js      best-effort YouTube transcript fetch
  convert.js      local unit conversion tables
  util.js         small shared helpers (duration parsing, etc.)
scripts/
  probe-llm.js    the `npm run probe` model test — 4 prompts, no Discord connection
```

Persistence is a single JSON file at `data/johnny.json` (gitignored, created on first run) — no database
server, no native modules, no build step. Reminders, polls, facts, stories, AFK, starboard config, and
activity tallies all live there, so they survive a restart.

## The model path

The bot has no vendor SDK. The `groq-sdk` dependency is removed. `lib/llm.js` calls any
OpenAI-compatible chat API with `fetch` (Node 18 or later, no dependency).

`config/llm.json` holds the provider chain:

- `order` — the provider names, in the sequence to try. It is `["groq","cloudflare"]`.
- `defaults` — temperature 0.95, maxTokens 350, timeoutMs 30000.
- `providers` — one block for each provider, with `baseUrl`, `apiKeyEnv`, `model`, `modelEnv`,
  `tokenParam`, and `extraBody`.

A provider with no API key in the environment is skipped without a message.

### Primary provider — Groq

The model is `openai/gpt-oss-120b`. The provider block sends `reasoning_effort: "low"` and
`include_reasoning: false`. Two facts about this model are verified by live test:

- At the default reasoning effort (`"medium"`) the model refuses `/roast`. It replies "I'm not going
  to do that." At `"low"` it answers in character in approximately 300 ms. **The setting is not
  optional.**
- `reasoning_format` is not supported on this model. It does not cause an error. It returns an
  **empty** message. Do not add it for this model.

The previous model `llama-3.3-70b-versatile` was retired to enterprise-only accounts on 2026-08-16.
It now returns HTTP 404 `model_not_found`. This is why the bot became silent.

### Fallback provider — Cloudflare Workers AI

The fallback is dormant until you set `CF_ACCOUNT_ID` and `CF_API_TOKEN` in `.env`.

**Status: structurally verified, not live-tested.** There is no Cloudflare account to test it
against. The code path and the configuration exist, but no live reply came from this provider.

### Failure behaviour

`lib/llm.js` retries the same provider on a temporary failure: a network error, a timeout, HTTP 429,
or HTTP 5xx. There are 2 retries, with a delay of 400 ms and then 800 ms. After the retries, the
request goes to the next provider in the chain. A permanent failure — HTTP 404 for a model that is
gone, or HTTP 401 for a bad key — goes to the next provider immediately, with no retry. Tune with
`LLM_RETRIES` and `LLM_RETRY_BASE_MS`.

`lib/llm.js` also removes `<think>...</think>` blocks from each reply, including a block with no end
tag. Thus a reasoning model cannot post its scratchpad to Discord.

### Free-tier ceilings (Groq)

These limits are measured against the live key, and they agree with Groq's published table:

| Limit | Value |
|---|---|
| Requests each minute | 30 |
| Requests each day | 1,000 |
| Tokens each minute | 8,000 |
| Tokens each day | 200,000 |

The persona costs approximately 900 input tokens on each call. **Thus the real ceiling is
approximately 190 LLM replies each day.** The tokens-each-minute limit is the constraint, not the
requests-each-minute limit: it permits approximately 8 calls each minute.

### Logging

`lib/log.js` writes structured JSON lines to `logs/johnny.log`, and it also writes each line to the
console. The file rolls at approximately 2 MB and keeps one previous file, `johnny.log.1`. The
`logs/` folder is gitignored.

- `LOG_TO_FILE=0` stops the file writes. The console output continues.
- `LOG_MAX_BYTES` changes the roll size.

### The probe

`npm run probe` (`scripts/probe-llm.js`) tests the model path from end to end. It does not start the
bot, and it does not connect to Discord. It prints the active provider chain, then it sends 4
prompts: a plain question, a special-interest question, a roast, and a jailbreak attempt. It examines
each reply for leaked chain-of-thought and for broken character. Exit code 0 is a pass. All 4 probes
pass at this time.

Run the probe first when Johnny is silent. It shows if the fault is in the model path or in Discord.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill it in:
   - **BOT_TOKEN** — Discord Developer Portal → your app → **Bot** → Reset Token
   - **CLIENT_ID** — Developer Portal → **General Information** → Application ID
   - **GROQ_API_KEY** — the key for the default primary provider. See below.
   - **GUILD_ID** *(optional)* — a server ID; set it so command changes appear instantly while testing
   - **GROQ_MODEL** *(optional)* — overrides the model in `config/llm.json`. The default is
     `openai/gpt-oss-120b`.
   - **CF_ACCOUNT_ID** / **CF_API_TOKEN** *(optional)* — these two turn on the Cloudflare fallback.
     Leave them empty to keep the fallback dormant.
   - **LOG_TO_FILE** / **LOG_MAX_BYTES** / **LLM_RETRIES** / **LLM_RETRY_BASE_MS** *(optional)* — see
     **The model path** above.
3. In the Developer Portal → **Bot**, enable the **Message Content Intent** (Johnny needs it for
   @mentions, `/catchup`, and last-seen tracking).
4. `npm run probe` — this confirms the model path before you start the bot.
5. `npm start`

The startup guard requires `BOT_TOKEN` and `CLIENT_ID`. It then requires a minimum of one configured
LLM provider. It does not ask for `GROQ_API_KEY` by name, so a Cloudflare-only installation also
starts. The boot line writes the full provider chain to the log.

### Getting a Groq API key

1. Go to **console.groq.com**, sign up (free, no credit card).
2. **API Keys** → **Create API Key**, copy it into `GROQ_API_KEY`.
3. The free-tier ceilings are in the table above. They give approximately 190 replies each day.

### Inviting the bot

Developer Portal → **OAuth2 → URL Generator** → scopes `bot` + `applications.commands`,
then open the generated URL and add it to your server.

## Deploy to Wispbyte (free)

The panel is at **https://wispbyte.com/client**. It is a custom Wispbyte panel with a Pterodactyl
lineage, so it uses "egg" vocabulary.

1. Push this folder to a GitHub repo. The `.gitignore` keeps `.env`, `node_modules`, `data/`, and
   `logs/` out of the repo. Never commit a token.
2. **Environment variables** — Panel → your server → **Startup** → **Server Configuration**. Put
   `BOT_TOKEN`, `CLIENT_ID`, `GROQ_API_KEY`, and each optional variable there.
3. **Node version** — Panel → **Startup** → the **Docker Image** selector. `package.json` requires
   Node 18 or later. Select an image with that version or a later version.
4. **Repository** — Panel → your server → **GitHub Integration** holds the repository URL, the
   branch, and the **Clone** and **Pull** buttons.
5. **Start** — Console → **Restart**. `npm install` runs automatically at each start, because
   `package.json` is at the container root.

### The panel wins over .env

The panel injects its variables into the container environment before Node starts, and `dotenv` never
replaces a variable that is already in the environment. Thus a panel variable always wins over an
uploaded `.env` file. Also, `.env` is gitignored, so a `git clone` puts no `.env` file on the server.
The panel is the real source of the configuration. Wispbyte's own security page gives the same
instruction: use panel variables, and do not commit `.env` files.

### Updates

`AUTO_UPDATE` is in Startup → Server Configuration.

- If `AUTO_UPDATE` is 1, a `git pull` runs at each start. Console → **Restart** is sufficient.
- If `AUTO_UPDATE` is 0, press **Pull** on the GitHub Integration page, and then **Restart**.

The value on this server is **not verified**. Look at Startup → Server Configuration before you
deploy.

### One Discord bot for each server

Wispbyte permits only ONE Discord bot for each server, and it does a check every minute. It stops a
server that runs two bots automatically.

Ask-johnny starts one Discord application only. It does not start a second bot. Thus this server
obeys the rule. The rule stays in force on the account: if you add a second bot later, give it its
own Wispbyte server.

The `fun-police` bot was removed from this repo on 2026-09-07. The bot is not deleted. It continues
as its own repo at `github.com/Jordan-Doerksen/fun-police`.

### Free-tier conditions

- **Login** — log in to the panel a minimum of one time every 2 weeks, or the server stops. The login
  page says 2 weeks and the knowledge base says 1 month. Use the shorter figure. An inactive server
  is archived, not deleted.
- **Shared IP address** — the free tier shares one outbound IP address. Thus Discord rate limits
  caused by other people's bots can make your bot slow. The console shows a banner with a countdown
  at these times. Do not restart the server again and again during a countdown.
- **No shell** — there is no SSH. SFTP is a premium-only feature.

> Note: `data/johnny.json` is gitignored, so reminders and facts stay across a restart, but not
> across a fresh deployment that erases the working directory. For a friends' server that is the
> correct compromise.

## Notes

- Johnny never breaks character and never admits he's an AI.
- Temperature runs high (≈0.95) on purpose — that's where the chaos lives.
- Real data (weather, conversions, dictionary, Wikipedia, reminders, poll tallies) is always real —
  Johnny only voices the wrapper around it, never invents the facts or numbers.
- LLM calls are rate-limited in-process (`lib/ratelimit.js`), so a burst of @mentions queues instead of
  tripping the free-tier limit; when it's saturated Johnny says so rather than erroring. The defaults
  are now `GROQ_MIN_TIME_MS` 2000 (from 1200) and `GROQ_RESERVOIR` 7 (from 20). The reason is the
  8,000 tokens-each-minute ceiling: at approximately 900 input tokens for each call, the true limit is
  approximately 8 calls each minute, not 20. Tune with `GROQ_MIN_TIME_MS` / `GROQ_RESERVOIR` /
  `GROQ_WINDOW_MS`.
- Dependencies: discord.js is `^14.27.0`. The `undici` override is `^6.27.1`; the previous `^6.27.0`
  pin no longer cleared the advisories, because the advisory range is `<=6.27.0`. `npm audit` now
  reports 0 vulnerabilities, from 3 moderate.
- The starboard is off until someone with **Manage Server** runs `/starboard set #channel`. It uses the
  (non-privileged) Server Reactions intent, so there's nothing extra to enable in the portal.
- **Daily backup:** set `BACKUP_CHANNEL_ID` (a private channel) or `OWNER_ID` (a DM) and the bot posts
  `data/johnny.json` once a day — a backup that survives a full host wipe, no paid plan needed. To
  restore, download the attachment and put it back into `data/` through Files. Off if unset.
