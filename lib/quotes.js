const db = require('./db');
const { genId } = require('./util');

// The quote book — the dumb, great things people actually said, kept verbatim.
// Per-guild, in the same JSON store as everything else. Quote TEXT is never
// touched by the model (it's a record, not a bit); Johnny only voices the
// wrapper around it. Shape: { id, guildId, text, author, addedBy, ts }.

function list(guildId) {
  return (db.data.quotes || []).filter(q => q.guildId === guildId);
}

function get(guildId, id) {
  return list(guildId).find(q => q.id === id) || null;
}

function add(guildId, text, author, addedBy) {
  const quote = {
    id: genId('q_'),
    guildId,
    text: text.trim(),
    author: (author || '').trim(),
    addedBy,
    ts: Date.now(),
  };
  db.data.quotes.push(quote);
  db.flush();
  return quote;
}

// Remove by id. Returns true if something was actually removed.
function remove(guildId, id) {
  const before = db.data.quotes.length;
  db.data.quotes = db.data.quotes.filter(q => !(q.id === id && q.guildId === guildId));
  if (db.data.quotes.length !== before) { db.flush(); return true; }
  return false;
}

// A random quote, optionally filtered to an author (substring, case-insensitive).
function random(guildId, author) {
  let pool = list(guildId);
  if (author) {
    const key = author.toLowerCase();
    pool = pool.filter(q => q.author && q.author.toLowerCase().includes(key));
  }
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

// Match on quote text OR author.
function search(guildId, term) {
  const key = term.toLowerCase();
  return list(guildId).filter(
    q => q.text.toLowerCase().includes(key) || (q.author && q.author.toLowerCase().includes(key)),
  );
}

// Most-quoted leaderboard: [[author, count], ...] descending.
function authors(guildId) {
  const counts = {};
  for (const q of list(guildId)) {
    const a = q.author || 'anon';
    counts[a] = (counts[a] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

module.exports = { list, get, add, remove, random, search, authors };
