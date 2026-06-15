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

// Random angle injected into Johnny's generator prompts. An identical prompt
// makes the model keep returning its few "default" answers even at high
// temperature, so /judge, /warcrime and /whatwouldyoudo would repeat. Seeding a
// different sub-topic per call changes the input and breaks the repetition.
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

const WAR_ANGLES = [
  'ancient history (Rome, Greece, the Mongols, etc.)',
  'the medieval era',
  'the 1600s or 1700s',
  'the 1800s — colonial empires or civil wars',
  'World War I',
  'World War II, but NOT Hiroshima or Dresden',
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

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

const commands = [
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription("Ask Johnny something. He'll answer, I guess.")
    .addStringOption(o => o.setName('question').setDescription('What do you wanna ask Johnny?').setRequired(true)),

  new SlashCommandBuilder()
    .setName('roast')
    .setDescription('Johnny roasts a homie. Low effort, on purpose.')
    .addUserOption(o => o.setName('target').setDescription('Who is getting roasted?').setRequired(true)),

  new SlashCommandBuilder()
    .setName('debate')
    .setDescription('Johnny picks a side and argues it, mildly annoyed he has to.')
    .addStringOption(o => o.setName('topic').setDescription('What is the debate about?').setRequired(true)),

  new SlashCommandBuilder()
    .setName('judge')
    .setDescription('Johnny poses a moral dilemma. Vote, then he shrugs out a verdict.'),

  new SlashCommandBuilder()
    .setName('simp')
    .setDescription('Johnny says something nice about a homie. Reluctantly.')
    .addUserOption(o => o.setName('target').setDescription('Who is Johnny simping for?').setRequired(true)),

  new SlashCommandBuilder()
    .setName('hotpoll')
    .setDescription('Johnny gives a flat take and lets you vote on it.')
    .addStringOption(o => o.setName('question').setDescription('The yes/no question').setRequired(true)),

  new SlashCommandBuilder()
    .setName('warcrime')
    .setDescription('A dark historical event. Vote justified or not, then Johnny weighs in. Barely.'),

  new SlashCommandBuilder()
    .setName('whatwouldyoudo')
    .setDescription('Johnny tosses out a ridiculous hypothetical. Do what you want with it.'),

  new SlashCommandBuilder()
    .setName('news')
    .setDescription("Johnny's vibe-based \"news\" on a topic. Probably wrong. Whatever.")
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
  const msg = "brain buffered for a sec. try again whenever.";
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
        `Roast your friend ${name} in your dry, deadpan way — flat, understated burns where the lack of effort ` +
        `is half the insult. Still a friend who loves them, never genuinely cruel. A couple lines, no more.`,
    });
    await interaction.editReply(reply);
  },

  async debate(interaction) {
    const topic = interaction.options.getString('topic');
    const side = Math.random() < 0.5 ? 'FOR' : 'AGAINST';
    const reply = await askJohnny(`The topic is: ${topic}`, {
      extraSystem:
        `Argue the ${side} side of this topic, but flatly — like it's obvious and you're mildly annoyed you have ` +
        `to spell it out. Dry, a little lazy with the logic, unbothered. Commit to the bit without raising your voice.`,
    });
    await interaction.editReply(reply);
  },

  async simp(interaction) {
    const name = nameOf(interaction, 'target');
    const reply = await askJohnny(`Hype up my homie ${name}.`, {
      extraSystem:
        `Compliment your friend ${name}, but in your dry deadpan way — understated, almost reluctant, the kind of ` +
        `praise that lands harder because you clearly mean it and won't make a thing of it. Never weird or ` +
        `romantic, just low-key homie respect. A couple lines.`,
    });
    await interaction.editReply(reply);
  },

  async news(interaction) {
    const topic = interaction.options.getString('topic');
    const reply = await askJohnny(`Give me the latest on: ${topic}`, {
      extraSystem:
        `Summarize "the latest" on this topic from vibes and half-remembered headlines — flat and unbothered, a ` +
        `little vague and probably slightly wrong, delivered like old news you can't believe anyone's still asking ` +
        `about. Your version of news, not real news.`,
    });
    await interaction.editReply(reply);
  },

  async whatwouldyoudo(interaction) {
    const seed = pick(HYPOTHETICAL_SEEDS);
    const reply = await askJohnny(`Give the group a hypothetical about ${seed}.`, {
      extraSystem:
        `Make up ONE absurd, funny hypothetical scenario based loosely on "${seed}" and ask the group what ` +
        `they'd do. Two to four sentences, genuinely ridiculous, ends with the question. Don't answer it yourself.`,
      temperature: 1.0,
    });
    await interaction.editReply(`👀 **What would you do?**\n${reply}`);
  },

  async hotpoll(interaction) {
    const question = interaction.options.getString('question');
    const take = await askJohnny(`Give your hot take on this yes/no question: ${question}`, {
      extraSystem: 'Give your dry, unbothered take in 1-2 sentences, then leave it to the people to vote.',
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
    const theme = pick(DILEMMA_THEMES);
    const scenario = await askJohnny(`Pose a moral dilemma about ${theme}.`, {
      extraSystem:
        `Make up ONE spicy everyday moral dilemma about ${theme}, as a yes/no question. Make it specific and a ` +
        `little unexpected. One or two sentences. Just the dilemma and the question — do NOT give your own answer yet.`,
      temperature: 1.0,
    });
    await runVotePoll(interaction, {
      title: '⚖️ Johnny judges',
      scenario,
      verdictSystem:
        'Give your verdict on the dilemma below — flat, dry, unbothered. Note where the people landed, then go ' +
        'with your own gut anyway. Keep it short.',
      verdictBuilder: (yes, no) =>
        `The dilemma was: "${scenario}". The people voted ${yes} yes and ${no} no. What's your verdict?`,
    });
  },

  async warcrime(interaction) {
    const angle = pick(WAR_ANGLES);
    const scenario = await askJohnny(`Name a dark historical event from ${angle} to judge.`, {
      extraSystem:
        `Name ONE real dark historical event — a controversial military action, bombing, or atrocity — from ` +
        `${angle}. Avoid the single most obvious textbook example; pick something a bit less predictable. Then ` +
        `ask "Was it justified?" One or two sentences. Just the event and the question — do NOT give your take yet.`,
      temperature: 1.0,
    });
    await runVotePoll(interaction, {
      title: '🪖 War crimes with Johnny',
      scenario,
      verdictSystem:
        'Give your verdict on whether it was justified. Stay in character — flat, dry, and way too casual about ' +
        'heavy history, like it\'s barely worth the energy. Never hateful, never endorsing harm, just detached. ' +
        'Keep it short.',
      verdictBuilder: (yes, no) =>
        `The event was: "${scenario}". The people voted ${yes} justified and ${no} not justified. Your verdict?`,
    });
  },
};

// ---------------------------------------------------------------------------
// Wire up the client
// ---------------------------------------------------------------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', () => {
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
