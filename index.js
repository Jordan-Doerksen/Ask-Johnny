require('dotenv').config();

const { Client, GatewayIntentBits, REST, Routes, MessageFlags, Partials } = require('discord.js');
const { askJohnny } = require('./lib/johnny');
const llm = require('./lib/llm');
const log = require('./lib/log');
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
const mod = require('./lib/mod');
const automod = require('./lib/automod');
const { check, mark } = require('./lib/cooldown');
const { loadCommands } = require('./commands/_loader');

const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // optional — instant command updates on one server

// Johnny needs Discord creds plus AT LEAST ONE model provider. Which provider is now
// config (config/llm.json), so the guard asks the client what is actually configured
// rather than naming one vendor's key.
if (!TOKEN || !CLIENT_ID) {
  console.error('Missing env vars. Need BOT_TOKEN and CLIENT_ID (see .env.example).');
  process.exit(1);
}
if (!llm.activeProviders().length) {
  console.error('No LLM provider configured. Set GROQ_API_KEY (or a fallback provider) — see .env.example.');
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
    GatewayIntentBits.AutoModerationExecution, // AutoMod blocks become strikes (not privileged)
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction], // see reactions on uncached messages
});

// Everything a command needs, handed in so command files stay thin.
const ctx = { askJohnny, db, memory, embeds, util, convert, weather, wiki, tldr, youtube, define, activity, quotes, lore, trivia, birthdays, ratelimit, mod, automod, log, client, commands: commandData };

client.once('clientReady', () => {
  // Log the whole provider chain at boot. When Johnny goes quiet, the first question is
  // always "which model was he even on" — the answer is now the first line in the log.
  log.info('boot', { as: client.user.tag, chain: llm.describe(), commands: commandData.length });
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
      return interaction.reply({ content: 'Stand by. One second between commands.', flags: MessageFlags.Ephemeral });
    }
    if (perCmd && check(interaction.user.id, perCmd, interaction.commandName)) {
      return interaction.reply({ content: 'That command has a longer cooldown. Stand by.', flags: MessageFlags.Ephemeral });
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
    log.error('command_failed', { command: interaction.commandName, msg: err.message, providers: err.allProvidersFailed || false });
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
    message.reply('Welcome back. AFK status cleared.').catch(() => {});
  }
  // AFK: if they pinged someone who's away, say so.
  for (const [id, user] of message.mentions.users) {
    if (id === client.user.id || id === message.author.id) continue;
    const afk = memory.getAfk(id);
    if (afk) {
      const why = afk.reason && afk.reason !== 'afk' ? `: ${afk.reason}` : '';
      message.reply(`${user.username} is AFK${why}. Expect a delay.`).catch(() => {});
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
    log.error('mention_failed', { msg: err.message, providers: err.allProvidersFailed || false });
  }
});

// Starboard: watch ⭐ reactions and mirror popular messages to the board.
client.on('messageReactionAdd', reaction => {
  starboard.handleStar(client, reaction).catch(err => log.error('starboard_failed', { msg: err.message }));
});

// AutoMod: Discord blocked a message. Each block is one strike toward the timeout ladder
// (DECISIONS.md, Decision 14). Discord did the blocking already; this only counts.
client.on('autoModerationActionExecution', execution => {
  automod.handleExecution(execution, client).catch(err => log.error('automod_execution_failed', { msg: err.message }));
});

// Flush the store on shutdown so nothing in-flight is lost.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    db.flushNow();
    process.exit(0);
  });
}

// (The fun-police co-launch was removed 2026-09-07 — see DECISIONS.md. It ran a SECOND
// Discord application from this one server, which is what Wispbyte auto-stops. Johnny is
// the bot that has to stay up, so the second gateway is gone. fun-police survives on its
// own at github.com/Jordan-Doerksen/fun-police.)

registerCommands()
  .then(() => client.login(TOKEN))
  .catch(err => {
    log.error('startup_failed', { msg: err.message });
    process.exit(1);
  });
