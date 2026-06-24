// Fetch a webpage and crudely strip it to readable text for /tldr. Native
// fetch, no dependency. The raw text is summarized by Johnny — JS-heavy pages
// that ship no real HTML just won't have content, and he says so.

// Block private/loopback hosts so a pasted link can't probe the host's network.
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[?::1\]?|172\.(1[6-9]|2\d|3[01])\.)/i;

async function fetchPageText(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch (_) {
    return { error: 'badurl' };
  }
  if (!/^https?:$/.test(url.protocol)) return { error: 'badurl' };
  if (PRIVATE.test(url.hostname)) return { error: 'blocked' };

  let res;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; ask-johnny bot)' },
      redirect: 'follow',
    });
  } catch (_) {
    return { error: 'fetchfail' };
  }
  if (!res.ok) return { error: 'fetchfail' };

  const ctype = res.headers.get('content-type') || '';
  if (!ctype.includes('text/html') && !ctype.includes('text/plain')) return { error: 'nottext' };

  const html = (await res.text()).slice(0, 200000);
  const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '').trim();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < 200) return { error: 'empty', title };

  return { title, text: text.slice(0, 6000), url: url.href };
}

module.exports = { fetchPageText };
