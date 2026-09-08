const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

// Configure the starboard (the actual ⭐-watching lives in lib/starboard.js,
// wired to the reaction event in index.js). Restricted to people who can manage
// the server, so randoms can't repoint it.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('starboard')
    .setDescription('Starboard setup. Johnny reposts messages that hit a ⭐ count.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s =>
      s.setName('set').setDescription('Set the starboard channel')
        .addChannelOption(o =>
          o.setName('channel').setDescription('Where stars go').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s =>
      s.setName('threshold').setDescription('How many ⭐ it takes')
        .addIntegerOption(o => o.setName('count').setDescription('default 3').setRequired(true)))
    .addSubcommand(s => s.setName('off').setDescription('Turn the starboard off')),

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const g = interaction.guildId;
    const sb = ctx.db.data.starboard;

    if (sub === 'set') {
      const channel = interaction.options.getChannel('channel');
      sb[g] = { channelId: channel.id, threshold: sb[g]?.threshold || 3 };
      ctx.db.flush();
      return interaction.editReply(`Confirmed. Messages go to <#${channel.id}> at ${sb[g].threshold} ⭐.`);
    }

    if (sub === 'threshold') {
      const count = Math.max(1, interaction.options.getInteger('count'));
      if (!sb[g]) sb[g] = { channelId: null, threshold: count };
      else sb[g].threshold = count;
      ctx.db.flush();
      return interaction.editReply(
        sb[g].channelId
          ? `Confirmed. Threshold is ${count} ⭐.`
          : `Threshold is ${count} ⭐. Set a channel with /starboard set to turn it on.`,
      );
    }

    // off
    if (sb[g]) { delete sb[g]; ctx.db.flush(); }
    return interaction.editReply('Starboard off.');
  },
};
