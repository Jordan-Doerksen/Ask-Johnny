const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');

// /birthday — set yours, and Johnny announces it on the day in the channel a
// server admin points him at. The announcement itself lives in lib/scheduler.js
// (a once-a-day check); this command is just the config + storage (lib/birthdays.js).

module.exports = {
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Birthdays. Johnny announces them on the day.')
    .addSubcommand(s =>
      s.setName('set').setDescription('Set your birthday')
        .addStringOption(o => o.setName('date').setDescription('e.g. "Jan 5", "01-05", "5 January 1990"').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Forget your birthday'))
    .addSubcommand(s => s.setName('list').setDescription('Upcoming birthdays'))
    .addSubcommand(s =>
      s.setName('channel').setDescription('Where Johnny announces (Manage Server)')
        .addChannelOption(o =>
          o.setName('channel').setDescription('The announcement channel').addChannelTypes(ChannelType.GuildText).setRequired(true))),

  async execute(interaction, ctx) {
    if (!interaction.guildId) return interaction.editReply('This works in a server only. Birthdays are per-server.');
    const sub = interaction.options.getSubcommand();
    const g = interaction.guildId;

    if (sub === 'set') {
      const date = ctx.birthdays.parseBirthday(interaction.options.getString('date'));
      if (!date) {
        return interaction.editReply("Could not read that as a date. Try 'Jan 5', '01-05', or '5 January 1990'.");
      }
      ctx.birthdays.set(g, interaction.user.id, date);
      const cfg = ctx.birthdays.get(g);
      const tail = cfg.channelId ? '' : ' (No announce channel is set, so nothing will be posted. An admin can set one with /birthday channel.)';
      return interaction.editReply(`Recorded: ${ctx.birthdays.fmt(date)}. I announce it on the day.${tail}`);
    }

    if (sub === 'remove') {
      const gone = ctx.birthdays.remove(g, interaction.user.id);
      return interaction.editReply(gone ? 'Removed. Your birthday is off the list.' : 'I had no birthday on file for you.');
    }

    if (sub === 'list') {
      const up = ctx.birthdays.upcoming(g);
      if (!up.length) return interaction.editReply('No birthdays on file. Set yours with `/birthday set`.');
      const lines = up.slice(0, 15).map(([id, d]) => `• <@${id}> — ${ctx.birthdays.fmt({ m: d.m, d: d.d })}`).join('\n');
      const embed = new EmbedBuilder()
        .setColor(ctx.embeds.MAUVE)
        .setTitle('Upcoming birthdays')
        .setDescription(lines.slice(0, 4000));
      return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
    }

    // channel — Manage Server only
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.editReply('Negative. This requires Manage Server.');
    }
    const channel = interaction.options.getChannel('channel');
    ctx.birthdays.setChannel(g, channel.id);
    return interaction.editReply(`Confirmed. Birthday announcements go to <#${channel.id}>.`);
  },
};
