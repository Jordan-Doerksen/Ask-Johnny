const db = require('./db');
const { genId } = require('./util');

// Server-authored CANON — the facts about Johnny and this server that get folded
// straight into his head, so the people who run the server literally co-author
// his personality ("Johnny hates Tuesdays", "the shop closed in 2019", etc.).
// Distinct from lib/memory.js facts, which are recall lookups about people/things;
// lore is always-on context injected into his LLM replies. Per-guild, curated
// (add/remove gated behind Manage Server at the command layer).

// Pure read — never mutates the store, so reading lore (which /ask and every
// @mention do) can't dirty or grow it. add() is the only creator of the array.
function list(guildId) {
  return db.data.lore[guildId] || [];
}

function add(guildId, text, addedBy) {
  if (!db.data.lore[guildId]) db.data.lore[guildId] = [];
  const entry = { id: genId('l_'), text: text.trim(), addedBy, ts: Date.now() };
  db.data.lore[guildId].push(entry);
  db.flush();
  return entry;
}

function remove(guildId, id) {
  const arr = db.data.lore[guildId];
  if (!arr) return false;
  const before = arr.length;
  db.data.lore[guildId] = arr.filter(e => e.id !== id);
  if (db.data.lore[guildId].length !== before) { db.flush(); return true; }
  return false;
}

// A compact block for injecting into Johnny's system context. Capped so a big
// canon can't blow out the prompt. Returns null when there's nothing to inject.
function block(guildId) {
  const arr = list(guildId);
  if (!arr.length) return null;
  return arr.slice(0, 25).map(e => `- ${e.text}`).join('\n');
}

module.exports = { list, add, remove, block };
