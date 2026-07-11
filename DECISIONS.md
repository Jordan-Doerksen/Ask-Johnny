# DECISIONS — ask-johnny

The manifest. Retrofitted 2026-07-10 onto a bot that already shipped, so it records
the decisions in force rather than pretending they were made up front. Change anything
here only via the Change Log at the bottom.

## Core Goal
A dry, deadpan Discord bot for a friends' server — Johnny — that is *grudgingly competent*:
he jokes, but he also remembers things, sets reminders, settles arguments, and gives real
data. The fun is the contrast between a guy who can't be bothered and a bot that gets it right.

## Non-Negotiable Constraints
- **Real data is always real.** Weather, conversions, dictionary, Wikipedia, poll tallies,
  reminders — fetched or computed, never invented by the model. Johnny only voices the wrapper.
- **Secrets live in a gitignored `.env`.** Never a committed token (ask-johnny *and* the vendored
  fun-police). The fun-police leak lesson stands.
- **In character, always.** Johnny never admits he's an AI, never lectures, never refuses.
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
7. **fun-police is co-launched as a child process with its own creds** (`FP_BOT_TOKEN`). It stays a
   separate gateway/process so a crash there doesn't take Johnny down. Change rule: keep it isolated.

## Open Questions
- fun-police lives here (vendored) *and* as its own repo — declare which is canonical in the brain's
  project map, then keep one authoritative copy.
- Recurring / "remind @someone-else" reminders are wanted but blocked on the no-timezone constraint.
- Voice is one flat note across every command; a mood/voice pass is deferred (chose awareness first).

## Change Log
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
