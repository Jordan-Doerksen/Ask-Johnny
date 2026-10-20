const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } = require('discord.js');
const { gated } = require('./_gate');

// Security commands: /lockdown and /restore (DECISIONS.md, Decisions 17 and 18). The raid
// watcher and anti-nuke run by themselves from lib/security.js; these are the human controls.

module.exports = [
  gated({
    perm: 'ManageGuild',
    data: new SlashCommandBuilder()
      .setName('lockdown')
      .setDescription('Pause invites and DMs and raise verification. Never touches channels.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .setContexts(InteractionContextType.Guild)
      .addSubcommand(s => s.setName('on').setDescription('Lock the server down'))
      .addSubcommand(s => s.setName('off').setDescription('Lift the lockdown, or a raid pause, and restore the old verification level'))
      .addSubcommand(s => s.setName('status').setDescription('Lockdown, pauses, raid detection, anti-nuke, mod log')),
    async run(interaction, ctx) {
      const { security } = ctx;
      const sub = interaction.options.getSubcommand();

      if (sub === 'status') return interaction.editReply(security.status(interaction.guild));

      if (sub === 'on') {
        const r = await security.lockdownOn(interaction.guild, interaction.user);
        if (r.already) return interaction.editReply('Lockdown is already on. /lockdown status shows the details.');
        const lvl = r.raisedFrom ? ` Verification raised from ${r.raisedFrom} to ${r.level}.` : ' Verification already high enough; unchanged.';
        return interaction.editReply(`Confirmed. Lockdown on. Invites and DMs paused until <t:${Math.floor(r.pausedUntil / 1000)}:t>.${lvl} Lift with /lockdown off.`);
      }

      // off
      const r = await security.lockdownOff(interaction.guild, interaction.user);
      const lvl = r.restored ? ` Verification restored to ${r.restored}.` : '';
      return interaction.editReply(`Confirmed. ${r.hadLockdown ? 'Lockdown off.' : 'No lockdown was on; any invite or DM pause is lifted.'} Invites and DMs open.${lvl}`);
    },
  }),

  gated({
    perm: 'ManageRoles',
    data: new SlashCommandBuilder()
      .setName('restore')
      .setDescription('Give back the roles anti-nuke stripped from a member, exactly as they were.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .setContexts(InteractionContextType.Guild)
      .addUserOption(o => o.setName('user').setDescription('Who').setRequired(true)),
    async run(interaction, ctx) {
      const { mod, security } = ctx;
      const user = interaction.options.getUser('user');
      const member = interaction.options.getMember('user');
      if (!member) return interaction.editReply(mod.LINES.notMember);
      // A stripped member cannot restore themself; that is the point of the strip.
      if (user.id === interaction.user.id) return interaction.editReply(mod.LINES.self);

      const r = await security.restore(interaction.guild, interaction.member, member);
      if (r.none) return interaction.editReply(`Negative. No anti-nuke strip on record for ${user.tag}.`);
      const entry = r.give.length
        ? mod.addCase(interaction.guildId, {
          type: 'restore', userId: user.id, userTag: user.tag, modId: interaction.user.id, modTag: interaction.user.tag,
          reason: `Restored from case ${r.fromCase}.`, roleIds: r.give,
        })
        : null;
      if (entry) await mod.postModlog(interaction.guild, entry);

      const kept = [];
      if (r.aboveYou) kept.push(`${r.aboveYou} at or above your top role`);
      if (r.aboveMe) kept.push(`${r.aboveMe} above my role`);
      if (r.missing) kept.push(`${r.missing} deleted since`);
      const tail = kept.length ? ` Not restored: ${kept.join(', ')}.` : '';
      return interaction.editReply(entry
        ? `Confirmed. ${r.give.length} role${r.give.length === 1 ? '' : 's'} restored to ${user.tag} from case ${r.fromCase}. Case ${entry.id}.${tail}`
        : `Negative. No role from case ${r.fromCase} can be restored.${tail}`);
    },
  }),
];
