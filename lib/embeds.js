const { EmbedBuilder } = require('discord.js');

// Johnny's colors (catppuccin, same family as Fun-Police).
const MAUVE = 0xb48ef5;
const PEACH = 0xfab387;
const RED = 0xf38ba8;

// A vote/prompt embed (mauve) — the thing people react to.
function voteEmbed({ title, description }) {
  return new EmbedBuilder().setColor(MAUVE).setTitle(title).setDescription(description);
}

// A result/verdict embed (peach) — Johnny's call after the votes are in.
function verdictEmbed({ title, description, footer }) {
  const embed = new EmbedBuilder().setColor(PEACH).setTitle(title).setDescription(description);
  if (footer) embed.setFooter({ text: footer });
  return embed;
}

module.exports = { MAUVE, PEACH, RED, voteEmbed, verdictEmbed, EmbedBuilder };
