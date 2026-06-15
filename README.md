# Ask-Johnny

A Discord bot powered by Groq (Llama). Johnny is a blissfully unaware, confidently earnest normie
who gets all his information from headlines and vibes. He's not mean, not edgy — just genuinely and
sincerely wrong about most things.

## Commands

| Command | What it does |
|---|---|
| `/ask <question>` | Just talk to Johnny. He answers in character. |
| `/roast <user>` | Johnny roasts a homie — crude, earnest, never vicious. |
| `/debate <topic>` | Johnny randomly picks a side and argues it like he read one tweet. |
| `/simp <user>` | Over-the-top sincere homie hype. |
| `/news <topic>` | Johnny's vibe-based, half-remembered "latest" on a topic. |
| `/whatwouldyoudo` | A ridiculous hypothetical for the group to riff on. |
| `/hotpoll <question>` | Johnny's take + a 👍/👎 vote that just lives in chat. |
| `/judge` | Johnny poses a moral dilemma, the server votes ✅/❌, he renders a verdict after 60s. |
| `/warcrime` | A dark historical event — vote justified or not, Johnny weighs in after 60s. |

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill it in:
   - **BOT_TOKEN** — Discord Developer Portal → your app → **Bot** → Reset Token
   - **CLIENT_ID** — Developer Portal → **General Information** → Application ID
   - **GROQ_API_KEY** — see below
   - **GUILD_ID** *(optional)* — a server ID; set it so command changes appear instantly while testing
   - **GROQ_MODEL** *(optional)* — defaults to `llama-3.3-70b-versatile`
3. `npm start`

### Getting a Groq API key

1. Go to **console.groq.com**, sign up (free, no credit card).
2. **API Keys** → **Create API Key**, copy it into `GROQ_API_KEY`.

### Inviting the bot

Developer Portal → **OAuth2 → URL Generator** → scopes `bot` + `applications.commands`,
then open the generated URL and add it to your server.

## Deploy to Wispbyte (free)

1. Push this folder to a GitHub repo (the `.gitignore` keeps `.env` and `node_modules` out — never commit your token).
2. Create the bot on Wispbyte, point it at the repo, set the start command to `npm start`.
3. Add `BOT_TOKEN`, `CLIENT_ID`, and `GROQ_API_KEY` as environment variables in the Wispbyte panel.

## Notes

- Johnny never breaks character and never admits he's an AI.
- Temperature runs high (≈0.95) on purpose — that's where the chaos lives.
- Poll state for `/judge` and `/warcrime` is held in memory for 60 seconds. If the bot restarts
  mid-poll, that poll quietly dies. No database, by design.
