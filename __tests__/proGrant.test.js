// Admin-given Pro (Code/Helper/proGrant.js). Each test loads a fresh copy of
// the module with its own fake MMKV, Firebase Auth and RTDB.

const DAY = 24 * 60 * 60 * 1000;

function load({ seed = {}, uid = null } = {}) {
  const store = new Map(Object.entries(seed));
  const fb = { uid, authCb: null, valueCbs: new Map(), writes: [] };
  jest.resetModules();
  jest.doMock('react-native-mmkv', () => ({
    createMMKV: () => ({
      getString: (k) => store.get(k),
      getNumber: (k) => store.get(k),
      set: (k, v) => store.set(k, v),
      remove: (k) => store.delete(k),
    }),
  }));
  jest.doMock('@react-native-firebase/auth', () => ({
    getAuth: () => ({ currentUser: fb.uid ? { uid: fb.uid } : null }),
    onAuthStateChanged: (_a, cb) => { fb.authCb = cb; return () => {}; },
  }));
  jest.doMock('@react-native-firebase/database', () => ({
    getDatabase: () => ({}),
    ref: (_db, path) => path,
    onValue: (path, cb) => {
      fb.valueCbs.set(path, cb);
      return () => fb.valueCbs.delete(path);
    },
    set: (path, val) => { fb.writes.push(['set', path, val]); return Promise.resolve(); },
    remove: (path) => { fb.writes.push(['remove', path]); return Promise.resolve(); },
  }));
  const mod = require('../Code/Helper/proGrant');
  const serverSays = (u, val) => fb.valueCbs.get(`pro_grants/${u}`)({ val: () => val });
  return { ...mod, store, fb, serverSays };
}

afterEach(() => jest.useRealTimers());

test('no grant: not Pro', () => {
  const m = load({ uid: 'u1' });
  m.startProGrants();
  m.serverSays('u1', null);
  expect(m.isProGrantActive()).toBe(false);
});

test('a running grant turns Pro on and notifies', () => {
  const m = load({ uid: 'u1' });
  const seen = jest.fn();
  m.onProGrantChange(seen);
  m.startProGrants();
  seen.mockClear();
  m.serverSays('u1', { until: Date.now() + 7 * DAY, at: Date.now() });
  expect(m.isProGrantActive()).toBe(true);
  expect(seen).toHaveBeenCalled();
});

test('an ended grant is not Pro', () => {
  const m = load({ uid: 'u1' });
  m.startProGrants();
  m.serverSays('u1', { until: Date.now() - 1000, at: Date.now() - DAY });
  expect(m.isProGrantActive()).toBe(false);
});

test('removing the grant takes Pro away', () => {
  const m = load({ uid: 'u1' });
  m.startProGrants();
  m.serverSays('u1', { until: Date.now() + DAY, at: Date.now() });
  m.serverSays('u1', null);
  expect(m.isProGrantActive()).toBe(false);
});

test('cached grant holds on a cold start before RTDB answers', () => {
  const m = load({ seed: { lastUid: 'u1', until_u1: Date.now() + DAY } });
  expect(m.isProGrantActive()).toBe(true);
});

test('sign-out drops Pro; another account on the phone does not get it', () => {
  const m = load({ uid: 'u1' });
  m.startProGrants();
  m.serverSays('u1', { until: Date.now() + DAY, at: Date.now() });
  m.fb.authCb(null);
  expect(m.isProGrantActive()).toBe(false);
  m.fb.authCb({ uid: 'u2' });
  expect(m.isProGrantActive()).toBe(false);
  m.fb.authCb({ uid: 'u1' });
  expect(m.isProGrantActive()).toBe(true);
});

test('Pro ends on time while the app is open', () => {
  jest.useFakeTimers();
  const m = load({ uid: 'u1' });
  const seen = jest.fn();
  m.onProGrantChange(seen);
  m.startProGrants();
  m.serverSays('u1', { until: Date.now() + 60 * 1000, at: Date.now() });
  expect(m.isProGrantActive()).toBe(true);
  seen.mockClear();
  jest.advanceTimersByTime(62 * 1000);
  expect(seen).toHaveBeenCalled();
  expect(m.isProGrantActive()).toBe(false);
});

test('grantPro adds days on top of a running grant; 0 days is lifetime', async () => {
  const m = load();
  const running = Date.now() + 10 * DAY;
  await m.grantPro('u9', 30, running, 'admin1');
  const [, path, val] = m.fb.writes[0];
  expect(path).toBe('pro_grants/u9');
  expect(val.until).toBe(running + 30 * DAY);
  expect(val.by).toBe('admin1');
  await m.grantPro('u9', 0, 0, 'admin1');
  expect(m.fb.writes[1][2].until).toBe(m.LIFETIME_UNTIL);
  await m.revokePro('u9');
  expect(m.fb.writes[2]).toEqual(['remove', 'pro_grants/u9']);
});
