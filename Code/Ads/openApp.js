import { AppOpenAd, AdEventType } from 'react-native-google-mobile-ads';
import getAdUnitId from './ads';

const adUnitId = getAdUnitId('openapp');

class AppOpenAdManager {
  static appOpenAd = AppOpenAd.createForAdRequest(adUnitId);
  static isAdLoaded = false;
  static hasInitialized = false;
  static hasShownOnce = false;
  static retryCount = 0;
  static maxRetries = 5;
  static unsubscribeEvents = [];

  static initAndShow() {
    if (this.hasInitialized || this.hasShownOnce) return;
    this.hasInitialized = true;

    const onLoaded = this.appOpenAd.addAdEventListener(AdEventType.LOADED, async () => {
      this.isAdLoaded = true;
      this.retryCount = 0;

      if (!this.hasShownOnce) {
        try {
          await this.appOpenAd.show();
          this.hasShownOnce = true;

          // ✅ DO NOT LOAD NEXT AD
          // this.appOpenAd.load(); ❌ REMOVE this line
        } catch (err) {
          // console.warn("Ad show error:", err);
        }
      }
    });

    const onError = this.appOpenAd.addAdEventListener(AdEventType.ERROR, (error) => {
      this.isAdLoaded = false;

      if (this.retryCount < this.maxRetries && !this.hasShownOnce) {
        const delay = Math.pow(2, this.retryCount) * 1000;
        setTimeout(() => {
          this.retryCount += 1;
          this.appOpenAd.load();
        }, delay);
      }
    });

    const onClosed = this.appOpenAd.addAdEventListener(AdEventType.CLOSED, () => {
      this.isAdLoaded = false;
      // ❌ Don’t load again after close
      // this.appOpenAd.load();
    });

    this.unsubscribeEvents = [onLoaded, onError, onClosed];
    this.appOpenAd.load(); // Load once
  }

  static async showAd() {
    if (!this.hasInitialized || this.hasShownOnce) return;

    if (this.isAdLoaded) {
      try {
        await this.appOpenAd.show();
        this.hasShownOnce = true;
        this.isAdLoaded = false;

        // ❌ Don't preload next
        // this.appOpenAd.load();
      } catch (err) {
        // console.warn("Show failed:", err);
      }
    }
  }

  static cleanup() {
    this.unsubscribeEvents.forEach((u) => u());
    this.unsubscribeEvents = [];
    this.hasInitialized = false;
    this.isAdLoaded = false;
    this.hasShownOnce = false;
  }
}

export default AppOpenAdManager;
