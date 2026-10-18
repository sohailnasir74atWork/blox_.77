import { reportBannerHeight } from '../Code/Ads/bannerHeight';
import { bannerAware, aboveBanner, aboveChatInputAndBanner, BANNER_HEIGHT, FLOATING_BUTTON_GAP, ABOVE_BANNER, ABOVE_CHAT_INPUT_AND_BANNER } from '../Code/Helper/floatingButtonLayout';

describe('banner-height-aware floating buttons', () => {
  test('defaults equal the old fixed offsets', () => {
    expect(aboveBanner()).toBe(ABOVE_BANNER);
    expect(aboveChatInputAndBanner()).toBe(ABOVE_CHAT_INPUT_AND_BANNER);
    expect(bannerAware(ABOVE_BANNER, false)).toBe(ABOVE_BANNER);
    expect(bannerAware(ABOVE_BANNER, true)).toBe(FLOATING_BUTTON_GAP);
  });

  test('a 128dp large banner lifts the buttons by the difference', () => {
    expect(aboveBanner(128)).toBe(128 + FLOATING_BUTTON_GAP);
    expect(aboveChatInputAndBanner(128)).toBe(ABOVE_CHAT_INPUT_AND_BANNER + 128 - BANNER_HEIGHT);
    expect(bannerAware(aboveBanner(128), false, 128)).toBe(148);
    // Pro members have no banner: back to the plain gap whatever the size.
    expect(bannerAware(aboveBanner(128), true, 128)).toBe(FLOATING_BUTTON_GAP);
  });

  test('reportBannerHeight ignores zero/negative heights', () => {
    expect(() => reportBannerHeight(0)).not.toThrow();
    expect(() => reportBannerHeight(-5)).not.toThrow();
    expect(() => reportBannerHeight(127.6)).not.toThrow();
  });
});
