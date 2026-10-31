// Pure parts of Code/Helper/customBadges.js (Blox role keys: trusted / grinder / raider / helper): name rules, worn-node
// normalisation, the 3-badge count and the custom:<id> keys. The RTDB
// writes and the registry listener need a device and are not covered here.
jest.mock('react-native-mmkv', () => {
  const stores = new Map();
  return {
    createMMKV: ({ id } = {}) => {
      if (!stores.has(id)) stores.set(id, new Map());
      const m = stores.get(id);
      return { getString: (k) => m.get(k), set: (k, v) => m.set(k, v), remove: (k) => m.delete(k) };
    },
  };
});

const cb = require('../Code/Helper/customBadges');

describe('validateBadgeName: short, smart names', () => {
  test('trims and collapses spaces', () => {
    expect(cb.validateBadgeName('  Event   Winner ')).toEqual({ ok: true, value: 'Event Winner' });
  });
  test('rejects empty, too many words, too long, markup', () => {
    expect(cb.validateBadgeName('').ok).toBe(false);
    expect(cb.validateBadgeName('one two three four five six').ok).toBe(false);
    expect(cb.validateBadgeName('one two three four five').ok).toBe(true);
    expect(cb.validateBadgeName('x'.repeat(cb.NAME_MAX_CHARS + 1)).ok).toBe(false);
    expect(cb.validateBadgeName('x'.repeat(cb.NAME_MAX_CHARS)).ok).toBe(true);
    expect(cb.validateBadgeName('<b>Mod</b>').ok).toBe(false);
  });
});

describe('normalizeWorn: only known role keys and real colours survive', () => {
  test('drops bad colours, unknown roles and empty custom entries', () => {
    const w = cb.normalizeWorn({
      styles: { trusted: '#ec4899', helper: 'pink', admin: '#FFFFFF', raider: '#0284C7' },
      custom: { a: { color: '#2563eb', at: 5, by: 'mod1' }, b: true, c: null, d: { color: 'nope' } },
    });
    expect(w.styles).toEqual({ trusted: '#EC4899', raider: '#0284C7' });
    expect(w.custom).toEqual({
      a: { color: '#2563EB', at: 5, by: 'mod1' },
      b: { color: null, at: 0, by: null },
      d: { color: null, at: 0, by: null },
    });
  });
  test('null / garbage → empty', () => {
    expect(cb.normalizeWorn(null)).toEqual({ styles: {}, custom: {} });
    expect(cb.normalizeWorn('x')).toEqual({ styles: {}, custom: {} });
  });
});

describe('the 3-badge cap counts role badges and custom badges together', () => {
  test('wornBadgeCount', () => {
    expect(cb.wornBadgeCount({})).toBe(0);
    expect(cb.wornBadgeCount({ isTrusted: true, isGrinder: true })).toBe(2);
    expect(cb.wornBadgeCount({ isHelper: true, customBadges: { a: { at: 1 }, b: { at: 2 } } })).toBe(3);
    expect(cb.MAX_WORN_BADGES).toBe(3);
  });
  test('customIdsOf orders by grant time and skips removed ids', () => {
    expect(cb.customIdsOf({ late: { at: 9 }, early: { at: 1 }, gone: null })).toEqual(['early', 'late']);
    expect(cb.customIdsOf(null)).toEqual([]);
  });
});

describe('custom:<id> keys and the registry', () => {
  test('key helpers round-trip', () => {
    expect(cb.customKey('abc')).toBe('custom:abc');
    expect(cb.isCustomKey('custom:abc')).toBe(true);
    expect(cb.isCustomKey('helper')).toBe(false);
    expect(cb.customIdOf('custom:abc')).toBe('abc');
    expect(cb.customIdOf('helper')).toBe(null);
  });
  test('an unknown badge id resolves to nothing (deleted, or registry not loaded)', () => {
    expect(cb.getCustomBadge('nope')).toBe(null);
    expect(cb.resolveCustomBadge('nope', { color: '#EC4899' })).toBe(null);
  });
  test('every icon name has an asset and every palette entry is a hex colour', () => {
    expect(cb.CUSTOM_ICON_NAMES.length).toBeGreaterThanOrEqual(12);
    cb.CUSTOM_ICON_NAMES.forEach((n) => expect(cb.CUSTOM_ICONS[n]).toBeTruthy());
    cb.BADGE_COLORS.forEach((c) => expect(cb.isHexColor(c.hex)).toBe(true));
    cb.ROLE_BADGE_KEYS.forEach((k) => expect(cb.isHexColor(cb.ROLE_DEFAULT_COLOR[k])).toBe(true));
  });
});
