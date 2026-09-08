# RUNBOOK — ask-johnny

This document has two jobs.

1. It is the bug-identification-and-fix plan for this bot (observability law).
2. It is the refresher for the Wispbyte hosting panel.

Read Part 1 when Johnny is quiet or wrong. Read Part 2 when you must change something in the
panel. Read Part 3 for the routine jobs.

---

# Part 1 — Is it broken, and where do I look?

## 1.1 The log

| Item | Value |
|---|---|
| File | `logs/johnny.log` |
| Format | JSON lines. One object on each line. |
| Order | Oldest at the top. Newest at the bottom. |
| Rollover | At approximately 2 MB the file moves to `logs/johnny.log.1`. One old file is kept. |
| Git | The `logs/` directory is gitignored. The log is per host. |
| Restart | The log stays after a restart. |
| Redeploy | The log does not stay after a fresh deployment that erases the directory. |
| `LOG_TO_FILE=0` | Stops file logging. The console output continues. |
| `LOG_MAX_BYTES` | Changes the rollover size in bytes. |

## 1.2 The events

| Event | Meaning | Fields |
|---|---|---|
| `boot` | The bot connected to Discord. **Read this line first.** It shows which model Johnny uses. | `as` (bot tag), `chain` (the full provider chain), `commands` (count) |
| `llm.ok` | A model answered. | `provider`, `model`, `ms`, `in` (input tokens), `out` (output tokens), `attempt` (0 = first try), `fellBack` (true = the primary provider failed and a fallback answered) |
| `llm.call_failed` | One attempt at one provider failed. | `provider`, `model`, `status`, `msg`, `attempt`, `willRetry` |
| `llm.no_providers` | No provider is configured. The API key is missing. | — |
| `command_failed` | A slash command did not complete. | `providers: true` means all LLM providers failed |
| `mention_failed` | An @mention reply did not complete. | `providers: true` means all LLM providers failed |
| `starboard_failed` | The starboard operation failed. | — |
| `startup_failed` | The bot did not start. | — |

## 1.3 Triage order

1. **Run `npm run probe`.** This tests the model path from end to end. It does not use Discord.
   It prints the active provider chain. Exit code 0 means the brain is reachable and in
   character. This is the fastest answer. Always do this first.
2. **If the probe fails, read the newest `llm.call_failed` line.** Find the `status` field. Use
   the status table in 1.4.
3. **If the probe passes, but Discord is quiet, the fault is in Discord, not in the model.**
   Do these three checks:
   - The bot shows as online in the server.
   - The Message Content Intent is on in the Discord Developer Portal.
   - The Wispbyte Console shows no Discord rate-limit banner.
4. **If the console shows nothing, the process does not run.** Open Wispbyte Console. Look for a
   crash. Read the `startup_failed` line.

## 1.4 Status codes

| Status | Meaning | Fix |
|---|---|---|
| `404` | The model does not exist on this account. **This is the 2026-08-16 failure.** | Set `GROQ_MODEL` in the panel to a live model. Then restart. Or edit `config/llm.json`. To list the live models, run: `curl -H "Authorization: Bearer $GROQ_API_KEY" https://api.groq.com/openai/v1/models` |
| `401` | The API key is wrong, revoked, or missing. | Make a new key at `console.groq.com`. Put it in the Wispbyte panel. |
| `429` | Rate limited. | Usually, wait. If it continues, lower `GROQ_RESERVOIR` or raise `GROQ_MIN_TIME_MS`. Also check the daily token budget in 1.6. |
| `5xx` | The provider is down. | Do nothing. The bot retries, then it uses a configured fallback. |
| `0` | No answer. A network error, or the 30-second timeout. | Do nothing. The bot retries. |
| `502` from our own code | The model returned an EMPTY message. Usually a wrong reasoning parameter. | Never set `reasoning_format` on a gpt-oss model. |

## 1.5 Known silent areas

These parts do **not** write to `logs/johnny.log`. A fault in them does not show in the log.

- Discord API failures inside the `.catch(() => {})` handlers on the AFK replies in `index.js`.
- The per-tick work of the scheduler: reminders, poll closing, birthdays, and the daily backup.
  This work writes to the console only. It does not go through `lib/log.js`.
- Data-store write failures in `lib/db.js`.

If a bug hides, add logging in these three places first.

## 1.6 The measured operating ceilings

| Limit | Value |
|---|---|
| Requests each minute | 30 |
| Requests each day | 1,000 |
| Tokens each minute | 8,000 |
| Tokens each day | 200,000 |

The persona costs approximately 900 input tokens on every call. Thus the real ceiling is
approximately **190 LLM replies each day**. The daily TOKEN budget ends before the daily request
budget ends.

These commands do not use the LLM. They do not count against the budget: weather, convert, wiki,
define, roll, and trivia from the local bank.

---

# Part 2 — The Wispbyte panel

All facts in this part were researched on 2026-09-07.

## 2.1 How to log in

Go to `https://wispbyte.com/client`. Sign-in also accepts Discord, Google, and GitHub.

**IMPORTANT CHANGE — billing moved.** Billing is no longer at `billing.wispbyte.com`. That
address now redirects. Billing is inside the panel:

| Item | Path |
|---|---|
| Billing | Panel -> Billing (`/client/billing`) |
| Invoices | `/client/invoices` |

A password from the old billing site does **not** work on the client panel. The logins were not
copied across. If you only used the old billing site, register at
`https://wispbyte.com/client/register` with **the same email address**. Paid services then attach
to the account automatically.

## 2.2 How to identify the plan of a server

| Plan | What you see |
|---|---|
| Free | An "Upgrade to Premium" block in the server sidebar. The SFTP page shows a "Premium only" gate. |
| Premium | No upgrade block. Real SFTP credentials. "Subusers" in the sidebar. |

Support tickets (`/client/tickets`) are premium only.

## 2.3 The server sidebar

Console · Files · Startup · Logs · GitHub Integration · Subdomains (beta) · Settings.
Premium only: SFTP · Subusers.

## 2.4 Console tab

- The buttons are Start, Restart, Stop, and Kill. Kill is the skull icon. Kill forces the stop.
- The live output shows here. The separate Logs page holds the older output.
- A Discord IP rate limit shows as a banner with a countdown at the top of Console. The bot is not
  crashed. Do not restart it again. More restarts make the limit worse.

## 2.5 Startup tab

This tab holds the important settings.

| Field | What to do |
|---|---|
| Startup Command | Free text. Press Ctrl+S (or Cmd+S) to save. For this bot the command is `npm start`. A "Reset to Default" button is on this field. |
| Docker Image | This selects the Node version. `package.json` requires Node 18 or higher. UNVERIFIED: which versions the dropdown offers. Open the dropdown and look. |
| Additional Node.js Packages | Leave this empty. This project has a `package.json`. |
| Server Configuration | The environment variables, as editable fields. `BOT_TOKEN`, `CLIENT_ID`, `GROQ_API_KEY`, and the others go here. |

## 2.6 Environment variables — the rule

Put the variables in **Startup -> Server Configuration**. Do not upload a `.env` file.

Reasons:

- The panel injects its variables into the container environment before Node starts.
- `dotenv` does not overwrite a variable that already exists. Thus the panel variables win.
- `.env` is gitignored. A git clone puts no `.env` on the server.

UNVERIFIED: whether this panel permits a variable with a new, arbitrary name. `CF_ACCOUNT_ID` and
`CF_API_TOKEN` need this. Look for an "Add variable" control on the Startup page. If the control
does not exist, upload a `.env` file through Files instead.

## 2.7 The variables this bot reads

| Variable | Required | Purpose |
|---|---|---|
| `BOT_TOKEN` | Yes | The Discord bot token. |
| `CLIENT_ID` | Yes | The Discord application ID. |
| `GROQ_API_KEY` | Yes, unless a fallback provider is configured | The key for the primary LLM provider. |
| `GUILD_ID` | No | Registers the slash commands to one server for instant updates. Blank = global registration. |
| `GROQ_MODEL` | No | Overrides the Groq model from `config/llm.json`. |
| `CF_ACCOUNT_ID` | No | The Cloudflare account ID for the fallback provider. |
| `CF_API_TOKEN` | No | The Cloudflare API token for the fallback provider. |
| `CF_MODEL` | No | Overrides the Cloudflare model. |
| `BACKUP_CHANNEL_ID` | No | The private channel that receives the daily data backup. |
| `OWNER_ID` | No | The user that receives the daily data backup as a DM. |
| `GROQ_MIN_TIME_MS` | No | The minimum time between two LLM calls. |
| `GROQ_RESERVOIR` | No | The number of calls permitted in one window. |
| `GROQ_WINDOW_MS` | No | The length of the rate-limit window. |
| `GROQ_MAX_WAIT_MS` | No | The maximum time a call waits in the queue. |
| `LLM_RETRIES` | No | The number of retries after the first attempt. |
| `LLM_RETRY_BASE_MS` | No | The base delay between the retries. |
| `LOG_TO_FILE` | No | `0` stops file logging. |
| `LOG_MAX_BYTES` | No | The log rollover size in bytes. |

## 2.8 How to deploy new code after a git push

The GitHub Integration page holds the repository URL, the branch, and the Clone and Pull buttons.
Path: Panel -> your server -> GitHub Integration.

| `AUTO_UPDATE` in Startup -> Server Configuration | What to do |
|---|---|
| `1` | A `git pull` runs at every start. Press Console -> Restart. That is all. |
| `0` | Press Pull on the GitHub Integration page. Then press Console -> Restart. |

UNVERIFIED: which value this server has. Check it. This is the setting that most probably drifted.

`npm install` runs automatically at every start, because `package.json` is at the container root.
There is no SSH.

## 2.9 Warnings

- **One Discord bot for each server.** Wispbyte enforces this automatically each minute. A server
  that runs two bots is stopped. This bot starts one Discord application only. It no longer
  co-launches a second bot, so this server obeys the rule. The rule stays in force on the account:
  give each new bot its own Wispbyte server. If a server was stopped, read the reason at
  `/client/notifications`.
- **Free tier: log in at least every 2 weeks.** If you do not, the server is archived. The server
  is archived, not deleted. (The login page says 2 weeks. The knowledge base says 1 month. Use 2
  weeks.)
- **Free tier shares an outbound IP address with other bots.** Another person's bot can cause a
  Discord IP rate limit on your bot. A premium server can get a new IP address.
- **A fresh Clone does not restore the gitignored files.** These are lost: `data/`, `.env`, and
  `logs/`. The reminders, facts, quotes, lore, and trivia scores are in `data/johnny.json`.

## 2.10 ACTION ITEM — the daily backup is OFF

The daily backup does not run, because neither `BACKUP_CHANNEL_ID` nor `OWNER_ID` is set.

Set one of the two variables. The bot then posts `data/johnny.json` once a day to a private channel
or to a DM. That is the only protection against the loss of that data at a redeploy.

The function is built and it works. It needs one variable.

## 2.11 Links

| Item | Address |
|---|---|
| Panel | https://wispbyte.com/client |
| Register | https://wispbyte.com/client/register |
| Dashboard | `/client/dashboard` |
| Billing | `/client/billing` |
| Invoices | `/client/invoices` |
| Notifications | `/client/notifications` |
| Account and 2FA | `/client/account-settings` |
| Knowledge base | https://wispbyte.com/kb |
| Status | https://wispbyte.com/status |
| Support | support@wispbyte.com |

---

# Part 3 — Routine tasks

## 3.1 Change the model without a code change

1. Open Panel -> your server -> Startup -> Server Configuration.
2. Set `GROQ_MODEL` to the new model ID.
3. Save.
4. Open Console. Press Restart.
5. Run `npm run probe`. Confirm the exit code is 0.

## 3.2 Add the Cloudflare fallback

1. Go to `dash.cloudflare.com`. Open Workers & Pages. Copy the account ID from the right side.
2. Go to My Profile -> API Tokens -> Create Token. Use the **Workers AI (Read)** template. Copy
   the token.
3. Open Panel -> your server -> Startup -> Server Configuration.
4. Set `CF_ACCOUNT_ID` and `CF_API_TOKEN`. Save.
5. Open Console. Press Restart.
6. Read the `boot` line. Confirm that the `chain` field shows both providers.

NOTE: the Cloudflare path is structurally verified. It is not live-tested.

## 3.3 Turn on the daily backup

1. In Discord, open Settings -> Advanced. Turn on Developer Mode.
2. Right-click a private channel. Copy the channel ID. (Or right-click your own name and copy your
   user ID.)
3. Open Panel -> your server -> Startup -> Server Configuration.
4. Set `BACKUP_CHANNEL_ID` to the channel ID. (Or set `OWNER_ID` to your user ID.) Save.
5. Open Console. Press Restart.
6. After one day, confirm that a `johnny.json` file arrived.

## 3.4 Read the log on the host

1. Open Panel -> your server -> Files.
2. Open the `logs` folder.
3. Open `johnny.log`. The newest line is at the bottom.

The Logs tab in the sidebar shows the older console output. It is an alternative.

---

## Verified on 2026-09-07

**Tested:**

- The Groq free-tier ceilings, against the live key.
- The model 404 failure and its cause.
- The probe. It passes.

**Not tested:**

- The Cloudflare fallback. It is structurally verified only. There is no Cloudflare account yet.
- The Wispbyte click paths. They come from the public Wispbyte knowledge base, not from inside the
  account.

Items marked UNVERIFIED in the text are open questions. Check them in the panel.
