const db = require('./db');
const fs = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');

// A single time poller. Every tick it does two cheap in-memory scans:
//   1. fire any reminders that have come due (incl. while the bot was offline),
//   2. close any polls whose window has elapsed.
// Both reminders and polls live in the DB, so they survive a restart — which is
// the whole "robust" upgrade over the old in-memory setTimeout.

const TICK_MS = 20_000;
const LATE_GRACE_MS = 120_000; // reminders later than this get a wry apology
const DAY_MS = 24 * 3_600_000;

// Files the daily backup ships to Discord — Johnny's persistent data.
// (fun-police/banlist.json was dropped 2026-09-07 with the co-launch. A missing file was
// only ever skipped by the existsSync filter below, so this was never a crash — just a
// backup quietly shipping one fewer file than the restore message claimed.)
const BACKUP_FILES = [
  { path: path.join(__dirname, '..', 'data', 'johnny.json'), name: 'johnny.json' },
];

// Verdict prompts for the reaction polls (/judge, /warcrime). Stored here so a
// poll started before a restart can still be closed purely from its DB row.
const VERDICTS = {
  judge: {
    title: "🧠 Johnny's verdict",
    system:
      'Give your verdict on the dilemma below. State where the people landed, then give your own call and the ' +
      'reason for it, in that order. Commit to it. Keep it short.',
    build: (p, yes, no) =>
      `The dilemma was: "${p.scenario}". The people voted ${yes} yes and ${no} no. What's your verdict?`,
  },
  warcrime: {
    title: "🧠 Johnny's verdict",
    system:
      'Give your verdict on whether it was justified. Stay in character: precise and unflinching about hard ' +
      'history, naming the actual mechanism and who decided what. Never hateful, never endorsing harm. State ' +
      'your call and the reason. Keep it short.',
    build: (p, yes, no) =>
      `The event was: "${p.scenario}". The people voted ${yes} justified and ${no} not justified. Your verdict?`,
  },
};

const LETTERS = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫'];

const REMIND_LINES = [
  (t) => `Reminder: ${t}. That is what you asked for.`,
  (t) => `Reminder: ${t}. Delivered.`,
  (t) => `You asked me to remind you: ${t}. Done.`,
  (t) => `Reminder: ${t}. Logged and delivered.`,
];

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function start(client, ctx) {
  // One pass shortly after login (fires anything overdue from downtime), then steady ticks.
  setTimeout(() => tick(client, ctx).catch(e => console.error('scheduler:', e)), 5000);
  setInterval(() => tick(client, ctx).catch(e => console.error('scheduler:', e)), TICK_MS);
}

async function tick(client, ctx) {
  const now = Date.now();
  await fireReminders(client, now);
  await closePolls(client, ctx, now);
  await maybeBackup(client, now);
  await maybeBirthdays(client, now);
}

// Once a day, DM/post both bots' data files to Discord — a backup that needs no
// paid plan and survives a full host wipe (the host can't store backups). Set
// BACKUP_CHANNEL_ID (preferred, a private channel) or OWNER_ID (a DM); without
// either, this is off. lastBackup is persisted, so the 24h cadence holds across
// restarts and the first backup lands shortly after deploy.
async function maybeBackup(client, now) {
  const channelId = process.env.BACKUP_CHANNEL_ID;
  const ownerId = process.env.OWNER_ID;
  if (!channelId && !ownerId) return;
  if (now - (db.data.lastBackup || 0) < DAY_MS) return;

  // Mark before sending so a send failure doesn't retry every tick.
  db.data.lastBackup = now;
  db.flush();

  const stamp = new Date(now).toISOString().slice(0, 10);
  const files = BACKUP_FILES
    .filter(f => fs.existsSync(f.path))
    .map(f => new AttachmentBuilder(f.path, { name: `${stamp}-${f.name}` }));
  if (!files.length) return; // nothing written yet

  try {
    const target = channelId
      ? await client.channels.fetch(channelId)
      : await client.users.fetch(ownerId);
    await target.send({
      content: `🗄️ Daily backup — ${stamp}. Drop this back into Files (\`data/\`) to restore.`,
      files,
    });
    console.log(`backup: sent ${files.length} file(s) to ${channelId ? 'channel' : 'owner DM'}.`);
  } catch (err) {
    console.error('backup: failed to send:', err.message);
  }
}

// Once per calendar day (bot-local time), announce any birthdays that fall today
// in each guild's configured channel. Tracked by a date stamp so a restart can't
// double-announce; a bot that was down simply announces on its next tick. No
// timezone handling by design (same trade as reminders).
async function maybeBirthdays(client, now) {
  const today = new Date(now);
  const stamp = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  if (db.data.lastBirthdayStamp === stamp) return;
  // Mark before sending (synchronously, so a hard kill in the debounce window
  // can't double-announce) — a send failure doesn't retry every tick.
  db.data.lastBirthdayStamp = stamp;
  db.flushNow();

  const m = today.getMonth() + 1;
  const d = today.getDate();
  for (const [guildId, cfg] of Object.entries(db.data.birthdays)) {
    if (!cfg || !cfg.channelId || !cfg.users) continue;
    // Guard against a malformed entry (e.g. a hand-restored johnny.json) so one
    // bad record can't throw and skip every guild after it.
    const celebrants = Object.entries(cfg.users).filter(([, dt]) => dt && dt.m === m && dt.d === d);
    if (!celebrants.length) continue;
    try {
      const channel = await client.channels.fetch(cfg.channelId);
      for (const [uid, dt] of celebrants) {
        const age = dt.y ? ` They are ${today.getFullYear() - dt.y} today.` : '';
        await channel.send({
          content: `It is <@${uid}>'s birthday.${age} Happy birthday.`,
          allowedMentions: { parse: ['users'] },
        });
      }
    } catch (err) {
      console.error('birthday announce failed', guildId, err.message);
    }
  }
}

async function fireReminders(client, now) {
  const due = db.data.reminders.filter(r => !r.done && r.fireAt <= now);
  for (const r of due) {
    r.done = true; // mark first so an overlapping tick can't double-fire it
    try {
      const channel = await client.channels.fetch(r.channelId);
      const tail = now - r.fireAt > LATE_GRACE_MS ? ' (Correction: this fired late.)' : '';
      await channel.send(`<@${r.userId}> ${pick(REMIND_LINES)(r.text)}${tail}`);
    } catch (err) {
      console.error('reminder deliver failed', r.id, err.message);
    }
  }
  if (due.length) {
    db.data.reminders = db.data.reminders.filter(r => !r.done);
    db.flush();
  }
}

async function closePolls(client, ctx, now) {
  const due = db.data.polls.filter(p => !p.closed && p.closeAt && p.closeAt <= now);
  for (const p of due) {
    p.closed = true;
    db.flushNow(); // persist the closed flag BEFORE the side-effecting reveal, so a hard kill can't re-fire it
    try {
      const channel = await client.channels.fetch(p.channelId);
      const msg = await channel.messages.fetch(p.messageId);
      if (p.kind === 'poll') await closeGenericPoll(ctx, channel, msg, p);
      else if (p.kind === 'trivia') await closeTriviaPoll(ctx, channel, msg, p);
      else await closeVerdictPoll(ctx, channel, msg, p);
    } catch (err) {
      console.error('poll close failed', p.id, err.message);
    }
  }
  if (due.length) {
    db.data.polls = db.data.polls.filter(p => !p.closed);
    db.flush();
  }
}

async function closeVerdictPoll(ctx, channel, msg, p) {
  // Subtract Johnny's own seed reaction so a no-vote poll isn't 1–1.
  const yes = Math.max(0, (msg.reactions.cache.get('✅')?.count ?? 1) - 1);
  const no = Math.max(0, (msg.reactions.cache.get('❌')?.count ?? 1) - 1);
  const v = VERDICTS[p.kind] ?? VERDICTS.judge;
  const verdict = await ctx.askJohnny(v.build(p, yes, no), { extraSystem: v.system });
  await channel.send({
    embeds: [ctx.embeds.verdictEmbed({ title: v.title, description: verdict, footer: `votes — ✅ ${yes}  ❌ ${no}` })],
  });
}

async function closeGenericPoll(ctx, channel, msg, p) {
  const counts = p.options.map((opt, i) => ({
    opt,
    n: Math.max(0, (msg.reactions.cache.get(LETTERS[i])?.count ?? 1) - 1),
  }));
  const max = Math.max(...counts.map(c => c.n));
  const winners = counts.filter(c => c.n === max && max > 0);
  const tally = counts.map((c, i) => `${LETTERS[i]} ${c.opt} — ${c.n}`).join('\n');

  let result;
  if (max === 0) result = 'Nobody voted. No result.';
  else if (winners.length > 1) result = `Tie between ${winners.map(w => w.opt).join(' and ')}. No winner.`;
  else result = `${winners[0].opt} wins with ${max} vote${max === 1 ? '' : 's'}.`;

  await channel.send({
    embeds: [ctx.embeds.verdictEmbed({ title: `📊 ${p.question}`, description: `${result}\n\n${tally}` })],
  });
}

// All non-bot users who reacted with an emoji, paginated (Discord returns at
// most 100 per page) so scoring is correct even on a busy question.
async function fetchReactors(reaction) {
  const ids = new Set();
  if (!reaction) return ids;
  let after;
  for (;;) {
    const batch = await reaction.users.fetch(after ? { after } : {});
    if (!batch.size) break;
    for (const u of batch.values()) { if (!u.bot) ids.add(u.id); after = u.id; }
    if (batch.size < 100) break;
  }
  return ids;
}

// Reveal the trivia answer and award a point to everyone who reacted with ONLY
// the correct letter — hedging across options scores nothing. The bot's own seed
// reactions are excluded. Scores live in db.data.trivia via ctx.trivia. If any
// letter's reactions can't be read, we reveal the answer but skip scoring rather
// than mis-award off a partial tally.
async function closeTriviaPoll(ctx, channel, msg, p) {
  const perLetter = [];
  let fetchFailed = false;
  for (let i = 0; i < p.options.length; i++) {
    try {
      perLetter.push(await fetchReactors(msg.reactions.cache.get(LETTERS[i])));
    } catch (_) {
      fetchFailed = true;
      perLetter.push(new Set());
    }
  }

  const answer = `${LETTERS[p.correctIndex]} ${p.options[p.correctIndex]}`;
  const tail = p.note ? `\n${p.note}` : ''; // the interesting factoid, if the bank supplied one

  if (fetchFailed) {
    await channel.send({
      embeds: [ctx.embeds.verdictEmbed({ title: '🧠 Trivia', description: `The answer was ${answer}. The reactions did not load, so no points this round.${tail}` })],
    });
    return;
  }

  const winners = [];
  for (const uid of perLetter[p.correctIndex]) {
    const hedged = perLetter.some((set, i) => i !== p.correctIndex && set.has(uid));
    if (!hedged) { ctx.trivia.addPoint(p.guildId, uid); winners.push(uid); }
  }

  const desc = (winners.length
    ? `The answer was ${answer}. One point each.`
    : `The answer was ${answer}. Nobody got it.`) + tail;
  // Mentions must live in message content to actually ping — a ping inside an
  // embed body renders but never notifies.
  const payload = {
    embeds: [ctx.embeds.verdictEmbed({ title: '🧠 Trivia', description: desc })],
    allowedMentions: { parse: ['users'] },
  };
  if (winners.length) payload.content = winners.map(u => `<@${u}>`).join(' ');
  await channel.send(payload);
}

module.exports = { start };
