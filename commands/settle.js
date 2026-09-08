const { SlashCommandBuilder } = require('discord.js');

// Johnny as reluctant referee. /settle just decides; /coinflip and /pick are
// quick RNG calls with a flat one-liner. (Persistent multi-option votes live in
// /poll, in polls.js.)

const FLIP_LINES = [
  side => `Result: ${side}. Confirmed.`,
  side => `It is ${side}. That is the flip, and it stands.`,
  side => `The coin came up ${side}. One flip, one result.`,
];

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('settle')
      .setDescription('Johnny ends the argument. He picks one side and commits.')
      .addStringOption(o => o.setName('question').setDescription('What are you arguing about?').setRequired(true)),
    async execute(interaction, ctx) {
      const question = interaction.options.getString('question');
      const reply = await ctx.askJohnny(`Settle this argument: ${question}`, {
        extraSystem:
          'Pick one side and commit — no hedging, no "it depends". State the ruling first, then the one reason ' +
          'that decides it. One or two lines.',
        temperature: 0.9,
      });
      await interaction.editReply(reply);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('coinflip')
      .setDescription('Heads or tails. Johnny flips once and calls it.'),
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
        return interaction.editReply('Two options minimum, separated by | or commas.');
      }
      const chosen = options[Math.floor(Math.random() * options.length)];
      const reply = await ctx.askJohnny(`The options were: ${options.join(', ')}. You picked "${chosen}" at random.`, {
        extraSystem:
          `You picked "${chosen}" from a list at random. State the pick plainly and say the selection was random. ` +
          `One line. Do not deliberate, do not weigh the options, and do not pretend it was reasoned.`,
      });
      await interaction.editReply(reply);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('roll')
      .setDescription('Roll dice. e.g. 2d6, d20, 3d6+1.')
      .addStringOption(o => o.setName('dice').setDescription('e.g. 2d6, d20, 4d8+2 (default 1d20)').setRequired(false)),
    async execute(interaction) {
      const spec = (interaction.options.getString('dice') || '1d20').toLowerCase().replace(/\s+/g, '');
      const m = spec.match(/^(\d*)d(\d+)([+-]\d+)?$/);
      if (!m) {
        return interaction.editReply('That is not a dice spec. Use a format like 2d6, d20, or 3d8+1.');
      }
      const count = parseInt(m[1] || '1', 10);
      const sides = parseInt(m[2], 10);
      const mod = m[3] ? parseInt(m[3], 10) : 0;
      if (count < 1 || count > 100 || sides < 2 || sides > 1000) {
        return interaction.editReply('Out of range. Use 1 to 100 dice with 2 to 1000 sides.');
      }
      const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
      const sum = rolls.reduce((a, b) => a + b, 0) + mod;
      const breakdown = count > 1 || mod
        ? ` (${rolls.join(' + ')}${mod ? ` ${mod > 0 ? '+' : '-'} ${Math.abs(mod)}` : ''})`
        : '';
      await interaction.editReply(`🎲 **${sum}**${breakdown}. That is the roll.`);
    },
  },
];
