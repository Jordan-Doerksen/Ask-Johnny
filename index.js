require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
} = require('discord.js');
const { askJohnny, MODEL } = require('./johnny');

const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // optional — instant command updates on one server

if (!TOKEN || !CLIENT_ID || !process.env.GROQ_API_KEY) {
  console.error('Missing env vars. Need BOT_TOKEN, CLIENT_ID, and GROQ_API_KEY (see .env.example).');
  process.exit(1);
}

// Johnny's colors (catppuccin, same family as Fun-Police).
const MAUVE = 0xb48ef5;
const PEACH = 0xfab387;
const RED = 0xf38ba8;

const VOTE_MS = 60_000; // judge + warcrime voting window

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

const commands = [
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask Johnny anything. He will answer with full confidence.')
    .addStringOption(o => o.setName('question').setDescription('What do you wanna ask Johnny?').setRequired(true)),

  new SlashCommandBuilder()
    .setName('roast')
    .setDescription('Johnny roasts a homie (lovingly).')
    .addUserOption(o => o.setName('target').setDescription('Who is getting roasted?').setRequired(true)),

  new SlashCommandBuilder()
    .setName('debate')
    .setDescription('Johnny picks a side on a topic and argues it badly.')
    .addStringOption(o => o.setName('topic').setDescription('What is the debate about?').setRequired(true)),

  new SlashCommandBuilder()
    .setName('judge')
    .setDescription('Johnny drops a moral dilemma. Vote, then he renders his verdict.'),

  new SlashCommandBuilder()
    .setName('simp')
    .setDescription('Johnny delivers an over-the-top sincere compliment to a homie.')
    .addUserOption(o => o.setName('target').setDescription('Who is Johnny simping for?').setRequired(true)),

  new SlashCommandBuilder()
    .setName('hotpoll')
    .setDescription('Johnny gives his take and opens it to a vote.')
    .addStringOption(o => o.setName('question').setDescription('The yes/no question').setRequired(true)),

  new SlashCommandBuilder()
    .setName('warcrime')
    .setDescription('Johnny presents a dark historical event. Vote justified or not, then he weighs in.'),

  new SlashCommandBuilder()
    .setName('whatwouldyoudo')
    .setDescription('Johnny cooks up a ridiculous hypothetical for the group.'),

  new SlashCommandBuilder()
    .setName('news')
    .setDescription("Johnny's vibe-based summary of the latest on a topic.")
    .addStringOption(o => o.setName('topic').setDescription('What topic?').setRequired(true)),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const body = commands.map(c => c.toJSON());
  const route = GUILD_ID
    ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    : Routes.applicationCommands(CLIENT_ID);
  console.log(`Registering ${body.length} commands ${GUILD_ID ? `to guild ${GUILD_ID}` : 'globally'}...`);
  await rest.put(route, { body });
  console.log('Commands registered.');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Resolve a nice display name for a targeted user.
function nameOf(interaction, optionName) {
  const member = interaction.options.getMember(optionName);
  const user = interaction.options.getUser(optionName);
  return member?.displayName || user?.username || 'this guy';
}

// Tell Johnny something broke without breaking character.
async function brainLag(interaction) {
  const msg = "yo my brain just buffered for a sec. hit me again in a minute.";
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply(msg);
    else await interaction.reply({ content: msg, ephemeral: true });
  } catch (_) {
    /* interaction already gone, nothing to do */
  }
}

// Run a 60-second emoji vote (✅ / ❌), then let Johnny deliver a verdict.
// `scenario` is the text already posted; `verdictBuilder(yes, no)` returns the
// user-prompt for Johnny's final take.
async function runVotePoll(interaction, { title, scenario, verdictBuilder, verdictSystem }) {
  const embed = new EmbedBuilder()
    .setColor(MAUVE)
    .setTitle(title)
    .setDescription(`${scenario}\n\n✅ = yeah   ❌ = nah\nJohnny calls it in 60 seconds.`);

  const msg = await interaction.editReply({ embeds: [embed] });
  await msg.react('✅');
  await msg.react('❌');

  setTimeout(async () => {
    try {
      const fetched = await msg.fetch(); // refreshes reaction counts
      // Subtract Johnny's own seed reaction so polls don't start 1–1.
      const yes = Math.max(0, (fetched.reactions.cache.get('✅')?.count ?? 1) - 1);
      const no = Math.max(0, (fetched.reactions.cache.get('❌')?.count ?? 1) - 1);

      const verdict = await askJohnny(verdictBuilder(yes, no), { extraSystem: verdictSystem });

      const verdictEmbed = new EmbedBuilder()
        .setColor(PEACH)
        .setTitle("🧠 Johnny's verdict")
        .setDescription(verdict)
        .setFooter({ text: `votes — ✅ ${yes}  ❌ ${no}` });

      await interaction.followUp({ embeds: [verdictEmbed] });
    } catch (err) {
      console.error('verdict failed:', err);
    }
  }, VOTE_MS);
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

const handlers = {
  async ask(interaction) {
    const question = interaction.options.getString('question');
    await interaction.editReply(await askJohnny(question));
  },

  async roast(interaction) {
    const name = nameOf(interaction, 'target');
    const reply = await askJohnny(`Roast my buddy ${name}.`, {
      extraSystem:
        `You are roasting your friend ${name} to their face, like a roast at a party. Be crude, silly, and ` +
        `confident — wrong facts, dumb comparisons, big swings. Punch like a friend who loves them, never ` +
        `genuinely cruel. A few lines max.`,
    });
    await interaction.editReply(reply);
  },

  async debate(interaction) {
    const topic = interaction.options.getString('topic');
    const side = Math.random() < 0.5 ? 'FOR' : 'AGAINST';
    const reply = await askJohnny(`The topic is: ${topic}`, {
      extraSystem:
        `Take the ${side} side of this topic and argue it confidently like you read exactly one tweet about ` +
        `it. Use shaky logic, half-remembered facts, and weird analogies. Commit to the bit.`,
    });
    await interaction.editReply(reply);
  },

  async simp(interaction) {
    const name = nameOf(interaction, 'target');
    const reply = await askJohnny(`Hype up my homie ${name}.`, {
      extraSystem:
        `Deliver an over-the-top, deeply sincere compliment about your friend ${name}. Earnest, wholesome, ` +
        `a little unhinged with the praise — invent fake stats and "scientists would agree" energy. Never ` +
        `weird or romantic, just pure homie love. A few lines.`,
    });
    await interaction.editReply(reply);
  },

  async news(interaction) {
    const topic = interaction.options.getString('topic');
    const reply = await askJohnny(`Give me the latest on: ${topic}`, {
      extraSystem:
        `Summarize "the latest" on this topic entirely from vibes and half-remembered headlines. Confident, ` +
        `vague, slightly wrong, lots of "honestly" and "which is crazy when you think about it." This is not ` +
        `real news, it's your version of it.`,
    });
    await interaction.editReply(reply);
  },

  async whatwouldyoudo(interaction) {
    const reply = await askJohnny('Give the group a hypothetical.', {
      extraSystem:
        `Make up ONE absurd, funny hypothetical scenario and ask the group what they'd do. Two to four ` +
        `sentences, genuinely ridiculous, ends with the question. Don't answer it yourself.`,
      temperature: 1.0,
    });
    await interaction.editReply(`👀 **What would you do?**\n${reply}`);
  },

  async hotpoll(interaction) {
    const question = interaction.options.getString('question');
    const take = await askJohnny(`Give your hot take on this yes/no question: ${question}`, {
      extraSystem: 'Give your confident take in 1-2 sentences, then leave it to the people to vote.',
    });
    const embed = new EmbedBuilder()
      .setColor(MAUVE)
      .setTitle(`🔥 ${question}`)
      .setDescription(`${take}\n\n👍 = yeah   👎 = nah`);
    const msg = await interaction.editReply({ embeds: [embed] });
    await msg.react('👍');
    await msg.react('👎');
  },

  async judge(interaction) {
    const scenario = await askJohnny('Pose a moral dilemma.', {
      extraSystem:
        `Make up ONE spicy everyday moral dilemma as a yes/no question (found cash, white lies, dumb temptations, ` +
        `etc.). One or two sentences. Just the dilemma and the question — do NOT give your own answer yet.`,
      temperature: 1.0,
    });
    await runVotePoll(interaction, {
      title: '⚖️ Johnny judges',
      scenario,
      verdictSystem:
        'Give your verdict on the dilemma below. React to where the people landed but ultimately go with your ' +
        'own confidently-wrong gut. A few sentences.',
      verdictBuilder: (yes, no) =>
        `The dilemma was: "${scenario}". The people voted ${yes} yes and ${no} no. What's your verdict?`,
    });
  },

  async warcrime(interaction) {
    const scenario = await askJohnny('Name a dark historical event to judge.', {
      extraSystem:
        `Name ONE real, well-known dark historical event — a controversial military action, bombing, or ` +
        `atrocity — then ask "Was it justified?" One or two sentences. Just the event and the question — do ` +
        `NOT give your take yet.`,
      temperature: 1.0,
    });
    await runVotePoll(interaction, {
      title: '🪖 War crimes with Johnny',
      scenario,
      verdictSystem:
        'Give your verdict on whether it was justified. Stay totally in character — a clueless guy who doesn\'t ' +
        'clock how heavy this is and gives a breezy, confidently-wrong take. Never hateful, never endorsing harm, ' +
        'just way too chill about serious history. A few sentences.',
      verdictBuilder: (yes, no) =>
        `The event was: "${scenario}". The people voted ${yes} justified and ${no} not justified. Your verdict?`,
    });
  },
};

// ---------------------------------------------------------------------------
// Wire up the client
// ---------------------------------------------------------------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  console.log(`Johnny is online as ${client.user.tag} (model: ${MODEL})`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const handler = handlers[interaction.commandName];
  if (!handler) return;

  try {
    await interaction.deferReply(); // Groq is slower than Discord's 3s window
    await handler(interaction);
  } catch (err) {
    console.error(`/${interaction.commandName} failed:`, err);
    await brainLag(interaction);
  }
});

registerCommands()
  .then(() => client.login(TOKEN))
  .catch(err => {
    console.error('Startup failed:', err);
    process.exit(1);
  });
