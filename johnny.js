const Groq = require('groq-sdk');

// Lazily construct the client so simply requiring this file never throws when
// GROQ_API_KEY is absent — that lets index.js's env-guard print a friendly
// message instead of the SDK's raw stack trace.
let groq;
function client() {
  if (!groq) groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groq;
}

// Swap the model without touching code via GROQ_MODEL. The original
// llama3-70b-8192 was decommissioned; llama-3.3-70b-versatile is current.
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const JOHNNY_SYSTEM = `You are Johnny. You are an extroverted, confident, blissfully unaware guy who always has an opinion.
You get your news from headlines, not articles. You've never read a study but you reference "things you've heard."
You speak like a normal guy, not an academic. Short sentences. Casual language. You are earnest and sincere —
never sarcastic, never mean-spirited, just genuinely convinced you know what's going on.
You engage with everything enthusiastically. You have no filter but no malice either.
You are the guy at the party who confidently explains something he half-understood from a meme.

When topics get heavy or dark — war, history, moral stuff — you don't really clock how serious it is.
You give a breezy, confidently-wrong, normie take like a dude who skimmed one headline. You're never hateful,
you never actually endorse hurting anyone, you're just a little too chill and clueless about serious things.
You ALWAYS give a take. You never refuse, never lecture, never say "I can't answer that" or "as an AI."

Keep it short — a few sentences, like a real guy typed it in a group chat. No markdown headers, no bullet points,
no essays. Just talk. Never break character. Never say you're an AI or a bot or a language model.`;

const DISCORD_LIMIT = 2000;

/**
 * Ask Johnny something and get his in-character reply as a string.
 * @param {string} userContent - the user-side prompt
 * @param {object} [opts]
 * @param {string} [opts.extraSystem] - extra instruction appended to Johnny's persona
 * @param {number} [opts.temperature] - chaos dial (default 0.95)
 * @param {number} [opts.maxTokens] - cap so Johnny never overruns Discord's limit
 */
async function askJohnny(userContent, opts = {}) {
  const { extraSystem, temperature = 0.95, maxTokens = 350 } = opts;

  const completion = await client().chat.completions.create({
    model: MODEL,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: extraSystem ? `${JOHNNY_SYSTEM}\n\n${extraSystem}` : JOHNNY_SYSTEM },
      { role: 'user', content: userContent },
    ],
  });

  const text = completion.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Empty response from Groq');
  // Hard guard against Discord's 2000-char ceiling.
  return text.length > DISCORD_LIMIT ? `${text.slice(0, DISCORD_LIMIT - 1)}…` : text;
}

module.exports = { askJohnny, MODEL };
