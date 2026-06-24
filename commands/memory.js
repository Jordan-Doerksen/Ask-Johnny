const { SlashCommandBuilder } = require('discord.js');

// Memory & catch-up — the headline of the redesign. Johnny remembers when you
// last spoke (to scope /catchup) and holds onto facts you tell him. /catchup
// reads recent messages live from Discord and recaps what you missed.

const EMPTY_LINES = [
  "nothing happened. you didn't miss anything. you're welcome i guess.",
  "it's been dead in here. nothing to catch up on. consider yourself caught up.",
  'no activity worth the recap. quiet as a library. a boring library.',
  "you missed nothing. genuinely nothing. don't let it go to your head.",
];

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

const CATCHUP_WINDOW_MS = 24 * 3_600_000; // never recap more than ~a day

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('catchup')
      .setDescription('Johnny recaps what you missed in here. Flatly.'),
    ephemeral: true, // it's what *you* missed — keep it to you
    async execute(interaction, ctx) {
      const channel = interaction.channel;
      const userId = interaction.user.id;

      const since = ctx.memory.getLastSeen(channel.id, userId);
      const floor = Date.now() - CATCHUP_WINDOW_MS;
      const cutoff = since ? Math.max(since, floor) : floor;

      const fetched = await channel.messages.fetch({ limit: 100 });
      const lines = [...fetched.values()]
        .reverse()
        .filter(m => !m.author.bot && m.content.trim() && m.createdTimestamp > cutoff)
        .map(m => `${m.member?.displayName || m.author.username}: ${m.content.replace(/\s+/g, ' ').slice(0, 250)}`);

      // Bump last-seen now so a second /catchup doesn't repeat this one.
      ctx.memory.touchLastSeen(channel.id, userId, Date.now());

      if (!lines.length) {
        return interaction.editReply(pick(EMPTY_LINES));
      }

      const transcript = lines.slice(-120).join('\n').slice(0, 6000);
      const reply = await ctx.askJohnny(`Here's what happened in chat since they were last around:\n\n${transcript}`, {
        extraSystem:
          'Give a flat, deadpan recap of what actually happened — the gist, who was on about what, like you skimmed ' +
          'it for someone who stepped away. A few sentences, unbothered. Do not quote it all back.',
        maxTokens: 400,
      });
      await interaction.editReply(reply);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('remember')
      .setDescription('Tell Johnny a fact. He will hold onto it, grudgingly.')
      .addStringOption(o => o.setName('subject').setDescription('Who or what is this about? e.g. "dave"').setRequired(true))
      .addStringOption(o => o.setName('fact').setDescription('The thing to remember').setRequired(true)),
    async execute(interaction, ctx) {
      const subject = interaction.options.getString('subject');
      const fact = interaction.options.getString('fact');
      ctx.memory.addFact(interaction.guildId, subject, fact, interaction.user.id);
      await interaction.editReply(`noted. ${subject}: ${fact}. i'll carry that around forever now.`);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('facts')
      .setDescription('Ask Johnny what he knows about someone or something.')
      .addStringOption(o => o.setName('subject').setDescription('Who or what? e.g. "dave"').setRequired(true)),
    async execute(interaction, ctx) {
      const subject = interaction.options.getString('subject');
      const found = ctx.memory.getFacts(interaction.guildId, subject);
      if (!found.length) {
        return interaction.editReply(`i've got nothing on ${subject}. blank slate. lucky them.`);
      }

      // Johnny voices a one-line intro; the facts themselves are shown verbatim
      // so they stay accurate (never invented or reworded).
      const intro = await ctx.askJohnny(
        `Someone asked what you know about "${subject}". You have ${found.length} note(s) on them. ` +
          `Give ONE flat intro line, like begrudgingly opening a grubby notebook. Do not list the facts yourself.`,
        { maxTokens: 80 },
      );
      await interaction.editReply(`${intro}\n${found.map(f => `• ${f.text}`).join('\n')}`);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('summary')
      .setDescription('Johnny flatly recaps the last chunk of chat.')
      .addIntegerOption(o =>
        o.setName('count').setDescription('How many recent messages (default 30, max 100)').setRequired(false)),
    async execute(interaction, ctx) {
      const count = Math.min(Math.max(interaction.options.getInteger('count') ?? 30, 5), 100);
      const fetched = await interaction.channel.messages.fetch({ limit: count });
      const lines = [...fetched.values()]
        .reverse()
        .filter(m => !m.author.bot && m.content.trim())
        .map(m => `${m.member?.displayName || m.author.username}: ${m.content.replace(/\s+/g, ' ').slice(0, 250)}`);
      if (!lines.length) {
        return interaction.editReply("nothing worth recapping. it's been quiet — or i can't read the messages.");
      }
      const transcript = lines.join('\n').slice(0, 6000);
      const reply = await ctx.askJohnny(`Here's the recent chat:\n\n${transcript}`, {
        extraSystem:
          'Give a flat, deadpan recap of what actually happened in this chat — the gist, who was on about what, ' +
          'like you skimmed it for someone who stepped away. A few sentences, unbothered. Do not quote it all back.',
        maxTokens: 400,
      });
      await interaction.editReply(reply);
    },
  },
];
