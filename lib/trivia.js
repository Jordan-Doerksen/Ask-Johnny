const db = require('./db');

// Trivia backed by the Open Trivia Database (opentdb.com) — real, curated
// questions, no API key, no dependency. Per the house rule, the QUESTION and
// ANSWER are always real (fetched, never invented by the model); Johnny only
// voices the wrapper. The live question rides the same `polls` array + 20s
// scheduler as /poll and /judge, so it survives a restart; the leaderboard lives
// in db.data.trivia[guildId].scores.

// OpenTDB base64-encodes every field (encode=base64), which sidesteps the HTML
// entity mess you get otherwise — we just decode each field.
const dec = s => Buffer.from(s, 'base64').toString('utf8');

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Fetch one multiple-choice question. Returns { category, difficulty, question,
// options[4], correctIndex } or null if the API is down / rate-limited / empty.
async function fetchQuestion(difficulty) {
  const params = new URLSearchParams({ amount: '1', type: 'multiple', encode: 'base64' });
  if (difficulty) params.set('difficulty', difficulty);
  try {
    const res = await fetch(`https://opentdb.com/api.php?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.response_code !== 0 || !data.results || !data.results.length) return null;
    const q = data.results[0];
    const correct = dec(q.correct_answer);
    // Dedup: OpenTDB occasionally ships an incorrect answer byte-identical to the
    // correct one; two identical options would break letter-based scoring.
    const options = shuffle([...new Set([correct, ...q.incorrect_answers.map(dec)])]);
    return {
      category: dec(q.category),
      difficulty: dec(q.difficulty),
      question: dec(q.question),
      options,
      correctIndex: options.indexOf(correct),
    };
  } catch (_) {
    return null; // network blip / bad JSON — caller shows a flat "well's dry" line
  }
}

function addPoint(guildId, userId) {
  if (!db.data.trivia[guildId]) db.data.trivia[guildId] = { scores: {} };
  const scores = db.data.trivia[guildId].scores;
  scores[userId] = (scores[userId] || 0) + 1;
  db.flush();
}

// [[userId, points], ...] descending.
function leaderboard(guildId) {
  const scores = db.data.trivia[guildId]?.scores || {};
  return Object.entries(scores).sort((a, b) => b[1] - a[1]);
}

module.exports = { fetchQuestion, addPoint, leaderboard };
