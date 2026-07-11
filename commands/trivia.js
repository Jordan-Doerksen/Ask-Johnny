const { SlashCommandBuilder } = require('discord.js');

// /trivia — a real OpenTDB question with letter-reaction answers. The question
// persists as a `trivia` poll row and is closed by lib/scheduler.js after 30s,
// which reveals the answer and awards a point to everyone who picked ONLY the
// correct letter (no hedging). Leaderboard in db.data.trivia via lib/trivia.js.

const LETTERS = ['🇦', '🇧', '🇨', '🇩'];
const CLOSE_MS = 30_000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('trivia')
    .setDescription('A real trivia question. Johnny keeps score, grudgingly.')
    .addSubcommand(s =>
      s.setName('play').setDescription('Start a question')
        .addStringOption(o =>
          o.setName('difficulty').setDescription('How hard').setRequired(false)
            .addChoices({ name: 'easy', value: 'easy' }, { name: 'medium', value: 'medium' }, { name: 'hard', value: 'hard' })))
    .addSubcommand(s => s.setName('leaderboard').setDescription('Who actually knows things')),

  cooldownMs: 10_000, // hits an external API — let it rest

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
    const q = await ctx.trivia.fetchQuestion(interaction.options.getString('difficulty'));
    if (!q) return interaction.editReply("couldn't pull a question. the trivia well's dry, or the api's down. try again.");

    const body = q.options.map((o, i) => `${LETTERS[i]} ${o}`).join('\n');
    // The question goes in the description (4096-char limit), not the title
    // (256), because OpenTDB questions can run long; the title holds the category.
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
      closeAt: Date.now() + CLOSE_MS,
      closed: false,
    });
    ctx.db.flush();
  },
};
