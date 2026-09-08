const { SlashCommandBuilder } = require('discord.js');

// Meta commands: what Johnny can do, and how much he's been bothered.

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('help')
      .setDescription('Every command Johnny has, with what it does.'),
    async execute(interaction, ctx) {
      const list = ctx.commands
        .map(c => `**/${c.name}** — ${c.description}`)
        .sort()
        .join('\n');
      const embed = new ctx.embeds.EmbedBuilder()
        .setColor(ctx.embeds.MAUVE)
        .setTitle('What Johnny can do')
        .setDescription(list.slice(0, 4000))
        .setFooter({ text: 'Or @mention me and ask directly.' });
      await interaction.editReply({ embeds: [embed] });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Command counts and uptime for this bot.'),
    async execute(interaction, ctx) {
      const counts = ctx.db.data.stats.commandCounts || {};
      const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const total = entries.reduce((sum, [, n]) => sum + n, 0);
      const top = entries.slice(0, 8).map(([k, v]) => `/${k} — ${v}`).join('\n') || 'Nothing yet.';
      const uptime = ctx.util.humanizeMs(process.uptime() * 1000);
      await interaction.editReply(
        `I have handled ${total} command${total === 1 ? '' : 's'} all-time. Up ${uptime} this run.\n\nMost used:\n${top}`,
      );
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('activity')
      .setDescription('Message counts and the busiest hour in this server.'),
    async execute(interaction, ctx) {
      const a = ctx.activity.get(interaction.guildId);
      if (!a || !a.total) {
        return interaction.editReply('Nothing tracked yet. I started counting when I came online.');
      }
      const top = Object.entries(a.users)
        .sort((x, y) => y[1] - x[1])
        .slice(0, 5)
        .map(([id, n]) => `<@${id}> — ${n}`)
        .join('\n');
      const busiest = Object.entries(a.hours).sort((x, y) => y[1] - x[1])[0];
      const hour = busiest ? `${busiest[0]}:00` : 'unclear';
      await interaction.editReply({
        content: `I have counted ${a.total} messages here. Most active:\n${top}\n\nBusiest hour: around ${hour}, server time.`,
        allowedMentions: { parse: [] },
      });
    },
  },
];
