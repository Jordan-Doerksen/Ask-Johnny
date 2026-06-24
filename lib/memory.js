const db = require('./db');
const { genId } = require('./util');

// Johnny's memory. Two things only, and deliberately NOT the contents of every
// message:
//   - lastSeen: when each person last spoke in a channel (scopes /catchup).
//   - facts: explicit "remember this" notes, shared per server.
// /catchup reads recent messages live from Discord (the source of truth) and
// filters by lastSeen — so we never hoard chat history at rest.

// --- last seen -------------------------------------------------------------

function touchLastSeen(channelId, userId, ts) {
  if (!channelId || !userId) return;
  if (!db.data.lastSeen[channelId]) db.data.lastSeen[channelId] = {};
  db.data.lastSeen[channelId][userId] = ts;
  db.flush();
}

function getLastSeen(channelId, userId) {
  return db.data.lastSeen[channelId]?.[userId] || null;
}

// --- facts -----------------------------------------------------------------

function addFact(guildId, subject, text, authorId) {
  const fact = {
    id: genId('f_'),
    guildId,
    subjectKey: subject.toLowerCase().trim(),
    subject: subject.trim(),
    text: text.trim(),
    authorId,
    ts: Date.now(),
  };
  db.data.facts.push(fact);
  db.flush();
  return fact;
}

// Match on exact subject, or either side containing the other, so "/facts dave"
// finds "Dave" and "/facts the lake trip" finds "lake trip".
function getFacts(guildId, subject) {
  const key = subject.toLowerCase().trim();
  return db.data.facts.filter(
    f => f.guildId === guildId &&
      (f.subjectKey === key || f.subjectKey.includes(key) || key.includes(f.subjectKey)),
  );
}

// --- afk --------------------------------------------------------------------

function setAfk(userId, reason) {
  db.data.afk[userId] = { reason: reason || 'afk', since: Date.now() };
  db.flush();
}

function getAfk(userId) {
  return db.data.afk[userId] || null;
}

// Returns true if the user *was* afk (and is now cleared), false otherwise.
function clearAfk(userId) {
  if (db.data.afk[userId]) {
    delete db.data.afk[userId];
    db.flush();
    return true;
  }
  return false;
}

module.exports = { touchLastSeen, getLastSeen, addFact, getFacts, setAfk, getAfk, clearAfk };
