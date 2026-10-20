const { AuditLogEvent, GuildVerificationLevel } = require('discord.js');
const db = require('./db');
const log = require('./log');
const embeds = require('./embeds');
const mod = require('./mod');
const { humanizeMs } = require('./util');
const CONFIG = require('../config/security.json');

// Security: the raid watcher, /lockdown, anti-nuke, and the new-account flag (DECISIONS.md,
// Decisions 16-19). Every automatic action is a timeout, a pause, or a role strip — never a
// kick or a ban (Decision 14) — and no LLM call is anywhere in this file (Decision 12).

const MAX_PAUSE_MS = 24 * 3_600_000; // Discord's ceiling for an invite or DM pause
const MIN = 60_000;

// Set at boot by index.js. False when the Server Members Intent is off in the Developer Portal:
// Johnny then starts without it, and /lockdown status says raid detection is OFF instead of
// pretending it runs (SAFE-04).
const state = { membersIntent: true };

// In memory, not in the store. A join list or an action count from before a restart would be
// stale, and a raid that spans a restart is a rare miss, not a wrong action.
const joins = new Map();    // guildId -> [{ id, ts }]
const raids = new Map();    // guildId -> { at, sweepUntil, pauseUntil, source, timedOut: Set }
const actions = new Map();  // guildId -> Map(executorId -> [ts])
const strippedAt = new Map(); // `${guildId}:${userId}` -> ts, so one nuke is stripped once

// --- pure helpers (proved by scripts/check-mod.js) ----------------------------

const inWindow = (list, now, windowMs) => list.filter(j => now - j.ts < windowMs);

// The later of two pause ends, capped at Discord's 24h from now. A raid pause must never
// shorten a longer pause that /lockdown already set.
function pauseEnd(currentMs, wantedMs, now) {
  return Math.min(Math.max(currentMs || 0, wantedMs), now + MAX_PAUSE_MS);
}

// Which of a member's roles anti-nuke can remove. `roles` is [{ id, name, editable, managed }]
// without @everyone. A managed role (a bot's integration role) can never be removed by anyone.
function stripPlan(roles) {
  return {
    remove: roles.filter(r => r.editable && !r.managed).map(r => r.id),
    managed: roles.filter(r => r.managed).map(r => r.name),
    aboveMe: roles.filter(r => !r.editable && !r.managed).map(r => r.name),
  };
}

// Which roles from a strip case /restore may give back. `live` maps role id -> { position,
// editable }. A mod can only give roles below their own highest role, as in Discord itself;
// the server owner can give any role Johnny can reach.
function restorePlan(roleIds, live, invokerTop, invokerIsOwner) {
  const plan = { give: [], missing: 0, aboveYou: 0, aboveMe: 0 };
  for (const id of roleIds) {
    const r = live.get(id);
    if (!r) plan.missing++;
    else if (!r.editable) plan.aboveMe++;
    else if (!invokerIsOwner && r.position >= invokerTop) plan.aboveYou++;
    else plan.give.push(id);
  }
  return plan;
}

const isNewAccount = (createdTs, now, days) => now - createdTs < days * 86_400_000;

// --- delivery -------------------------------------------------------------------

function alertEmbed(title, lines, color = embeds.RED) {
  return new embeds.EmbedBuilder().setColor(color).setTitle(title).setDescription(lines.join('\n').slice(0, 4000)).setTimestamp();
}

async function dmOwner(guild, text) {
  try {
    const owner = await guild.fetchOwner();
    await owner.send(text.slice(0, 2000));
    return true;
  } catch (_) {
    return false;
  }
}

// Pause invites and DMs between non-friends until `untilMs`, never shortening a longer pause.
async function pause(guild, untilMs) {
  const now = Date.now();
  const cur = guild.incidentsData;
  const invites = pauseEnd(cur?.invitesDisabledUntil?.getTime(), untilMs, now);
  const dms = pauseEnd(cur?.dmsDisabledUntil?.getTime(), untilMs, now);
  // Send both fields every time: the call replaces the whole state, and a missing field lifts it.
  await guild.setIncidentActions({ invitesDisabledUntil: new Date(invites), dmsDisabledUntil: new Date(dms) });
  return Math.max(invites, dms);
}

// --- raids (Decision 16) ---------------------------------------------------------

// Time out each joiner once per raid. Returns { done, skipped }.
async function timeoutJoiners(guild, client, ids) {
  const raid = raids.get(guild.id);
  const ms = mod.parseTimeout(CONFIG.raid.timeoutJoiners);
  const out = { done: 0, skipped: 0 };
  if (!raid || !ms) return out;
  for (const id of ids) {
    if (raid.timedOut.has(id)) continue;
    raid.timedOut.add(id);
    try {
      const member = await guild.members.fetch(id);
      if (member.user.bot || !member.moderatable) { out.skipped++; continue; }
      const reason = 'Automatic: raid response (joined during the spike).';
      await member.timeout(ms, mod.auditReason('Johnny', reason));
      mod.addCase(guild.id, { type: 'timeout', userId: id, userTag: member.user.tag, modId: client.user.id, modTag: client.user.tag, reason, durationMs: ms, auto: true });
      out.done++;
    } catch (err) {
      out.skipped++;
      log.warn('raid_timeout_failed', { guild: guild.id, user: id, msg: err.message, code: err.code });
    }
  }
  return out;
}

async function triggerRaid(guild, client, source, joinerIds) {
  const now = Date.now();
  const active = raids.get(guild.id);
  if (active && now < active.pauseUntil) return; // already responding to this raid
  const cfg = CONFIG.raid;
  raids.set(guild.id, {
    at: now, source, timedOut: new Set(),
    sweepUntil: now + cfg.windowSeconds * 1000,
    pauseUntil: now + Math.min(cfg.pauseMinutes * MIN, MAX_PAUSE_MS),
  });
  log.warn('raid_detected', { guild: guild.id, source, joiners: joinerIds.length });

  let pausedUntil = null;
  try {
    pausedUntil = await pause(guild, raids.get(guild.id).pauseUntil);
  } catch (err) {
    log.error('raid_pause_failed', { guild: guild.id, msg: err.message, code: err.code });
  }
  const t = await timeoutJoiners(guild, client, joinerIds);

  const lines = [
    `Source: ${source}. ${joinerIds.length} recent joins.`,
    pausedUntil
      ? `Invites and DMs paused until <t:${Math.floor(pausedUntil / 1000)}:t>. Lift early with /lockdown off.`
      : 'Invite pause FAILED. Pause invites by hand: Server Settings → Members → Security Actions.',
    `Joiners timed out for ${cfg.timeoutJoiners}: ${t.done}.${t.skipped ? ` Skipped: ${t.skipped}.` : ''} Clear one with /timeout off.`,
    `Members who join in the next ${cfg.windowSeconds}s are timed out too.`,
  ];
  await mod.postAlert(guild, alertEmbed('Raid detected', lines));
}

// guildMemberAdd. Needs the Server Members Intent.
async function handleJoin(member, client) {
  const guild = member.guild;
  const now = Date.now();
  const cfg = CONFIG.raid;

  if (cfg.enabled) {
    const keepMs = Math.max(cfg.windowSeconds, cfg.discordFlagLookbackSeconds || 0) * 1000;
    const list = inWindow(joins.get(guild.id) || [], now, keepMs);
    list.push({ id: member.id, ts: now });
    joins.set(guild.id, list);

    const raid = raids.get(guild.id);
    if (raid && now < raid.sweepUntil) {
      await timeoutJoiners(guild, client, [member.id]);
      return; // the raid alert covers this join; no new-account line per raider
    }
    const spike = inWindow(list, now, cfg.windowSeconds * 1000);
    if (spike.length >= cfg.joins && !(raid && now < raid.pauseUntil)) {
      await triggerRaid(guild, client, 'join counter', spike.map(j => j.id));
      return;
    }
  }

  const na = CONFIG.newAccount;
  if (na.enabled && !member.user.bot && isNewAccount(member.user.createdTimestamp, now, na.days)) {
    const age = humanizeMs(now - member.user.createdTimestamp);
    await mod.postAlert(guild, alertEmbed('New account', [
      `<@${member.id}> (${member.user.tag}) joined. Account age: ${age}, created <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>.`,
      'No action taken.',
    ], embeds.PEACH));
  }
}

// guildUpdate. Discord's own raid flag. The field is in discord.js 14.27; its arrival on a
// guild update is not verified live, so the join counter stays the primary detector.
async function handleGuildUpdate(oldGuild, newGuild, client) {
  if (!CONFIG.raid.enabled || !CONFIG.raid.listenToDiscordFlag) return;
  const before = oldGuild.incidentsData?.raidDetectedAt?.getTime() || 0;
  const after = newGuild.incidentsData?.raidDetectedAt?.getTime() || 0;
  if (!after || after === before) return;
  const recent = inWindow(joins.get(newGuild.id) || [], Date.now(), (CONFIG.raid.discordFlagLookbackSeconds || 120) * 1000);
  await triggerRaid(newGuild, client, "Discord's raid flag", recent.map(j => j.id));
}

// --- lockdown (Decision 17) --------------------------------------------------------

const levelName = lvl => Object.keys(GuildVerificationLevel).find(k => GuildVerificationLevel[k] === lvl) || String(lvl);

// Returns { already } or { pausedUntil, raisedFrom }. The saved level goes into the store
// BEFORE the level changes, so a crash between the two cannot lose the way back.
async function lockdownOn(guild, user) {
  const s = mod.store(guild.id);
  if (s.lockdown) return { already: true };
  const target = GuildVerificationLevel[CONFIG.lockdown.verificationLevel] ?? GuildVerificationLevel.VeryHigh;
  const prev = guild.verificationLevel;
  s.lockdown = { since: Date.now(), byId: user.id, prevVerification: prev, raised: false };
  db.flushNow();

  let pausedUntil;
  let raisedFrom = null;
  try {
    pausedUntil = await pause(guild, Date.now() + Math.min(CONFIG.lockdown.pauseMinutes * MIN, MAX_PAUSE_MS));
    if (prev < target) {
      await guild.setVerificationLevel(target, mod.auditReason(user.tag, '/lockdown on'));
      s.lockdown.raised = true;
      db.flushNow();
      raisedFrom = levelName(prev);
    }
  } catch (err) {
    // Nothing to restore unless the level changed: drop the saved state, or the next
    // /lockdown on would report "already on" for a lockdown that never happened.
    if (!s.lockdown.raised) { delete s.lockdown; db.flushNow(); }
    throw err;
  }
  log.warn('lockdown_on', { guild: guild.id, by: user.id, raised: s.lockdown.raised });
  await mod.postAlert(guild, alertEmbed('Lockdown on', [
    `By <@${user.id}>. Invites and DMs paused until <t:${Math.floor(pausedUntil / 1000)}:t>.`,
    raisedFrom ? `Verification raised from ${raisedFrom} to ${levelName(target)}.` : `Verification already at ${levelName(prev)} or higher; unchanged.`,
    'Lift with /lockdown off.',
  ]));
  return { pausedUntil, raisedFrom, level: levelName(target) };
}

// Lifts the pause and restores the saved level exactly. The saved state is deleted only after
// both calls succeed, so a failed run can be retried.
async function lockdownOff(guild, user) {
  const s = mod.store(guild.id);
  const ld = s.lockdown;
  await guild.setIncidentActions({ invitesDisabledUntil: null, dmsDisabledUntil: null });
  let restored = null;
  if (ld?.raised) {
    await guild.setVerificationLevel(ld.prevVerification, mod.auditReason(user.tag, '/lockdown off'));
    restored = levelName(ld.prevVerification);
  }
  delete s.lockdown;
  db.flushNow();
  raids.delete(guild.id);
  log.warn('lockdown_off', { guild: guild.id, by: user.id, restored });
  await mod.postAlert(guild, alertEmbed('Lockdown off', [
    `By <@${user.id}>. Invites and DMs open.`,
    restored ? `Verification restored to ${restored}.` : 'Verification unchanged.',
  ], embeds.MAUVE));
  return { hadLockdown: !!ld, restored };
}

function status(guild) {
  const s = mod.store(guild.id);
  const inc = guild.incidentsData;
  const now = Date.now();
  const until = d => (d && d.getTime() > now ? `paused until <t:${Math.floor(d.getTime() / 1000)}:R>` : 'open');
  const r = CONFIG.raid;
  const a = CONFIG.antinuke;
  const lines = [
    `Lockdown: ${s.lockdown ? `ON since <t:${Math.floor(s.lockdown.since / 1000)}:R>, by <@${s.lockdown.byId}>${s.lockdown.raised ? ` (saved level: ${levelName(s.lockdown.prevVerification)})` : ''}` : 'off'}.`,
    `Verification level: ${levelName(guild.verificationLevel)}.`,
    `Invites: ${until(inc?.invitesDisabledUntil)}. DMs: ${until(inc?.dmsDisabledUntil)}.`,
    `Discord raid flag: ${inc?.raidDetectedAt ? `<t:${Math.floor(inc.raidDetectedAt.getTime() / 1000)}:R>` : 'none'}.`,
    !state.membersIntent
      ? 'Raid detection: OFF. Server Members Intent is not enabled (Developer Portal → Bot). New-account flags are off too.'
      : `Raid detection: ${r.enabled ? `on (${r.joins} joins in ${r.windowSeconds}s)` : 'off in config'}.`,
    `Anti-nuke: ${a.enabled ? `on (${a.threshold} actions in ${a.windowSeconds}s)` : 'off in config'}.`,
    `Mod log: ${s.modlogChannelId ? `<#${s.modlogChannelId}>` : 'NOT SET. Raid and anti-nuke alerts go nowhere. Run /modlog set.'}`,
  ];
  return lines.join('\n');
}

// --- anti-nuke (Decision 18) -------------------------------------------------------

const WATCHED = new Set((CONFIG.antinuke.actions || []).map(n => AuditLogEvent[n]).filter(v => v != null));

// guildAuditLogEntryCreate. Needs the GuildModeration intent (not privileged).
async function handleAuditEntry(entry, guild, client) {
  const cfg = CONFIG.antinuke;
  if (!cfg.enabled || !WATCHED.has(entry.action)) return;
  const ex = entry.executorId;
  if (!ex || ex === guild.ownerId || ex === client.user.id) return;

  const now = Date.now();
  const windowMs = cfg.windowSeconds * 1000;
  if (!actions.has(guild.id)) actions.set(guild.id, new Map());
  const byExec = actions.get(guild.id);
  const list = (byExec.get(ex) || []).filter(t => now - t < windowMs);
  list.push(now);
  byExec.set(ex, list);
  if (list.length < cfg.threshold) return;

  const key = `${guild.id}:${ex}`;
  if (now - (strippedAt.get(key) || 0) < windowMs) return; // this nuke is already handled
  strippedAt.set(key, now);
  await strip(guild, client, ex, list.length);
}

async function strip(guild, client, userId, count) {
  const cfg = CONFIG.antinuke;
  const what = `${count} destructive actions in ${cfg.windowSeconds}s`;
  log.warn('antinuke_triggered', { guild: guild.id, user: userId, count });

  let member;
  try {
    member = await guild.members.fetch(userId);
  } catch (_) {
    await mod.postAlert(guild, alertEmbed('Anti-nuke', [`<@${userId}> made ${what}, and is no longer a member. Nothing to strip.`]));
    return;
  }
  const plan = stripPlan(member.roles.cache.filter(r => r.id !== guild.id).map(r => ({ id: r.id, name: r.name, editable: r.editable, managed: r.managed })));

  let removedOk = false;
  if (plan.remove.length) {
    try {
      await member.roles.remove(plan.remove, mod.auditReason('Johnny', `anti-nuke: ${what}`));
      removedOk = true;
    } catch (err) {
      log.error('antinuke_strip_failed', { guild: guild.id, user: userId, msg: err.message, code: err.code });
    }
  }
  const entry = removedOk
    ? mod.addCase(guild.id, {
      type: 'strip', userId, userTag: member.user.tag, modId: client.user.id, modTag: client.user.tag,
      reason: `Automatic: anti-nuke, ${what}.`, roleIds: plan.remove, auto: true,
    })
    : null;

  const lines = [`<@${userId}> (${member.user.tag}) made ${what}.`];
  if (entry) lines.push(`Removed ${plan.remove.length} role${plan.remove.length === 1 ? '' : 's'}. Case ${entry.id}. Undo with /restore.`);
  else if (plan.remove.length) lines.push('Role removal FAILED. Remove their roles by hand now.');
  else lines.push('No role I can remove.');
  if (plan.aboveMe.length) lines.push(`Kept, above my role: ${plan.aboveMe.join(', ')}. Move my role to the top.`);
  if (plan.managed.length) lines.push(`Kept, a bot's own integration role (Discord allows no removal): ${plan.managed.join(', ')}. Kick the bot by hand.`);
  await mod.postAlert(guild, alertEmbed('Anti-nuke', lines));
  await dmOwner(guild, `Anti-nuke in ${guild.name}: ${member.user.tag} made ${what}. ${lines.slice(1).join(' ')}`);
}

// /restore: give back exactly the roles in the member's latest strip case.
async function restore(guild, invoker, targetMember) {
  const last = mod.casesFor(guild.id, targetMember.id).filter(c => c.type === 'strip').pop();
  if (!last) return { none: true };
  const live = new Map(guild.roles.cache.map(r => [r.id, { position: r.position, editable: r.editable }]));
  const plan = restorePlan(last.roleIds || [], live, invoker.roles.highest.position, invoker.id === guild.ownerId);
  if (plan.give.length) await targetMember.roles.add(plan.give, mod.auditReason(invoker.user.tag, `/restore, case ${last.id}`));
  return { fromCase: last.id, ...plan };
}

module.exports = {
  CONFIG, state, MAX_PAUSE_MS,
  inWindow, pauseEnd, stripPlan, restorePlan, isNewAccount,
  handleJoin, handleGuildUpdate, handleAuditEntry, triggerRaid,
  lockdownOn, lockdownOff, status, restore, levelName,
  _test: { joins, raids, actions, strippedAt },
};
