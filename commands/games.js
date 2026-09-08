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
        return interaction.editReply('This story is at the line limit. Use /story end to finish it.');
      }
      stories[ch].push({ name: interaction.member?.displayName || interaction.user.username, text: line });
      ctx.db.flush();
      return interaction.editReply(`Logged. That is line ${stories[ch].length}. The next line is open.`);
    }

    if (sub === 'show') {
      const s = stories[ch];
      if (!s || !s.length) return interaction.editReply('No story is running here. Use /story add to start one.');
      return interaction.editReply(`📖 The story so far:\n${s.map(l => l.text).join(' ')}`.slice(0, 1900));
    }

    // end
    const s = stories[ch];
    if (!s || !s.length) return interaction.editReply('No story to end.');
    const text = s.map(l => l.text).join(' ').slice(0, 4000);
    const ending = await ctx.askJohnny(`Here's a group story. Write ONE flat, anticlimactic final sentence to end it:\n\n${text}`, {
      extraSystem: 'End the story in ONE line that actually resolves it. Land the ending, do not undercut it ' +
        'and do not trail off. No drama, no moral.',
      temperature: 1.0,
    });
    delete stories[ch];
    ctx.db.flush();
    return interaction.editReply(`📖 ${text}\n\n…${ending}\n\n*The end.*`.slice(0, 1990));
  },
};
