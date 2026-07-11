// The @mention brain. Talking to Johnny by pinging him used to be a stateless
// one-shot: he had no idea who you were or what was just said. Now he's *aware* —
// he sees the last few messages in the channel (continuity), knows who's talking
// to him, and quietly pulls from what he already remembers about them (/facts)
// and who's currently AFK. The data he collects finally reaches his mouth.
//
// This deliberately lives outside index.js so the boot file stays a thin router.

const HISTORY_LIMIT = 6;      // recent messages fed back for continuity
const HISTORY_CHARS = 200;    // per-line cap so a wall of text can't blow the prompt

// Flat lines for when the Groq limiter is saturated — an honest "give me a sec"
// instead of queueing a reply that lands a minute later (per "show nothing false").
const COOLING_LINES = [
  'give me a sec, everyone\'s talking at once.',
  'one at a time. i\'ve got a queue.',
  'hold on, catching up. ask again in a bit.',
];

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// Pull the last few real messages before the trigger, oldest-first, labelled by
// speaker — with Johnny's own lines marked so he can see he's mid-conversation.
async function recentHistory(message, client) {
  try {
    const fetched = await message.channel.messages.fetch({ limit: HISTORY_LIMIT + 1, before: message.id });
    const lines = [...fetched.values()]
      .reverse()
      .filter(m => m.content.trim() && (!m.author.bot || m.author.id === client.user.id))
      .map(m => {
        const who = m.author.id === client.user.id ? 'You (Johnny)' : (m.member?.displayName || m.author.username);
        const text = m.content.replace(/<@!?\d+>/g, '').replace(/\s+/g, ' ').trim().slice(0, HISTORY_CHARS);
        return text ? `${who}: ${text}` : null;
      })
      .filter(Boolean);
    return lines.length ? lines.join('\n') : null;
  } catch (_) {
    return null; // no history is fine — he just answers cold, like before
  }
}

// Build the awareness block appended to Johnny's persona for this one reply.
function awareness({ speaker, history, known, afkNames, lore }) {
  const bits = ['You are in an ongoing group chat with people you know. Stay in character; weave context in only where it fits naturally, never announce that you remember things.'];
  if (lore) bits.push(`Canon about you and this server (treat as true, don't recite it):\n${lore}`);
  if (history) bits.push(`Recent messages in this channel:\n${history}`);
  bits.push(`The person talking to you right now is ${speaker}.`);
  if (known.length) {
    bits.push(`What you already know about ${speaker}: ${known.map(f => f.text).join('; ')}.`);
  }
  if (afkNames.length) {
    bits.push(`Currently away: ${afkNames.join(', ')}. Mention only if relevant.`);
  }
  return bits.join('\n\n');
}

// Handle a message that @mentions Johnny. Returns nothing; replies in-channel.
async function handleMention(message, client, ctx) {
  const raw = message.content.replace(/<@!?\d+>/g, '').trim();
  const guildId = message.guildId;
  const speaker = message.member?.displayName || message.author.username;

  // If Groq is backed up, bail with a flat line instead of queueing a late reply.
  if (ctx.ratelimit && ctx.ratelimit.projectedWaitMs() > ctx.ratelimit.MAX_WAIT_MS) {
    await message.reply(pick(COOLING_LINES));
    return;
  }

  await message.channel.sendTyping();

  // Direct lookup: "@johnny what do you know about X" answers straight from his
  // notes, verbatim, so the facts stay accurate (never reworded by the model).
  const m = raw.match(/(?:what do you know about|who is|who's|tell me about|what about)\s+(.+?)[?.!]*$/i);
  if (m && guildId) {
    const subject = m[1].trim();
    const facts = ctx.memory.getFacts(guildId, subject);
    if (facts.length) {
      const intro = await ctx.askJohnny(
        `Someone asked what you know about "${subject}". Give ONE flat intro line; don't list the facts.`,
        { maxTokens: 60 },
      );
      await message.reply(ctx.util.capMsg(`${intro}\n${facts.map(f => `• ${f.text}`).join('\n')}`));
      return;
    }
  }

  // Otherwise: a normal reply, but now with eyes and a memory.
  const history = await recentHistory(message, client);
  const known = guildId ? ctx.memory.getFacts(guildId, speaker) : [];
  const afkNames = ctx.memory.afkNames ? ctx.memory.afkNames(message) : [];
  const lore = guildId && ctx.lore ? ctx.lore.block(guildId) : null;

  const reply = await ctx.askJohnny(raw || 'someone just pinged you with nothing to say.', {
    extraSystem: awareness({ speaker, history, known, afkNames, lore }),
  });
  await message.reply(reply);
}

module.exports = { handleMention };
