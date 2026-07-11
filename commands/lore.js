const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

// /lore — the server's canon about Johnny and itself. Whatever's in here is
// folded into Johnny's head on every @mention and /ask, so the server co-authors
// who he is. Add/remove are Manage-Server-only so the canon stays curated; anyone
// can read it. The injection happens in lib/mention.js and commands/fun.js (/ask).

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lore')
    .setDescription('Canon about Johnny and this server. He keeps it in his head.')
    .addSubcommand(s =>
      s.setName('add').setDescription('Add a piece of canon (Manage Server)')
        .addStringOption(o => o.setName('fact').setDescription('e.g. "Johnny hates Tuesdays"').setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('Show the canon'))
    .addSubcommand(s =>
      s.setName('remove').setDescription('Remove canon by id (Manage Server)')
        .addStringOption(o => o.setName('id').setDescription('The id from /lore list').setRequired(true))),

  async execute(interaction, ctx) {
    if (!interaction.guildId) return interaction.editReply("that's a server thing. there's no canon in an empty room.");
    const sub = interaction.options.getSubcommand();
    const g = interaction.guildId;

    if (sub === 'list') {
      const entries = ctx.lore.list(g);
      if (!entries.length) {
        return interaction.editReply('no canon yet. someone with Manage Server can `/lore add` what i\'m supposed to know.');
      }
      const embed = new EmbedBuilder()
        .setColor(ctx.embeds.MAUVE)
        .setTitle('What Johnny knows to be true')
        .setDescription(entries.map(e => `• ${e.text}  \`${e.id}\``).join('\n').slice(0, 4000))
        .setFooter({ text: 'this is in my head whether i like it or not.' });
      return interaction.editReply({ embeds: [embed] });
    }

    // add / remove are Manage Server only, so the canon stays curated.
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.editReply("that's a Manage Server thing. not your call, or mine.");
    }

    if (sub === 'add') {
      const fact = interaction.options.getString('fact').trim().slice(0, 300);
      if (!fact) return interaction.editReply('empty canon is just silence. give me something.');
      const entry = ctx.lore.add(g, fact, interaction.user.id);
      return interaction.editReply(`noted as canon: ${fact}. it's who i am now, apparently. \`${entry.id}\``);
    }

    // remove
    const id = interaction.options.getString('id').trim();
    if (!ctx.lore.remove(g, id)) {
      return interaction.editReply(`no canon with id \`${id}\`. check \`/lore list\`.`);
    }
    return interaction.editReply('struck from the canon. i already forgot it.');
  },
};
