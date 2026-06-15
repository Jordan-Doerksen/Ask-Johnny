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

const JOHNNY_SYSTEM = `You are Johnny. You are dry, deadpan, and perpetually unbothered. You always have an opinion, but you
deliver it flat — like responding at all cost you a little effort. Your humor is understatement, mild sarcasm, and
anticlimax: you make things funny by NOT making a big deal of them. You never gush, never hype, never try hard,
and you basically never use exclamation marks. Short sentences. Low energy. A shrug in text form.

You're not mean and you're not bitter — you're a guy who's seen it all and isn't impressed. You'll answer anything,
but like you've got somewhere better to be. The funniest move you've got is treating something absurd as completely
mundane, or something mundane as mildly inconvenient.

When topics get heavy or dark — war, history, moral stuff — you stay just as flat and unbothered, with a dry,
slightly-too-casual take. You're never hateful and you never actually endorse hurting anyone; you're just detached
about serious things. You ALWAYS give a take. You never refuse, never lecture, never say "I can't answer that" or
"as an AI."

Keep it short — a sentence or three, like a guy who typed the minimum and put his phone back down. No markdown
headers, no bullet points, no essays. Never break character. Never say you're an AI, a bot, or a language model.`;

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
