// Wikipedia summaries via the public REST API. No key, native fetch. The
// summary is returned verbatim — Johnny only voices a one-line wrapper around
// it, never rewrites the facts (house rule: show nothing rather than something
// false).
async function getWiki(query) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query.trim())}`;
  let res;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' } });
  } catch (_) {
    return null;
  }
  if (!res.ok) return null;

  const json = await res.json();
  if (json.type && json.type.includes('disambiguation')) {
    return { disambiguation: true, title: json.title };
  }
  if (!json.extract) return null;
  return {
    title: json.title,
    extract: json.extract,
    url: json.content_urls?.desktop?.page || null,
  };
}

module.exports = { getWiki };
