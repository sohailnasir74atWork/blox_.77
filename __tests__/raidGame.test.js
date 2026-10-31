/**
 * Sea Beast Raid (Code/Raid/*): the bundled game is in step with its source,
 * the app and the game agree on every text key and every rule table, and
 * the bridge helpers behave. Locale coverage (every language has every
 * "raid" key) is added in Phase 1 step 6 when the strings land.
 */
import fs from 'fs';
import path from 'path';
import RAID_HTML from '../Code/Raid/raidGameHtml';
import {
  RAID_KEYS, RAID_RULES, cleanSave, parseMessage, initScript, withInit, shouldShowInterstitial, HAPTIC_TYPES,
} from '../Code/Raid/raidBridge';
import { RAID_FRAMES, ALL_ITEMS, getItemsByRarity, RARITY } from '../Code/Engagement/shopItems';

const SRC = fs.readFileSync(path.join(__dirname, '../Code/Raid/game/raid.html'), 'utf8');

// Evaluate a `const NAME = <literal>;` from the game script (a regex over the
// text would also match words inside sentences).
const gameConst = (name) => {
  const start = SRC.indexOf(`const ${name} = `) + `const ${name} = `.length;
  const end = SRC.indexOf(';\n', start);
  const HOUR = 3600e3; const DAY = 24 * HOUR; // the game's literals use these
  // eslint-disable-next-line no-new-func
  return Function('HOUR', 'DAY', `return ${SRC.slice(start, end)}`)(HOUR, DAY);
};

describe('bundled game', () => {
  it('raidGameHtml.js matches raid.html (run npm run raid:build)', () => {
    expect(RAID_HTML).toBe(SRC);
  });
  it('makes no network requests', () => {
    expect(SRC).not.toMatch(/<link[^>]+href=|<script[^>]+src=|fetch\(|XMLHttpRequest|https?:\/\/(?!www\.w3\.org)/);
  });
  it('app keys and game keys are the same set', () => {
    expect([...RAID_KEYS].sort()).toEqual(Object.keys(gameConst('EN')).sort());
  });
  it('every text key the game asks for exists', () => {
    // T('key') and T(`rank_${…}`)-style prefixes
    const direct = [...SRC.matchAll(/\bT\('([a-z0-9_]+)'[,)]/g)].map((m) => m[1]);
    for (const k of direct) expect([k, RAID_KEYS.includes(k)]).toEqual([k, true]);
    const dataS = [...SRC.matchAll(/data-s="([a-z0-9_]+)"/g)].map((m) => m[1]);
    for (const k of dataS) expect([k, RAID_KEYS.includes(k)]).toEqual([k, true]);
    for (const p of ['rank_', 'boss_', 'frame_', 'chest_', 'd_']) {
      const ids = p === 'rank_' ? RAID_RULES.RANKS.map((r) => r[0])
        : p === 'boss_' || p === 'frame_' ? RAID_RULES.BOSS_IDS
          : p === 'chest_' ? RAID_RULES.CHESTS.map((c) => c.id)
            : RAID_RULES.FRUIT_IDS;
      for (const id of ids) expect([p + id, RAID_KEYS.includes(p + id)]).toEqual([p + id, true]);
    }
  });
  it('reads its settings from window.__RAID_INIT before anything else', () => {
    expect(SRC.indexOf('const INIT = window.__RAID_INIT')).toBeLessThan(SRC.indexOf('const EN = {'));
  });
});

describe('rules: game and app agree', () => {
  it('fruits, swords, styles, bosses', () => {
    expect(gameConst('FRUITS').map((f) => f.id)).toEqual(RAID_RULES.FRUIT_IDS);
    expect(gameConst('SWORDS').map((f) => f.id)).toEqual(RAID_RULES.SWORD_IDS);
    expect(gameConst('STYLES').map((f) => f.id)).toEqual(RAID_RULES.STYLE_IDS);
    const bosses = gameConst('BOSSES');
    expect(bosses.map((b) => b.id)).toEqual(RAID_RULES.BOSS_IDS);
    expect(Object.fromEntries(bosses.map((b) => [b.id, b.weak]))).toEqual(RAID_RULES.BOSS_WEAK);
  });
  it('ranks, chests, PRO tables, damage scale', () => {
    expect(gameConst('RANKS')).toEqual(RAID_RULES.RANKS);
    const chests = gameConst('CHESTS'); const pct = gameConst('CHEST_PCT');
    expect(chests.map((c) => ({ id: c.id, min: c.min, pro: c.pro, pct: pct[c.id] }))).toEqual(RAID_RULES.CHESTS);
    expect(gameConst('RANK_PRO')).toEqual(RAID_RULES.RANK_PRO);
    expect(gameConst('STREAK_PRO')).toEqual(RAID_RULES.STREAK_PRO);
    expect(gameConst('DMG_SCALE')).toBe(RAID_RULES.DMG_SCALE);
    expect(SRC).toContain('left:60,');
    expect(RAID_RULES.ROUND_SECS).toBe(60);
  });
  it('raids per day and the free raid', () => {
    expect(SRC).toContain('Math.max(0, 4 - ST.raidsUsed) : Math.max(0, 1 - ST.raidsUsed)');
    expect([RAID_RULES.RAIDS_FREE, RAID_RULES.RAIDS_PER_DAY]).toEqual([1, 4]);
  });
});

describe('locales: every language has every raid string', () => {
  const dir = path.join(__dirname, '../Code/Translation');
  const files = fs.readdirSync(dir).filter((x) => x.endsWith('.json'));
  const ph = (v) => (String(v).match(/\{\w+\}/g) || []).sort();
  const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'));
  it('en.json raid block equals the game EN text', () => {
    expect(en.raid).toEqual(gameConst('EN'));
  });
  it('every language has every raid key, with the same placeholders as English', () => {
    expect(files.length).toBeGreaterThanOrEqual(11);
    for (const f of files) {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      for (const k of RAID_KEYS) {
        expect([f, k, typeof (m.raid || {})[k]]).toEqual([f, k, 'string']);
        expect([f, k, ph(m.raid[k])]).toEqual([f, k, ph(en.raid[k])]);
      }
      for (const k of ['title', 'crate_title', 'crate_body', 'crate_body_pro', 'capped', 'ad_title', 'ad_unavailable', 'signin']) expect([f, k, typeof (m.raid_app || {})[k]]).toEqual([f, k, 'string']);
      for (const k of ['game_raid', 'tag_new']) expect([f, k, typeof m.home.home_tab_screen[k]]).toEqual([f, k, 'string']);
      for (const k of ['raid_name', 'raid_desc', 'new_tag']) expect([f, k, typeof m.engagement.game_hub[k]]).toEqual([f, k, 'string']);
    }
  });
  it('the screen asks for raid_app keys that exist', () => {
    const screen = fs.readFileSync(path.join(__dirname, '../Code/Raid/RaidScreen.jsx'), 'utf8');
    for (const m of screen.matchAll(/t\('raid_app\.(\w+)'/g)) expect([m[1], typeof en.raid_app[m[1]]]).toEqual([m[1], 'string']);
  });
});

describe('boss frames: game, server and My Cosmetics agree', () => {
  const server = require('../functions/raid/logic');
  it('every boss has its frame in the catalogue, matching the server record', () => {
    for (const b of server.BOSSES) {
      const sf = server.FRAMES[b.id];
      const f = RAID_FRAMES[sf.id];
      expect(f).toBeTruthy();
      expect([f.id, f.name, f.borderColors, f.borderWidth, f.glowColor, f.rarity, f.duration, f.source])
        .toEqual([sf.id, sf.name, sf.borderColors, sf.borderWidth, sf.glowColor, 'legendary', -1, 'raid']);
      expect(Object.values(RARITY)).toContain(f.rarity);
      expect(RAID_KEYS).toContain(`frame_${b.id}`);
    }
    expect(Object.keys(RAID_FRAMES).length).toBe(server.BOSSES.length);
  });
  it('raid frames are in the catalogue (My Cosmetics) but never drop from eggs', () => {
    for (const id of Object.keys(RAID_FRAMES)) expect(ALL_ITEMS[id]).toBe(RAID_FRAMES[id]);
    for (const r of Object.values(RARITY)) expect(getItemsByRarity(r).some((i) => i.source === 'raid')).toBe(false);
  });
});

describe('bridge helpers', () => {
  it('cleanSave keeps known ids and falls back', () => {
    expect(cleanSave(null)).toEqual({ loadout: { fruit: 'kitsune', sword: 'saber', style: 'combat' }, sound: false, howSeen: false });
    expect(cleanSave({ loadout: { fruit: 'dragon', sword: 'hack', style: 'godhuman' }, sound: true, howSeen: 'yes' }))
      .toEqual({ loadout: { fruit: 'dragon', sword: 'saber', style: 'godhuman' }, sound: true, howSeen: false });
  });
  it('parseMessage', () => {
    expect(parseMessage('{"type":"save"}')).toEqual({ type: 'save' });
    expect(parseMessage('nope')).toBe(null);
    expect(parseMessage('{"x":1}')).toBe(null);
  });
  it('interstitial on the 2nd raid and every 2nd after, never for Pro', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => shouldShowInterstitial(n, false))).toEqual([false, true, false, true, false, true]);
    expect(shouldShowInterstitial(2, true)).toBe(false);
    expect(shouldShowInterstitial(0, false)).toBe(false);
  });
  it('initScript cannot break out of the script tag', () => {
    const s = initScript({ strings: { tag: '</script><b>' } });
    expect(s).not.toContain('</script>');
    expect(s.startsWith('window.__RAID_INIT = ')).toBe(true);
  });
  it('withInit puts the settings before the game script', () => {
    const page = withInit(SRC, { insetsHandled: true });
    const at = page.indexOf('window.__RAID_INIT = ');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(page.indexOf('const INIT = window.__RAID_INIT'));
  });
  it('haptic names map to library types and the game only uses known ones', () => {
    expect(HAPTIC_TYPES.success).toBe('notificationSuccess');
    for (const m of SRC.matchAll(/haptic\('(\w+)'\)/g)) expect([m[1], !!HAPTIC_TYPES[m[1]]]).toEqual([m[1], true]);
  });
});
