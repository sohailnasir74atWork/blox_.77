// Remote switch for Android collapsible banners (Code/Ads/collapsibleSwitch.js).
// Each test loads a fresh copy of the module with its own fake RTDB + MMKV.

function load({ cached, apps = 1 } = {}) {
  const store = new Map();
  if (cached !== undefined) store.set('collapsibleBannersEnabled', cached);
  const rtdb = { onValue: null, onError: null, path: null };
  jest.resetModules();
  jest.doMock('react-native-mmkv', () => ({
    createMMKV: () => ({
      getBoolean: (k) => store.get(k),
      set: (k, v) => store.set(k, v),
    }),
  }));
  jest.doMock('@react-native-firebase/app', () => ({
    getApps: () => new Array(apps).fill({}),
    getApp: () => ({}),
  }));
  jest.doMock('@react-native-firebase/database', () => ({
    getDatabase: () => ({}),
    ref: (_db, path) => {
      rtdb.path = path;
      return path;
    },
    onValue: (_ref, onValue, onError) => {
      rtdb.onValue = onValue;
      rtdb.onError = onError;
      return () => {};
    },
  }));
  const mod = require('../Code/Ads/collapsibleSwitch');
  return { mod, rtdb, store };
}

const snap = (v) => ({ val: () => v });

describe('collapsibleSwitch', () => {
  it('is OFF before the RTDB value arrives on a first launch', () => {
    const { mod, rtdb } = load();
    expect(mod.collapsibleBannersEnabled()).toBe(false);
    expect(rtdb.path).toBe('collapsible_banners_enabled');
  });

  it('turns ON only for an explicit true', () => {
    const { mod, rtdb, store } = load();
    for (const v of [null, false, 'true', 1, {}]) {
      rtdb.onValue(snap(v));
      expect(mod.collapsibleBannersEnabled()).toBe(false);
    }
    rtdb.onValue(snap(true));
    expect(mod.collapsibleBannersEnabled()).toBe(true);
    expect(store.get('collapsibleBannersEnabled')).toBe(true);
  });

  it('uses the cached value before this session reads RTDB', () => {
    const { mod } = load({ cached: true });
    expect(mod.collapsibleBannersEnabled()).toBe(true);
  });

  it('turns OFF when the read is denied', () => {
    const { mod, rtdb, store } = load({ cached: true });
    rtdb.onError(new Error('permission-denied'));
    expect(mod.collapsibleBannersEnabled()).toBe(false);
    expect(store.get('collapsibleBannersEnabled')).toBe(false);
  });

  it('stays OFF and retries later when Firebase is not ready yet', () => {
    const { mod, rtdb } = load({ apps: 0 });
    expect(mod.collapsibleBannersEnabled()).toBe(false);
    expect(rtdb.onValue).toBeNull();
  });
});
