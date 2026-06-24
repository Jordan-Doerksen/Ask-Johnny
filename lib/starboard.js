const db = require('./db');
const { EmbedBuilder } = require('discord.js');

const PEACH = 0xfab387;
const STAR = '⭐';

// On each ⭐ reaction, if the guild has a starboard channel configured and the
// message is at/over the threshold, post (or update) it on the board. State of
// which source message maps to which board post lives in the DB, so it survives
// restarts and we never double-post.
async function handleStar(client, reaction) {
  if (reaction.partial) {
    try { await reaction.fetch(); } catch (_) { return; }
  }
  if (reaction.emoji.name !== STAR) return;

  let msg = reaction.message;
  if (msg.partial) {
    try { msg = await msg.fetch(); } catch (_) { return; }
  }
  const guildId = msg.guildId;
  if (!guildId) return;

  const cfg = db.data.starboard[guildId];
  if (!cfg || !cfg.channelId) return;
  if (msg.channelId === cfg.channelId) return; // don't star the board itself

  const count = reaction.count || 0;
  if (count < (cfg.threshold || 3)) return;

  const board = await client.channels.fetch(cfg.channelId).catch(() => null);
  if (!board) return;

  const content = `${STAR} ${count} · <#${msg.channelId}>`;
  const embed = new EmbedBuilder()
    .setColor(PEACH)
    .setAuthor({
      name: msg.member?.displayName || msg.author?.username || 'someone',
      iconURL: msg.author?.displayAvatarURL?.() || undefined,
    })
    .setDescription(msg.content?.slice(0, 2000) || '*(no text)*')
    .addFields({ name: '​', value: `[jump to message](${msg.url})` })
    .setTimestamp(msg.createdTimestamp);

  const img = msg.attachments?.find?.(a => a.contentType?.startsWith('image/'));
  if (img) embed.setImage(img.url);

  const existingId = db.data.starred[msg.id];
  if (existingId) {
    const prev = await board.messages.fetch(existingId).catch(() => null);
    if (prev) {
      await prev.edit({ content, embeds: [embed] }).catch(() => {});
      return;
    }
  }
  const posted = await board.send({ content, embeds: [embed] }).catch(() => null);
  if (posted) {
    db.data.starred[msg.id] = posted.id;
    db.flush();
  }
}

module.exports = { handleStar };
