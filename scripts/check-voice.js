// check-voice — a lint for VOICE, not syntax.
//
// Why this exists: the persona was rewritten on 2026-09-07, and rewriting `JOHNNY_SYSTEM`
// turned out to fix only part of it. Johnny's voice also lives in ~44 hardcoded canned
// replies AND in ~15 per-command `extraSystem` prompts, each of which quietly instructed
// the OLD voice and overrode the persona at the command level. Nothing failed; the bot
// just disagreed with itself. This catches that class of drift.
//
// Run: npm run lint:voice

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'logs', 'data', 'content', 'scripts']);

// The register the owner rejected on 2026-09-07: nonchalant, avoidant, performed boredom.
const AVOIDANT = [
  /\banyway\b/i, /\bor whatever\b/i, /\bi guess\b/i, /\bif you say so\b/i,
  /as if it never mattered/i, /we all move on/i, /i already forgot/i,
  /\blucky them\b/i, /make of that what you will/i, /don't hold your breath/i,
  /\bdeadpan\b/i, /\bunbothered\b/i, /can'?t be bothered/i, /barely worth/i,
  /mildly annoyed/i, /\bmeh\b/i, /\bshrug/i,
];
// Assistant-voice leaks. These break character outright.
const ASSISTANT = [/i'?m sorry,? but/i, /i can'?t comply/i, /\bas an ai\b/i, /i'?m unable to/i];

// A banned phrase inside a PROHIBITION is correct usage — "never say 'I guess'" is the
// fix, not the bug. But the negation must apply to THIS phrase: an earlier "No hype" in
// the same sentence does not excuse a later "Deadpan, unbothered". So look only at the
// short run of text immediately before the match. (A whole-string check let three real
// violations through when this lint was first written.)
const NEGATOR = /\b(never|not|no|don'?t|doesn'?t|avoid|banned|instead of|rather than|nothing)\b[^.]{0,40}$/i;
const isNegated = (str, index) => NEGATOR.test(str.slice(0, index));

// lib/johnny.js is the persona itself: its LINES section must quote the banned assistant
// phrasings in order to forbid them. Exempt it from the ASSISTANT rule only.
const PERSONA = 'lib/johnny.js';

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
})(ROOT);

let hits = 0;
for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (/^\s*\/\//.test(line)) return; // a comment may discuss the old voice freely
    const strings = line.match(/(['"`])(?:(?!\1)[^\\]|\\.)*\1/g) || [];
    for (const s of strings) {
      // Report a string once, however many banned phrases it carries — the fix is to
      // rewrite that string, and six lines about one string is just noise.
      const bad = [];
      for (const re of AVOIDANT) {
        const m = re.exec(s);
        if (m && !isNegated(s, m.index)) bad.push(`AVOIDANT:${m[0]}`);
      }
      if (rel !== PERSONA) {
        for (const re of ASSISTANT) {
          const m = re.exec(s);
          if (m && !isNegated(s, m.index)) bad.push(`ASSISTANT:${m[0]}`);
        }
      }
      if (bad.length) {
        console.log(`${rel}:${i + 1}  [${bad.join(', ')}]\n    ${s.slice(0, 110)}`);
        hits++;
      }
    }
  });
}

console.log(hits
  ? `\n${hits} voice violation(s). The persona and the hardcoded strings disagree — fix the strings.`
  : `\nClean: ${files.length} files carry one consistent voice.`);
process.exit(hits ? 1 : 0);
