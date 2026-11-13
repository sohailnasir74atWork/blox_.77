// 2026-11-13 RTDB cost fixes:
//  - customBadges registry: get() at most every 6 h (MMKV keeps the defs), a
//    throttled refresh on an unknown badge id, forced after a MOD edit.
//  - profileCache: no worn_badges/{uid} RTDB read when Supabase answered and
//    the user has no roles row.
const mockMmkvStores = new Map();
jest.mock('react-native-mmkv', () => ({
  createMMKV: ({ id } = {}) => {
    if (!mockMmkvStores.has(id)) mockMmkvStores.set(id, new Map());
    const m = mockMmkvStores.get(id);
    return { getString: (k) => m.get(k), set: (k, v) => m.set(k, v), remove: (k) => m.delete(k) };
  },
}));

const mockGet = jest.fn();
jest.mock('@react-native-firebase/database', () => ({
  ref: (_db, path) => ({ path }),
  get: (...a) => mockGet(...a),
  onValue: jest.fn(() => () => {}),
  update: jest.fn(() => Promise.resolve()),
  set: jest.fn(() => Promise.resolve()),
  push: jest.fn(() => ({ key: 'newId' })),
  remove: jest.fn(() => Promise.resolve()),
}));

const snap = (val) => ({ exists: () => val != null, val: () => val });
const DEFS = { b1: { name: 'Event Winner', icon: 'star', color: '#2563EB' } };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('custom badge registry fetches', () => {
  beforeEach(() => { mockMmkvStores.clear(); mockGet.mockReset(); jest.resetModules(); });

  test('cold start with nothing cached: one get, no live listener', async () => {
    mockGet.mockResolvedValue(snap(DEFS));
    const cb = require('../Code/Helper/customBadges');
    const fb = require('@react-native-firebase/database');
    cb.startCustomBadgeRegistry({ id: 'db' });
    await flush();
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(fb.onValue).not.toHaveBeenCalled();
    expect(cb.getCustomBadge('b1').name).toBe('Event Winner');
  });

  test('next launch within 6 h: no read, defs come from MMKV', async () => {
    mockGet.mockResolvedValue(snap(DEFS));
    require('../Code/Helper/customBadges').startCustomBadgeRegistry({ id: 'db' });
    await flush();
    jest.resetModules(); mockGet.mockClear();
    const cb = require('../Code/Helper/customBadges');
    cb.startCustomBadgeRegistry({ id: 'db2' });
    await flush();
    expect(mockGet).not.toHaveBeenCalled();
    expect(cb.getCustomBadge('b1').name).toBe('Event Winner');
  });

  test('unknown badge id refreshes at most once per 10 min', async () => {
    mockGet.mockResolvedValue(snap(DEFS));
    const cb = require('../Code/Helper/customBadges');
    cb.startCustomBadgeRegistry({ id: 'db' });
    await flush();
    mockGet.mockClear();
    mockGet.mockResolvedValue(snap({ ...DEFS, b2: { name: 'New One', icon: 'moon', color: '#DC2626' } }));
    expect(cb.getCustomBadge('b2')).toBeNull(); // the start fetch was < 10 min ago
    expect(mockGet).not.toHaveBeenCalled();
    await cb.refreshCustomBadges({ force: true });
    expect(cb.getCustomBadge('b2').name).toBe('New One');
    mockGet.mockClear();
    cb.getCustomBadge('nope'); cb.getCustomBadge('nope'); // throttled
    expect(mockGet).not.toHaveBeenCalled();
  });

  test('a MOD save forces a refresh', async () => {
    mockGet.mockResolvedValue(snap(DEFS));
    const cb = require('../Code/Helper/customBadges');
    cb.startCustomBadgeRegistry({ id: 'db' });
    await flush();
    mockGet.mockClear();
    await cb.saveCustomBadge({ id: 'db' }, { name: 'Fresh', icon: 'star', color: '#2563EB' }, 'mod1');
    await flush();
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});

describe('profileCache: worn_badges read only when it can matter', () => {
  beforeEach(() => { mockMmkvStores.clear(); mockGet.mockReset(); jest.resetModules(); });

  const load = (roles) => {
    jest.doMock('../Code/Supabase/featureFlags', () => ({ SUPABASE_USERS_ENABLED: true }));
    jest.doMock('../Code/Supabase/userBackend', () => ({
      getIdentity: jest.fn(async () => ({ displayName: 'P', avatar: null })),
      getRoles: jest.fn(async () => roles),
      getRoblox: jest.fn(async () => null),
      getCosmetics: jest.fn(async () => null),
      getIdentityBatch: jest.fn(), getRolesBatch: jest.fn(), getRobloxBatch: jest.fn(), getCosmeticsBatch: jest.fn(),
    }));
    return require('../Code/Helper/profileCache');
  };
  const wornReads = () => mockGet.mock.calls.filter(([r]) => String(r?.path).startsWith('worn_badges/')).length;

  test('Supabase answered, no roles row: no RTDB read', async () => {
    const pc = load(null);
    const p = await pc.getOrFetchProfile({ id: 'db' }, 'uidA');
    expect(p.displayName).toBe('P');
    expect(p.customBadges).toBeNull();
    expect(wornReads()).toBe(0);
  });

  test('roles row with the 058 columns: uses them, no RTDB read', async () => {
    const pc = load({ isTrusted: true, badgeStyles: { trusted: '#2563EB' }, customBadges: { b1: { color: null, at: 1 } } });
    const p = await pc.getOrFetchProfile({ id: 'db' }, 'uidB');
    expect(p.badgeStyles).toEqual({ trusted: '#2563EB' });
    expect(Object.keys(p.customBadges)).toEqual(['b1']);
    expect(wornReads()).toBe(0);
  });

  test('roles row without the 058 columns: still reads worn_badges', async () => {
    mockGet.mockResolvedValue(snap({ custom: { b1: { at: 1 } } }));
    const pc = load({ isTrusted: true });
    const p = await pc.getOrFetchProfile({ id: 'db' }, 'uidC');
    expect(wornReads()).toBe(1);
    expect(Object.keys(p.customBadges)).toEqual(['b1']);
  });
});
