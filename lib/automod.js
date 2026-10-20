const {
  AutoModerationRuleTriggerType: Trigger,
  AutoModerationRuleEventType,
  AutoModerationActionType: Action,
  AutoModerationRuleKeywordPresetType: Preset,
} = require('discord.js');
const log = require('./log');
const mod = require('./mod');

// Johnny sets up Discord's NATIVE AutoMod; he never scans messages himself (DECISIONS.md,
// Decision 13). Discord blocks the message before it posts, and the rules keep working while
// Johnny is offline. Discord is the source of truth: no rule and no word list is stored here.
// Johnny touches only rules whose name starts with the configured prefix.

const CFG = mod.CONFIG.automod;
const PREFIX = CFG.rulePrefix;
const NAMES = {
  presets: `${PREFIX}presets`,
  spam: `${PREFIX}spam`,
  mentions: `${PREFIX}mention spam`,
  invites: `${PREFIX}invites`,
  words: `${PREFIX}blocked words`,
};
const PRESETS = { profanity: Preset.Profanity, sexual_content: Preset.SexualContent, slurs: Preset.Slurs };
// Discord allows one rule of each of these per server; keyword rules allow six.
const SINGLETONS = new Set([Trigger.Spam, Trigger.KeywordPreset, Trigger.MentionSpam]);
const TRIGGER_NAMES = {
  [Trigger.Keyword]: 'keyword', [Trigger.Spam]: 'spam', [Trigger.KeywordPreset]: 'preset',
  [Trigger.MentionSpam]: 'mention spam', [Trigger.MemberProfile]: 'member profile',
};
const MAX_WORD = 60;
const MAX_WORDS = 1000;

const isMine = rule => rule.name.startsWith(PREFIX);

function actionsFor(alertChannelId) {
  const actions = [{ type: Action.BlockMessage, metadata: { customMessage: CFG.blockMessage.slice(0, 150) } }];
  if (alertChannelId) actions.push({ type: Action.SendAlertMessage, metadata: { channel: alertChannelId } });
  return actions;
}

// Pure: the rules config/moderation.json asks for. `words` is the blocked-word list as it
// stands on Discord now, merged with the config list, so a re-run of setup never drops a word.
function desiredRules(cfg, words) {
  const rules = [];
  const presets = (cfg.presets || []).map(p => PRESETS[p]).filter(v => v != null);
  if (presets.length) rules.push({ name: NAMES.presets, triggerType: Trigger.KeywordPreset, triggerMetadata: { presets } });
  if (cfg.spam) rules.push({ name: NAMES.spam, triggerType: Trigger.Spam });
  if (cfg.mentionSpam?.enabled) {
    rules.push({
      name: NAMES.mentions,
      triggerType: Trigger.MentionSpam,
      triggerMetadata: {
        mentionTotalLimit: Math.min(50, Math.max(1, cfg.mentionSpam.limit || 5)),
        mentionRaidProtectionEnabled: !!cfg.mentionSpam.raidProtection,
      },
    });
  }
  if (cfg.blockInvites && cfg.invitePatterns?.length) {
    rules.push({ name: NAMES.invites, triggerType: Trigger.Keyword, triggerMetadata: { regexPatterns: cfg.invitePatterns.slice(0, 10) } });
  }
  const allWords = [...new Set([...(cfg.keywords || []), ...(words || [])])].slice(0, MAX_WORDS);
  if (allWords.length) rules.push({ name: NAMES.words, triggerType: Trigger.Keyword, triggerMetadata: { keywordFilter: allWords } });
  return rules;
}

// Create or update every rule in the config. Idempotent: run it again after a config change.
// Returns one line per rule: created, updated, kept (the server has its own rule of a type
// Discord allows once), or failed with Discord's reason.
async function setup(guild) {
  const existing = await guild.autoModerationRules.fetch();
  const wordsRule = existing.find(r => r.name === NAMES.words);
  const want = desiredRules(CFG, wordsRule?.triggerMetadata.keywordFilter);
  const alertChannelId = mod.store(guild.id).modlogChannelId;
  const report = [];

  for (const rule of want) {
    const mine = existing.find(r => r.name === rule.name);
    try {
      if (mine) {
        await mine.edit({ triggerMetadata: rule.triggerMetadata, actions: actionsFor(alertChannelId), enabled: true, reason: 'Johnny: /automod setup' });
        report.push(`Updated: ${rule.name}`);
      } else if (SINGLETONS.has(rule.triggerType) && existing.some(r => r.triggerType === rule.triggerType)) {
        report.push(`Kept: the server's own ${TRIGGER_NAMES[rule.triggerType]} rule. Discord allows one.`);
      } else {
        await guild.autoModerationRules.create({
          name: rule.name,
          eventType: AutoModerationRuleEventType.MessageSend,
          triggerType: rule.triggerType,
          triggerMetadata: rule.triggerMetadata,
          actions: actionsFor(alertChannelId),
          enabled: true,
          reason: 'Johnny: /automod setup',
        });
        report.push(`Created: ${rule.name}`);
      }
    } catch (err) {
      log.error('automod_setup_failed', { guild: guild.id, rule: rule.name, msg: err.message, code: err.code });
      report.push(`Failed: ${rule.name}. ${err.message}`);
    }
  }
  return report;
}

// Delete Johnny's rules only. A rule the server made by hand is never touched.
async function off(guild) {
  const existing = await guild.autoModerationRules.fetch();
  let removed = 0;
  for (const rule of existing.filter(isMine).values()) {
    await rule.delete('Johnny: /automod off');
    removed++;
  }
  return removed;
}

async function status(guild) {
  const existing = await guild.autoModerationRules.fetch();
  return [...existing.values()].map(r => ({
    name: r.name,
    type: TRIGGER_NAMES[r.triggerType] || String(r.triggerType),
    enabled: r.enabled,
    mine: isMine(r),
    // A keyword rule matches words, regex patterns, or both; count both.
    entries: r.triggerType === Trigger.Keyword ? r.triggerMetadata.keywordFilter.length + r.triggerMetadata.regexPatterns.length : null,
  }));
}

// Add one word to Johnny's blocked-words rule, creating the rule when it does not exist.
// Returns a result code; the command turns it into a line.
async function block(guild, word) {
  const w = word.trim().toLowerCase();
  if (!w || w.length > MAX_WORD) return 'bad_word';
  const existing = await guild.autoModerationRules.fetch();
  const rule = existing.find(r => r.name === NAMES.words);
  if (!rule) {
    await guild.autoModerationRules.create({
      name: NAMES.words,
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: Trigger.Keyword,
      triggerMetadata: { keywordFilter: [w] },
      actions: actionsFor(mod.store(guild.id).modlogChannelId),
      enabled: true,
      reason: 'Johnny: /automod block',
    });
    return 'added';
  }
  const list = rule.triggerMetadata.keywordFilter;
  if (list.includes(w)) return 'exists';
  if (list.length >= MAX_WORDS) return 'full';
  await rule.edit({ triggerMetadata: { keywordFilter: [...list, w] }, reason: 'Johnny: /automod block' });
  return 'added';
}

// Remove one word. An empty list deletes the rule, because Discord rejects a keyword rule
// with nothing to match.
async function unblock(guild, word) {
  const w = word.trim().toLowerCase();
  const existing = await guild.autoModerationRules.fetch();
  const rule = existing.find(r => r.name === NAMES.words);
  if (!rule || !rule.triggerMetadata.keywordFilter.includes(w)) return 'missing';
  const rest = rule.triggerMetadata.keywordFilter.filter(k => k !== w);
  if (!rest.length) await rule.delete('Johnny: /automod unblock (last word)');
  else await rule.edit({ triggerMetadata: { keywordFilter: rest }, reason: 'Johnny: /automod unblock' });
  return 'removed';
}

// Point the alert action of Johnny's rules at the mod-log channel (or remove it when null).
// Called by /modlog, so the alerts follow the channel without a second setup run.
async function pointAlerts(guild, channelId) {
  const existing = await guild.autoModerationRules.fetch();
  let changed = 0;
  for (const rule of existing.filter(isMine).values()) {
    try {
      await rule.setActions(actionsFor(channelId), 'Johnny: /modlog');
      changed++;
    } catch (err) {
      log.error('automod_alert_point_failed', { guild: guild.id, rule: rule.name, msg: err.message });
    }
  }
  return changed;
}

// Gateway event: Discord blocked a message. Each rule hit sends one event per action, so count
// only the block action — one hit is one strike, never two.
async function handleExecution(execution, client) {
  if (execution.action.type !== Action.BlockMessage) return;
  log.info('automod_block', {
    guild: execution.guild.id, user: execution.userId, rule: execution.ruleId,
    trigger: TRIGGER_NAMES[execution.ruleTriggerType] || execution.ruleTriggerType,
  });
  if (!mod.CONFIG.strikes.countAutomodBlocks) return;
  const { applied } = await mod.strikeAndEscalate(execution.guild, execution.userId, client, 'AutoMod block');
  if (applied) log.info('automod_escalated', { guild: execution.guild.id, user: execution.userId, case: applied.id });
}

module.exports = { NAMES, PREFIX, desiredRules, actionsFor, setup, off, status, block, unblock, pointAlerts, handleExecution };
