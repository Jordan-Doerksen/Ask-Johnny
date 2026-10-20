const { PermissionFlagsBits } = require('discord.js');
const db = require('./db');
const log = require('./log');
const embeds = require('./embeds');
const { parseDuration, humanizeMs } = require('./util');
const CONFIG = require('../config/moderation.json');

// The moderation engine: the guard, the case log, strikes and escalation, the mod-log post.
// No LLM call is anywhere in this file, on purpose (DECISIONS.md, Decision 12) — an @mention
// cannot talk Johnny into a ban, and a provider outage cannot stop one. Every line a member or
// a mod sees comes from LINES below, in the military register of persona 3.0.

const MAX_TIMEOUT_MS = 28 * 86_400_000; // Discord's ceiling for a timeout
const AUDIT_REASON_MAX = 512;

const LINES = {
  noPerm: perm => `Negative. This requires ${perm}.`,
  self: 'Negative. You cannot target yourself.',
  bot: 'Negative. I do not act on myself.',
  owner: 'Negative. The server owner is out of scope.',
  outranks: 'Negative. Target holds a role equal to or above yours.',
  unreachable: 'Negative. Target is above my role, or immune to this action. Move my role higher.',
  notMember: 'Negative. That user is not in this server.',
  badDuration: 'Negative. Duration format: 10m, 2h, 1d, 1w. Maximum 28d. Use "off" to clear a timeout.',
  noReason: 'No reason given.',
  dmFailed: ' DM not delivered.',
};

// --- the store ---------------------------------------------------------------
// One block per guild inside data/johnny.json, so the daily backup carries the case log.

function store(guildId) {
  if (!db.data.mod[guildId]) {
    db.data.mod[guildId] = { nextCase: 1, cases: [], strikes: {}, modlogChannelId: null };
  }
  return db.data.mod[guildId];
}

function addCase(guildId, fields) {
  const s = store(guildId);
  const entry = { id: s.nextCase++, ts: Date.now(), ...fields };
  s.cases.push(entry);
  db.flush();
  log.info('mod_case', { guild: guildId, case: entry.id, type: entry.type, user: entry.userId, mod: entry.modId, auto: !!entry.auto });
  return entry;
}

const getCase = (guildId, id) => store(guildId).cases.find(c => c.id === id) || null;
const casesFor = (guildId, userId) => store(guildId).cases.filter(c => c.userId === userId);
const recentCases = (guildId, n) => store(guildId).cases.slice(-n);

// --- the guard (Decision 11) -------------------------------------------------
// Pure, so scripts/check-mod.js can prove it without Discord. Returns null when the action
// may proceed, or the refusal line when it may not. Order matters: the cheapest, most
// certain refusals first.
function guardCheck({ invokerId, targetId, botId, ownerId, invokerIsOwner, targetOutranks, botCanReach }) {
  if (targetId === invokerId) return LINES.self;
  if (targetId === botId) return LINES.bot;
  if (targetId === ownerId) return LINES.owner;
  if (targetOutranks && !invokerIsOwner) return LINES.outranks;
  if (botCanReach === false) return LINES.unreachable;
  return null;
}

const REACH = { ban: 'bannable', kick: 'kickable', timeout: 'moderatable', warn: null };

// The Discord-facing wrapper. targetMember is null for a user who is not in the server (a
// ban can still land on them); the role checks then have nothing to compare and are skipped.
function guard(interaction, targetUser, targetMember, action) {
  const guild = interaction.guild;
  const invoker = interaction.member;
  const reachProp = REACH[action];
  return guardCheck({
    invokerId: interaction.user.id,
    targetId: targetUser.id,
    botId: interaction.client.user.id,
    ownerId: guild.ownerId,
    invokerIsOwner: interaction.user.id === guild.ownerId,
    targetOutranks: !!targetMember && targetMember.roles.highest.comparePositionTo(invoker.roles.highest) >= 0,
    botCanReach: targetMember && reachProp ? targetMember[reachProp] : undefined,
  });
}

// Discord's own permission is the gate (Decision 11). setDefaultMemberPermissions hides the
// command; this re-checks at run time, because an admin can change that default in Integrations.
const PERM_NAMES = {
  BanMembers: 'Ban Members',
  KickMembers: 'Kick Members',
  ModerateMembers: 'Timeout Members',
  ManageMessages: 'Manage Messages',
  ManageGuild: 'Manage Server',
};
function requirePerm(interaction, flagName) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits[flagName])) return null;
  return LINES.noPerm(PERM_NAMES[flagName] || flagName);
}

// --- durations -----------------------------------------------------------------

// Returns ms, 0 for "off", or null when unparseable or past Discord's 28-day ceiling.
function parseTimeout(input) {
  const s = String(input || '').trim().toLowerCase();
  if (s === 'off' || s === '0' || s === 'none') return 0;
  const ms = parseDuration(s);
  if (!ms || ms > MAX_TIMEOUT_MS) return null;
  return ms;
}

// --- strikes and escalation (Decision 14) ---------------------------------------

// Pure. Given the strike count inside the window and the ladder, return the step to apply, or
// null. A step fires when the count reaches its `at`; above the top step, every new strike
// applies the top step again.
function escalationFor(count, ladder) {
  if (!ladder || !ladder.length) return null;
  const steps = [...ladder].sort((a, b) => a.at - b.at);
  const top = steps[steps.length - 1];
  if (count > top.at) return top;
  return steps.find(st => st.at === count) || null;
}

function addStrike(guildId, userId, now = Date.now()) {
  const s = store(guildId);
  const windowMs = (CONFIG.strikes.windowHours || 24) * 3_600_000;
  const kept = (s.strikes[userId] || []).filter(t => now - t < windowMs);
  kept.push(now);
  s.strikes[userId] = kept;
  // Drop other members' strikes that have aged out, so the store does not grow forever.
  for (const [id, list] of Object.entries(s.strikes)) {
    const live = list.filter(t => now - t < windowMs);
    if (live.length) s.strikes[id] = live;
    else delete s.strikes[id];
  }
  db.flush();
  return kept.length;
}

// Record one strike and apply the ladder. Returns { count, applied, skipped }: applied is the
// automatic timeout case or null; skipped names why a due step was not applied, so the mod is
// told instead of left to assume. Never kicks, never bans.
async function strikeAndEscalate(guild, userId, client, source) {
  const count = addStrike(guild.id, userId);
  const step = escalationFor(count, CONFIG.strikes.ladder);
  if (!step) return { count, applied: null, skipped: null };

  const ms = parseTimeout(step.timeout);
  if (!ms) {
    log.error('mod_ladder_invalid', { guild: guild.id, timeout: step.timeout });
    return { count, applied: null, skipped: 'ladder_invalid' };
  }
  let member;
  try {
    member = await guild.members.fetch(userId);
  } catch (_) {
    log.warn('mod_escalate_skipped', { guild: guild.id, user: userId, why: 'not_member' });
    return { count, applied: null, skipped: 'not_member' };
  }
  if (!member.moderatable) {
    log.warn('mod_escalate_skipped', { guild: guild.id, user: userId, why: 'not_moderatable' });
    return { count, applied: null, skipped: 'not_moderatable' };
  }
  const windowH = CONFIG.strikes.windowHours || 24;
  const reason = `Automatic: ${count} strikes in ${windowH}h (last: ${source}).`;
  try {
    await member.timeout(ms, auditReason('Johnny', reason));
  } catch (err) {
    log.error('mod_escalate_failed', { guild: guild.id, user: userId, msg: err.message, code: err.code });
    return { count, applied: null, skipped: 'discord_refused' };
  }
  const entry = addCase(guild.id, {
    type: 'timeout', userId, userTag: member.user.tag, modId: client.user.id, modTag: client.user.tag,
    reason, durationMs: ms, auto: true,
  });
  await dm(member.user, `You were timed out in ${guild.name} for ${step.timeout}. Reason: ${reason}`);
  await postModlog(guild, entry);
  return { count, applied: entry, skipped: null };
}

// --- delivery -------------------------------------------------------------------

// The audit log shows Johnny as the actor, so the reason names the human who ran the command.
const auditReason = (modTag, reason) => `${modTag}: ${reason}`.slice(0, AUDIT_REASON_MAX);

// Returns true when the DM landed, false when it did not (closed DMs are normal), and null when
// DMs are off in config. A miss is reported, never thrown.
async function dm(user, text) {
  if (!CONFIG.dmTarget) return null;
  try {
    await user.send(text.slice(0, 2000));
    return true;
  } catch (_) {
    return false;
  }
}

// The pre-action DM went out, then Discord refused the action: the member now holds a false
// message. Correct it (SAFE-04). Best effort — if this DM fails too, the log has the refusal.
async function dmCorrection(user, guildName, verb) {
  try {
    await user.send(`Correction: the ${verb} in ${guildName} did not go through. Disregard the previous message.`);
  } catch (_) { /* DMs closed since; nothing more to do */ }
}

const SKIP_LINES = {
  not_moderatable: 'Automatic timeout not applied: target is immune (admin) or above my role.',
  not_member: 'Automatic timeout not applied: target left the server.',
  discord_refused: 'Automatic timeout not applied: Discord refused it. See the log.',
  ladder_invalid: 'Automatic timeout not applied: the ladder in config/moderation.json is invalid.',
};

const TITLES = {
  ban: 'Ban', unban: 'Unban', kick: 'Kick', timeout: 'Timeout', untimeout: 'Timeout cleared',
  warn: 'Warn', purge: 'Purge',
};
const COLORS = {
  ban: embeds.RED, kick: embeds.RED, timeout: embeds.PEACH, warn: embeds.PEACH,
  unban: embeds.MAUVE, untimeout: embeds.MAUVE, purge: embeds.MAUVE,
};

function caseEmbed(entry) {
  const e = new embeds.EmbedBuilder()
    .setColor(COLORS[entry.type] || embeds.MAUVE)
    .setTitle(`Case ${entry.id} · ${TITLES[entry.type] || entry.type}`)
    .addFields(
      { name: 'Member', value: entry.userId ? `<@${entry.userId}> (${entry.userTag || entry.userId})` : '—', inline: true },
      { name: 'Moderator', value: entry.auto ? 'Johnny (automatic)' : `<@${entry.modId}>`, inline: true },
      { name: 'Reason', value: (entry.reason || LINES.noReason).slice(0, 1024) },
    )
    .setTimestamp(entry.ts);
  if (entry.durationMs) e.addFields({ name: 'Duration', value: humanizeMs(entry.durationMs), inline: true });
  if (entry.count != null) e.addFields({ name: 'Messages', value: String(entry.count), inline: true });
  if (entry.channelId) e.addFields({ name: 'Channel', value: `<#${entry.channelId}>`, inline: true });
  return e;
}

// Post a case to the mod-log channel, when one is set. A missing or broken channel is logged,
// never fatal: the case is already in the store.
async function postModlog(guild, entry) {
  const channelId = store(guild.id).modlogChannelId;
  if (!channelId) return;
  try {
    const channel = await guild.channels.fetch(channelId);
    await channel.send({ embeds: [caseEmbed(entry)], allowedMentions: { parse: [] } });
  } catch (err) {
    log.error('modlog_post_failed', { guild: guild.id, channel: channelId, msg: err.message });
  }
}

// Turn a Discord API error into one precise line. A wrong message here would be worse than
// none (SAFE-04), so an unknown code reports Discord's own text.
function describeError(err) {
  switch (err?.code) {
    case 50013: return 'Negative. Discord refused: Missing Permissions. Move my role above the target.';
    case 60003: return 'Negative. This server requires 2FA for moderation. The bot owner account needs 2FA turned on.';
    case 10007: return LINES.notMember;
    case 10013: return 'Negative. No such user.';
    case 10026: return 'Negative. That user is not banned.';
    default: return `Negative. Discord refused the action: ${err?.message || 'unknown error'}.`;
  }
}

module.exports = {
  CONFIG, LINES, MAX_TIMEOUT_MS,
  store, addCase, getCase, casesFor, recentCases,
  guardCheck, guard, requirePerm,
  parseTimeout, escalationFor, addStrike, strikeAndEscalate,
  auditReason, dm, dmCorrection, SKIP_LINES, caseEmbed, postModlog, describeError,
};
