const { SlashCommandBuilder } = require('discord.js');

// A group story, built one line at a time. State lives in the DB (per channel),
// so it survives a restart. Johnny holds the pen and gives the last word.

const MAX_LINES = 60;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('story')
    .setDescription('A group story, one line at a time. Johnny keeps it.')
    .addSubcommand(s =>
      s.setName('add').setDescription('Add the next line')
        .addStringOption(o => o.setName('line').setDescription('Your line').setRequired(true)))
    .addSubcommand(s => s.setName('show').setDescription('Read the story so far'))
    .addSubcommand(s => s.setName('end').setDescription('Finish it; Johnny gives the last word')),

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const ch = interaction.channelId;
    const stories = ctx.db.data.stories;

    if (sub === 'add') {
      const line = interaction.options.getString('line');
      if (!stories[ch]) stories[ch] = [];
      if (stories[ch].length >= MAX_LINES) {
        return interaction.editReply("this story's gone on long enough. someone /story end it.");
      }
      stories[ch].push({ name: interaction.member?.displayName || interaction.user.username, text: line });
      ctx.db.flush();
      return interaction.editReply(`added. that's line ${stories[ch].length}. someone keep it going.`);
    }

    if (sub === 'show') {
      const s = stories[ch];
      if (!s || !s.length) return interaction.editReply('there is no story going. /story add to start one.');
      return interaction.editReply(`📖 the story so far:\n${s.map(l => l.text).join(' ')}`.slice(0, 1900));
    }

    // end
    const s = stories[ch];
    if (!s || !s.length) return interaction.editReply('nothing to end. there is no story.');
    const text = s.map(l => l.text).join(' ').slice(0, 4000);
    const ending = await ctx.askJohnny(`Here's a group story. Write ONE flat, anticlimactic final sentence to end it:\n\n${text}`, {
      extraSystem: 'End the story in one deadpan line. Undercut whatever was building. No drama.',
      temperature: 1.0,
    });
    delete stories[ch];
    ctx.db.flush();
    return interaction.editReply(`📖 ${text}\n\n…${ending}\n\n*the end. finally.*`.slice(0, 1990));
  },
};
