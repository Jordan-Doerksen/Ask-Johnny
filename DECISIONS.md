# DECISIONS — ask-johnny

The manifest. Retrofitted 2026-07-10 onto a bot that already shipped, so it records
the decisions in force rather than pretending they were made up front. Change anything
here only via the Change Log at the bottom.

## Core Goal
A dry, deadpan Discord bot for a friends' server — Johnny — that is *grudgingly competent*:
he jokes, but he also remembers things, sets reminders, settles arguments, and gives real
data. The fun is the contrast between a guy who can't be bothered and a bot that gets it right.
Since 2026-10-20 he is also the moderation bot for every server the owner runs (Decision 10): the
paid features of the big moderation bots, built in, with no LLM in the path of a mod action.

## Non-Negotiable Constraints
- **Real data is always real.** Weather, conversions, dictionary, Wikipedia, poll tallies,
  reminders — fetched or computed, never invented by the model. Johnny only voices the wrapper.
- **Secrets live in a gitignored `.env`.** Never a committed token. The fun-police leak lesson stands.
- **In character, always.** Johnny never admits he's an AI, never lectures, never refuses.
  One exception (2026-10-20, Decision 12): a moderation command refuses an action that the
  invoker has no permission for, or that the guard forbids. The refusal is a fixed line in his voice.
- **No native modules, no build step.** `npm install && npm start` must stay green on a free host
  (Wispbyte). Persistence is one JSON file with atomic, debounced writes.
- **Friends'-server scale.** Simplicity beats robustness theatre; don't add a real DB.

## Decisions
1. **Domain split: `commands/` (one file per category) + `lib/` (engines) + config-in-JSON store.**
   Change rule: new surface goes in the matching command file or a new lib module; keep index.js a
   thin router.
2. **Persistence = `data/johnny.json`, one live object, atomic tmp+rename flush.**
   Change rule: only revisit if scale outgrows a friends' server (it won't soon).
3. **Reminders/polls survive restart via the DB + a 20s scheduler poll** (not in-memory setTimeout).
   Change rule: keep the DB-backed model for anything that must outlive a bounce.
4. **Time parsing is relative-duration only** (`in 2h`, `30m`, `3d`) — deliberately no NLP, no
   timezones, no clock times. An unparseable time is refused, never guessed.
   Change rule: adding recurring/absolute reminders means adding a timezone — treat as a real CR.
5. **Command surface is trimmed, not sprawling** (2026-07-10). Cut redundant/weak gags rather than
   ship five near-duplicate vote commands. Change rule: a new command must earn its place — if it's
   `/ask` or `/poll` with a canned prompt, it's a flavor, not a command.
6. **@mention Johnny is memory-aware** (2026-07-10). His ping replies see recent channel messages
   and what he knows about the speaker (`/facts`, AFK). Change rule: awareness is additive context
   only — never fabricate a "memory," never leak group-chat framing into the slash commands.
7. **RETIRED 2026-09-07 — fun-police was co-launched as a child process with its own creds**
   (`FP_BOT_TOKEN`). It stayed a separate gateway/process so a crash there could not take Johnny down.
   Retired because the co-launch started a second Discord application from Johnny's server, and
   Wispbyte stops a server that runs two bots. The vendored copy is deleted, and the standalone repo
   `github.com/Jordan-Doerksen/fun-police` is the only copy. See the Change Log entry dated 2026-09-07.
8. **The model provider is configuration, not code** (2026-09-07). `groq-sdk` is removed. `lib/llm.js`
   calls any OpenAI-compatible chat-completions API with plain `fetch` (Node 18+, no dependency).
   `config/llm.json` holds the provider chain: `order`, `defaults`, and, for each provider, `baseUrl`,
   `apiKeyEnv`, `model`, `modelEnv`, `tokenParam`, and `extraBody`. A provider whose API key is absent
   from the environment is skipped without an error, thus an unconfigured fallback has no cost.
   Change rule: a new provider is one config entry plus one key in `.env`. It must never require an
   edit to `lib/johnny.js`.
9. **Failures are recorded, not only printed** (2026-09-07). `lib/log.js` writes JSON-lines records to
   `logs/johnny.log` (about 2 MB, one rollover file kept) and mirrors each record to the console. Every
   LLM call logs its outcome: the provider, the model, the latency, the token counts, the attempt
   number, and whether the call fell back to another provider. This closes the gap that hid the August
   outage, and it brings the bot into agreement with the observability law, which it did not meet
   before. Change rule: each new failure path gets a log event. A silent failure is a defect.

10. **Johnny moderates the owner's servers** (2026-10-20). He is the moderation, security, and
   server-management bot for each server the owner runs, and not only a persona. The request is five
   systems in four chunks: (1) mod core + AutoMod, (2) security, (3) server management, (4) command
   hooks. Chunk 1 is built. The rest are Open Questions.
   Change rule: each chunk gets its own interview pass and its own entry in the Change Log.
11. **Discord's own permissions are the gate** (2026-10-20, owner choice). Each mod command is a
   top-level command with `setDefaultMemberPermissions`, so Discord hides `/ban` from a member who
   has no Ban Members. The command checks the permission again when it runs, because a server admin
   can change the default in Integrations. **The guard:** Johnny never acts on the invoker, on
   himself, on the server owner, or on a member whose highest role is equal to or above the
   invoker's (the server owner is exempt from the last rule). A target that Johnny's own role cannot
   reach is refused before the call.
   Change rule: the guard lives in one function (`lib/mod.js`, `guard`). Every mod action calls it.
12. **The model never holds a moderation tool** (2026-10-20). No LLM call is in the path of a mod
   action, an AutoMod hit, or an escalation. All moderation output is fixed text in the military
   register of persona 3.0 ("Confirmed. ... Case 14."), from `lib/mod.js` `LINES`. Thus an @mention
   cannot talk Johnny into a ban, an outage at the LLM provider cannot stop a ban, and moderation
   costs none of the daily LLM budget. Change rule: a mod feature that wants a model goes through an
   interview first, with this decision named as the conflict.
13. **AutoMod is Discord's native AutoMod, set up by Johnny** (2026-10-20). Johnny does not scan
   messages himself. `/automod setup` creates or updates his rules on Discord. The rule names start
   with `Johnny · `, and Johnny never edits a rule that does not carry that prefix. Discord blocks a
   message before it posts, and the rules continue to work when Johnny is offline. This is the main
   defence against the free-tier host stopping him. Discord is the source of truth for the rules:
   Johnny stores no copy of a rule or of its word list. The defaults are in
   `config/moderation.json`. Discord's limits (verified in discord-api-types): 6 keyword rules,
   1 spam rule, 1 preset rule, and 1 mention-spam rule per server.
   Change rule: a new filter is a field in `config/moderation.json` first, not a new scanner.
14. **Escalation is automatic timeouts only** (2026-10-20, owner choice). A warn or an AutoMod block
   is a strike. Strikes count inside a window (24h by default). The ladder in
   `config/moderation.json` maps a strike count to a timeout. Above the top step, each new strike
   applies the top step again. **Johnny never kicks or bans on his own.** A timeout expires by
   itself, thus a false positive costs a member one hour, not their membership.
   Change rule: an automatic kick or ban is a new Change Request, not a config edit.
15. **Johnny's role has Administrator** (2026-10-20, owner choice, against the recommendation).
   The recommendation was the exact permissions that each chunk uses. The owner chose Administrator.
   **The recorded risk:** a leaked `BOT_TOKEN` gives total control of every server that Johnny is
   in. fun-police already had a token committed once. The mitigation is SAFE-01: rotate the token
   first, then remove it. Administrator does not bypass the role order: Johnny's role must be the
   highest role that he has to act on.
   Change rule: revisit when Johnny joins a server that the owner does not own.

## Open Questions
- **Chunk 2, security:** raid detection by join rate, a one-command lockdown, invite pausing
  (`guild.setIncidentActions`, at most 24h, verified in discord.js 14.27), and a watch on the audit
  log for an admin who deletes in bulk. It needs the privileged GuildMembers intent.
- **Chunk 3, server management:** welcome message, autorole, reaction roles, an event log
  (edits, deletes, joins, leaves).
- **Chunk 4, command hooks — not yet defined.** "Hook commands through him to do whatever I need"
  has four readings: macros in JSON, natural-language admin through the model (conflicts with
  Decision 12), command files dropped into `commands/` (true already, through `_loader.js`), or an
  HTTP endpoint for the owner's other tools. Interview it before chunk 4.
- **The host is a risk for a security bot.** Wispbyte's free tier stops a server after two weeks
  without a panel login, and the shared IP address can slow Johnny during a raid. Decision 13 keeps
  AutoMod alive while he is down. Mod commands, cases, and escalation stop until he is back.
- Recurring / "remind @someone-else" reminders are wanted but blocked on the no-timezone constraint.
- Voice is one flat note across every command; a mood/voice pass is deferred (chose awareness first).
- The Cloudflare Workers AI fallback is not verified. There is no Cloudflare account to test it
  against, thus the provider chain has one untested link. Test it when an account exists.

## Change Log
- **2026-10-20** — Change Request: Johnny becomes the moderation bot for the owner's servers.
  Owner's words: "I want to make ask johnny my discord god bot, able to manage servers, act as
  security and a automod, and be able to hook commands through him to do basically whatever I need
  in the servers I own."
  - **Interview pass (rank HIGH: real bans, Administrator, every server).** APPROVE: mod commands
    with a case log; security; server management. FLAVOUR: automod uses Discord's native AutoMod,
    not a scanner (Decision 13). ADD: the model never holds a mod tool (Decision 12); the guard
    (Decision 11). OPEN: command hooks (Open Questions). No new package: discord.js 14.27 covers
    AutoMod and incident actions.
  - **Owner choices.** V1 = mod core + AutoMod. The gate = Discord's own permissions. Johnny's
    permissions = Administrator (Decision 15, risk recorded). Mod voice = fixed lines, military
    register. Escalation = automatic timeouts only.
  - **Agent defaults, reversible in config.** Mod replies are ephemeral; the public record is the
    mod-log channel. The default AutoMod set is the slurs preset, spam, mention spam at 5 with raid
    protection, and Discord invite links. Profanity is off, because these are friends' servers.
    Mod commands skip the 1-second cooldown: a raid is not the time to wait.
  - **What it costs.** 9 new commands (ban, unban, kick, timeout, purge, warn, cases, modlog,
    automod). The `AutoModerationExecution` intent, which is not privileged. One new store key,
    `mod`, inside `data/johnny.json`, so the daily backup carries the case log.
- **2026-09-07** — Change Request: persona 3.0 — precise and literal, not deadpan and avoidant.
  Owner's words: "I don't like the nonchalant like avoidant attitude. I want my bot to be nerdy
  precise and literal, militaristic language at times."
  - **What was wrong.** The 2.0 persona opened with "Dry, deadpan, low-energy, unbothered... like it
    cost you a little effort", and it instructed him to "go quiet again ('Anyway.')" after every burst
    of detail. That go-quiet rhythm was the avoidant tic: it appeared at the end of nearly every reply.
    The low-energy framing is removed. Note for the record that the 2.0 voice was itself a correction
    away from a hyped-up voice the owner rejected on 2026-06-15 — **this CR does not return to that.**
    The bot is now precise and engaged; it is neither bored nor enthusiastic.
  - **What is kept, deliberately.** The autistic-coded precision, literalism and special-interest
    detail — that is the trait the owner asked for MORE of, and it stays affectionate
    self-representation, never a caricature. The hard lines, the distress override, the special-interest
    canon, and "real data is always real" are all unchanged.
  - **New sections in `JOHNNY_SYSTEM`.** PRECISION (hyper-literal, corrects directly, states what it
    would need to know). MILITARY REGISTER (clipped operational language — "Confirmed." "Negative."
    "Correction:" — but only when the subject has an objective, an enemy, terrain, logistics or an
    order of operations; never aimed at a person, never roleplayed rank). YOU HAVE TAKES (a balanced
    survey of something he has views on is a failure, not neutrality).
  - **DETAIL IS EARNED BY CERTAINTY — the safety rule this CR made necessary.** Removing "keep the
    burst brief" removed the thing that had been limiting how much invented detail the model could
    produce. Live test: asked for a StarCraft 4-gate build order, it produced a confident, wrong,
    numbered build with fabricated supply counts. An abstract "only say what you are certain of"
    instruction did not fix it; naming the failure categories did. The persona now forbids enumerated
    precision outright — no numbered build orders, no supply or timing counts, no patch or version
    numbers, no release dates, no statistics — and directs him to mechanisms, names, causes and
    sequence, which he gets right. Re-tested: the numeric fabrication is gone. Change rule: any future
    instruction that invites more detail must be paired with this limit, or the bot invents specifics
    on exactly the topics the owner cares most about.
  - **An assistant-voice leak fixed.** The model was refusing jailbreak attempts with "I'm sorry, but
    I can't comply with that", which breaks character. LINES now names the banned phrasings explicitly.
    Verified: the refusal is now "Not doing that." / "No."
  - **The voice was in three places, not one — this is the main lesson of the CR.** Rewriting
    `JOHNNY_SYSTEM` alone would have changed almost nothing a user sees.
    (1) **~44 canned strings** across `index.js`, `lib/` and `commands/` carried the avoidant register
    ("as if it never mattered", "we all move on", "I already forgot it", "lucky them") and would have
    contradicted the new persona on every error, confirmation and AFK reply. Re-voiced, including
    slash-command descriptions. Capitalisation changed with them: the canned lines were lowercase while
    model replies are sentence-cased, and the two sit side by side in one channel.
    (2) **15 per-command `extraSystem` prompts** each re-instructed the OLD voice and overrode the
    persona at the command level — `/roast`, `/debate`, `/rate`, `/hottake`, `/haiku`, `/catchup`,
    `/summary`, `/tldr`, `/yt`, `/settle`, `/pick`, `/story`, plus `/judge` and `/warcrime` in
    `lib/scheduler.js`. Every one said "dry, deadpan, unbothered" or similar. All rewritten to instruct
    precision and commitment. `commands/quickfacts.js`'s `WIKI_ANGLES` seeds were the same problem in
    miniature — every angle was "put upon" or "unimpressed" — and were replaced.
    (3) The persona itself. Change rule: a voice change is not done until all three are changed
    together; verify with `npm run lint:voice`.
  - **New guard: `npm run lint:voice` (`scripts/check-voice.js`).** A lint for VOICE, not syntax. It
    scans every string literal for the rejected register and for assistant-voice leaks, skipping a
    phrase that appears inside a prohibition, and exempting the persona's own list of banned phrasings.
    Written because this failure is silent — nothing errors, the bot simply disagrees with itself. Its
    first version reported "clean" while three real violations stood, because it skipped any string
    containing a negation anywhere; it now checks only the text immediately before each match. A check
    that lies is worse than no check.
  - **A standing-rule violation found in passing.** `commands/links.js` shipped the label
    "Portfolio (The Observatory)". The site has had no collective name since the owner's ruling of
    2026-07-25 — not "the Observatory", not "the Archive". Corrected to "Jordan Doerksen".
  - **A retry defect found while testing this.** The retry added earlier the same day used a fixed
    400/800 ms backoff. Groq's token-per-minute limit replies "try again in 8.8s", so every 429
    exhausted all retries and failed a reply that would have succeeded. `lib/llm.js` now reads
    `retry-after`, falls back to parsing the wait out of the error message, and caps it
    (`LLM_MAX_RETRY_WAIT_MS`, default 15s). Verified with 4 mocked cases including two consecutive
    rate limits.
- **2026-09-07** — Change Request: fun-police is removed from this repo (Decision 7 retired).
  Approved scope: "Get rid of fun-police." The Discord server that it policed is dead.
  - **Trigger.** Wispbyte permits one Discord bot for each server, and it checks every minute. It
    stops a server that runs two bots automatically. The co-launch started a SECOND Discord
    application from Johnny's server. Thus the arrangement put the working bot at risk of a stop, for
    the sake of a bot whose server is dead. Johnny is the bot that must stay up.
  - **Safety checks before the deletion.** The standalone repo `github.com/Jordan-Doerksen/fun-police`
    exists at `C:\projects\bots\fun-police`. Its working tree is clean, and it has 0 unpushed commits.
    The vendored copy was a duplicate, thus nothing unique was lost. The ban list held 0 entries, thus
    no data needed a migration.
  - **The six changes.** (1) `launchFunPolice()` and its call site are deleted from `index.js`; a
    comment marks the removal and points at this file. (2) The vendored `fun-police/` directory is
    deleted. (3) `.env.example` no longer holds `FP_BOT_TOKEN` and `FP_CLIENT_ID`, and its
    daily-backup comment no longer names `fun-police/banlist.json`. (4) `.gitignore` no longer holds
    the `fun-police/banlist.json` line. (5) `lib/scheduler.js`: `BACKUP_FILES` no longer includes
    `fun-police/banlist.json`, and the backup message no longer tells the user to restore into
    `fun-police/`. (6) The Non-Negotiable Constraints no longer name a vendored copy.
  - **A backup defect found in the same pass.** Change 5 repaired no crash: the `existsSync` filter
    always skipped a file that is absent. But the daily backup shipped one file fewer than its own
    restore instructions named, thus the instructions were wrong for a user who followed them.
  - **An Open Question resolved.** The question "fun-police lives here (vendored) *and* as its own
    repo — declare which is canonical" is answered by this CR. The standalone repo is the only copy,
    thus the question is removed from Open Questions.
  - **The port was interviewed and DECLINED (owner, 2026-09-07).** The first plan was to move
    `/banlist`, `/ban` and `/unban` into Johnny as native commands. The interview listed the conflicts:
    the list is global where every other Johnny feature is per-guild; it writes its own file against
    Decision 2; its emoji-and-exclamation copy contradicts the "in character, always" constraint; and
    `/ban` in a live server implies a real Discord ban when the command bans nobody. The owner's
    ruling: do not port it. His reason — he will not overlap real bans with a fake one, and a command
    that only adds a name to a list does not earn a place (Decision 5). No ban-list code exists in this
    repo. Change rule: treat a future request for this feature as a new CR, not as unfinished work.
  - **Verification after the change.** 38 modules load, 37 commands register, and all 4 probes pass.
- **2026-09-07** — Follow-up, same CR: the real-data commands hold their one-line shape again.
  The swap changed behaviour that no test covered. `openai/gpt-oss-120b` obeys a length rule in the
  SYSTEM prompt but largely ignores one in the user message, so `/wiki` wrote its own full summary
  directly above the verbatim Wikipedia extract — a duplicate, and a risk of contradicting the real
  data, which the "real data is always real" constraint forbids. `commands/quickfacts.js` now applies
  a shared `ONE_LINER` system rule to `/weather`, `/convert`, `/wiki` and `/define`. Measured effect on
  `/wiki`: about 300 characters down to about 60. Two further findings from the same pass. First, a
  reasoning model spends the completion budget on thinking, so the 40 to 60 token caps on these
  commands produced empty and mid-word-truncated replies; `reasoningHeadroom` in `config/llm.json`
  (128 tokens for Groq) is added to whatever a caller asks for, so call sites keep sizing the REPLY
  and the thinking room is set once. Second, asking for an "intro line" made the model define the
  topic, and the fixed phrasing produced the same opening word ("Fine") seven times in a row; `/wiki`
  now asks for a REACTION and rotates a `WIKI_ANGLES` seed, the same anti-repetition pattern
  `commands/fun.js` already uses. Verified: six of six distinct openings, no facts in the intro.
  Change rule: a command that prints an LLM line beside real data states its length limit in
  `extraSystem`, never only in the user message.
- **2026-09-07** — Change Request: model swap, provider chain, and logging (Decisions 8 and 9).
  Approved scope: "Swap the model, and make the provider a config value."
  - **Trigger.** On 2026-08-16 Groq moved `llama-3.3-70b-versatile` to enterprise-only accounts. Each
    LLM call then returned HTTP 404 `model_not_found`. The bot stayed online, thus nothing looked
    broken: Discord users only saw the flat "brain buffered for a sec" message. The API key was valid
    for the full period and was never the cause. This is the SECOND model retirement that took this bot
    offline. The first was `llama3-70b-8192`, recorded in the old comment in `lib/johnny.js`.
  - **Decision 8 — the provider is config.** `groq-sdk` is removed. `lib/llm.js` calls any
    OpenAI-compatible chat-completions API with plain `fetch` (Node 18+, no dependency).
    `config/llm.json` holds the chain: `order`, `defaults`, and, for each provider, `baseUrl`,
    `apiKeyEnv`, `model`, `modelEnv`, `tokenParam`, and `extraBody`. A provider whose API key is absent
    is skipped without an error, thus an unconfigured fallback has no cost. A new provider is one
    config entry plus one key in `.env`, and never an edit to `lib/johnny.js`.
  - **Decision 9 — failures are recorded.** `lib/log.js` writes JSON-lines records to
    `logs/johnny.log` (about 2 MB, one rollover file kept) and mirrors each record to the console.
    Every LLM call logs the provider, the model, the latency, the token counts, the attempt number,
    and whether it fell back. This closes the gap that hid the August outage. It also brings the bot
    into agreement with the observability law, which it did not meet before.
  - **The provider chain as built.** Primary: Groq `openai/gpt-oss-120b`, with `reasoning_effort:
    "low"` and `include_reasoning: false`. Fallback: Cloudflare Workers AI, dormant until
    `CF_ACCOUNT_ID` and `CF_API_TOKEN` are set. The Cloudflare path is **structurally verified, not
    live-tested** — there is no Cloudflare account to test it against yet.
  - **Model behaviour, verified by test on 2026-09-07.** Two findings control the configuration.
    - At the default reasoning effort, `openai/gpt-oss-120b` REFUSES `/roast`: it replies "I'm not
      going to do that." `reasoning_effort: "low"` removes the refusal, and it also cuts the latency
      to about 300 ms. The setting is functional, not cosmetic.
    - `reasoning_format` is not supported on gpt-oss, and it does not give an error. It returns an
      empty message. Never set it for that model. `qwen/qwen3.6-27b` is different: it writes its raw
      chain-of-thought into the reply content. Thus `lib/llm.js` removes `<think>` blocks from each
      reply as a defence.
  - **A regression found and repaired during the build.** The removal of `groq-sdk` also removed its
    `maxRetries: 3`. That setting was added deliberately in commit 2879e18, to absorb a connection drop
    in the middle of a response. `lib/llm.js` rebuilds the function: 2 retries, with 400 ms and 800 ms
    backoff, on a transient failure only (network error, timeout, 429, 5xx). A permanent failure (404,
    401) falls over to the next provider immediately, with no retry. This is exactly the type of silent
    capability loss that the change-control process exists to catch.
  - **Rate-limit retune, with its reason.** `lib/ratelimit.js` defaults changed from MIN_TIME_MS 1200 /
    RESERVOIR 20 to MIN_TIME_MS 2000 / RESERVOIR 7. The limiter was tuned for a requests-per-minute
    ceiling, but requests are not the binding constraint. The measured Groq free-tier limits are 30
    requests/min, 1,000 requests/day, 8,000 tokens/min, and 200,000 tokens/day. The persona costs about
    900 input tokens per call. Thus the real ceiling is about 8 calls per minute and about **190
    replies per day**. That figure is a true operating constraint on the design.
  - **Housekeeping in the same change.** `discord.js` to `^14.27.0`. The `undici` override went from
    `^6.27.0` to `^6.27.1`, because the advisory range is now `<=6.27.0` and the old pin no longer
    cleared it (`npm audit` went from 3 moderate to 0). A new `npm run probe` command
    (`scripts/probe-llm.js`) tests the model path end to end without Discord; all 4 of its probes pass.
    The startup guard in `index.js` no longer names `GROQ_API_KEY` — it requires at least one
    configured provider.
- **2026-07-10** — Trivia bank (Johnny's own questions, swarm-built). A research+verify swarm (135 agents:
  one researcher per special interest → an independent fact-checker per question) produced
  `content/trivia.json` — **120 questions, 8 per interest, every one fact-checked** (correct answer
  confirmed, all 3 distractors confirmed wrong/unambiguous; unverifiable ones dropped). `/trivia play` now
  defaults to this bank with a topic dropdown per interest + "surprise me"; OpenTDB kept as the "the web"
  option and as a fallback if the bank has no match. The reveal now includes the factoid behind the answer.
  `lib/trivia.js` loads the bank at require time; `content/` is committed (unlike the gitignored `data/`).
  Rationale for the swarm: the owner didn't want to hand-author questions, and generated trivia MUST be
  accurate (the "real data is always real" rule) — hence the per-question adversarial fact-check gate.
- **2026-07-10** — Feature batch 2: trivia + birthdays (the other two picks from the repo survey).
  - **Trivia** (`lib/trivia.js` + `commands/trivia.js`): `/trivia play·leaderboard`. Real OpenTDB questions
    (base64-encoded fetch, no key, no dep) — keeps the "real data is always real" rule; Johnny only voices
    the wrapper. The live question is a `trivia` poll row in `db.data.polls`, closed by the scheduler after
    30s (`closeTriviaPoll`), which awards a point to anyone who reacted with ONLY the correct letter (no
    hedging). Per-guild leaderboard in `db.data.trivia`. (Ref: Elitezen/discord-trivia — pattern, not the dep.)
  - **Birthdays** (`lib/birthdays.js` + `commands/birthday.js`): `/birthday set·remove·list·channel`. Stores
    month/day (+ optional year for age); the scheduler announces on the day (`maybeBirthdays`, once per
    calendar day via `db.data.lastBirthdayStamp`). Deliberately NO timezone (same trade as reminders) —
    bot-local calendar day. Announce channel is Manage-Server-gated. (Ref: scottbucher/BirthdayBot — design only.)
  - Persona special interests filled with the owner's real canon (see the persona entry's tweak note).
  - `db.js` EMPTY gained `trivia: {}`, `birthdays: {}`, `lastBirthdayStamp: ''`. 35 → 37 commands.
  - **Hardening** (adversarial review found 10, all low/medium, all addressed): the trivia question now lives
    in the embed description (4096) not the title (256) so a long OpenTDB question can't fail the command;
    options are de-duplicated (OpenTDB sometimes ships a duplicate answer); reaction fetches paginate past
    100 and, if any letter can't be read, the answer is revealed WITHOUT scoring rather than mis-awarding;
    winners are pinged in message content (a ping inside an embed body never notifies); the poll-close and
    birthday-stamp flags are now `flushNow()`-persisted before the side-effecting send, closing a hard-kill
    double-fire window; and `maybeBirthdays` guards against a malformed (hand-restored) user record. Left as
    an accepted tradeoff: a transient send failure skips that day's birthday (mark-before-send, same as the
    backup/reminder paths — retrying every tick would spam).
- **2026-07-10** — Feature batch: quote book + server lore + reliability layer (features mined from a
  survey of 16 verified open-source Discord bots).
  - **Quote book** (`lib/quotes.js` + `commands/quotes.js`): per-guild `/quote add·random·search·authors·remove`.
    Quotes stored verbatim; wrappers are static (no LLM call) so the most-used path is cheap. Remove is
    gated to the quote's author or Manage Server. (Ref: AlecM33/quote-bot — design only, not its Postgres.)
  - **Server lore** (`lib/lore.js` + `commands/lore.js`): per-guild canon injected into Johnny's LLM
    context on @mention (`lib/mention.js`) and `/ask` (`commands/fun.js`), so the server co-authors his
    personality. Add/remove Manage-Server-gated; capped at 25 lines in the prompt. Distinct from
    `memory.js` facts (recall lookups) — lore is always-on context. (Ref: JakeLunn/discord-chatgpt-personality-bot.)
  - **Reliability** (`lib/ratelimit.js`, no dep): homegrown Groq limiter — serialized calls, min-gap +
    reservoir-per-window — wrapping the call in `lib/johnny.js`, so a burst of @mentions queues instead of
    tripping the free-tier limit. Honest "cooling down" bail on the @mention path when saturated
    (`lib/mention.js`). Per-command cooldowns added (`lib/cooldown.js` scope arg; `cmd.cooldownMs` on
    catchup/summary/tldr/yt = 15s). Verified: limiter orders/spaces/recovers-from-rejection correctly.
    (Refs: SGrondin/bottleneck, discord.js Cooldowns guide — patterns, not deps.)
  - `db.js` EMPTY gained `quotes: []` and `lore: {}`; existing stores pick them up via the EMPTY-merge on load.
  - **Hardening** (adversarial review found 7, all fixed): a shared `util.capMsg()` now caps the fact/quote
    concat replies to Discord's 2000-char limit (`mention.js`, `/facts`) — previously they could throw and
    Johnny would silently fail; `/remember` fact input capped at 1000 chars. `lore.list()` is now a pure read
    (no auto-vivify side effect) and `/ask`, `/lore`, `/quote` guard against a null guild (no DM junk-writes).
    The Groq limiter tracks queue depth so a simultaneous @mention burst trips the "cooling down" bail instead
    of queueing late replies. Cooldowns split into pure `check` + `mark` (peek-both-commit-if-both-pass) so a
    per-command-rejected invocation no longer burns the shared global window.
- **2026-07-10** — Persona rewrite (Johnny 2.0).
  - Replaced `JOHNNY_SYSTEM` in `lib/johnny.js`. Johnny is now an autistic-coded nerd played straight and
    warm (deep special interests → brief precise info-dumps; hyper-literal correction; blunt honesty;
    systems brain) with a guardrailed edge (dark/gallows tone, but the edge points at ideas/systems, never
    a person or group; hard lines held in-character; distress override; jailbreak → flat bored non-answer).
    Kept the dry-deadpan DNA. Owner is autistic — this is affectionate self-representation, never a
    caricature; autism is never the punchline.
  - Chosen via a 5-phase bake-off (3 drafts × 4 judge lenses, authenticity weighted highest). Winner:
    "The Info-Dumper"; synthesis grafted a dignity line + an in-character refusal protocol (fixes the old
    "never refuse" vs. hard-lines contradiction).
  - **Special interests (set 2026-07-10):** filled with the owner's real canon — Warcraft III / StarCraft I&II /
    Diablo II, Ocarina of Time (treated as the medium's peak), Pokémon Gen 1&2 lore, LotR, Princess Mononoke,
    the original Starship Troopers, the band Dissection, ancient history & megaliths, options trading, vibe
    coding, and Matrix-flavoured philosophy (first three films = scripture, there is no fourth). This is what
    makes Johnny read as *him*; edit the list in `lib/johnny.js` to retune.
- **2026-07-10** — Trim + awareness pass.
  - Cut `/news` (fake-news gag, faint misinfo smell), `/simp` (weak, dated), `/hotpoll` (redundant
    with `/poll` + `/ask`). 36 → 33 commands.
  - Kept `/warcrime` (owner's call — a friends'-server crowd-pleaser).
  - Added `lib/mention.js`: memory-aware @mention brain (recent-chat continuity + speaker facts +
    who's AFK). Moved the @mention logic out of `index.js`; de-duped the facts lookup.
  - Added `memory.afkNames()`. Updated README. Wrote this manifest + ARCHITECTURE.md.
