/**
 * raidBridge.js — the pure parts of the Sea Beast Raid ↔ app bridge
 * (2026-10-31, Phase 1 step 1). No React, no native modules, so
 * __tests__/raidGame.test.js can cover them.
 *
 * The game (Code/Raid/game/raid.html) carries its own English text; the app
 * sends the user's language as `strings` (Code/Translation/*.json → "raid").
 * Placeholders are single-brace {name}: i18next only touches {{double}}, so
 * they reach the game unchanged and the game fills them in.
 *
 * Rewards are decided by the server (functions/raid/logic.js); the tables
 * below are the client's copy so the loadout screen and the standalone page
 * agree with it. The jest test checks the game file against RAID_RULES.
 */

// Every text key the game reads. Kept in step with EN in raid.html (the
// test checks both directions).
export const RAID_KEYS = [
  'logo1', 'logo2', 'tag', 'todays_boss', 'resets_in',
  'boss_sub', 'defeated', 'raiders', 'your_share',
  'your_bounty', 'rank', 'to_rank', 'max_rank', 'title_none', 'title_is', 'frames_n',
  'pro_active', 'pro_paid', 'pro_none',
  'streak', 'streak_one', 'streak_next', 'streak_max',
  'raid', 'ranks', 'raids_free', 'raids_ad', 'raids_left', 'raids_tomorrow',
  'disclaimer',
  'pick_loadout', 'pick_sub', 'fruit', 'sword', 'style',
  'weak_note', 'weak_tag', 'dmg_plus', 'awaken_plus', 'speed_plus', 'balanced',
  'power', 'speed', 'awaken', 'loadout_desc', 'set_sail',
  'hint_tap', 'hint_dodge', 'damage', 'combo', 'awaken_btn', 'enraged', 'stunned', 'hit', 'dodge', 'crit',
  'paused', 'resume', 'quit',
  'raid_over', 'boss_defeated', 'head_sank', 'head_massive', 'head_solid', 'head_warmup',
  'damage_dealt', 'best_combo', 'hits_n', 'dodged_n',
  'saving', 'not_saved', 'signin_needed', 'signin_btn',
  'bounty', 'bounty_gain', 'raid_chest', 'open', 'opened', 'chest_next', 'chest_top',
  'chest_wood', 'chest_iron', 'chest_gold', 'chest_mythic',
  'loot_bounty', 'loot_pro', 'loot_rankup', 'loot_rankup_paid',
  'loot_streak', 'loot_boss', 'loot_boss_pro', 'loot_cap',
  'crew_boss', 'pirates_n', 'crate_done', 'crate_todo',
  'crate_sunk',
  'again', 'again_ad', 'again_none', 'home', 'ad_failed',
  'bounty_board', 'today', 'all_time', 'you', 'lb_empty', 'lb_loading',
  'how_1_t', 'how_1_b', 'how_2_t', 'how_2_b', 'how_3_t', 'how_3_b', 'how_4_t', 'how_4_b',
  'how_next', 'how_go', 'how_skip',
  'rank_rookie', 'rank_pirate', 'rank_captain', 'rank_warlord', 'rank_emperor', 'rank_king',
  'boss_seabeast', 'boss_leviathan', 'boss_doughking', 'boss_kitsune', 'boss_tyrant',
  'frame_seabeast', 'frame_leviathan', 'frame_doughking', 'frame_kitsune', 'frame_tyrant', 'title_raider',
  'd_dough', 'd_dragon', 'd_kitsune', 'd_leopard',
  'd_spirit', 'd_venom', 'd_buddha', 'd_rumble',
  'd_ice', 'd_magma', 'd_light', 'd_dark',
  'unit_min', 'unit_h', 'unit_d', 'unit_d1', 'time_dh', 'time_hm', 'time_m',
];

const HOUR = 3600e3;
const DAY = 24 * HOUR;

// Rules shared with the game (and, by copy, with functions/raid/logic.js).
export const RAID_RULES = {
  FRUIT_IDS: ['dough', 'dragon', 'kitsune', 'leopard', 'spirit', 'venom', 'buddha', 'rumble', 'ice', 'magma', 'light', 'dark'],
  SWORD_IDS: ['cutlass', 'saber', 'rengoku', 'cdk'],
  STYLE_IDS: ['combat', 'ds', 'ec', 'godhuman'],
  BOSS_IDS: ['seabeast', 'leviathan', 'doughking', 'kitsune', 'tyrant'],
  BOSS_WEAK: { seabeast: 'rumble', leviathan: 'light', doughking: 'magma', kitsune: 'dark', tyrant: 'ice' },
  RANKS: [['rookie', 0], ['pirate', 1e6], ['captain', 5e6], ['warlord', 2e7], ['emperor', 7.5e7], ['king', 2.5e8]],
  CHESTS: [
    { id: 'wood', min: 0, pro: 0, pct: 5 },
    { id: 'iron', min: 4e5, pro: 30 * 60e3, pct: 10 },
    { id: 'gold', min: 9e5, pro: 2 * HOUR, pct: 15 },
    { id: 'mythic', min: 1.5e6, pro: 12 * HOUR, pct: 25 },
  ],
  RANK_PRO: { pirate: 1 * DAY, captain: 3 * DAY, warlord: 7 * DAY, emperor: 14 * DAY, king: 30 * DAY },
  STREAK_PRO: { 3: 6 * HOUR, 7: 3 * DAY, 14: 7 * DAY, 30: 30 * DAY },
  BOSS_CRATE_PRO: DAY,
  DMG_SCALE: 300,
  RAIDS_FREE: 1,
  RAIDS_PER_DAY: 4,
  ROUND_SECS: 60,
};

// An interstitial may show at the natural break after a raid (owner plan
// 2026-10-31: the 2nd raid and every 2nd after; never the first, never for
// Pro, never during a raid, never a banner inside the game).
export const RAIDS_PER_INTERSTITIAL = 2;
export const shouldShowInterstitial = (raidsFinished, isPro) =>
  !isPro && raidsFinished > 0 && raidsFinished % RAIDS_PER_INTERSTITIAL === 0;

/** The player's local preferences, cleaned (they come back from MMKV and from the game). */
export function cleanSave(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const l = s.loadout && typeof s.loadout === 'object' ? s.loadout : {};
  const pick = (ids, v, dflt) => (ids.includes(v) ? v : dflt);
  return {
    loadout: {
      fruit: pick(RAID_RULES.FRUIT_IDS, l.fruit, 'kitsune'),
      sword: pick(RAID_RULES.SWORD_IDS, l.sword, 'saber'),
      style: pick(RAID_RULES.STYLE_IDS, l.style, 'combat'),
    },
    sound: s.sound === true,
    howSeen: s.howSeen === true,
  };
}

/** Parse one message from the game; null when it is not ours. */
export function parseMessage(data) {
  let msg;
  try {
    msg = typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) {
    return null;
  }
  return msg && typeof msg === 'object' && typeof msg.type === 'string' ? msg : null;
}

// Game haptic names → react-native-haptic-feedback types.
export const HAPTIC_TYPES = {
  light: 'impactLight',
  medium: 'impactMedium',
  success: 'notificationSuccess',
  warning: 'notificationWarning',
  error: 'notificationError',
};

/** The window.__RAID_INIT assignment ('<' escaped, so no string can close the tag). */
export const initScript = (init) => `window.__RAID_INIT = ${JSON.stringify(init).replace(/</g, '\\u003c')}; true;`;

/**
 * The game page with its settings written in ahead of the game script.
 * Not injectedJavaScriptBeforeContentLoaded: on Android that ran AFTER the
 * page's inline script (MM2 Manor, 2026-10-30, react-native-webview 16.0.0).
 */
export const withInit = (html, init) => html.replace('<head>', `<head><script>${initScript(init)}</script>`);
