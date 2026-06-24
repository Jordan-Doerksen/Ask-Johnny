const { SlashCommandBuilder } = require('discord.js');

// Johnny as reluctant referee. /settle just decides; /coinflip and /pick are
// quick RNG calls with a flat one-liner. (Persistent multi-option votes live in
// /poll, in polls.js.)

const FLIP_LINES = [
  side => `${side}. the universe has spoken. it didn't care much.`,
  side => `${side}. that's the flip. don't make it weird.`,
  side => `it's ${side}. fate, or a coin. same difference.`,
];

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('settle')
      .setDescription('Johnny ends the argument. He just decides.')
      .addStringOption(o => o.setName('question').setDescription('What are you arguing about?').setRequired(true)),
    async execute(interaction, ctx) {
      const question = interaction.options.getString('question');
      const reply = await ctx.askJohnny(`Settle this argument: ${question}`, {
        extraSystem:
          'Pick one side and commit — no hedging, no "it depends". Decide it flatly, like the answer was always ' +
          'obvious and you\'re a little surprised it was a question. One or two lines.',
        temperature: 0.9,
      });
      await interaction.editReply(reply);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('coinflip')
      .setDescription('Heads or tails. Johnny flips it without enthusiasm.'),
    async execute(interaction) {
      const side = Math.random() < 0.5 ? 'heads' : 'tails';
      await interaction.editReply(pick(FLIP_LINES)(side));
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('pick')
      .setDescription('Johnny picks one. Separate options with | or commas.')
      .addStringOption(o => o.setName('options').setDescription('e.g. pizza | tacos | sushi').setRequired(true)),
    async execute(interaction, ctx) {
      const raw = interaction.options.getString('options');
      const options = raw.split(/\s*[|,]\s*/).map(s => s.trim()).filter(Boolean);
      if (options.length < 2) {
        return interaction.editReply('give me at least two things to pick between. separate with | or commas.');
      }
      const chosen = options[Math.floor(Math.random() * options.length)];
      const reply = await ctx.askJohnny(`The options were: ${options.join(', ')}. You picked "${chosen}" at random.`, {
        extraSystem:
          `You just picked "${chosen}" out of a list, at random. State that it's the pick and give a flat, ` +
          `throwaway non-reason. One line. Don't deliberate, don't weigh it.`,
      });
      await interaction.editReply(reply);
    },
  },
];
