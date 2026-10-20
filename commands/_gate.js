// The shared shape of every moderation and security command (DECISIONS.md, Decision 11):
// guild only, then Discord's own permission, then the action, then one precise line for any
// Discord refusal. A failed action is logged, never silent (Decision 9). Replies are ephemeral;
// the public record is the mod log. `cooldown: false` — the 1-second machine-gun guard is for the
// LLM, and a raid is not the time to wait. The loader skips this file (leading underscore).
function gated({ perm, data, run }) {
  return {
    data,
    ephemeral: true,
    cooldown: false,
    async execute(interaction, ctx) {
      if (!interaction.inGuild()) return interaction.editReply('Negative. This works in a server only.');
      const denied = ctx.mod.requirePerm(interaction, perm);
      if (denied) return interaction.editReply(denied);
      try {
        await run(interaction, ctx);
      } catch (err) {
        ctx.log.error('mod_command_failed', { command: data.name, guild: interaction.guildId, msg: err.message, code: err.code });
        await interaction.editReply(ctx.mod.describeError(err));
      }
    },
  };
}

module.exports = { gated };
