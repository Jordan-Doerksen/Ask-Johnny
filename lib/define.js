// Real dictionary definitions via dictionaryapi.dev (free, no key). Definitions
// are returned verbatim — Johnny never makes one up (house rule: show nothing
// rather than something false; an LLM "definition" can be confidently wrong).
async function getDefinition(word) {
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.trim())}`;
  let res;
  try {
    res = await fetch(url);
  } catch (_) {
    return null;
  }
  if (!res.ok) return null; // 404 => not a word

  const json = await res.json();
  const entry = Array.isArray(json) ? json[0] : null;
  if (!entry) return null;

  const meanings = (entry.meanings || [])
    .slice(0, 3)
    .map(m => {
      const def = m.definitions?.[0]?.definition;
      return def ? { pos: m.partOfSpeech, def } : null;
    })
    .filter(Boolean);
  if (!meanings.length) return null;

  return { word: entry.word, phonetic: entry.phonetic || '', meanings };
}

module.exports = { getDefinition };
