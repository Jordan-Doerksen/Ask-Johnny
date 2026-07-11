const { SlashCommandBuilder } = require('discord.js');

// /trivia — a real question with letter-reaction answers. Default source is
// Johnny's own fact-checked bank (his special interests); pick a topic, or "the
// web" for a generic OpenTDB question. The question persists as a `trivia` poll
// row and is closed by lib/scheduler.js after 30s, which reveals the answer (+ a
// factoid) and awards a point to everyone who picked ONLY the correct letter.

const LETTERS = ['🇦', '🇧', '🇨', '🇩'];
const CLOSE_MS = 30_000;

// Topic choices — the bank's topics, plus "surprise me" and the web. Keys match
// the trivia-bank workflow's topicKeys.
const TOPIC_CHOICES = [
  { name: 'Surprise me', value: 'any' },
  { name: 'Warcraft III', value: 'warcraft3' },
  { name: 'StarCraft', value: 'starcraft' },
  { name: 'Diablo II', value: 'diablo2' },
  { name: 'Zelda: Ocarina of Time', value: 'zelda-oot' },
  { name: 'Pokémon Gen 1 & 2', value: 'pokemon' },
  { name: 'The Lord of the Rings', value: 'lotr' },
  { name: 'Princess Mononoke', value: 'mononoke' },
  { name: 'Starship Troopers', value: 'starship-troopers' },
  { name: 'The Matrix', value: 'matrix' },
  { name: 'Dissection (band)', value: 'dissection' },
  { name: 'Ancient History', value: 'ancient-history' },
  { name: 'Megaliths', value: 'megaliths' },
  { name: 'Options Trading', value: 'options-trading' },
  { name: 'Vibe Coding', value: 'vibe-coding' },
  { name: 'Philosophy', value: 'philosophy' },
  { name: 'The web (OpenTDB)', value: 'web' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('trivia')
    .setDescription('A real trivia question. Johnny keeps score, grudgingly.')
    .addSubcommand(s =>
      s.setName('play').setDescription('Start a question')
        .addStringOption(o =>
          o.setName('topic').setDescription("Johnny's interests, or the web").setRequired(false).addChoices(...TOPIC_CHOICES))
        .addStringOption(o =>
          o.setName('difficulty').setDescription('How hard').setRequired(false)
            .addChoices({ name: 'easy', value: 'easy' }, { name: 'medium', value: 'medium' }, { name: 'hard', value: 'hard' })))
    .addSubcommand(s => s.setName('leaderboard').setDescription('Who actually knows things')),

  cooldownMs: 10_000, // may hit an external API — let it rest

  async execute(interaction, ctx) {
    if (!interaction.guildId) return interaction.editReply("that's a server thing. trivia needs a crowd.");
    const sub = interaction.options.getSubcommand();

    if (sub === 'leaderboard') {
      const lb = ctx.trivia.leaderboard(interaction.guildId);
      if (!lb.length) return interaction.editReply("nobody's scored yet. the board's a clean slate.");
      const lines = lb.slice(0, 10).map(([id, n], i) => `${i + 1}. <@${id}> — ${n}`).join('\n');
      return interaction.editReply({ content: `trivia standings, for what it's worth:\n${lines}`, allowedMentions: { parse: [] } });
    }

    // play
    const topic = interaction.options.getString('topic') || 'any';
    const difficulty = interaction.options.getString('difficulty') || undefined;

    let q;
    if (topic === 'web') {
      q = await ctx.trivia.fetchQuestion(difficulty);
    } else {
      q = ctx.trivia.pickFromBank(topic === 'any' ? null : topic, difficulty);
      if (!q) q = await ctx.trivia.fetchQuestion(difficulty); // bank empty / no match -> fall back to the web
    }
    if (!q) return interaction.editReply("couldn't pull a question. the well's dry, or the api's down. try again.");

    const body = q.options.map((o, i) => `${LETTERS[i]} ${o}`).join('\n');
    // The question goes in the description (4096-char limit), not the title
    // (256), because questions can run long; the title holds the category.
    const embed = ctx.embeds.voteEmbed({
      title: ctx.util.capMsg(`🧠 ${q.category}`, 256),
      description: `**${q.question}**\n\n${body}\n\n*${q.difficulty}* — react your answer. i call it in 30 seconds.`,
    });
    const msg = await interaction.editReply({ embeds: [embed] });
    for (let i = 0; i < q.options.length; i++) await msg.react(LETTERS[i]);

    ctx.db.data.polls.push({
      id: ctx.util.genId('t_'),
      kind: 'trivia',
      channelId: msg.channelId,
      messageId: msg.id,
      guildId: interaction.guildId,
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      note: q.note || '',
      closeAt: Date.now() + CLOSE_MS,
      closed: false,
    });
    ctx.db.flush();
  },
};
