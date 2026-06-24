const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

// Jordan's links & projects, shown in an embed. Editable in Discord — no
// redeploy needed. The list lives in the DB (guild-scoped); a new server starts
// from the defaults below, which can then be added to or removed like any other.

const DEFAULTS = [
  { label: 'Portfolio (The Observatory)', url: 'https://jordan-doerksen.github.io' },
  { label: 'GitHub', url: 'https://github.com/Jordan-Doerksen' },
];

function getLinks(ctx, guildId) {
  if (!ctx.db.data.links[guildId]) {
    ctx.db.data.links[guildId] = DEFAULTS.map(d => ({ ...d, addedBy: null, ts: Date.now() }));
    ctx.db.flush();
  }
  return ctx.db.data.links[guildId];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('links')
    .setDescription("Jordan's links and projects.")
    .addSubcommand(s => s.setName('show').setDescription('Show the links'))
    .addSubcommand(s =>
      s.setName('add').setDescription('Add a link (Manage Server)')
        .addStringOption(o => o.setName('label').setDescription('e.g. itch.io').setRequired(true))
        .addStringOption(o => o.setName('url').setDescription('https://...').setRequired(true)))
    .addSubcommand(s =>
      s.setName('remove').setDescription('Remove a link by label (Manage Server)')
        .addStringOption(o => o.setName('label').setDescription('The exact label to remove').setRequired(true))),

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'show') {
      const links = getLinks(ctx, guildId);
      if (!links.length) {
        return interaction.editReply('no links saved. someone with Manage Server can `/links add` some.');
      }
      const embed = new EmbedBuilder()
        .setColor(ctx.embeds.MAUVE)
        .setTitle("Jordan's stuff")
        .setDescription(links.map(l => `• [${l.label}](${l.url})`).join('\n'))
        .setFooter({ text: 'go look, or don\'t. it\'s all there.' });
      return interaction.editReply({ embeds: [embed] });
    }

    // add / remove are Manage Server only, so the list stays curated.
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.editReply("that's a Manage Server thing. not your call, or mine.");
    }

    if (sub === 'add') {
      const label = interaction.options.getString('label').trim().slice(0, 80);
      const url = interaction.options.getString('url').trim();
      if (!/^https?:\/\/\S+\.\S+/i.test(url)) {
        return interaction.editReply("that's not a url i'll vouch for. start it with http(s):// and make it real.");
      }
      const links = getLinks(ctx, guildId);
      const at = links.findIndex(l => l.label.toLowerCase() === label.toLowerCase());
      const entry = { label, url, addedBy: interaction.user.id, ts: Date.now() };
      if (at >= 0) links[at] = entry; // same label -> update
      else links.push(entry);
      ctx.db.flush();
      return interaction.editReply(`added **${label}**. it's on the list now. try to keep it working.`);
    }

    // remove
    const label = interaction.options.getString('label').trim();
    const links = getLinks(ctx, guildId);
    const before = links.length;
    ctx.db.data.links[guildId] = links.filter(l => l.label.toLowerCase() !== label.toLowerCase());
    if (ctx.db.data.links[guildId].length === before) {
      return interaction.editReply(`no link called "${label}". check \`/links show\` for the exact label.`);
    }
    ctx.db.flush();
    return interaction.editReply(`removed **${label}**. gone. like it never linked.`);
  },
};
