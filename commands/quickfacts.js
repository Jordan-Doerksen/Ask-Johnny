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
  'sound mildly put upon that you had to look it up',
  'make a flat remark about the person asking',
  'note that the article is right there and they could have read it',
  'sound like you already knew this and are unimpressed',
  'be briefly, flatly curious about it despite yourself',
  'treat the request as one more thing on a long list',
];

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
        extraSystem: ONE_LINER,
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
        extraSystem: ONE_LINER,
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
      .setDescription('Paste a link. Johnny reads it so you do not have to.')
      .addStringOption(o => o.setName('url').setDescription('The link').setRequired(true)),
    cooldownMs: 15_000, // fetches an external page + an LLM call — let it rest
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
      .setDescription('Johnny summarizes a YouTube video. If it has captions.')
      .addStringOption(o => o.setName('url').setDescription('YouTube link or id').setRequired(true)),
    cooldownMs: 15_000, // fetches a transcript + an LLM call — let it rest
    async execute(interaction, ctx) {
      const r = await ctx.youtube.getTranscript(interaction.options.getString('url'));
      if (r.error === 'badid') return interaction.editReply("that's not a youtube link i recognize. paste the actual url.");
      if (r.error === 'fetchfail') return interaction.editReply("youtube wouldn't load for me. it does that, especially from a server.");
      if (r.error === 'notranscript') return interaction.editReply(`no captions i can read on${r.title ? ` "${r.title}"` : ' that one'}. can't summarize what i can't read.`);
      const summary = await ctx.askJohnny(`Summarize this YouTube video from its transcript, flatly.\n\nTitle: ${r.title}\n\nTranscript:\n${r.text}`, {
        extraSystem: 'Give the gist in 3-5 flat sentences. Deadpan, unbothered. What the video actually covers, not hype. No "this video".',
        maxTokens: 350,
      });
      await interaction.editReply(`**${r.title || 'that video'}**\n${summary}`);
    },
  },
];
