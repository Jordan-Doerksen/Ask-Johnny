require('dotenv').config();

const { Client, GatewayIntentBits, REST, Routes, MessageFlags, Partials } = require('discord.js');
const { askJohnny, MODEL } = require('./lib/johnny');
const db = require('./lib/db');
const memory = require('./lib/memory');
const mention = require('./lib/mention');
const embeds = require('./lib/embeds');
const util = require('./lib/util');
const convert = require('./lib/convert');
const weather = require('./lib/weather');
const wiki = require('./lib/wiki');
const tldr = require('./lib/tldr');
const youtube = require('./lib/youtube');
const define = require('./lib/define');
const activity = require('./lib/activity');
const quotes = require('./lib/quotes');
const lore = require('./lib/lore');
const trivia = require('./lib/trivia');
const birthdays = require('./lib/birthdays');
const ratelimit = require('./lib/ratelimit');
const starboard = require('./lib/starboard');
const scheduler = require('./lib/scheduler');
const { check, mark } = require('./lib/cooldown');
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
    GatewayIntentBits.GuildMessageReactions, // for the starboard
    GatewayIntentBits.MessageContent, // PRIVILEGED — must be enabled in the Discord Developer Portal
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction], // see reactions on uncached messages
});

// Everything a command needs, handed in so command files stay thin.
const ctx = { askJohnny, db, memory, embeds, util, convert, weather, wiki, tldr, youtube, define, activity, quotes, lore, trivia, birthdays, ratelimit, client, commands: commandData };

client.once('clientReady', () => {
  console.log(`Johnny is online as ${client.user.tag} (model: ${MODEL})`);
  scheduler.start(client, ctx); // begin firing reminders + closing polls
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = handlers[interaction.commandName];
  if (!cmd) return;

  if (cmd.cooldown !== false) {
    // Global machine-gun guard (all commands + @mentions) plus an optional longer
    // per-command rest for the expensive LLM/fetch commands. Peek both first and
    // commit only if both pass, so a command rejected by its own longer cooldown
    // doesn't burn the shared global window (and vice versa).
    const perCmd = cmd.cooldownMs || 0;
    if (check(interaction.user.id)) {
      return interaction.reply({ content: 'give it a second.', flags: MessageFlags.Ephemeral });
    }
    if (perCmd && check(interaction.user.id, perCmd, interaction.commandName)) {
      return interaction.reply({ content: 'easy. that one takes it out of me. give it a bit.', flags: MessageFlags.Ephemeral });
    }
    mark(interaction.user.id);
    if (perCmd) mark(interaction.user.id, interaction.commandName);
  }

  try {
    // Groq is slower than Discord's 3s window, so defer first.
    await interaction.deferReply(cmd.ephemeral === true ? { flags: MessageFlags.Ephemeral } : {});
    await cmd.execute(interaction, ctx);
    db.data.stats.commandCounts[interaction.commandName] =
      (db.data.stats.commandCounts[interaction.commandName] || 0) + 1;
    db.flush();
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
  activity.record(message.guildId, message.author.id, new Date(message.createdTimestamp).getHours());

  // AFK: if the speaker was away, welcome them back and clear it.
  if (memory.clearAfk(message.author.id)) {
    message.reply('back, are you. i was barely covering for you.').catch(() => {});
  }
  // AFK: if they pinged someone who's away, say so.
  for (const [id, user] of message.mentions.users) {
    if (id === client.user.id || id === message.author.id) continue;
    const afk = memory.getAfk(id);
    if (afk) {
      const why = afk.reason && afk.reason !== 'afk' ? `: ${afk.reason}` : '';
      message.reply(`${user.username}'s afk${why}. don't hold your breath.`).catch(() => {});
    }
  }

  // Talk to Johnny by @mentioning him — no slash command needed. The mention
  // brain (lib/mention.js) gives him recent-chat context + what he knows about
  // the speaker, so the reply isn't a stateless one-shot anymore.
  if (!message.mentions.users.has(client.user.id)) return;
  if (check(message.author.id)) return;
  mark(message.author.id);

  try {
    await mention.handleMention(message, client, ctx);
  } catch (err) {
    console.error('mention reply failed:', err);
  }
});

// Starboard: watch ⭐ reactions and mirror popular messages to the board.
client.on('messageReactionAdd', reaction => {
  starboard.handleStar(client, reaction).catch(err => console.error('starboard:', err.message));
});

// Flush the store on shutdown so nothing in-flight is lost.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    db.flushNow();
    process.exit(0);
  });
}

// Optionally co-launch fun-police (the ban-list bot) as its own child process
// from the same host — only when its own credentials are set, so ask-johnny
// runs fine without them. Separate process means isolated env + gateway; if it
// crashes, ask-johnny keeps running.
function launchFunPolice() {
  if (!process.env.FP_BOT_TOKEN) return;
  const { fork } = require('child_process');
  const path = require('path');
  const child = fork(path.join(__dirname, 'fun-police', 'index.js'));
  child.on('exit', code => console.log(`fun-police exited (code ${code}).`));
  child.on('error', err => console.error('fun-police failed to launch:', err.message));
  console.log('Co-launching fun-police...');
}

launchFunPolice();

registerCommands()
  .then(() => client.login(TOKEN))
  .catch(err => {
    console.error('Startup failed:', err);
    process.exit(1);
  });
