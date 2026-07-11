const db = require('./db');
const fs = require('fs');
const path = require('path');

// Trivia from two sources:
//   1. Johnny's OWN fact-checked question bank (content/trivia.json), built by a
//      research+verify swarm from his special interests — the default.
//   2. The Open Trivia Database (opentdb.com), for a generic "the web" question.
// Either way, per the house rule the question and answer are always REAL; Johnny
// only voices the wrapper. The live question rides db.data.polls + the 20s
// scheduler (survives restart); the leaderboard lives in db.data.trivia.

// --- the local bank --------------------------------------------------------

const BANK_FILE = path.join(__dirname, '..', 'content', 'trivia.json');
let BANK = [];
try {
  if (fs.existsSync(BANK_FILE)) BANK = JSON.parse(fs.readFileSync(BANK_FILE, 'utf8'));
} catch (err) {
  console.error('trivia: failed to load question bank:', err.message);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Shape a {correct, incorrect[]} pair into shuffled options + the index of the
// correct one, deduped so two identical strings can't split scoring.
function buildOptions(correct, incorrect) {
  const options = shuffle([...new Set([correct, ...incorrect])]);
  return { options, correctIndex: options.indexOf(correct) };
}

// Topics present in the bank: [{ key, name, count }] — used for display/help.
function bankTopics() {
  const m = new Map();
  for (const q of BANK) {
    const e = m.get(q.topicKey) || { key: q.topicKey, name: q.category, count: 0 };
    e.count++;
    m.set(q.topicKey, e);
  }
  return [...m.values()];
}

const bankSize = () => BANK.length;

// A random bank question, optionally filtered to a topicKey and/or difficulty,
// shaped exactly like fetchQuestion's return so the command/scheduler are agnostic.
function pickFromBank(topicKey, difficulty) {
  let pool = BANK;
  if (topicKey) pool = pool.filter(q => q.topicKey === topicKey);
  if (difficulty) {
    const byDiff = pool.filter(q => q.difficulty === difficulty);
    if (byDiff.length) pool = byDiff; // only narrow if something matches
  }
  if (!pool.length) return null;
  const q = pool[Math.floor(Math.random() * pool.length)];
  const { options, correctIndex } = buildOptions(q.correct, q.incorrect);
  return { category: q.category, difficulty: q.difficulty, question: q.question, options, correctIndex, note: q.note || '' };
}

// --- the web (OpenTDB) -----------------------------------------------------

// OpenTDB base64-encodes every field (encode=base64), which sidesteps the HTML
// entity mess — we just decode each field.
const dec = s => Buffer.from(s, 'base64').toString('utf8');

// One multiple-choice question from OpenTDB, or null on failure.
async function fetchQuestion(difficulty) {
  const params = new URLSearchParams({ amount: '1', type: 'multiple', encode: 'base64' });
  if (difficulty) params.set('difficulty', difficulty);
  try {
    const res = await fetch(`https://opentdb.com/api.php?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.response_code !== 0 || !data.results || !data.results.length) return null;
    const q = data.results[0];
    const { options, correctIndex } = buildOptions(dec(q.correct_answer), q.incorrect_answers.map(dec));
    return { category: dec(q.category), difficulty: dec(q.difficulty), question: dec(q.question), options, correctIndex, note: '' };
  } catch (_) {
    return null;
  }
}

// --- leaderboard -----------------------------------------------------------

function addPoint(guildId, userId) {
  if (!db.data.trivia[guildId]) db.data.trivia[guildId] = { scores: {} };
  const scores = db.data.trivia[guildId].scores;
  scores[userId] = (scores[userId] || 0) + 1;
  db.flush();
}

function leaderboard(guildId) {
  const scores = db.data.trivia[guildId]?.scores || {};
  return Object.entries(scores).sort((a, b) => b[1] - a[1]);
}

module.exports = { fetchQuestion, pickFromBank, bankTopics, bankSize, addPoint, leaderboard };
