// Best-effort YouTube transcript fetch for /yt. No dependency — scrape the
// watch page for the caption track, pull the timed-text, hand it to Johnny.
// Caveat: YouTube often serves consent/bot pages to datacenter IPs, so this can
// fail on a host even when it works locally. We degrade gracefully.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function videoId(input) {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  let u;
  try {
    u = new URL(s.startsWith('http') ? s : `https://${s}`);
  } catch (_) {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1);
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (host.endsWith('youtube.com')) {
    const v = u.searchParams.get('v');
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const m = u.pathname.match(/\/(?:shorts|embed|v|live)\/([\w-]{11})/);
    if (m) return m[1];
  }
  return null;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;#39;/g, "'").replace(/&#39;/g, "'")
    .replace(/&amp;quot;/g, '"').replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

async function getTranscript(input) {
  const id = videoId(input);
  if (!id) return { error: 'badid' };

  let res;
  try {
    res = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, {
      headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', cookie: 'CONSENT=YES+cb' },
    });
  } catch (_) {
    return { error: 'fetchfail' };
  }
  if (!res.ok) return { error: 'fetchfail' };

  const html = await res.text();
  const title = decodeEntities((html.match(/<title>([^<]*)<\/title>/)?.[1] || '').replace(/ - YouTube$/, '').trim());

  const m = html.match(/"captionTracks":(\[.*?\])/);
  if (!m) return { error: 'notranscript', title };
  let tracks;
  try {
    tracks = JSON.parse(m[1]);
  } catch (_) {
    return { error: 'notranscript', title };
  }
  const track = tracks.find(t => (t.languageCode || '').startsWith('en')) || tracks[0];
  if (!track?.baseUrl) return { error: 'notranscript', title };

  let capRes;
  try {
    capRes = await fetch(track.baseUrl, { headers: { 'user-agent': UA } });
  } catch (_) {
    return { error: 'notranscript', title };
  }
  if (!capRes.ok) return { error: 'notranscript', title };

  const xml = await capRes.text();
  const text = decodeEntities(
    xml
      .replace(/<text[^>]*>/g, ' ')
      .replace(/<\/text>/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < 50) return { error: 'notranscript', title };

  return { title, text: text.slice(0, 8000), id };
}

module.exports = { getTranscript, videoId };
