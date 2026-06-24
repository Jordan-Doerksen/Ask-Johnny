const db = require('./db');

// Lightweight chat-activity tallies, per guild: how many messages each person
// has sent, and a histogram by hour-of-day (server time). Counts only — never
// message content. Powers /activity.

function record(guildId, userId, hour) {
  if (!guildId || !userId) return;
  const all = db.data.activity;
  if (!all[guildId]) all[guildId] = { users: {}, hours: {}, total: 0 };
  const g = all[guildId];
  g.users[userId] = (g.users[userId] || 0) + 1;
  g.hours[hour] = (g.hours[hour] || 0) + 1;
  g.total += 1;
  db.flush();
}

function get(guildId) {
  return db.data.activity[guildId] || null;
}

module.exports = { record, get };
