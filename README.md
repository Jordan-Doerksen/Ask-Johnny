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

### The helpful
| Command | What it does |
|---|---|
| `/catchup` | Recaps what you missed in this channel since you last spoke. Private to you. |
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

You can also just **@mention** Johnny to talk to him without a slash command.

## How it's built

```
index.js          boot, client, the interaction router, passive last-seen logging
commands/         one file per category — each exports { data, execute } commands
  _loader.js      discovers and registers every command
lib/
  johnny.js       the persona + askJohnny() Groq wrapper
  db.js           the JSON store (data/johnny.json) — atomic, debounced writes
  memory.js       last-seen + remembered facts
  scheduler.js    fires due reminders and closes polls every 20s
  cooldown.js     in-memory per-user anti-spam
  embeds.js       shared colors + embed helpers
  weather.js      Open-Meteo lookups (no API key)
  convert.js      local unit conversion tables
  util.js         small shared helpers (duration parsing, etc.)
```

Persistence is a single JSON file at `data/johnny.json` (gitignored, created on first run) — no database
server, no native modules, no build step. Reminders and polls live there, so they survive a restart.

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
- Real data (weather, conversions, reminders, poll tallies) is always real — Johnny only voices the
  wrapper around it, never invents the numbers.
