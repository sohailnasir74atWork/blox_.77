// Store review prompt at success moments (Code/AppHelper/reviewPrompt.js).
// Each test loads a fresh copy of the module with its own fake MMKV, ad state
// and InAppReview.

const DAY = 24 * 60 * 60 * 1000;

function load({ seed = {}, adVisible = false, msSinceAd = Infinity, available = true } = {}) {
  const store = new Map(Object.entries(seed));
  const review = { calls: 0 };
  jest.resetModules();
  jest.doMock('react-native-mmkv', () => ({
    createMMKV: () => ({
      getString: (k) => store.get(k),
      set: (k, v) => store.set(k, v),
    }),
  }));
  jest.doMock('react-native', () => ({ AppState: { currentState: 'active' } }));
  jest.doMock('react-native-in-app-review', () => ({
    isAvailable: () => available,
    RequestInAppReview: () => {
      review.calls += 1;
      return Promise.resolve(true);
    },
  }));
  jest.doMock('../Code/Ads/adVisibility', () => ({
    isFullScreenAdVisible: () => adVisible,
    msSinceAnyFullScreenAd: () => msSinceAd,
  }));
  const mod = require('../Code/AppHelper/reviewPrompt');
  return { ...mod, store, review };
}

// A returning user: 3 active days already counted, opened today.
const returning = (extra = {}) => ({
  'reviewPrompt.activeDays': '3',
  ...extra,
});

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('asks after a one-off success moment for a returning user', () => {
  const m = load({ seed: returning() });
  m.maybeAskForReview('trade_logged');
  expect(m.review.calls).toBe(0); // waits for the toast first
  jest.advanceTimersByTime(1500);
  expect(m.review.calls).toBe(1);
  expect(Number(m.store.get('reviewPrompt.lastAskAt'))).toBeGreaterThan(0);
});

test('does not ask a user with fewer than 3 active days', () => {
  const m = load({ seed: { 'reviewPrompt.activeDays': '2' } });
  m.maybeAskForReview('wishlist_got_it');
  jest.advanceTimersByTime(5000);
  expect(m.review.calls).toBe(0);
});

test('does not ask within 90 days of the last ask', () => {
  const m = load({ seed: returning({ 'reviewPrompt.lastAskAt': String(Date.now() - 30 * DAY) }) });
  m.maybeAskForReview('trade_logged');
  jest.advanceTimersByTime(5000);
  expect(m.review.calls).toBe(0);
});

test('does not ask while an ad is on screen or within 60 s of one', () => {
  const a = load({ seed: returning(), adVisible: true });
  a.maybeAskForReview('trade_logged');
  jest.advanceTimersByTime(5000);
  expect(a.review.calls).toBe(0);

  const b = load({ seed: returning(), msSinceAd: 20 * 1000 });
  b.maybeAskForReview('trade_logged');
  jest.advanceTimersByTime(5000);
  expect(b.review.calls).toBe(0);
});

test('calculator asks on the 5th check of a session, not before', () => {
  const m = load({ seed: returning() });
  for (let i = 0; i < 4; i += 1) m.maybeAskForReview('calculator');
  jest.advanceTimersByTime(5000);
  expect(m.review.calls).toBe(0);
  m.maybeAskForReview('calculator');
  jest.advanceTimersByTime(1500);
  expect(m.review.calls).toBe(1);
});

test('collection asks on the 3rd add ever, counted across launches', () => {
  const m = load({ seed: returning({ 'reviewPrompt.collectionAdds': '1' }) });
  m.maybeAskForReview('collection');
  jest.advanceTimersByTime(5000);
  expect(m.review.calls).toBe(0);
  m.maybeAskForReview('collection');
  jest.advanceTimersByTime(1500);
  expect(m.review.calls).toBe(1);
});

test('two moments close together make one request', () => {
  const m = load({ seed: returning() });
  m.maybeAskForReview('trade_logged');
  m.maybeAskForReview('wishlist_got_it');
  jest.advanceTimersByTime(5000);
  expect(m.review.calls).toBe(1);
});

test('active days count once per day; old launch counter seeds existing users', () => {
  const fresh = load();
  fresh.noteReviewActiveDay();
  fresh.noteReviewActiveDay();
  expect(fresh.store.get('reviewPrompt.activeDays')).toBe('1');

  const existing = load({ seed: { reviewCount: '40' } });
  existing.noteReviewActiveDay();
  expect(existing.store.get('reviewPrompt.activeDays')).toBe('3');
});
