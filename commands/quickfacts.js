const { SlashCommandBuilder } = require('discord.js');

// Quick real facts, delivered flat. The data is always real — fetched
// (weather) or computed locally (convert) — and Johnny only ever voices the
// wrapper around it. Per the house rule, he never invents the numbers.

// Every command here prints Johnny's line NEXT TO verbatim real data. A wordy line
// therefore repeats that data, and can contradict it — which is the one thing the house
// rule forbids. The length limit has to live in the SYSTEM prompt: gpt-oss honours it
// there and largely ignores it in the user message. Verified 2026-09-07 — with the limit
// only in the user message, /wiki wrote its own full Stonehenge summary directly above
// the real Wikipedia extract. (The old model obeyed the user-message version; this is
// the behaviour that changed with the provider swap, not a new requirement.)
const ONE_LINER =
  'Answer with ONE short sentence, then stop. Never explain, summarize, define, or list facts — ' +
  'the real information is already shown to the user right beside your line, so repeating it is ' +
  'noise and contradicting it is worse. You are only the throwaway remark in front of the data.';

// Same trick the chaos commands use (see commands/fun.js): without a varied seed the model
// falls into one default opening and never leaves it. Measured 2026-09-07 — seven /wiki
// intros in a row began with the word "Fine". Rotating the angle breaks the tic.
const WIKI_ANGLES = [
  'note that you already know this one',
  'say plainly that the text below is the accurate version, not your summary',
  'give one precise reason the topic is worth knowing',
  'be openly interested in it for exactly one line',
  'note that this is a topic people usually state wrong',
  'point out that the detail people actually want is in the text below',
];

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('weather')
      .setDescription('Current weather for a place. Live data, not a forecast.')
      .addStringOption(o => o.setName('place').setDescription('City or place').setRequired(true)),
    async execute(interaction, ctx) {
      const place = interaction.options.getString('place');
      const w = await ctx.weather.getWeather(place);
      if (!w) {
        return interaction.editReply(`No match for "${place}". Check the spelling, or name a larger nearby city.`);
      }

      const dataLine = `${w.label}: ${w.temp}°C, feels like ${w.feels}°C, ${w.desc}, wind ${w.wind} km/h.`;
      const quip = await ctx.askJohnny(`The weather is: ${dataLine} Give ONE short, exact reaction line. Don't repeat the numbers.`, {
        extraSystem: ONE_LINER,
        maxTokens: 60,
      });
      await interaction.editReply(`${dataLine}\n${quip}`);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('convert')
      .setDescription('Convert a value from one unit to another.')
      .addNumberOption(o => o.setName('value').setDescription('The number').setRequired(true))
      .addStringOption(o => o.setName('from').setDescription('e.g. miles').setRequired(true))
      .addStringOption(o => o.setName('to').setDescription('e.g. km').setRequired(true)),
    async execute(interaction, ctx) {
      const value = interaction.options.getNumber('value');
      const from = interaction.options.getString('from');
      const to = interaction.options.getString('to');

      const res = ctx.convert.convert(value, from, to);
      if (!res.ok) {
        return interaction.editReply(`Negative. "${from}" and "${to}" are not the same kind of unit.`);
      }

      const out = ctx.convert.round(res.value);
      const quip = await ctx.askJohnny(`Converted ${value} ${from} to ${out} ${to}. Give ONE flat throwaway line. Don't restate the math.`, {
        extraSystem: ONE_LINER,
        maxTokens: 50,
      });
      await interaction.editReply(`${value} ${from} = ${out} ${to}\n${quip}`);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('wiki')
      .setDescription('Look up a topic and get the Wikipedia summary, verbatim.')
      .addStringOption(o => o.setName('topic').setDescription('What to look up').setRequired(true)),
    async execute(interaction, ctx) {
      const topic = interaction.options.getString('topic');
      const result = await ctx.wiki.getWiki(topic);
      if (!result) {
        return interaction.editReply(`No Wikipedia article for "${topic}". Check the spelling, or use the exact title.`);
      }
      if (result.disambiguation) {
        return interaction.editReply(`"${topic}" matches several articles. Give me the exact title.`);
      }
      // The summary is shown verbatim (accurate); Johnny only voices the intro.
      // Asking for an "intro line" about a topic invites the model to define the topic,
      // and the real extract is printed immediately below — so it echoed Wikipedia's own
      // first sentence. Ask for the REACTION instead, and forbid the facts outright.
      const angle = ctx.util.pick(WIKI_ANGLES);
      const intro = await ctx.askJohnny(`Someone made you look up "${result.title}" on Wikipedia. Give ONE flat line — ${angle}. Say NOTHING factual about it: no dates, no places, no definition. The real article is printed directly under your line.`, {
        extraSystem: ONE_LINER,
        maxTokens: 50,
      });
      const body = result.extract.length > 1500 ? `${result.extract.slice(0, 1500)}…` : result.extract;
      await interaction.editReply(`${intro}\n\n**${result.title}**\n${body}${result.url ? `\n<${result.url}>` : ''}`);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('tldr')
      .setDescription('Paste a link. Get the page summarized in a few sentences.')
      .addStringOption(o => o.setName('url').setDescription('The link').setRequired(true)),
    cooldownMs: 15_000, // fetches an external page + an LLM call — let it rest
    async execute(interaction, ctx) {
      const page = await ctx.tldr.fetchPageText(interaction.options.getString('url'));
      if (page.error === 'badurl') return interaction.editReply('That is not a valid link. Give me an http or https URL.');
      if (page.error === 'blocked') return interaction.editReply('Negative. Internal addresses are off limits.');
      if (page.error === 'nottext') return interaction.editReply('That link serves a file, not a webpage I can read.');
      if (page.error) return interaction.editReply('Could not read that page. It is down, it blocked me, or it is all JavaScript.');
      const summary = await ctx.askJohnny(`Summarize this webpage flatly for someone who won't read it.\n\nTitle: ${page.title}\n\n${page.text}`, {
        extraSystem: 'Give the gist in 2-4 exact sentences. Say what the page actually claims, in order. No hype, no '
          + '"this article is about", no padding. Do not add anything the page does not say.',
        maxTokens: 300,
      });
      await interaction.editReply(`**${page.title || 'the link'}**\n${summary}`);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('define')
      .setDescription('Define a word from a real dictionary.')
      .addStringOption(o => o.setName('word').setDescription('The word').setRequired(true)),
    async execute(interaction, ctx) {
      const word = interaction.options.getString('word');
      const result = await ctx.define.getDefinition(word);
      if (!result) return interaction.editReply(`"${word}" is not in the dictionary. Check the spelling.`);
      const body = result.meanings.map(m => `*${m.pos}* — ${m.def}`).join('\n');
      const quip = await ctx.askJohnny(`Someone looked up the word "${result.word}". Give ONE flat throwaway line. Don't define it yourself.`, {
        extraSystem: ONE_LINER,
        maxTokens: 40,
      });
      await interaction.editReply(`**${result.word}**${result.phonetic ? ` ${result.phonetic}` : ''}\n${body}\n\n${quip}`);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('yt')
      .setDescription('Summarize a YouTube video from its captions.')
      .addStringOption(o => o.setName('url').setDescription('YouTube link or id').setRequired(true)),
    cooldownMs: 15_000, // fetches a transcript + an LLM call — let it rest
    async execute(interaction, ctx) {
      const r = await ctx.youtube.getTranscript(interaction.options.getString('url'));
      if (r.error === 'badid') return interaction.editReply('That is not a YouTube link I recognize. Paste the full URL.');
      if (r.error === 'fetchfail') return interaction.editReply('YouTube did not respond. Try again in a minute.');
      if (r.error === 'notranscript') return interaction.editReply(`No readable captions on${r.title ? ` "${r.title}"` : ' that one'}. I summarize from captions only.`);
      const summary = await ctx.askJohnny(`Summarize this YouTube video from its transcript, flatly.\n\nTitle: ${r.title}\n\nTranscript:\n${r.text}`, {
        extraSystem: 'Give the gist in 3-5 exact sentences. Say what the video actually covers, in order. No hype, no '
          + '"this video", no padding. Do not add anything the captions do not say.',
        maxTokens: 350,
      });
      await interaction.editReply(`**${r.title || 'that video'}**\n${summary}`);
    },
  },
];
