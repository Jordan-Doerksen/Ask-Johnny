// The LLM client — provider-agnostic, config-driven, with an automatic fallback chain.
//
// Replaces the hard-wired groq-sdk. Everything Johnny can talk to speaks the OpenAI
// chat-completions shape, so one plain fetch covers every provider and the choice of
// provider becomes config (config/llm.json) plus a key in .env — not code.
//
// Why: on 2026-08-16 Groq moved llama-3.3-70b-versatile to enterprise-only. The bot had
// the model ID compiled into a require()'d module, so a vendor's roadmap took Johnny
// offline. Next time it is a one-line config change, or the fallback just picks it up.
//
// No dependency: Node 18+ has global fetch, which is all an OpenAI-compatible API needs.

const path = require('path');
const log = require('./log');

const cfg = require(path.join(__dirname, '..', 'config', 'llm.json'));

const DEFAULTS = cfg.defaults || {};

// Substitute {ENV_NAME} placeholders in a config string from the environment, so a
// provider whose URL embeds an account id (Cloudflare) stays fully config-driven.
function interpolate(str) {
  return str.replace(/\{([A-Z0-9_]+)\}/g, (_, name) => process.env[name] || '');
}

// Read one provider's live settings. Returns null when it isn't configured — an
// unconfigured fallback must cost nothing and must never throw at require time.
function resolve(name) {
  const p = cfg.providers[name];
  if (!p) return null;

  const apiKey = process.env[p.apiKeyEnv];
  if (!apiKey) return null; // not configured — skip silently, by design

  const baseUrl = interpolate(p.baseUrlEnv ? process.env[p.baseUrlEnv] || p.baseUrl : p.baseUrl);
  // A placeholder that resolved to nothing (e.g. CF_ACCOUNT_ID unset) leaves a broken
  // URL like ".../accounts//ai/v1". Treat that as unconfigured rather than calling it.
  if (!baseUrl || baseUrl.includes('//ai/') || /\{[A-Z0-9_]+\}/.test(baseUrl)) return null;

  return {
    name,
    label: p.label || name,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    model: process.env[p.modelEnv] || p.model,
    tokenParam: p.tokenParam || 'max_completion_tokens',
    reasoningHeadroom: p.reasoningHeadroom || 0,
    extraBody: p.extraBody || {},
  };
}

// Every provider in `order` that is actually configured right now.
function activeProviders() {
  return (cfg.order || Object.keys(cfg.providers)).map(resolve).filter(Boolean);
}

// Some models emit their scratchpad inline instead of in a separate field. Never let
// that reach a Discord channel — qwen3.6 does exactly this and would post
// "Here's a thinking process: 1. Analyze User Input..." as Johnny's reply.
function stripThinking(text) {
  return String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '') // unterminated: the reply was cut off mid-thought
    .trim();
}

// Worth trying the next provider? A dead model, a rate limit, an outage or a network
// blip are all "ask someone else". A malformed request is our bug and would fail
// identically everywhere, so it stops the chain.
function shouldFallOver(status) {
  return status === 0 || status === 404 || status === 429 || status === 401 || status >= 500;
}

// Worth trying the SAME provider again? Only for the transient classes: a dropped
// connection, a timeout, a rate limit, or a 5xx. This replaces the `maxRetries: 3` the
// groq-sdk used to give us for free — dropped when the SDK went (commit 2879e18 exists
// because mid-response connection drops really do happen to this bot). Without it, one
// blip would fail the whole call whenever no fallback provider is configured, which is
// the situation today.
function isTransient(status) {
  return status === 0 || status === 429 || status >= 500;
}

const RETRIES = Number(process.env.LLM_RETRIES) || 2; // attempts after the first
const RETRY_BASE_MS = Number(process.env.LLM_RETRY_BASE_MS) || 400;
// Ceiling on an API-suggested wait. A Discord reply that lands 15s late is still a
// reply; one that lands a minute late is noise, and the limiter should have shaped
// the burst long before that.
const MAX_RETRY_WAIT_MS = Number(process.env.LLM_MAX_RETRY_WAIT_MS) || 15_000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callProvider(p, { system, user, temperature, maxTokens, timeoutMs }) {
  const body = {
    model: p.model,
    temperature,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    ...p.extraBody,
  };
  // A reasoning model bills its scratchpad from the SAME completion budget as the reply,
  // so a caller asking for 40 tokens can get an empty or mid-word-truncated answer even
  // at reasoning_effort:low. Callers size maxTokens for the REPLY; the provider declares
  // how much thinking room to add on top. One knob, set per provider, instead of padding
  // every call site by hand.
  body[p.tokenParam] = maxTokens + (p.reasoningHeadroom || 0);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();

  let res;
  try {
    res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    // Network error or our own timeout — status 0 means "no answer at all".
    const e = new Error(ctrl.signal.aborted ? `timeout after ${timeoutMs}ms` : err.message);
    e.status = 0;
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const e = new Error((json.error && json.error.message) || `HTTP ${res.status}`);
    e.status = res.status;
    // A rate-limited provider TELLS you how long to wait. Honour it: the token-per-minute
    // ceiling needs ~9s, and a fixed 400ms/800ms backoff just burns all the retries and
    // fails a reply that would have succeeded. Prefer the header, fall back to parsing the
    // message (Groq puts the wait there too), and cap it so nobody waits forever.
    const header = Number(res.headers.get('retry-after'));
    const fromMessage = /try again in ([\d.]+)s/i.exec(e.message);
    const seconds = Number.isFinite(header) && header > 0
      ? header
      : (fromMessage ? Number(fromMessage[1]) : 0);
    if (seconds > 0) e.retryAfterMs = Math.min(seconds * 1000 + 250, MAX_RETRY_WAIT_MS);
    throw e;
  }

  const text = stripThinking((json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '');
  if (!text) {
    // An empty-but-successful reply is a real failure mode, not a quirk: gpt-oss returns
    // exactly this if a reasoning parameter is wrong, and a reasoning model returns it
    // when it spends the whole token budget thinking. Fall over instead of saying nothing.
    const e = new Error('empty response (model returned no content)');
    e.status = 502;
    throw e;
  }

  return { text, usage: json.usage, ms: Date.now() - started };
}

/**
 * Ask the model something. Tries each configured provider in order.
 * @returns {Promise<{text: string, provider: string, model: string}>}
 */
async function chat({ system, user, temperature, maxTokens }) {
  const providers = activeProviders();
  if (!providers.length) {
    log.error('llm.no_providers', { order: (cfg.order || []).join(',') });
    throw new Error('No LLM provider is configured. Set GROQ_API_KEY (see .env.example).');
  }

  const opts = {
    system,
    user,
    temperature: temperature ?? DEFAULTS.temperature ?? 0.95,
    maxTokens: maxTokens ?? DEFAULTS.maxTokens ?? 350,
    timeoutMs: DEFAULTS.timeoutMs || 30000,
  };

  const failures = [];
  for (const p of providers) {
    let lastStatus = 0;

    // Try this provider a few times before giving up on it — a dropped connection is
    // not a reason to change provider, or to make the channel see a failure.
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      try {
        const { text, usage, ms } = await callProvider(p, opts);
        // Log the winner: which provider actually answered is the single most useful
        // fact when someone asks "why does Johnny sound different today".
        log.info('llm.ok', {
          provider: p.name,
          model: p.model,
          ms,
          in: usage && usage.prompt_tokens,
          out: usage && usage.completion_tokens,
          attempt,
          fellBack: failures.length > 0,
        });
        return { text, provider: p.name, model: p.model };
      } catch (err) {
        lastStatus = err.status ?? 0;
        const willRetry = isTransient(lastStatus) && attempt < RETRIES;
        log.error('llm.call_failed', {
          provider: p.name,
          model: p.model,
          status: lastStatus,
          msg: err.message,
          attempt,
          willRetry,
          waitMs: willRetry ? (err.retryAfterMs || RETRY_BASE_MS * 2 ** attempt) : 0,
        });
        if (!willRetry) break;
        // The provider's own advice wins over our guess when it gave one.
        await sleep(err.retryAfterMs || RETRY_BASE_MS * 2 ** attempt);
      }
    }

    failures.push(`${p.name}:${lastStatus}`);
    // A malformed request is our bug — the next provider would reject it identically.
    if (!shouldFallOver(lastStatus)) break;
  }

  const err = new Error(`All LLM providers failed (${failures.join(', ')})`);
  err.allProvidersFailed = true;
  throw err;
}

// A one-line description of the live chain, for /stats and the boot banner.
function describe() {
  const active = activeProviders();
  if (!active.length) return 'no provider configured';
  return active.map((p, i) => `${p.label} ${p.model}${i ? ' (fallback)' : ''}`).join(' → ');
}

module.exports = { chat, describe, activeProviders, stripThinking };
