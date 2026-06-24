require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Vendored copy of the fun-police ban-list bot so ask-johnny can co-launch it
// from one host (see launchFunPolice() in ../index.js). It runs as its own
// child process with its OWN credentials — FP_BOT_TOKEN / FP_CLIENT_ID — so it
// doesn't collide with ask-johnny's BOT_TOKEN / CLIENT_ID. Keep its token in the
// gitignored .env, never in code.
const TOKEN = process.env.FP_BOT_TOKEN;
const CLIENT_ID = process.env.FP_CLIENT_ID;
if (!TOKEN || !CLIENT_ID) {
  console.error('fun-police: missing FP_BOT_TOKEN or FP_CLIENT_ID — not launching it.');
  process.exit(1);
}
const BANLIST_FILE = path.join(__dirname, 'banlist.json');
const SHAMAN_ROLE = 'shaman';

function loadBanlist() {
  if (!fs.existsSync(BANLIST_FILE)) {
    fs.writeFileSync(BANLIST_FILE, JSON.stringify([]));
  }
  return JSON.parse(fs.readFileSync(BANLIST_FILE, 'utf8'));
}

function saveBanlist(list) {
  fs.writeFileSync(BANLIST_FILE, JSON.stringify(list, null, 2));
}

function isShaman(member) {
  return member.roles.cache.some(r => r.name.toLowerCase() === SHAMAN_ROLE);
}

const commands = [
  new SlashCommandBuilder()
    .setName('banlist')
    .setDescription('View the current ban list'),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Add a user to the ban list (Shaman only)')
    .addStringOption(opt =>
      opt.setName('username').setDescription('Username to ban').setRequired(true))
    .addStringOption(opt =>
      opt.setName('reason').setDescription('Reason for the ban').setRequired(true)),

  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Remove a user from the ban list (Shaman only)')
    .addStringOption(opt =>
      opt.setName('username').setDescription('Username to unban').setRequired(true)),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log('fun-police: registering slash commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('fun-police: commands registered.');
  } catch (err) {
    console.error('fun-police: failed to register commands:', err);
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', () => {
  console.log(`Fun-Police is online as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'banlist') {
    const list = loadBanlist();
    const embed = new EmbedBuilder()
      .setColor(0xb48ef5)
      .setTitle(`🔨 Ban List — ${list.length} ${list.length === 1 ? 'entry' : 'entries'}`);

    if (list.length === 0) {
      embed.setDescription('No one is on the ban list. The server is clean 🧹');
    } else {
      const entries = list.map((entry, i) =>
        `**${i + 1}. ${entry.username}**\n> ${entry.reason}\n> Banned by **${entry.bannedBy}** on ${entry.date}`
      ).join('\n\n');
      embed.setDescription(entries);
    }

    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'ban') {
    if (!isShaman(interaction.member)) {
      const embed = new EmbedBuilder()
        .setColor(0xf38ba8)
        .setTitle('❌ Permission denied')
        .setDescription('Only users with the **Shaman** role can add to the ban list.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const username = interaction.options.getString('username');
    const reason = interaction.options.getString('reason');
    const list = loadBanlist();

    if (list.find(e => e.username.toLowerCase() === username.toLowerCase())) {
      const embed = new EmbedBuilder()
        .setColor(0xefb429)
        .setTitle('⚠️ Already banned')
        .setDescription(`**${username}** is already on the ban list.`);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    list.push({
      username,
      reason,
      bannedBy: interaction.member.displayName,
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    });
    saveBanlist(list);

    const embed = new EmbedBuilder()
      .setColor(0xa6e3a1)
      .setTitle('✅ User banned')
      .setDescription(`**${username}** has been added to the ban list.\n> **Reason:** ${reason}`);
    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'unban') {
    if (!isShaman(interaction.member)) {
      const embed = new EmbedBuilder()
        .setColor(0xf38ba8)
        .setTitle('❌ Permission denied')
        .setDescription('Only users with the **Shaman** role can remove from the ban list.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const username = interaction.options.getString('username');
    const list = loadBanlist();
    const index = list.findIndex(e => e.username.toLowerCase() === username.toLowerCase());

    if (index === -1) {
      const embed = new EmbedBuilder()
        .setColor(0xefb429)
        .setTitle('⚠️ Not found')
        .setDescription(`**${username}** is not on the ban list.`);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    list.splice(index, 1);
    saveBanlist(list);

    const embed = new EmbedBuilder()
      .setColor(0xa6e3a1)
      .setTitle('✅ User unbanned')
      .setDescription(`**${username}** has been removed from the ban list.`);
    return interaction.reply({ embeds: [embed] });
  }
});

registerCommands().then(() => client.login(TOKEN));
