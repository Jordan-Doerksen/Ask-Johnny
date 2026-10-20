const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, InteractionContextType } = require('discord.js');

// The mod core: ban, unban, kick, timeout, purge, warn, cases. Every one is a top-level command
// so Discord's own permission hides it from members who lack that permission (DECISIONS.md,
// Decision 11), and every one re-checks the permission and runs the guard before it acts.
// No LLM call anywhere (Decision 12). Replies are ephemeral: the public record is the mod log.
// `cooldown: false` — the 1-second machine-gun guard is for the LLM; a raid is not the time to wait.

const DELETE_WINDOWS = { none: 0, '1h': 3600, '1d': 86_400, '7d': 604_800 };

const reasonOf = (interaction, mod) => interaction.options.getString('reason')?.trim().slice(0, 400) || mod.LINES.noReason;

// One wrapper for the shared shape: the permission gate, then the action, then a precise
// line for any Discord refusal. A failed mod action is logged, never silent (Decision 9).
function modCommand(def) {
  return {
    data: def.data,
    ephemeral: true,
    cooldown: false,
    async execute(interaction, ctx) {
      if (!interaction.inGuild()) return interaction.editReply('Negative. Moderation works in a server only.');
      const denied = ctx.mod.requirePerm(interaction, def.perm);
      if (denied) return interaction.editReply(denied);
      try {
        await def.run(interaction, ctx);
      } catch (err) {
        ctx.log.error('mod_action_failed', { command: def.data.name, guild: interaction.guildId, msg: err.message, code: err.code });
        await interaction.editReply(ctx.mod.describeError(err));
      }
    },
  };
}

// Confirm to the mod. `dmed` is true or false when a DM was attempted, null when DMs are off
// in config, undefined when none was due — only an attempted, failed DM is reported.
const confirm = (interaction, mod, text, dmed) =>
  interaction.editReply(dmed === false ? `${text}${mod.LINES.dmFailed}` : text);

module.exports = [
  modCommand({
    perm: 'BanMembers',
    data: new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Ban a member. Works on a user who already left.')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .setContexts(InteractionContextType.Guild)
      .addUserOption(o => o.setName('user').setDescription('Who').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Logged and sent to them'))
      .addStringOption(o =>
        o.setName('delete').setDescription('Delete their recent messages (default none)')
          .addChoices({ name: 'none', value: 'none' }, { name: 'last hour', value: '1h' }, { name: 'last day', value: '1d' }, { name: 'last 7 days', value: '7d' })),
    async run(interaction, ctx) {
      const { mod } = ctx;
      const user = interaction.options.getUser('user');
      const member = interaction.options.getMember('user');
      const refusal = mod.guard(interaction, user, member, 'ban');
      if (refusal) return interaction.editReply(refusal);

      const reason = reasonOf(interaction, mod);
      // DM first: after the ban there is no shared server, and the DM usually fails.
      const dmed = member ? await mod.dm(user, `You were banned from ${interaction.guild.name}. Reason: ${reason}`) : undefined;
      try {
        await interaction.guild.members.ban(user, {
          reason: mod.auditReason(interaction.user.tag, reason),
          deleteMessageSeconds: DELETE_WINDOWS[interaction.options.getString('delete') || 'none'],
        });
      } catch (err) {
        if (dmed) await mod.dmCorrection(user, interaction.guild.name, 'ban');
        throw err;
      }
      const entry = mod.addCase(interaction.guildId, { type: 'ban', userId: user.id, userTag: user.tag, modId: interaction.user.id, modTag: interaction.user.tag, reason });
      await mod.postModlog(interaction.guild, entry);
      return confirm(interaction, mod, `Confirmed. ${user.tag} banned. Case ${entry.id}.`, dmed);
    },
  }),

  modCommand({
    perm: 'BanMembers',
    data: new SlashCommandBuilder()
      .setName('unban')
      .setDescription('Lift a ban, by user ID.')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .setContexts(InteractionContextType.Guild)
      .addStringOption(o => o.setName('user_id').setDescription('Their user ID (Developer Mode → Copy User ID)').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Logged')),
    async run(interaction, ctx) {
      const { mod } = ctx;
      const id = interaction.options.getString('user_id').match(/\d{17,20}/)?.[0];
      if (!id) return interaction.editReply('Negative. That is not a user ID. It is 17 to 20 digits.');
      const reason = reasonOf(interaction, mod);
      const user = await interaction.guild.members.unban(id, mod.auditReason(interaction.user.tag, reason));
      const entry = mod.addCase(interaction.guildId, { type: 'unban', userId: id, userTag: user?.tag || id, modId: interaction.user.id, modTag: interaction.user.tag, reason });
      await mod.postModlog(interaction.guild, entry);
      return interaction.editReply(`Confirmed. ${user?.tag || id} unbanned. Case ${entry.id}.`);
    },
  }),

  modCommand({
    perm: 'KickMembers',
    data: new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kick a member. They can rejoin with an invite.')
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
      .setContexts(InteractionContextType.Guild)
      .addUserOption(o => o.setName('user').setDescription('Who').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Logged and sent to them')),
    async run(interaction, ctx) {
      const { mod } = ctx;
      const user = interaction.options.getUser('user');
      const member = interaction.options.getMember('user');
      if (!member) return interaction.editReply(mod.LINES.notMember);
      const refusal = mod.guard(interaction, user, member, 'kick');
      if (refusal) return interaction.editReply(refusal);

      const reason = reasonOf(interaction, mod);
      const dmed = await mod.dm(user, `You were kicked from ${interaction.guild.name}. Reason: ${reason}`);
      try {
        await member.kick(mod.auditReason(interaction.user.tag, reason));
      } catch (err) {
        if (dmed) await mod.dmCorrection(user, interaction.guild.name, 'kick');
        throw err;
      }
      const entry = mod.addCase(interaction.guildId, { type: 'kick', userId: user.id, userTag: user.tag, modId: interaction.user.id, modTag: interaction.user.tag, reason });
      await mod.postModlog(interaction.guild, entry);
      return confirm(interaction, mod, `Confirmed. ${user.tag} kicked. Case ${entry.id}.`, dmed);
    },
  }),

  modCommand({
    perm: 'ModerateMembers',
    data: new SlashCommandBuilder()
      .setName('timeout')
      .setDescription('Time a member out (they cannot talk or react). "off" clears it.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .setContexts(InteractionContextType.Guild)
      .addUserOption(o => o.setName('user').setDescription('Who').setRequired(true))
      .addStringOption(o => o.setName('duration').setDescription('10m, 2h, 1d, 1w (max 28d), or off').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Logged and sent to them')),
    async run(interaction, ctx) {
      const { mod } = ctx;
      const user = interaction.options.getUser('user');
      const member = interaction.options.getMember('user');
      if (!member) return interaction.editReply(mod.LINES.notMember);
      const ms = mod.parseTimeout(interaction.options.getString('duration'));
      if (ms === null) return interaction.editReply(mod.LINES.badDuration);
      const refusal = mod.guard(interaction, user, member, 'timeout');
      if (refusal) return interaction.editReply(refusal);

      const reason = reasonOf(interaction, mod);
      await member.timeout(ms || null, mod.auditReason(interaction.user.tag, reason));
      const type = ms ? 'timeout' : 'untimeout';
      const entry = mod.addCase(interaction.guildId, { type, userId: user.id, userTag: user.tag, modId: interaction.user.id, modTag: interaction.user.tag, reason, durationMs: ms || undefined });
      const dmed = ms
        ? await mod.dm(user, `You were timed out in ${interaction.guild.name} for ${ctx.util.humanizeMs(ms)}. Reason: ${reason}`)
        : undefined;
      await mod.postModlog(interaction.guild, entry);
      return confirm(interaction, mod,
        ms ? `Confirmed. ${user.tag} timed out for ${ctx.util.humanizeMs(ms)}. Case ${entry.id}.` : `Confirmed. Timeout cleared for ${user.tag}. Case ${entry.id}.`,
        dmed);
    },
  }),

  modCommand({
    perm: 'ModerateMembers',
    data: new SlashCommandBuilder()
      .setName('warn')
      .setDescription('Warn a member. Warns are strikes; enough strikes means an automatic timeout.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .setContexts(InteractionContextType.Guild)
      .addUserOption(o => o.setName('user').setDescription('Who').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Logged and sent to them').setRequired(true)),
    async run(interaction, ctx) {
      const { mod } = ctx;
      const user = interaction.options.getUser('user');
      const member = interaction.options.getMember('user');
      if (!member) return interaction.editReply(mod.LINES.notMember);
      const refusal = mod.guard(interaction, user, member, 'warn');
      if (refusal) return interaction.editReply(refusal);

      const reason = reasonOf(interaction, mod);
      const entry = mod.addCase(interaction.guildId, { type: 'warn', userId: user.id, userTag: user.tag, modId: interaction.user.id, modTag: interaction.user.tag, reason });
      const dmed = await mod.dm(user, `You were warned in ${interaction.guild.name}. Reason: ${reason}`);
      await mod.postModlog(interaction.guild, entry);
      const { count, applied, skipped } = await mod.strikeAndEscalate(interaction.guild, user.id, interaction.client, `warn, case ${entry.id}`);
      const windowH = mod.CONFIG.strikes.windowHours;
      let tail = ` Strike ${count} in ${windowH}h.`;
      if (applied) tail += ` Automatic timeout applied: ${ctx.util.humanizeMs(applied.durationMs)}, case ${applied.id}.`;
      else if (skipped) tail += ` ${mod.SKIP_LINES[skipped]}`;
      return confirm(interaction, mod, `Confirmed. ${user.tag} warned. Case ${entry.id}.${tail}`, dmed);
    },
  }),

  modCommand({
    perm: 'ManageMessages',
    data: new SlashCommandBuilder()
      .setName('purge')
      .setDescription('Delete recent messages in this channel (14 days old at most).')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .setContexts(InteractionContextType.Guild)
      .addIntegerOption(o => o.setName('count').setDescription('How many (1-100)').setMinValue(1).setMaxValue(100).setRequired(true))
      .addUserOption(o => o.setName('user').setDescription('Only this member\'s messages')),
    async run(interaction, ctx) {
      const { mod } = ctx;
      const channel = interaction.channel;
      if (!channel || channel.type === ChannelType.DM) return interaction.editReply('Negative. Run this in a server channel.');
      const count = Math.min(interaction.options.getInteger('count'), mod.CONFIG.purgeMax || 100);
      const user = interaction.options.getUser('user');

      let target = count;
      if (user) {
        // Look back across the last 100 messages and take this member's newest `count`.
        const recent = await channel.messages.fetch({ limit: 100 });
        target = recent.filter(m => m.author.id === user.id).first(count);
      }
      // filterOld = true: Discord refuses bulk deletes of messages older than 14 days.
      const deleted = await channel.bulkDelete(target, true);
      const entry = mod.addCase(interaction.guildId, {
        type: 'purge', userId: user?.id || null, userTag: user?.tag || null,
        modId: interaction.user.id, modTag: interaction.user.tag,
        reason: user ? `Messages from ${user.tag}` : 'Recent messages', count: deleted.size, channelId: channel.id,
      });
      await mod.postModlog(interaction.guild, entry);
      const short = deleted.size < count ? ' Fewer than asked: older than 14 days, or not found.' : '';
      return interaction.editReply(`Confirmed. ${deleted.size} message${deleted.size === 1 ? '' : 's'} deleted. Case ${entry.id}.${short}`);
    },
  }),

  modCommand({
    perm: 'ModerateMembers',
    data: new SlashCommandBuilder()
      .setName('cases')
      .setDescription('The case log: one case by number, one member\'s history, or the latest.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .setContexts(InteractionContextType.Guild)
      .addIntegerOption(o => o.setName('id').setDescription('A case number').setMinValue(1))
      .addUserOption(o => o.setName('user').setDescription('A member\'s history')),
    async run(interaction, ctx) {
      const { mod } = ctx;
      const id = interaction.options.getInteger('id');
      const user = interaction.options.getUser('user');

      if (id) {
        const entry = mod.getCase(interaction.guildId, id);
        if (!entry) return interaction.editReply(`Negative. No case ${id} on this server.`);
        return interaction.editReply({ embeds: [mod.caseEmbed(entry)] });
      }

      const n = mod.CONFIG.casesPerPage || 10;
      const list = user ? mod.casesFor(interaction.guildId, user.id).slice(-n) : mod.recentCases(interaction.guildId, n);
      if (!list.length) return interaction.editReply(user ? `No cases for ${user.tag}.` : 'No cases on this server.');
      const lines = list.reverse().map(c => {
        const who = c.userId ? `<@${c.userId}>` : `<#${c.channelId}>`;
        const by = c.auto ? 'Johnny (automatic)' : `<@${c.modId}>`;
        return `**#${c.id}** ${c.type} · ${who} · by ${by} · <t:${Math.floor(c.ts / 1000)}:R>\n${(c.reason || '').slice(0, 120)}`;
      });
      const head = user ? `Cases for ${user.tag} (newest first, last ${n}):` : `Latest ${list.length} cases:`;
      return interaction.editReply({ content: ctx.util.capMsg(`${head}\n${lines.join('\n')}`), allowedMentions: { parse: [] } });
    },
  }),
];
