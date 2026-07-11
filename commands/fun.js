const { SlashCommandBuilder } = require('discord.js');

// The original chaos commands — stateless LLM bits, ported verbatim from the
// old monolith. Each command can pass an `extraSystem` string + `temperature`
// to ctx.askJohnny(). The seed arrays break the model's tendency to repeat its
// few "default" answers at high temperature.

const HYPOTHETICAL_SEEDS = [
  'waking up as an animal',
  'time travel or waking up in another era',
  'suddenly getting a weird, oddly specific superpower',
  'a huge amount of money with a ridiculous catch',
  'swapping bodies with someone',
  'being the last person on earth',
  'an everyday object that starts talking',
  'a wish that backfires',
  'being shrunk down tiny or made giant',
  'meeting an exact clone of yourself',
];

const HOTTAKE_TOPICS = [
  'food', 'movies or TV', 'phones and technology', 'sports', 'music', 'everyday life',
  'the internet', 'work', 'holidays', 'pets', 'cars', 'fashion', 'social media',
];

const WYR_SEEDS = [
  'food', 'superpowers', 'money', 'everyday annoyances', 'travel', 'technology',
  'animals', 'fame', 'time', 'the body',
];

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('ask')
      .setDescription("Ask Johnny something. He'll answer, I guess.")
      .addStringOption(o => o.setName('question').setDescription('What do you wanna ask Johnny?').setRequired(true)),
    async execute(interaction, ctx) {
      // Fold in the server's canon so /ask reflects who the server made him.
      const loreBlock = interaction.guildId && ctx.lore ? ctx.lore.block(interaction.guildId) : null;
      const opts = loreBlock
        ? { extraSystem: `Canon about you and this server (treat as true, don't recite it):\n${loreBlock}` }
        : {};
      await interaction.editReply(await ctx.askJohnny(interaction.options.getString('question'), opts));
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('roast')
      .setDescription('Johnny roasts a homie. Low effort, on purpose.')
      .addUserOption(o => o.setName('target').setDescription('Who is getting roasted?').setRequired(true)),
    async execute(interaction, ctx) {
      const name = ctx.util.nameOf(interaction, 'target');
      const reply = await ctx.askJohnny(`Roast my buddy ${name}.`, {
        extraSystem:
          `Roast your friend ${name} in your dry, deadpan way — flat, understated burns where the lack of effort ` +
          `is half the insult. Still a friend who loves them, never genuinely cruel. A couple lines, no more.`,
      });
      await interaction.editReply(reply);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('debate')
      .setDescription('Johnny picks a side and argues it, mildly annoyed he has to.')
      .addStringOption(o => o.setName('topic').setDescription('What is the debate about?').setRequired(true)),
    async execute(interaction, ctx) {
      const topic = interaction.options.getString('topic');
      const side = Math.random() < 0.5 ? 'FOR' : 'AGAINST';
      const reply = await ctx.askJohnny(`The topic is: ${topic}`, {
        extraSystem:
          `Argue the ${side} side of this topic, but flatly — like it's obvious and you're mildly annoyed you have ` +
          `to spell it out. Dry, a little lazy with the logic, unbothered. Commit to the bit without raising your voice.`,
      });
      await interaction.editReply(reply);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('rate')
      .setDescription('Johnny rates something out of 10. Generously, never.')
      .addStringOption(o => o.setName('thing').setDescription('What should Johnny rate?').setRequired(true)),
    async execute(interaction, ctx) {
      const thing = interaction.options.getString('thing');
      const reply = await ctx.askJohnny(`Rate this out of 10: ${thing}`, {
        extraSystem:
          'Rate it out of 10 in your dry, deadpan way. Give the number and a flat one-line reason. Do not overthink it.',
      });
      await interaction.editReply(reply);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('hottake')
      .setDescription('Johnny states an unprompted opinion. Mildly.'),
    async execute(interaction, ctx) {
      const topic = ctx.util.pick(HOTTAKE_TOPICS);
      const reply = await ctx.askJohnny(`Give a hot take about ${topic}.`, {
        extraSystem:
          `State ONE flat, deadpan opinion about ${topic} — the kind of mildly contrarian take you'd mutter and ` +
          `not bother defending. One or two sentences.`,
        temperature: 1.0,
      });
      await interaction.editReply(reply);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('whatwouldyoudo')
      .setDescription('Johnny tosses out a ridiculous hypothetical. Do what you want with it.'),
    async execute(interaction, ctx) {
      const seed = ctx.util.pick(HYPOTHETICAL_SEEDS);
      const reply = await ctx.askJohnny(`Give the group a hypothetical about ${seed}.`, {
        extraSystem:
          `Make up ONE absurd, funny hypothetical scenario based loosely on "${seed}" and ask the group what ` +
          `they'd do. Two to four sentences, genuinely ridiculous, ends with the question. Don't answer it yourself.`,
        temperature: 1.0,
      });
      await interaction.editReply(`👀 **What would you do?**\n${reply}`);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('wouldyourather')
      .setDescription('Johnny poses a would-you-rather. Vote 🇦 or 🇧.'),
    async execute(interaction, ctx) {
      const seed = ctx.util.pick(WYR_SEEDS);
      const reply = await ctx.askJohnny(`Make a would-you-rather about ${seed}.`, {
        extraSystem:
          `Make ONE would-you-rather themed around ${seed}, with exactly two options. Format: a one-line setup, then ` +
          `"🇦 ..." on its own line and "🇧 ..." on its own line. Flat and a little absurd. No commentary after.`,
        temperature: 1.0,
      });
      const embed = ctx.embeds.voteEmbed({ title: '🤔 Would you rather', description: reply });
      const msg = await interaction.editReply({ embeds: [embed] });
      await msg.react('🇦');
      await msg.react('🇧');
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('haiku')
      .setDescription('Johnny writes a haiku. Begrudgingly.')
      .addStringOption(o => o.setName('topic').setDescription('What about?').setRequired(true)),
    async execute(interaction, ctx) {
      const topic = interaction.options.getString('topic');
      const reply = await ctx.askJohnny(`Write a haiku about: ${topic}`, {
        extraSystem:
          'Write ONE haiku — three lines, roughly 5-7-5, no need to count perfectly — about the topic, in your flat ' +
          'deadpan voice. Anticlimactic. Output only the three lines, nothing else.',
        temperature: 1.0,
      });
      await interaction.editReply(reply);
    },
  },
];
