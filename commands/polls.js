const { SlashCommandBuilder } = require('discord.js');

// Reaction-vote commands. /judge and /warcrime pose something and let the
// server vote ✅/❌; /poll is a user-authored multi-option vote. All three now
// persist their poll to the DB and are closed later by lib/scheduler.js — so a
// poll survives a bot restart instead of dying in a setTimeout.

const VOTE_MS = 60_000; // judge + warcrime window
const POLL_DEFAULT_MS = 3_600_000; // /poll default close: 1h
const POLL_MAX_MS = 7 * 86_400_000; // /poll cap: 7d
const LETTERS = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫'];

const WAR_ANGLES = [
  'ancient history (Rome, Greece, the Mongols, etc.)',
  'the medieval era',
  'the 1600s or 1700s',
  'the 1800s — colonial empires or civil wars',
  'World War I',
  'World War II',
  'the Cold War',
  'a 20th-century conflict in Asia, Africa, or South America',
  'a conflict from the last 50 years',
];

const DILEMMA_THEMES = [
  'finding money or something valuable',
  'lying or white lies',
  'food, eating, or restaurants',
  'friends and loyalty',
  'dating or relationships',
  'work or school',
  'pets or animals',
  'phones, social media, or the internet',
  'strangers in public',
  'family',
];

// Post a ✅/❌ vote embed and persist it for the scheduler to close in 60s.
async function postVerdictPoll(interaction, ctx, { kind, title, scenario }) {
  const embed = ctx.embeds.voteEmbed({
    title,
    description: `${scenario}\n\n✅ = yeah   ❌ = nah\nJohnny calls it in 60 seconds.`,
  });
  const msg = await interaction.editReply({ embeds: [embed] });
  await msg.react('✅');
  await msg.react('❌');

  ctx.db.data.polls.push({
    id: ctx.util.genId('p_'),
    kind,
    channelId: msg.channelId,
    messageId: msg.id,
    guildId: interaction.guildId,
    scenario,
    closeAt: Date.now() + VOTE_MS,
    closed: false,
  });
  ctx.db.flush();
}

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('judge')
      .setDescription('Johnny poses a moral dilemma. Vote, then he shrugs out a verdict.'),
    async execute(interaction, ctx) {
      const theme = ctx.util.pick(DILEMMA_THEMES);
      const scenario = await ctx.askJohnny(`Pose a moral dilemma about ${theme}.`, {
        extraSystem:
          `Make up ONE spicy everyday moral dilemma about ${theme}, as a yes/no question. Make it specific and a ` +
          `little unexpected. One or two sentences. Just the dilemma and the question — do NOT give your own answer yet.`,
        temperature: 1.0,
      });
      await postVerdictPoll(interaction, ctx, { kind: 'judge', title: '⚖️ Johnny judges', scenario });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('warcrime')
      .setDescription('A dark historical event. Vote justified or not, then Johnny weighs in. Barely.'),
    async execute(interaction, ctx) {
      const angle = ctx.util.pick(WAR_ANGLES);
      const scenario = await ctx.askJohnny(`Name a real dark historical event from ${angle} to judge.`, {
        extraSystem:
          `Pick ONE real, well-documented dark historical event from ${angle} — a military action, bombing, or ` +
          `atrocity. Reply in EXACTLY this format and nothing else: the event stated in one short factual sentence, ` +
          `then "Was it justified?" Do not list options, do not compare events, do not explain your pick, do not give your take.`,
        temperature: 0.9,
      });
      await postVerdictPoll(interaction, ctx, { kind: 'warcrime', title: '🪖 War crimes with Johnny', scenario });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('poll')
      .setDescription('A real vote that survives restarts. Johnny tallies it later.')
      .addStringOption(o => o.setName('question').setDescription('The question').setRequired(true))
      .addStringOption(o => o.setName('options').setDescription('2-6 options, separated by |').setRequired(true))
      .addStringOption(o => o.setName('duration').setDescription('optional, e.g. "2h" (default 1h)').setRequired(false)),
    async execute(interaction, ctx) {
      const question = interaction.options.getString('question');
      const raw = interaction.options.getString('options');
      const durStr = interaction.options.getString('duration');

      const options = raw.split('|').map(s => s.trim()).filter(Boolean).slice(0, 6);
      if (options.length < 2) {
        return interaction.editReply("give me at least two options, split by | . one option isn't a poll, it's a decree.");
      }

      const ms = Math.min(ctx.util.parseDuration(durStr) || POLL_DEFAULT_MS, POLL_MAX_MS);
      const closeAt = Date.now() + ms;
      const body = options.map((o, i) => `${LETTERS[i]} ${o}`).join('\n');
      const embed = ctx.embeds.voteEmbed({
        title: `📊 ${question}`,
        description: `${body}\n\nvote with the letters. i'll tally it in ${ctx.util.humanizeMs(ms)}.`,
      });

      const msg = await interaction.editReply({ embeds: [embed] });
      for (let i = 0; i < options.length; i++) await msg.react(LETTERS[i]);

      ctx.db.data.polls.push({
        id: ctx.util.genId('p_'),
        kind: 'poll',
        channelId: msg.channelId,
        messageId: msg.id,
        guildId: interaction.guildId,
        question,
        options,
        closeAt,
        closed: false,
      });
      ctx.db.flush();
    },
  },
];
