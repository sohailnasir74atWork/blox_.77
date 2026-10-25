// Fruit Cards pure helpers (Code/FruitCards/cardMath.js, cardConfig.js).
// Port of Adopt Me's __tests__/petCards.test.js with Blox rarities, finishes and data.
import {
  formatCompact, parseCatalog, buildValueIndex, setProgress, setProgressAll, bestOwned, totalCopies,
  bestPull, revealTier, countdown, nextUtcMidnight, packsAvailable,
  parseShowcase, toggleShowcase, isShowcased, matchPalette, fusionOf, applyFusion,
} from '../Code/FruitCards/cardMath';
import {
  bgIdFor, themeIdFor, hashKey, RARITIES, FINISHES, RARITY_STYLE, FINISH_STYLE, RARITY_POINTS, DUPE_SHARDS,
  CRAFT_COST, DEFAULT_ODDS, HIT_RARITIES, FUSE_NEXT,
} from '../Code/FruitCards/cardConfig';

describe('formatCompact', () => {
  it('formats values like the card back shows them', () => {
    expect(formatCompact(675)).toBe('675');
    expect(formatCompact(2430)).toBe('2.4K');
    expect(formatCompact(3540000000)).toBe('3540M');
    expect(formatCompact(9100000)).toBe('9.1M');
    expect(formatCompact('x')).toBe('—');
  });
});

// Rows as card_catalog_list() returns them: [key, name, rarity, no, family, sets, bg].
const catalog = parseCatalog([
  ['kitsune', 'Kitsune', 'mythical', 60, 'beast', ['beast', 'mythical'], null],
  ['crimsonkitsune', 'Crimson Kitsune', 'limited', 70, 'skin', ['limited', 'skin_kitsune'], null],
  ['light', 'Light', 'legendary', 30, 'logia', ['logia'], null],
  ['rocket', 'Rocket', 'common', 1, 'natural', ['natural'], null],
]);

describe('catalog and sets', () => {
  it('parses compact rows with the family', () => {
    expect(catalog).toHaveLength(4);
    expect(catalog[1]).toEqual({ key: 'crimsonkitsune', name: 'Crimson Kitsune', rarity: 'limited', no: 70, family: 'skin', sets: ['limited', 'skin_kitsune'], bg: null });
  });
  it('counts set progress from the owned map', () => {
    const owned = { kitsune: [['holo', 1, 42]], rocket: [['classic', 3, null]] };
    expect(setProgress(catalog, owned, 'beast')).toEqual({ have: 1, total: 1, done: true });
    expect(setProgress(catalog, owned, 'all')).toEqual({ have: 2, total: 4, done: false });
    expect(setProgress(catalog, owned, 'skin_kitsune')).toEqual({ have: 0, total: 1, done: false });
    expect(setProgress(catalog, owned, 'nope')).toEqual({ have: 0, total: 0, done: false });
    const all = setProgressAll(catalog, owned);
    ['all', 'beast', 'mythical', 'limited', 'skin_kitsune', 'logia', 'natural', 'nope'].forEach((id) => {
      expect(all(id)).toEqual(setProgress(catalog, owned, id));
    });
  });
  it('picks the fanciest owned finish', () => {
    expect(bestOwned([['classic', 2, null], ['aura', 1, 7], ['holo', 1, 99]])).toEqual({ finish: 'aura', count: 1, serial: 7 });
    expect(bestOwned([['classic', 2, null], ['awakened', 1, null]])).toEqual({ finish: 'awakened', count: 1, serial: null });
    expect(bestOwned([])).toBeNull();
    expect(totalCopies([['classic', 2, null], ['holo', 3, 1]])).toBe(5);
  });
});

describe('values index', () => {
  const rows = [
    { name: 'West Dragon', value: '3540000000', permValue: '6670000000', demand: '10/10', type: 'Beast' },
    { name: 'Rocket', value: '0', permValue: null, demand: null, type: 'Natural' },
    { name: 'West Dragon', value: '1' },
  ];
  it('maps data.json rows by card key: value, permanent, demand', () => {
    const idx = buildValueIndex(rows);
    expect(idx.get('westdragon')).toEqual({ r: 3540000000, p: 6670000000, d: '10/10' });
    expect(idx.get('rocket')).toEqual({ r: null, p: null, d: null });
  });
  it('accepts the saved JSON string and object forms of localState.data', () => {
    expect(buildValueIndex(JSON.stringify(rows)).get('westdragon').r).toBe(3540000000);
    expect(buildValueIndex({ a: rows[0] }).get('westdragon').d).toBe('10/10');
    expect(buildValueIndex('not json').size).toBe(0);
    expect(buildValueIndex(null).size).toBe(0);
  });
});

describe('reveal', () => {
  const pack = [
    { key: 'a', rarity: 'common', finish: 'classic', new: true },
    { key: 'b', rarity: 'limited', finish: 'classic' },
    { key: 'c', rarity: 'rare', finish: 'holo' },
  ];
  it('brags about the rarest finish first', () => {
    expect(bestPull(pack).key).toBe('c');
    expect(bestPull([pack[0], pack[1]]).key).toBe('b');
  });
  it('scales the drama', () => {
    expect(revealTier(pack[0])).toBe(0);
    expect(revealTier(pack[1])).toBe(2);
    expect(revealTier({ rarity: 'mythical', finish: 'classic' })).toBe(2);
    expect(revealTier(pack[2])).toBe(1);
    expect(revealTier({ rarity: 'legendary', finish: 'classic' })).toBe(1);
    expect(revealTier({ rarity: 'common', finish: 'awakened' })).toBe(1);
    expect(revealTier({ rarity: 'common', finish: 'aura' })).toBe(3);
  });
});

describe('time and packs', () => {
  it('counts down', () => {
    expect(countdown(Date.UTC(2026, 9, 2), Date.UTC(2026, 9, 1, 19, 48))).toEqual({ h: 4, m: 12 });
    expect(countdown(1000, 0)).toEqual({ h: 0, m: 1 });
    expect(countdown(0, 5)).toEqual({ h: 0, m: 0 });
  });
  it('finds the next UTC midnight', () => {
    expect(nextUtcMidnight(Date.UTC(2026, 9, 1, 23, 59))).toBe(Date.UTC(2026, 9, 2));
  });
  it('counts packs ready (two free a day)', () => {
    expect(packsAvailable({ freeReady: true, freeLeft: 2, bonusPacks: 1 })).toBe(3);
    expect(packsAvailable({ freeReady: false, freeLeft: 0, bonusPacks: 0 })).toBe(0);
    expect(packsAvailable(null)).toBe(0);
  });
});

describe('art and theme choice', () => {
  it('gives each card a stable background by family', () => {
    expect(bgIdFor(catalog[0], 'classic')).toBe('beast_dusk');
    expect(bgIdFor(catalog[1], 'classic')).toBe('vault');
    expect(bgIdFor(catalog[2], 'classic')).toBe('logia_storm');
    expect(bgIdFor(catalog[3], 'awakened')).toBe('sea_night');
    expect(bgIdFor({ key: 'x', rarity: 'mythical', family: 'natural', sets: [] }, 'classic')).toBe('sea_sunset');
    expect(bgIdFor(catalog[3], 'classic')).toBe(bgIdFor(catalog[3], 'holo'));
    expect(bgIdFor(catalog[3], 'classic')).toMatch(/^sea_/);
    expect(themeIdFor(catalog[0])).toBe('beast');
    expect(themeIdFor(catalog[1])).toBe('skins');
    expect(themeIdFor(catalog[2])).toBe('logia');
    expect(themeIdFor(catalog[3])).toBe('sea');
    expect(hashKey('abc')).toBe(hashKey('abc'));
  });
});

describe('config mirrors supabase/057', () => {
  it('has a style and every table entry for each rarity and finish', () => {
    RARITIES.forEach((r) => {
      expect(RARITY_STYLE[r]).toBeDefined();
      expect(RARITY_POINTS[r]).toBeGreaterThan(0);
      expect(DUPE_SHARDS[r]).toBeGreaterThan(0);
      expect(CRAFT_COST[r]).toBeGreaterThan(0);
      expect(DEFAULT_ODDS.slot[r]).toBeGreaterThan(0);
    });
    FINISHES.forEach((f) => expect(FINISH_STYLE[f]).toBeDefined());
    HIT_RARITIES.forEach((r) => expect(DEFAULT_ODDS.hit[r]).toBeGreaterThan(0));
    expect(Object.values(DEFAULT_ODDS.slot).reduce((a, b) => a + b, 0)).toBe(100);
    expect(Object.values(DEFAULT_ODDS.hit).reduce((a, b) => a + b, 0)).toBe(100);
    expect(Object.values(DEFAULT_ODDS.finish).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);
    // Same numbers as _cards_rarity_points / _cards_craft_cost in the SQL.
    expect(RARITY_POINTS).toEqual({ common: 1, uncommon: 2, rare: 4, legendary: 8, mythical: 16, limited: 24 });
    expect(CRAFT_COST.limited).toBe(1500);
    expect(FUSE_NEXT).toEqual({ classic: 'awakened', awakened: 'aura' });
  });
});

describe('profile showcase', () => {
  const stored = [
    { k: 'kitsune', f: 'aura', s: 7, n: 'Kitsune', r: 'mythical', no: 60, fa: 'beast', sets: ['beast'], bg: null },
    { k: 'light', f: 'classic', s: null, n: 'Light', r: 'legendary', no: 30, fa: 'logia', sets: ['logia'] },
    { k: 'old', f: 'holo' },                                   // older shape without catalog fields
  ];
  it('turns stored entries into drawable cards', () => {
    const items = parseShowcase(stored);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      card: { key: 'kitsune', name: 'Kitsune', rarity: 'mythical', no: 60, family: 'beast', sets: ['beast'], bg: null },
      finish: 'aura', serial: 7,
    });
    expect(items[1].card.family).toBe('logia');
    expect(parseShowcase(null)).toEqual([]);
  });
  it('knows what is pinned', () => {
    expect(isShowcased(stored, 'kitsune', 'aura')).toBe(true);
    expect(isShowcased(stored, 'kitsune', 'classic')).toBe(false);
  });
  it('pins, replaces, unpins and caps at 3', () => {
    let list = toggleShowcase([], 'a', 'classic');
    list = toggleShowcase(list, 'b', 'classic');
    list = toggleShowcase(list, 'c', 'foil');
    list = toggleShowcase(list, 'd', 'classic');             // 4th drops the oldest
    expect(list).toEqual([{ k: 'd', f: 'classic' }, { k: 'c', f: 'foil' }, { k: 'b', f: 'classic' }]);
    list = toggleShowcase(list, 'b', 'aura');                // other finish replaces the pin
    expect(list).toEqual([{ k: 'b', f: 'aura' }, { k: 'd', f: 'classic' }, { k: 'c', f: 'foil' }]);
    list = toggleShowcase(list, 'b', 'aura');                // same again unpins
    expect(list).toEqual([{ k: 'd', f: 'classic' }, { k: 'c', f: 'foil' }]);
  });
});

describe('match my fruit', () => {
  it('keeps the fruit hue and sets lightness by tone', () => {
    const red = ['#E50F10', '#1B212C', '#CC110F'];
    expect(matchPalette(red, 'light').dark).toBe(false);
    expect(matchPalette(red, 'light').css).toContain('hsl(0, 75%, 93%)');
    expect(matchPalette(red, 'dark').css).toContain('hsl(0, 70%, 10%)');
  });
  it('leaves grey fruits grey and survives missing colours', () => {
    expect(matchPalette(['#808080'], 'light').css).toContain('hsl(0, 0%, 93%)');
    expect(matchPalette(null, 'dark').css).toContain('linear-gradient');
  });
});

describe('fusion', () => {
  it('shows what 4 copies would make', () => {
    const e = [['classic', 5, null], ['awakened', 2, null], ['holo', 1, 7]];
    expect(fusionOf(e, 'classic')).toEqual({ to: 'awakened', have: 5, need: 4, ready: true });
    expect(fusionOf(e, 'awakened')).toEqual({ to: 'aura', have: 2, need: 4, ready: false });
    expect(fusionOf(e, 'holo')).toBeNull();
    expect(fusionOf(null, 'classic')).toEqual({ to: 'awakened', have: 0, need: 4, ready: false });
  });
  it('applies a fusion to the owned entries', () => {
    expect(applyFusion([['classic', 5, null]], 'classic', 'awakened')).toEqual([['classic', 1, null], ['awakened', 1, null]]);
    expect(applyFusion([['classic', 4, null], ['awakened', 1, null]], 'classic', 'awakened')).toEqual([['awakened', 2, null]]);
    expect(applyFusion([['awakened', 4, null], ['aura', 1, 12]], 'awakened', 'aura')).toEqual([['aura', 2, 12]]);   // pulled serial kept
  });
});
