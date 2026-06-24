# Ask-Johnny

A Discord bot powered by Groq (Llama). Johnny is dry, deadpan, and perpetually unbothered — and now
grudgingly competent. He'll remember things, set your reminders, settle an argument, and tell you the
real weather, all like it cost him a little effort. The fun is the contrast: a guy who clearly can't be
bothered, who nonetheless gets it right.

## Commands

### The fun
| Command | What it does |
|---|---|
| `/ask <question>` | Just talk to Johnny. He answers in character. |
| `/roast <user>` | Flat, understated burns. Never actually cruel. |
| `/debate <topic>` | Johnny picks a side at random and argues it, mildly annoyed he has to. |
| `/simp <user>` | Reluctant, low-key homie respect. |
| `/news <topic>` | Vibe-based, half-remembered "latest" on a topic. Probably wrong. |
| `/rate <thing>` | A number out of 10 and a flat one-line reason. |
| `/hottake` | An unprompted, mildly contrarian opinion. |
| `/whatwouldyoudo` | A ridiculous hypothetical for the group to riff on. |
| `/wouldyourather` | A would-you-rather with a 🇦/🇧 vote. |
| `/hotpoll <question>` | Johnny's take + a 👍/👎 vote. |
| `/judge` | A moral dilemma, the server votes ✅/❌, Johnny renders a verdict after 60s. |
| `/warcrime` | A dark historical event — vote justified or not, Johnny weighs in after 60s. |
| `/haiku <topic>` | A deadpan haiku. Anticlimax guaranteed. |
| `/roll [dice]` | Dice — `2d6`, `d20`, `3d6+1`. Shows the breakdown. |
| `/story add·show·end` | A group story, one line at a time. Johnny gives the last word. |

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

### Server & meta
| Command | What it does |
|---|---|
| `/afk [reason]` | Marks you away; Johnny tells anyone who pings you, and clears it when you talk. |
| `/starboard set·threshold·off` | Mirror messages that hit enough ⭐ to a board channel. (Manage Server only.) |
| `/activity` | Who actually talks here — top posters + busiest hour. |
| `/stats` | Command usage + uptime. |
| `/help` | The whole list, in his voice. |

You can also just **@mention** Johnny to talk to him — and "@johnny what do you know about Dave"
pulls from his `/facts`.

## How it's built

```
index.js          boot, client, interaction router, @mention + AFK + reaction handling
commands/         one file per category — each exports { data, execute } commands
  _loader.js      discovers and registers every command
  fun.js          ask, roast, debate, haiku, roll, … the chaos
  polls.js        judge, warcrime, poll
  memory.js       catchup, summary, remember, facts, afk
  reminders.js    remind (me / list / cancel)
  settle.js       settle, coinflip, pick
  quickfacts.js   weather, convert, wiki, tldr, define
  games.js        story
  meta.js         help, stats, activity
  starboard.js    starboard config
lib/
  johnny.js       the persona + askJohnny() Groq wrapper
  db.js           the JSON store (data/johnny.json) — atomic, debounced writes
  memory.js       last-seen, remembered facts, AFK
  scheduler.js    fires due reminders and closes polls every 20s
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
```

Persistence is a single JSON file at `data/johnny.json` (gitignored, created on first run) — no database
server, no native modules, no build step. Reminders, polls, facts, stories, AFK, starboard config, and
activity tallies all live there, so they survive a restart.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill it in:
   - **BOT_TOKEN** — Discord Developer Portal → your app → **Bot** → Reset Token
   - **CLIENT_ID** — Developer Portal → **General Information** → Application ID
   - **GROQ_API_KEY** — see below
   - **GUILD_ID** *(optional)* — a server ID; set it so command changes appear instantly while testing
   - **GROQ_MODEL** *(optional)* — defaults to `llama-3.3-70b-versatile`
3. In the Developer Portal → **Bot**, enable the **Message Content Intent** (Johnny needs it for
   @mentions, `/catchup`, and last-seen tracking).
4. `npm start`

### Getting a Groq API key

1. Go to **console.groq.com**, sign up (free, no credit card).
2. **API Keys** → **Create API Key**, copy it into `GROQ_API_KEY`.

### Inviting the bot

Developer Portal → **OAuth2 → URL Generator** → scopes `bot` + `applications.commands`,
then open the generated URL and add it to your server.

## Deploy to Wispbyte (free)

1. Push this folder to a GitHub repo (the `.gitignore` keeps `.env`, `node_modules`, and `data/` out —
   never commit your token).
2. Create the bot on Wispbyte, point it at the repo, set the start command to `npm start`.
3. Add `BOT_TOKEN`, `CLIENT_ID`, and `GROQ_API_KEY` as environment variables in the Wispbyte panel.

> Note: `data/johnny.json` is gitignored, so reminders/facts persist across restarts but not across a
> fresh redeploy that wipes the working directory. For a friends' server that's the right trade.

## Notes

- Johnny never breaks character and never admits he's an AI.
- Temperature runs high (≈0.95) on purpose — that's where the chaos lives.
- Real data (weather, conversions, dictionary, Wikipedia, reminders, poll tallies) is always real —
  Johnny only voices the wrapper around it, never invents the facts or numbers.
- The starboard is off until someone with **Manage Server** runs `/starboard set #channel`. It uses the
  (non-privileged) Server Reactions intent, so there's nothing extra to enable in the portal.
- **Daily backup:** set `BACKUP_CHANNEL_ID` (a private channel) or `OWNER_ID` (a DM) and the bot posts
  `data/johnny.json` + `fun-police/banlist.json` once a day — a backup that survives a full host wipe,
  no paid plan needed. To restore, download the attachment and drop it back into Files. Off if unset.
