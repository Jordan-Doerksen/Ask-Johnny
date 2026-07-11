const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');

// /birthday — set yours, and Johnny announces it on the day in the channel a
// server admin points him at. The announcement itself lives in lib/scheduler.js
// (a once-a-day check); this command is just the config + storage (lib/birthdays.js).

module.exports = {
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Birthdays. Johnny will mention them. With minimal fuss.')
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
    if (!interaction.guildId) return interaction.editReply("that's a server thing. no one to tell in here.");
    const sub = interaction.options.getSubcommand();
    const g = interaction.guildId;

    if (sub === 'set') {
      const date = ctx.birthdays.parseBirthday(interaction.options.getString('date'));
      if (!date) {
        return interaction.editReply("couldn't read that as a date. try 'Jan 5', '01-05', or '5 January 1990'.");
      }
      ctx.birthdays.set(g, interaction.user.id, date);
      const cfg = ctx.birthdays.get(g);
      const tail = cfg.channelId ? '' : " (nobody's set an announce channel yet, so it'll be quiet — an admin can /birthday channel.)";
      return interaction.editReply(`noted. ${ctx.birthdays.fmt(date)}. i'll mark the day, with restraint.${tail}`);
    }

    if (sub === 'remove') {
      const gone = ctx.birthdays.remove(g, interaction.user.id);
      return interaction.editReply(gone ? "forgotten. as if you were never born. figuratively." : "i didn't have one for you anyway.");
    }

    if (sub === 'list') {
      const up = ctx.birthdays.upcoming(g);
      if (!up.length) return interaction.editReply("no birthdays on file. a server of people who sprang fully formed from nothing.");
      const lines = up.slice(0, 15).map(([id, d]) => `• <@${id}> — ${ctx.birthdays.fmt({ m: d.m, d: d.d })}`).join('\n');
      const embed = new EmbedBuilder()
        .setColor(ctx.embeds.MAUVE)
        .setTitle('Birthdays, in the order they arrive')
        .setDescription(lines.slice(0, 4000));
      return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
    }

    // channel — Manage Server only
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.editReply("that's a Manage Server thing. not your call, or mine.");
    }
    const channel = interaction.options.getChannel('channel');
    ctx.birthdays.setChannel(g, channel.id);
    return interaction.editReply(`fine. birthdays go to <#${channel.id}>. i'll do the bare minimum on the day.`);
  },
};
