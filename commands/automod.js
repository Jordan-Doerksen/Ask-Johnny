const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, InteractionContextType } = require('discord.js');
const { gated } = require('./_gate');

// Server setup for moderation: the mod-log channel and Discord's native AutoMod rules
// (DECISIONS.md, Decision 13). Manage Server only. The rule engine is lib/automod.js; the gate is
// commands/_gate.js.

module.exports = [
  gated({
    perm: 'ManageGuild',
    data: new SlashCommandBuilder()
      .setName('modlog')
      .setDescription('Where Johnny posts every case and AutoMod alert.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .setContexts(InteractionContextType.Guild)
      .addSubcommand(s =>
        s.setName('set').setDescription('Set the mod-log channel')
          .addChannelOption(o => o.setName('channel').setDescription('A private staff channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
      .addSubcommand(s => s.setName('off').setDescription('Stop posting cases and alerts')),
    async run(interaction, ctx) {
      const s = ctx.mod.store(interaction.guildId);
      if (interaction.options.getSubcommand() === 'off') {
        s.modlogChannelId = null;
        ctx.db.flush();
        const n = await ctx.automod.pointAlerts(interaction.guild, null);
        return interaction.editReply(`Confirmed. Mod log off. AutoMod alerts removed from ${n} rule${n === 1 ? '' : 's'}. Cases are still recorded.`);
      }
      const channel = interaction.options.getChannel('channel');
      s.modlogChannelId = channel.id;
      ctx.db.flush();
      const n = await ctx.automod.pointAlerts(interaction.guild, channel.id);
      const alerts = n ? ` AutoMod alerts from ${n} rule${n === 1 ? '' : 's'} now go there too.` : '';
      return interaction.editReply(`Confirmed. Cases post to <#${channel.id}>.${alerts}`);
    },
  }),

  gated({
    perm: 'ManageGuild',
    data: new SlashCommandBuilder()
      .setName('automod')
      .setDescription("Discord's own AutoMod, set up by Johnny. It works while he is offline.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .setContexts(InteractionContextType.Guild)
      .addSubcommand(s => s.setName('setup').setDescription('Create or update the rules in config (safe to re-run)'))
      .addSubcommand(s => s.setName('status').setDescription('Every AutoMod rule on this server, and the strike ladder'))
      .addSubcommand(s => s.setName('off').setDescription("Delete Johnny's rules (the server's own rules stay)"))
      .addSubcommand(s =>
        s.setName('block').setDescription('Add a word or phrase to the blocked list')
          .addStringOption(o => o.setName('word').setDescription('60 characters at most. * works as a wildcard.').setRequired(true).setMaxLength(60)))
      .addSubcommand(s =>
        s.setName('unblock').setDescription('Remove a word or phrase from the blocked list')
          .addStringOption(o => o.setName('word').setDescription('Exactly as it was added').setRequired(true).setMaxLength(60))),
    async run(interaction, ctx) {
      const { automod, mod } = ctx;
      const sub = interaction.options.getSubcommand();
      const guild = interaction.guild;

      if (sub === 'setup') {
        const report = await automod.setup(guild);
        const alerts = mod.store(guild.id).modlogChannelId ? '' : '\nNo mod-log channel: rules block, but alert nobody. Run /modlog set first, then re-run this.';
        return interaction.editReply(ctx.util.capMsg(`AutoMod setup complete.\n${report.map(l => `• ${l}`).join('\n')}${alerts}`));
      }

      if (sub === 'status') {
        const rules = await automod.status(guild);
        const lines = rules.length
          ? rules.map(r => `• ${r.name} — ${r.type}${r.entries != null ? `, ${r.entries} entr${r.entries === 1 ? 'y' : 'ies'}` : ''}, ${r.enabled ? 'on' : 'OFF'}${r.mine ? '' : ' (server rule)'}`)
          : ['• No AutoMod rules on this server. Run /automod setup.'];
        const { windowHours, ladder } = mod.CONFIG.strikes;
        const steps = ladder.length ? ladder.map(st => `${st.at} strikes → ${st.timeout} timeout`).join(', ') : 'off';
        const logCh = mod.store(guild.id).modlogChannelId;
        return interaction.editReply(ctx.util.capMsg(
          `${lines.join('\n')}\n\nStrike ladder (${windowHours}h window): ${steps}.\nMod log: ${logCh ? `<#${logCh}>` : 'not set'}.`));
      }

      if (sub === 'off') {
        const n = await automod.off(guild);
        return interaction.editReply(`Confirmed. ${n} Johnny rule${n === 1 ? '' : 's'} deleted. Rules the server made itself are untouched.`);
      }

      const word = interaction.options.getString('word');
      if (sub === 'block') {
        const r = await automod.block(guild, word);
        if (r === 'bad_word') return interaction.editReply('Negative. A blocked entry is 1 to 60 characters.');
        if (r === 'exists') return interaction.editReply('Already blocked.');
        if (r === 'full') return interaction.editReply('Negative. The list is at Discord\'s limit of 1000 entries.');
        return interaction.editReply('Confirmed. Blocked. Discord now stops it before it posts.');
      }

      // unblock
      const r = await automod.unblock(guild, word);
      if (r === 'missing') return interaction.editReply('Negative. That entry is not on the blocked list. /automod status shows the count.');
      return interaction.editReply('Confirmed. Unblocked.');
    },
  }),
];
