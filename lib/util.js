const { MessageFlags } = require('discord.js');

// Small shared helpers.

// Random pick. An identical prompt makes the model keep returning its few
// "default" answers even at high temperature, so seeding a different sub-topic
// per call breaks the repetition.
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// Short, human-friendly id for reminders/polls/facts. Collision odds are
// negligible at a friends-server scale.
const genId = prefix => prefix + Math.random().toString(36).slice(2, 7);

// Resolve a nice display name for a targeted user option.
function nameOf(interaction, optionName) {
  const member = interaction.options.getMember(optionName);
  const user = interaction.options.getUser(optionName);
  return member?.displayName || user?.username || 'this guy';
}

// Tell the user something broke without breaking character.
async function brainLag(interaction) {
  const msg = 'brain buffered for a sec. try again whenever.';
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply(msg);
    else await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
  } catch (_) {
    /* interaction already gone, nothing to do */
  }
}

const UNIT_MS = {
  m: 60_000, min: 60_000,
  h: 3_600_000, hr: 3_600_000, hour: 3_600_000,
  d: 86_400_000, day: 86_400_000,
  w: 604_800_000, week: 604_800_000,
};

// Parse a relative duration like "in 2h", "30m", "1h30m", "3d", "1 week".
// Returns milliseconds, or null if nothing parseable. Deliberately NOT NLP —
// relative durations only, no clock times, no timezones to get wrong.
function parseDuration(input) {
  if (!input) return null;
  const re = /(\d+)\s*(min|hour|hr|week|day|m|h|d|w)s?/gi;
  let ms = 0;
  let matched = false;
  let match;
  while ((match = re.exec(input)) !== null) {
    const per = UNIT_MS[match[2].toLowerCase()];
    if (per) {
      ms += parseInt(match[1], 10) * per;
      matched = true;
    }
  }
  return matched && ms > 0 ? ms : null;
}

// Coarse human-readable duration from milliseconds, e.g. "1d 3h".
function humanizeMs(ms) {
  if (ms < 0) ms = 0;
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (!parts.length) parts.push('<1m');
  return parts.join(' ');
}

// Discord's hard per-message ceiling, and a guard to never exceed it. Any reply
// that concatenates unbounded user content (facts, quotes) must pass through this
// — askJohnny caps its own output, but text appended after it does not.
const DISCORD_LIMIT = 2000;
function capMsg(str, limit = DISCORD_LIMIT) {
  return str.length > limit ? `${str.slice(0, limit - 1)}…` : str;
}

module.exports = { pick, genId, nameOf, brainLag, parseDuration, humanizeMs, capMsg, DISCORD_LIMIT };
