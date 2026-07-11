const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

// The quote book. Save the dumb thing a friend just said, pull it back later.
// Quotes are shown verbatim; Johnny only ever adds a flat one-line wrapper —
// and those wrappers are static (no LLM call), so the most-used command here is
// cheap and instant. Storage lives in lib/quotes.js (the JSON store).

const fmt = q => `> ${q.text}\n— ${q.author || 'unknown'}  \`${q.id}\``;

const RANDOM_LINES = [
  'from the archives. no context, as intended.',
  'someone said this. out loud. on purpose.',
  "pulled one at random. it holds up. barely.",
  'the record stands.',
];

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quote')
    .setDescription('The book of dumb things people said. Johnny keeps it.')
    .addSubcommand(s =>
      s.setName('add').setDescription('Save a quote')
        .addStringOption(o => o.setName('text').setDescription('What was said').setRequired(true))
        .addStringOption(o => o.setName('author').setDescription('Who said it').setRequired(false)))
    .addSubcommand(s =>
      s.setName('random').setDescription('Pull a random quote')
        .addStringOption(o => o.setName('author').setDescription('From this person (optional)').setRequired(false)))
    .addSubcommand(s =>
      s.setName('search').setDescription('Find a quote by text or author')
        .addStringOption(o => o.setName('term').setDescription('What to look for').setRequired(true)))
    .addSubcommand(s => s.setName('authors').setDescription('Who gets quoted the most'))
    .addSubcommand(s =>
      s.setName('remove').setDescription('Delete a quote (yours, or Manage Server)')
        .addStringOption(o => o.setName('id').setDescription('The id from the quote').setRequired(true))),

  async execute(interaction, ctx) {
    if (!interaction.guildId) return interaction.editReply("that's a server thing. quotes need a room to echo in.");
    const sub = interaction.options.getSubcommand();
    const g = interaction.guildId;

    if (sub === 'add') {
      const text = interaction.options.getString('text').trim().slice(0, 1500);
      const author = (interaction.options.getString('author') || '').trim().slice(0, 80);
      if (!text) return interaction.editReply('nothing to save. a quote needs words.');
      const q = ctx.quotes.add(g, text, author, interaction.user.id);
      return interaction.editReply(`saved. it's in the book now, forever. \`${q.id}\``);
    }

    if (sub === 'random') {
      const author = interaction.options.getString('author');
      const q = ctx.quotes.random(g, author);
      if (!q) {
        return interaction.editReply(
          author ? `nothing on record from "${author}". lucky them.` : 'the book\'s empty. nobody\'s said anything worth keeping yet.',
        );
      }
      return interaction.editReply(`${pick(RANDOM_LINES)}\n${fmt(q)}`);
    }

    if (sub === 'search') {
      const term = interaction.options.getString('term');
      const found = ctx.quotes.search(g, term);
      if (!found.length) return interaction.editReply(`nothing matches "${term}". made it up, or it never happened.`);
      const body = found.slice(0, 8).map(fmt).join('\n\n');
      const more = found.length > 8 ? `\n\n…and ${found.length - 8} more. narrow it down.` : '';
      return interaction.editReply(`${found.length} hit${found.length === 1 ? '' : 's'}:\n${body}${more}`.slice(0, 1990));
    }

    if (sub === 'authors') {
      const board = ctx.quotes.authors(g);
      if (!board.length) return interaction.editReply("nobody's been quoted yet. a clean, quiet record.");
      const lines = board.slice(0, 10).map(([a, n], i) => `${i + 1}. ${a} — ${n}`).join('\n');
      return interaction.editReply(`most-quoted, for their sins:\n${lines}`);
    }

    // remove — the author of the quote, or anyone with Manage Server
    const id = interaction.options.getString('id').trim();
    const q = ctx.quotes.get(g, id);
    if (!q) return interaction.editReply(`no quote with id \`${id}\`. check it and try again.`);
    const isOwner = q.addedBy === interaction.user.id;
    const canManage = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
    if (!isOwner && !canManage) {
      return interaction.editReply("not yours to pull, and you can't manage the server. leave it be.");
    }
    ctx.quotes.remove(g, id);
    return interaction.editReply('gone. struck from the record. we all move on.');
  },
};
