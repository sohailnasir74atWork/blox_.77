// proOfferings.js — which offering each step of the offer wall shows.
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: { getOfferings: jest.fn(), checkTrialOrIntroductoryPriceEligibility: jest.fn() },
}));

const Purchases = require('react-native-purchases').default;
const {
  loadWallOfferings, fullWallPackages, exitWallPackages, isNewPricing,
  trialEligibility, matchByPeriod,
} = require('../Code/SettingScreen/proOfferings');

const pkg = (id, type, price) => ({ identifier: id, packageType: type, product: { identifier: id, price } });
const offering = (...pkgs) => ({ availablePackages: pkgs });

const FULL = offering(pkg('full_1m', 'MONTHLY', 9.99), pkg('full_1y', 'ANNUAL', 49.99));
const EXIT = offering(pkg('off_1m', 'MONTHLY', 4.99), pkg('off_1y', 'ANNUAL', 24.99));
const OLD = offering(pkg('old_1m', 'MONTHLY', 1.99));

describe('fullWallPackages', () => {
  test('new prices when pro_full exists', () => {
    expect(fullWallPackages({ pro_full: FULL, default: OLD }).map((p) => p.identifier)).toEqual(['full_1m', 'full_1y']);
  });
  test('falls back to default, then to what the app loaded', () => {
    expect(fullWallPackages({ default: OLD }).map((p) => p.identifier)).toEqual(['old_1m']);
    expect(fullWallPackages({}, [pkg('launch', 'MONTHLY', 1)]).map((p) => p.identifier)).toEqual(['launch']);
    expect(fullWallPackages({ pro_full: offering() }, null)).toEqual([]);
  });
});

describe('exit offer', () => {
  test('only offered on the new prices', () => {
    expect(isNewPricing({ pro_full: FULL })).toBe(true);
    expect(isNewPricing({ default: OLD })).toBe(false);
    expect(isNewPricing(null)).toBe(false);
  });
  test('reads pro_offer', () => {
    expect(exitWallPackages({ pro_offer: EXIT }).map((p) => p.identifier)).toEqual(['off_1m', 'off_1y']);
    expect(exitWallPackages({})).toEqual([]);
  });
  test('was-price lookup matches the same billing period', () => {
    const byType = matchByPeriod(FULL.availablePackages, (p) => p.packageType);
    expect(byType.MONTHLY.product.price).toBe(9.99);
    expect(byType.ANNUAL.product.price).toBe(49.99);
    expect(byType.THREE_MONTH).toBeUndefined();
  });
});

describe('loadWallOfferings', () => {
  test('returns offerings.all and reuses it when the SDK fails', async () => {
    Purchases.getOfferings.mockResolvedValueOnce({ all: { pro_full: FULL } });
    expect(Object.keys(await loadWallOfferings())).toEqual(['pro_full']);
    Purchases.getOfferings.mockRejectedValueOnce(new Error('offline'));
    expect(Object.keys(await loadWallOfferings())).toEqual(['pro_full']);
  });
});

describe('trialEligibility (iOS)', () => {
  test('only status 2 (ELIGIBLE) counts', async () => {
    Purchases.checkTrialOrIntroductoryPriceEligibility.mockResolvedValueOnce({
      full_1m: { status: 2 }, full_1y: { status: 1 },
    });
    expect(await trialEligibility(FULL.availablePackages)).toEqual({ full_1m: true, full_1y: false });
  });
  test('an SDK error promises no trial', async () => {
    Purchases.checkTrialOrIntroductoryPriceEligibility.mockRejectedValueOnce(new Error('x'));
    expect(await trialEligibility(FULL.availablePackages)).toEqual({});
  });
});
