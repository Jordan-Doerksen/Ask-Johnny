const { SlashCommandBuilder } = require('discord.js');

// Reminders that survive a restart — the feature that most justifies the DB.
// Set one and the scheduler (lib/scheduler.js) delivers it later, even if the
// bot bounced in between. Time parsing is relative-duration only (no NLP, no
// timezones); an unparseable time is refused, never guessed at.

const SET_LINES = [
  (when, what) => `fine. ${when}. i'll mention "${what}". don't hold your breath, but i will.`,
  (when, what) => `noted. ${when} from now, i bug you about "${what}". try to act surprised.`,
  (when, what) => `${when}. "${what}". consider it on my list. such as it is.`,
];

const MAX_MS = 365 * 86_400_000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Johnny reminds you about something. Eventually.')
    .addSubcommand(s =>
      s.setName('me').setDescription('Set a reminder')
        .addStringOption(o => o.setName('when').setDescription('e.g. "in 2h", "30m", "3d"').setRequired(true))
        .addStringOption(o => o.setName('what').setDescription('What to remind you about').setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('Your pending reminders'))
    .addSubcommand(s =>
      s.setName('cancel').setDescription('Cancel one of yours')
        .addStringOption(o => o.setName('id').setDescription('The id from /remind list').setRequired(true))),

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'me') return remindMe(interaction, ctx);
    if (sub === 'list') return remindList(interaction, ctx);
    if (sub === 'cancel') return remindCancel(interaction, ctx);
  },
};

async function remindMe(interaction, ctx) {
  const when = interaction.options.getString('when');
  const what = interaction.options.getString('what');

  const ms = ctx.util.parseDuration(when);
  if (!ms) {
    return interaction.editReply("i can't read that as a time. give me something like 'in 2h', '30m', or '3d'.");
  }
  if (ms > MAX_MS) {
    return interaction.editReply("a year out. i'm not holding that. pick something this decade.");
  }

  const reminder = {
    id: ctx.util.genId('r_'),
    userId: interaction.user.id,
    channelId: interaction.channelId,
    guildId: interaction.guildId,
    text: what,
    fireAt: Date.now() + ms,
    createdAt: Date.now(),
    done: false,
  };
  ctx.db.data.reminders.push(reminder);
  ctx.db.flush();

  await interaction.editReply(ctx.util.pick(SET_LINES)(ctx.util.humanizeMs(ms), what));
}

async function remindList(interaction, ctx) {
  const now = Date.now();
  const mine = ctx.db.data.reminders.filter(r => !r.done && r.userId === interaction.user.id);
  if (!mine.length) {
    return interaction.editReply("you've got nothing pending. living in the moment, apparently.");
  }
  const lines = mine
    .sort((a, b) => a.fireAt - b.fireAt)
    .map(r => `\`${r.id}\` — in ${ctx.util.humanizeMs(r.fireAt - now)}: ${r.text}`);
  await interaction.editReply(`your pending reminders:\n${lines.join('\n')}`);
}

async function remindCancel(interaction, ctx) {
  const id = interaction.options.getString('id').trim();
  const before = ctx.db.data.reminders.length;
  ctx.db.data.reminders = ctx.db.data.reminders.filter(
    r => !(r.id === id && r.userId === interaction.user.id),
  );
  if (ctx.db.data.reminders.length === before) {
    return interaction.editReply("don't have that one. check /remind list for the id.");
  }
  ctx.db.flush();
  await interaction.editReply('cancelled. as if it never mattered.');
}
