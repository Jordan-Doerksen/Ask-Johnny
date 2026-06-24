const db = require('./db');

// A single time poller. Every tick it does two cheap in-memory scans:
//   1. fire any reminders that have come due (incl. while the bot was offline),
//   2. close any polls whose window has elapsed.
// Both reminders and polls live in the DB, so they survive a restart — which is
// the whole "robust" upgrade over the old in-memory setTimeout.

const TICK_MS = 20_000;
const LATE_GRACE_MS = 120_000; // reminders later than this get a wry apology

// Verdict prompts for the reaction polls (/judge, /warcrime). Stored here so a
// poll started before a restart can still be closed purely from its DB row.
const VERDICTS = {
  judge: {
    title: "🧠 Johnny's verdict",
    system:
      'Give your verdict on the dilemma below — flat, dry, unbothered. Note where the people landed, then go ' +
      'with your own gut anyway. Keep it short.',
    build: (p, yes, no) =>
      `The dilemma was: "${p.scenario}". The people voted ${yes} yes and ${no} no. What's your verdict?`,
  },
  warcrime: {
    title: "🧠 Johnny's verdict",
    system:
      'Give your verdict on whether it was justified. Stay in character — flat, dry, and way too casual about ' +
      "heavy history, like it's barely worth the energy. Never hateful, never endorsing harm, just detached. " +
      'Keep it short.',
    build: (p, yes, no) =>
      `The event was: "${p.scenario}". The people voted ${yes} justified and ${no} not justified. Your verdict?`,
  },
};

const LETTERS = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫'];

const REMIND_LINES = [
  (t) => `you wanted me to remind you: ${t}. there. it's out of my hands now.`,
  (t) => `reminder: ${t}. consider it brought up. your problem from here.`,
  (t) => `${t}. you asked me to mention this, so. mentioned.`,
  (t) => `heads up, allegedly: ${t}. do with it what you want.`,
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
}

async function fireReminders(client, now) {
  const due = db.data.reminders.filter(r => !r.done && r.fireAt <= now);
  for (const r of due) {
    r.done = true; // mark first so an overlapping tick can't double-fire it
    try {
      const channel = await client.channels.fetch(r.channelId);
      const tail = now - r.fireAt > LATE_GRACE_MS ? ' (late, i had things going on.)' : '';
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
    try {
      const channel = await client.channels.fetch(p.channelId);
      const msg = await channel.messages.fetch(p.messageId);
      if (p.kind === 'poll') await closeGenericPoll(ctx, channel, msg, p);
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
  if (max === 0) result = "nobody voted. that's an answer too, i guess.";
  else if (winners.length > 1) result = `it's a tie between ${winners.map(w => w.opt).join(' and ')}. sort it out yourselves.`;
  else result = `${winners[0].opt} won it, ${max} vote${max === 1 ? '' : 's'}. democracy, occasionally working.`;

  await channel.send({
    embeds: [ctx.embeds.verdictEmbed({ title: `📊 ${p.question}`, description: `${result}\n\n${tally}` })],
  });
}

module.exports = { start };
