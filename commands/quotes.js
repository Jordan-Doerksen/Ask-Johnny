const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

// The quote book. Save the dumb thing a friend just said, pull it back later.
// Quotes are shown verbatim; Johnny only ever adds a flat one-line wrapper —
// and those wrappers are static (no LLM call), so the most-used command here is
// cheap and instant. Storage lives in lib/quotes.js (the JSON store).

const fmt = q => `> ${q.text}\n— ${q.author || 'unknown'}  \`${q.id}\``;

const RANDOM_LINES = [
  'From the archives. No context supplied.',
  'Someone said this out loud, on purpose.',
  'Pulled at random from the book.',
  'The record stands.',
];

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quote')
    .setDescription('The quote book. Save what people said, pull it back later.')
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
    if (!interaction.guildId) return interaction.editReply('This works in a server only. The quote book is per-server.');
    const sub = interaction.options.getSubcommand();
    const g = interaction.guildId;

    if (sub === 'add') {
      const text = interaction.options.getString('text').trim().slice(0, 1500);
      const author = (interaction.options.getString('author') || '').trim().slice(0, 80);
      if (!text) return interaction.editReply('Nothing to save. A quote needs text.');
      const q = ctx.quotes.add(g, text, author, interaction.user.id);
      return interaction.editReply(`Logged. Id \`${q.id}\`.`);
    }

    if (sub === 'random') {
      const author = interaction.options.getString('author');
      const q = ctx.quotes.random(g, author);
      if (!q) {
        return interaction.editReply(
          author ? `Nothing on record from "${author}".` : 'The quote book is empty. Nothing has been saved yet.',
        );
      }
      return interaction.editReply(`${pick(RANDOM_LINES)}\n${fmt(q)}`);
    }

    if (sub === 'search') {
      const term = interaction.options.getString('term');
      const found = ctx.quotes.search(g, term);
      if (!found.length) return interaction.editReply(`No quote matches "${term}".`);
      const body = found.slice(0, 8).map(fmt).join('\n\n');
      const more = found.length > 8 ? `\n\n…and ${found.length - 8} more. Narrow the search term.` : '';
      return interaction.editReply(`${found.length} hit${found.length === 1 ? '' : 's'}:\n${body}${more}`.slice(0, 1990));
    }

    if (sub === 'authors') {
      const board = ctx.quotes.authors(g);
      if (!board.length) return interaction.editReply('Nobody has been quoted yet. The book is empty.');
      const lines = board.slice(0, 10).map(([a, n], i) => `${i + 1}. ${a} — ${n}`).join('\n');
      return interaction.editReply(`Most-quoted, by count:\n${lines}`);
    }

    // remove — the author of the quote, or anyone with Manage Server
    const id = interaction.options.getString('id').trim();
    const q = ctx.quotes.get(g, id);
    if (!q) return interaction.editReply(`No quote with id \`${id}\`. Check the id and try again.`);
    const isOwner = q.addedBy === interaction.user.id;
    const canManage = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
    if (!isOwner && !canManage) {
      return interaction.editReply('Negative. You can remove only your own quotes, or you need Manage Server.');
    }
    ctx.quotes.remove(g, id);
    return interaction.editReply('Removed.');
  },
};
