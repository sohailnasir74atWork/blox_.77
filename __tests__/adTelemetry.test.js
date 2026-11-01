jest.mock('@react-native-firebase/crashlytics', () => ({ getCrashlytics: jest.fn(), log: jest.fn() }));
jest.mock('../Code/Helper/growthAnalytics', () => ({ trackGrowthEvent: jest.fn() }));

const { trackGrowthEvent } = require('../Code/Helper/growthAnalytics');
const { startAdAttempt, logAdRevenue } = require('../Code/Ads/adTelemetry');

const names = () => trackGrowthEvent.mock.calls.map(([name]) => name);
const params = (name) => trackGrowthEvent.mock.calls.find(([n]) => n === name)[1];

beforeEach(() => trackGrowthEvent.mockClear());

describe('startAdAttempt', () => {
  it('logs request → shown → clicked → closed with placement and unit', () => {
    const a = startAdAttempt('interstitial', 'trade_post', 'tradePost', 'ca-app-pub-1/2');
    a.shown();
    a.clicked();
    a.clicked();
    a.closed();
    a.closed();
    expect(names()).toEqual(['ad_show_request', 'ad_shown', 'ad_clicked', 'ad_closed']);
    expect(params('ad_shown')).toMatchObject({
      ad_format: 'interstitial', placement: 'trade_post', ad_unit: 'tradePost', ad_unit_id: 'ca-app-pub-1/2',
    });
    expect(params('ad_closed').clicked).toBe(1);
  });

  it('ends in exactly one outcome', () => {
    const a = startAdAttempt('interstitial', 'review', 'interstitial', 'x');
    a.skip('cooldown');
    a.shown();
    a.skip('watchdog');
    a.clicked();
    a.closed();
    expect(names()).toEqual(['ad_show_request', 'ad_not_shown']);
    expect(params('ad_not_shown').reason).toBe('cooldown');
  });

  it('a failed present after load is not_shown with the cause', () => {
    const a = startAdAttempt('rewarded', 'mini_game', 'rewarded', 'x');
    a.skip('show_failed:show rejected!');
    expect(params('ad_not_shown').reason).toBe('show_failed:show_rejected_');
  });

  it('reward only counts on a shown ad', () => {
    const a = startAdAttempt('rewarded', 'mystery_egg', 'rewarded', 'x');
    a.rewarded();
    a.shown();
    a.rewarded();
    expect(names()).toEqual(['ad_show_request', 'ad_shown', 'ad_reward_earned']);
  });
});

describe('logAdRevenue', () => {
  it('prefers valueMicros and tags the unit', () => {
    logAdRevenue('interstitial', 'feed_post', { valueMicros: 12500, value: 9, currency: 'EUR', precision: 2 }, 'ca-app-pub-1/2', 'feedPost');
    expect(params('ad_paid')).toMatchObject({
      value: 0.0125, currency: 'EUR', placement: 'feed_post', ad_unit: 'feedPost', ad_unit_id: 'ca-app-pub-1/2',
    });
  });

  it('ignores a missing paid event', () => {
    logAdRevenue('banner', 'banner', null, 'x');
    expect(trackGrowthEvent).not.toHaveBeenCalled();
  });
});
