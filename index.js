require('dotenv').config();

const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const { askJohnny, MODEL } = require('./lib/johnny');
const db = require('./lib/db');
const memory = require('./lib/memory');
const embeds = require('./lib/embeds');
const util = require('./lib/util');
const convert = require('./lib/convert');
const weather = require('./lib/weather');
const scheduler = require('./lib/scheduler');
const { onCooldown } = require('./lib/cooldown');
const { loadCommands } = require('./commands/_loader');

const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // optional — instant command updates on one server

if (!TOKEN || !CLIENT_ID || !process.env.GROQ_API_KEY) {
  console.error('Missing env vars. Need BOT_TOKEN, CLIENT_ID, and GROQ_API_KEY (see .env.example).');
  process.exit(1);
}

// Discover every command from commands/*.js — `data` is the registration body,
// `handlers` maps command name -> { execute } for dispatch.
const { data: commandData, handlers } = loadCommands();

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const route = GUILD_ID
    ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    : Routes.applicationCommands(CLIENT_ID);
  console.log(`Registering ${commandData.length} commands ${GUILD_ID ? `to guild ${GUILD_ID}` : 'globally'}...`);
  await rest.put(route, { body: commandData });
  console.log('Commands registered.');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // PRIVILEGED — must be enabled in the Discord Developer Portal
  ],
});

// Everything a command needs, handed in so command files stay thin.
const ctx = { askJohnny, db, memory, embeds, util, convert, weather, client };

client.once('clientReady', () => {
  console.log(`Johnny is online as ${client.user.tag} (model: ${MODEL})`);
  scheduler.start(client, ctx); // begin firing reminders + closing polls
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = handlers[interaction.commandName];
  if (!cmd) return;

  if (cmd.cooldown !== false && onCooldown(interaction.user.id)) {
    return interaction.reply({ content: 'give it a second.', ephemeral: true });
  }

  try {
    await interaction.deferReply({ ephemeral: cmd.ephemeral === true }); // Groq is slower than Discord's 3s window
    await cmd.execute(interaction, ctx);
  } catch (err) {
    console.error(`/${interaction.commandName} failed:`, err);
    await util.brainLag(interaction);
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  // Passive: remember when each person last spoke here, so /catchup knows how
  // far back to recap. We store only the timestamp, never the message content.
  memory.touchLastSeen(message.channelId, message.author.id, message.createdTimestamp);

  // Talk to Johnny by @mentioning him — no slash command needed.
  if (!message.mentions.users.has(client.user.id)) return;
  if (onCooldown(message.author.id)) return;

  const prompt = message.content.replace(/<@!?\d+>/g, '').trim() || 'someone just pinged you with nothing to say.';
  try {
    await message.channel.sendTyping();
    await message.reply(await askJohnny(prompt));
  } catch (err) {
    console.error('mention reply failed:', err);
  }
});

// Flush the store on shutdown so nothing in-flight is lost.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    db.flushNow();
    process.exit(0);
  });
}

registerCommands()
  .then(() => client.login(TOKEN))
  .catch(err => {
    console.error('Startup failed:', err);
    process.exit(1);
  });
