const { SlashCommandBuilder } = require('discord.js');

// Quick real facts, delivered flat. The data is always real — fetched
// (weather) or computed locally (convert) — and Johnny only ever voices the
// wrapper around it. Per the house rule, he never invents the numbers.

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('weather')
      .setDescription("Johnny tells you the weather. Like it's a chore.")
      .addStringOption(o => o.setName('place').setDescription('City or place').setRequired(true)),
    async execute(interaction, ctx) {
      const place = interaction.options.getString('place');
      const w = await ctx.weather.getWeather(place);
      if (!w) {
        return interaction.editReply(`couldn't find "${place}" on the map. spell it like a place that exists.`);
      }

      const dataLine = `${w.label}: ${w.temp}°C, feels like ${w.feels}°C, ${w.desc}, wind ${w.wind} km/h.`;
      const quip = await ctx.askJohnny(`The weather is: ${dataLine} Give ONE flat, deadpan reaction line. Don't repeat the numbers.`, {
        maxTokens: 60,
      });
      await interaction.editReply(`${dataLine}\n${quip}`);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('convert')
      .setDescription('Johnny converts units. Correctly, unfortunately.')
      .addNumberOption(o => o.setName('value').setDescription('The number').setRequired(true))
      .addStringOption(o => o.setName('from').setDescription('e.g. miles').setRequired(true))
      .addStringOption(o => o.setName('to').setDescription('e.g. km').setRequired(true)),
    async execute(interaction, ctx) {
      const value = interaction.options.getNumber('value');
      const from = interaction.options.getString('from');
      const to = interaction.options.getString('to');

      const res = ctx.convert.convert(value, from, to);
      if (!res.ok) {
        return interaction.editReply(`i don't do "${from}" to "${to}". try real units from the same family.`);
      }

      const out = ctx.convert.round(res.value);
      const quip = await ctx.askJohnny(`Converted ${value} ${from} to ${out} ${to}. Give ONE flat throwaway line. Don't restate the math.`, {
        maxTokens: 50,
      });
      await interaction.editReply(`${value} ${from} = ${out} ${to}\n${quip}`);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('wiki')
      .setDescription('Johnny reads you the Wikipedia gist. Reluctantly.')
      .addStringOption(o => o.setName('topic').setDescription('What to look up').setRequired(true)),
    async execute(interaction, ctx) {
      const topic = interaction.options.getString('topic');
      const result = await ctx.wiki.getWiki(topic);
      if (!result) {
        return interaction.editReply(`couldn't find "${topic}" on wikipedia. either it doesn't exist or you spelled it creatively.`);
      }
      if (result.disambiguation) {
        return interaction.editReply(`"${topic}" could be a bunch of things. be more specific. i'm not guessing.`);
      }
      // The summary is shown verbatim (accurate); Johnny only voices the intro.
      const intro = await ctx.askJohnny(`Someone asked about "${result.title}". Give ONE flat intro line before the facts. Don't summarize it yourself.`, {
        maxTokens: 50,
      });
      const body = result.extract.length > 1500 ? `${result.extract.slice(0, 1500)}…` : result.extract;
      await interaction.editReply(`${intro}\n\n**${result.title}**\n${body}${result.url ? `\n<${result.url}>` : ''}`);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('tldr')
      .setDescription('Paste a link. Johnny reads it so you do not have to.')
      .addStringOption(o => o.setName('url').setDescription('The link').setRequired(true)),
    async execute(interaction, ctx) {
      const page = await ctx.tldr.fetchPageText(interaction.options.getString('url'));
      if (page.error === 'badurl') return interaction.editReply("that's not a real link. give me an http or https url.");
      if (page.error === 'blocked') return interaction.editReply("not fetching that. internal addresses are off limits.");
      if (page.error === 'nottext') return interaction.editReply("that's not a webpage i can read. probably a file or an app.");
      if (page.error) return interaction.editReply("couldn't read that page. it's down, it blocked me, or it's all javascript.");
      const summary = await ctx.askJohnny(`Summarize this webpage flatly for someone who won't read it.\n\nTitle: ${page.title}\n\n${page.text}`, {
        extraSystem: 'Give the gist in 2-4 flat sentences. Deadpan, unbothered. No hype, no "this article is about". Just what it says.',
        maxTokens: 300,
      });
      await interaction.editReply(`**${page.title || 'the link'}**\n${summary}`);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('define')
      .setDescription('Johnny defines a word. From a real dictionary, unfortunately.')
      .addStringOption(o => o.setName('word').setDescription('The word').setRequired(true)),
    async execute(interaction, ctx) {
      const word = interaction.options.getString('word');
      const result = await ctx.define.getDefinition(word);
      if (!result) return interaction.editReply(`"${word}" isn't in the dictionary. you made it up or spelled it wrong.`);
      const body = result.meanings.map(m => `*${m.pos}* — ${m.def}`).join('\n');
      const quip = await ctx.askJohnny(`Someone looked up the word "${result.word}". Give ONE flat throwaway line. Don't define it yourself.`, { maxTokens: 40 });
      await interaction.editReply(`**${result.word}**${result.phonetic ? ` ${result.phonetic}` : ''}\n${body}\n\n${quip}`);
    },
  },
];
