// check-mod — an offline test of the moderation logic that decides real actions.
//
// It needs no Discord connection and writes nothing: the store's flush is stubbed and the log
// file is off. It proves the guard (Decision 11), the strike ladder (Decision 14), the duration
// parser, the AutoMod rule builder (Decision 13), the security helpers and config (Decisions
// 16-19), and that every command still registers.
//
// Run: npm run check:mod   (exit 0 = pass)

process.env.LOG_TO_FILE = '0';
const db = require('../lib/db');
db.flush = () => {};
db.flushNow = () => {};

const mod = require('../lib/mod');
const automod = require('../lib/automod');
const security = require('../lib/security');
const { loadCommands } = require('../commands/_loader');
const { AutoModerationRuleTriggerType: Trigger, AutoModerationActionType: Action, AuditLogEvent, GuildVerificationLevel } = require('discord.js');

let failed = 0;
let passed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++;
  else {
    failed++;
    console.log(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
  }
}

// --- the guard ---
const base = { invokerId: 'mod', targetId: 'member', botId: 'johnny', ownerId: 'owner', invokerIsOwner: false, targetOutranks: false, botCanReach: true };
check('guard: ordinary target passes', mod.guardCheck(base), null);
check('guard: self', mod.guardCheck({ ...base, targetId: 'mod' }), mod.LINES.self);
check('guard: the bot', mod.guardCheck({ ...base, targetId: 'johnny' }), mod.LINES.bot);
check('guard: the server owner', mod.guardCheck({ ...base, targetId: 'owner' }), mod.LINES.owner);
check('guard: owner cannot target themself', mod.guardCheck({ ...base, invokerId: 'owner', targetId: 'owner', invokerIsOwner: true }), mod.LINES.self);
check('guard: target outranks invoker', mod.guardCheck({ ...base, targetOutranks: true }), mod.LINES.outranks);
check('guard: owner may act on a high role', mod.guardCheck({ ...base, targetOutranks: true, invokerIsOwner: true }), null);
check('guard: bot cannot reach', mod.guardCheck({ ...base, botCanReach: false }), mod.LINES.unreachable);
check('guard: non-member (ban) passes', mod.guardCheck({ ...base, botCanReach: undefined }), null);

// --- durations ---
check('timeout: 10m', mod.parseTimeout('10m'), 600_000);
check('timeout: 1h30m', mod.parseTimeout('1h30m'), 5_400_000);
check('timeout: off', mod.parseTimeout('off'), 0);
check('timeout: 28d is the ceiling', mod.parseTimeout('28d'), mod.MAX_TIMEOUT_MS);
check('timeout: 29d is refused', mod.parseTimeout('29d'), null);
check('timeout: nonsense is refused', mod.parseTimeout('soon'), null);

// --- the ladder ---
const ladder = [{ at: 3, timeout: '1h' }, { at: 5, timeout: '1d' }];
check('ladder: 1 strike', mod.escalationFor(1, ladder), null);
check('ladder: 3 strikes', mod.escalationFor(3, ladder), ladder[0]);
check('ladder: 4 strikes', mod.escalationFor(4, ladder), null);
check('ladder: 5 strikes', mod.escalationFor(5, ladder), ladder[1]);
check('ladder: 6 strikes repeats the top', mod.escalationFor(6, ladder), ladder[1]);
check('ladder: unsorted config still works', mod.escalationFor(3, [ladder[1], ladder[0]]), ladder[0]);
check('ladder: empty ladder is off', mod.escalationFor(9, []), null);
check('ladder: no step ever kicks or bans', mod.CONFIG.strikes.ladder.every(st => Object.keys(st).sort().join() === 'at,timeout'), true);

// --- strikes age out of the window ---
const G = '__check_mod__';
const hour = 3_600_000;
const t0 = 1_000_000_000_000;
check('strikes: first', mod.addStrike(G, 'u1', t0), 1);
check('strikes: second', mod.addStrike(G, 'u1', t0 + hour), 2);
check('strikes: after the window, the count restarts', mod.addStrike(G, 'u1', t0 + 30 * hour), 1);
mod.addStrike(G, 'u2', t0);
mod.addStrike(G, 'u1', t0 + 60 * hour);
check('strikes: aged-out members are pruned', Object.keys(mod.store(G).strikes), ['u1']);

// --- cases ---
const c1 = mod.addCase(G, { type: 'warn', userId: 'u1', modId: 'mod', reason: 'r' });
const c2 = mod.addCase(G, { type: 'ban', userId: 'u2', modId: 'mod', reason: 'r' });
check('cases: numbers count up per server', [c1.id, c2.id], [1, 2]);
check('cases: lookup', mod.getCase(G, 2).type, 'ban');
check('cases: history', mod.casesFor(G, 'u1').map(c => c.id), [1]);
delete db.data.mod[G];

// --- AutoMod rule builder ---
const cfg = mod.CONFIG.automod;
const rules = automod.desiredRules(cfg, ['existingword']);
const byName = Object.fromEntries(rules.map(r => [r.name, r]));
check('automod: every rule carries the prefix', rules.every(r => r.name.startsWith(cfg.rulePrefix)), true);
check('automod: words already on Discord survive a re-run', byName[automod.NAMES.words]?.triggerMetadata.keywordFilter.includes('existingword'), true);
check('automod: no words means no words rule', automod.desiredRules({ ...cfg, keywords: [] }, []).some(r => r.name === automod.NAMES.words), false);
check('automod: one rule per singleton type', [Trigger.Spam, Trigger.KeywordPreset, Trigger.MentionSpam].map(t => rules.filter(r => r.triggerType === t).length <= 1), [true, true, true]);
check('automod: at most 6 keyword rules', rules.filter(r => r.triggerType === Trigger.Keyword).length <= 6, true);
check('automod: block message fits 150 chars', automod.actionsFor(null)[0].metadata.customMessage.length <= 150, true);
check('automod: no alert without a mod log', automod.actionsFor(null).map(a => a.type), [Action.BlockMessage]);
check('automod: alert with a mod log', automod.actionsFor('123').map(a => a.type), [Action.BlockMessage, Action.SendAlertMessage]);
check('automod: regex count within 10', (byName[automod.NAMES.invites]?.triggerMetadata.regexPatterns.length || 0) <= 10, true);
const inviteRe = new RegExp(cfg.invitePatterns[0]);
check('automod: invite pattern matches invites', ['discord.gg/abc', 'https://discord.com/invite/abc', 'discordapp.com/invite/x'].map(s => inviteRe.test(s)), [true, true, true]);
check('automod: invite pattern leaves other links alone', ['https://discord.com/channels/1/2', 'https://github.com/x'].map(s => inviteRe.test(s)), [false, false]);

// --- security (Decisions 16-19) ---
const now = 2_000_000_000_000;
const DAY = 86_400_000;
check('pause: a raid never shortens a longer lockdown pause', security.pauseEnd(now + 20 * hour, now + hour, now), now + 20 * hour);
check('pause: extends a shorter pause', security.pauseEnd(now + hour, now + 2 * hour, now), now + 2 * hour);
check('pause: capped at Discord\'s 24h', security.pauseEnd(0, now + 30 * hour, now), now + security.MAX_PAUSE_MS);
check('pause: no current pause', security.pauseEnd(undefined, now + hour, now), now + hour);
check('window: keeps only recent joins', security.inWindow([{ ts: now - 40_000 }, { ts: now - 10_000 }], now, 30_000).length, 1);
check('new account: 2 days old is new', security.isNewAccount(now - 2 * DAY, now, 7), true);
check('new account: 30 days old is not', security.isNewAccount(now - 30 * DAY, now, 7), false);

const roles = [
  { id: 'a', name: 'Mod', editable: true, managed: false },
  { id: 'b', name: 'Admin', editable: false, managed: false },
  { id: 'c', name: 'SomeBot', editable: false, managed: true },
  { id: 'd', name: 'Helper', editable: true, managed: false },
];
check('strip: removes only what Johnny can reach', security.stripPlan(roles), { remove: ['a', 'd'], managed: ['SomeBot'], aboveMe: ['Admin'] });
check('strip: nothing reachable', security.stripPlan([roles[1]]).remove, []);

const live = new Map([['a', { position: 3, editable: true }], ['b', { position: 9, editable: false }], ['d', { position: 1, editable: true }]]);
check('restore: a mod gives back only roles below their own', security.restorePlan(['a', 'b', 'd', 'gone'], live, 3, false), { give: ['d'], missing: 1, aboveYou: 1, aboveMe: 1 });
check('restore: the owner gives back anything Johnny reaches', security.restorePlan(['a', 'b', 'd'], live, 0, true), { give: ['a', 'd'], missing: 0, aboveYou: 0, aboveMe: 1 });

const sc = security.CONFIG;
check('config: raid joiner timeout parses', mod.parseTimeout(sc.raid.timeoutJoiners) > 0, true);
check('config: raid pause within Discord\'s 24h', sc.raid.pauseMinutes > 0 && sc.raid.pauseMinutes <= 1440, true);
check('config: lockdown pause within Discord\'s 24h', sc.lockdown.pauseMinutes > 0 && sc.lockdown.pauseMinutes <= 1440, true);
check('config: lockdown level is a real level', GuildVerificationLevel[sc.lockdown.verificationLevel] != null, true);
check('config: every anti-nuke action is a real audit event', sc.antinuke.actions.every(a => AuditLogEvent[a] != null), true);
check('config: raid needs at least 2 joins', sc.raid.joins >= 2, true);
check('levels: names round-trip', security.levelName(GuildVerificationLevel.VeryHigh), 'VeryHigh');

// --- registration ---
const { data, handlers } = loadCommands();
const names = data.map(c => c.name);
check('commands: names are unique', new Set(names).size, names.length);
check('commands: under Discord\'s 100 limit', names.length <= 100, true);
for (const n of ['ban', 'unban', 'kick', 'timeout', 'warn', 'purge', 'cases', 'modlog', 'automod', 'lockdown', 'restore']) {
  check(`commands: /${n} registers, guild only, permission-gated, no cooldown`,
    [!!handlers[n], JSON.stringify(data.find(c => c.name === n).contexts), !!data.find(c => c.name === n).default_member_permissions, handlers[n].cooldown],
    [true, '[0]', true, false]);
}

console.log(failed ? `\n${failed} failed, ${passed} passed.` : `\nPass: ${passed} checks. ${names.length} commands register.`);
process.exit(failed ? 1 : 0);
