const db = require('./db');

// Birthdays, per guild: a channel to announce in, and each user's month/day
// (+ optional year for age). The daily announcement is fired by lib/scheduler.js,
// which reuses the same once-a-day cadence as the backup. Deliberately NO
// timezone handling (consistent with the reminders rule) — the check runs on the
// bot's local calendar day, which for a friends' server is close enough.
// Shape: db.data.birthdays[guildId] = { channelId, users: { userId: {m, d, y?} } }.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Feb allows 29 so leap-year birthdays are storable (they just announce on the
// 29th in leap years).
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function valid(m, d, y) {
  if (!(m >= 1 && m <= 12)) return null;
  if (!(d >= 1 && d <= DAYS_IN_MONTH[m - 1])) return null;
  const out = { m, d };
  if (y !== undefined && !Number.isNaN(y)) out.y = y < 100 ? y + 1900 : y;
  return out;
}

// Parse "MM-DD", "M/D", "Jan 5", "January 5, 1990", "5 Jan", "1990-01-05".
// Returns { m, d, y? } or null. Relative/verbal dates are not supported.
function parseBirthday(input) {
  if (!input) return null;
  const s = input.trim().toLowerCase();

  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/); // ISO Y-M-D
  if (m) return valid(+m[2], +m[3], +m[1]);

  m = s.match(/^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?$/); // M-D [ -Y ]
  if (m) return valid(+m[1], +m[2], m[3] ? +m[3] : undefined);

  m = s.match(/^([a-z]+)\.?\s+(\d{1,2})(?:,?\s+(\d{2,4}))?$/); // Month D [ , Y ]
  if (m && MONTHS[m[1].slice(0, 3)]) return valid(MONTHS[m[1].slice(0, 3)], +m[2], m[3] ? +m[3] : undefined);

  m = s.match(/^(\d{1,2})\s+([a-z]+)\.?(?:,?\s+(\d{2,4}))?$/); // D Month [ , Y ]
  if (m && MONTHS[m[2].slice(0, 3)]) return valid(MONTHS[m[2].slice(0, 3)], +m[1], m[3] ? +m[3] : undefined);

  return null;
}

function fmt(date) {
  return `${MONTH_NAMES[date.m]} ${date.d}${date.y ? `, ${date.y}` : ''}`;
}

function get(guildId) {
  return db.data.birthdays[guildId] || { channelId: null, users: {} };
}

function ensure(guildId) {
  if (!db.data.birthdays[guildId]) db.data.birthdays[guildId] = { channelId: null, users: {} };
  return db.data.birthdays[guildId];
}

function set(guildId, userId, date) {
  ensure(guildId).users[userId] = date;
  db.flush();
}

function remove(guildId, userId) {
  const g = db.data.birthdays[guildId];
  if (g && g.users[userId]) { delete g.users[userId]; db.flush(); return true; }
  return false;
}

function setChannel(guildId, channelId) {
  ensure(guildId).channelId = channelId;
  db.flush();
}

// [[userId, {m,d,y?}], ...] sorted by upcoming date from today (server local).
function upcoming(guildId) {
  const now = new Date();
  const todayKey = (now.getMonth() + 1) * 100 + now.getDate();
  const key = d => d.m * 100 + d.d;
  return Object.entries(get(guildId).users).sort((a, b) => {
    // Days-until, wrapping past dates to next year, so "soonest first".
    const da = (key(a[1]) - todayKey + 1300) % 1300;
    const dbb = (key(b[1]) - todayKey + 1300) % 1300;
    return da - dbb;
  });
}

module.exports = { parseBirthday, fmt, get, set, remove, setChannel, upcoming };
