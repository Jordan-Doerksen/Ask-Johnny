const { SlashCommandBuilder } = require('discord.js');

// Meta commands: what Johnny can do, and how much he's been bothered.

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('help')
      .setDescription('What Johnny can do, if he has to.'),
    async execute(interaction, ctx) {
      const list = ctx.commands
        .map(c => `**/${c.name}** — ${c.description}`)
        .sort()
        .join('\n');
      const embed = new ctx.embeds.EmbedBuilder()
        .setColor(ctx.embeds.MAUVE)
        .setTitle('Johnny, allegedly helpful')
        .setDescription(list.slice(0, 4000))
        .setFooter({ text: 'or just @mention me. minimal effort on both sides.' });
      await interaction.editReply({ embeds: [embed] });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('stats')
      .setDescription("How much Johnny's been bothered. Reluctant analytics."),
    async execute(interaction, ctx) {
      const counts = ctx.db.data.stats.commandCounts || {};
      const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const total = entries.reduce((sum, [, n]) => sum + n, 0);
      const top = entries.slice(0, 8).map(([k, v]) => `/${k} — ${v}`).join('\n') || 'nothing yet. a clean slate.';
      const uptime = ctx.util.humanizeMs(process.uptime() * 1000);
      await interaction.editReply(
        `i've handled ${total} command${total === 1 ? '' : 's'} all-time. up for ${uptime} this run.\n\nthe greatest hits:\n${top}`,
      );
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('activity')
      .setDescription('Who actually talks here. Reluctant analytics.'),
    async execute(interaction, ctx) {
      const a = ctx.activity.get(interaction.guildId);
      if (!a || !a.total) {
        return interaction.editReply("nothing tracked yet. either it's quiet or i just woke up.");
      }
      const top = Object.entries(a.users)
        .sort((x, y) => y[1] - x[1])
        .slice(0, 5)
        .map(([id, n]) => `<@${id}> — ${n}`)
        .join('\n');
      const busiest = Object.entries(a.hours).sort((x, y) => y[1] - x[1])[0];
      const hour = busiest ? `${busiest[0]}:00` : 'unclear';
      await interaction.editReply({
        content: `i've clocked ${a.total} messages here. the usual suspects:\n${top}\n\nbusiest hour: around ${hour} (server time). make of that what you will.`,
        allowedMentions: { parse: [] },
      });
    },
  },
];
