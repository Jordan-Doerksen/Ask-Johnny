const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

// /lore — the server's canon about Johnny and itself. Whatever's in here is
// folded into Johnny's head on every @mention and /ask, so the server co-authors
// who he is. Add/remove are Manage-Server-only so the canon stays curated; anyone
// can read it. The injection happens in lib/mention.js and commands/fun.js (/ask).

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lore')
    .setDescription('Server canon. Johnny reads it on every mention and /ask.')
    .addSubcommand(s =>
      s.setName('add').setDescription('Add a piece of canon (Manage Server)')
        .addStringOption(o => o.setName('fact').setDescription('e.g. "Johnny hates Tuesdays"').setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('Show the canon'))
    .addSubcommand(s =>
      s.setName('remove').setDescription('Remove canon by id (Manage Server)')
        .addStringOption(o => o.setName('id').setDescription('The id from /lore list').setRequired(true))),

  async execute(interaction, ctx) {
    if (!interaction.guildId) return interaction.editReply('This works in a server only. Canon is per-server.');
    const sub = interaction.options.getSubcommand();
    const g = interaction.guildId;

    if (sub === 'list') {
      const entries = ctx.lore.list(g);
      if (!entries.length) {
        return interaction.editReply('No canon yet. Anyone with Manage Server can add one with `/lore add`.');
      }
      const embed = new EmbedBuilder()
        .setColor(ctx.embeds.MAUVE)
        .setTitle('Server canon')
        .setDescription(entries.map(e => `• ${e.text}  \`${e.id}\``).join('\n').slice(0, 4000))
        .setFooter({ text: 'I read this on every mention and /ask.' });
      return interaction.editReply({ embeds: [embed] });
    }

    // add / remove are Manage Server only, so the canon stays curated.
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.editReply('Negative. This requires Manage Server.');
    }

    if (sub === 'add') {
      const fact = interaction.options.getString('fact').trim().slice(0, 300);
      if (!fact) return interaction.editReply('Nothing to add. Canon needs text.');
      const entry = ctx.lore.add(g, fact, interaction.user.id);
      return interaction.editReply(`Recorded as canon: ${fact}. Id \`${entry.id}\`.`);
    }

    // remove
    const id = interaction.options.getString('id').trim();
    if (!ctx.lore.remove(g, id)) {
      return interaction.editReply(`No canon with id \`${id}\`. Check \`/lore list\`.`);
    }
    return interaction.editReply('Removed from the canon.');
  },
};
