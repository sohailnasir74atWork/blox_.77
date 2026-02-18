import { AppOpenAd, AdEventType } from 'react-native-google-mobile-ads';
import getAdUnitId from './ads';

const adUnitId = getAdUnitId('openapp');

class AppOpenAdManager {
  // ✅ Pre-create ad instance at import time so it's ready ASAP
  static appOpenAd = AppOpenAd.createForAdRequest(adUnitId);
  static isAdLoaded = false;
  static hasInitialized = false;
  static hasShownOnce = false;
  static retryCount = 0;
  static maxRetries = 5;
  static unsubscribeEvents = [];
  static retryTimer = null;

  // ✅ Called once on app open (not on bg→fg) — shows ad immediately when loaded
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
        } catch (err) {
          // Show failed silently
        }
      }
    });

    const onError = this.appOpenAd.addAdEventListener(AdEventType.ERROR, () => {
      this.isAdLoaded = false;

      if (this.retryCount < this.maxRetries && !this.hasShownOnce) {
        const delay = Math.pow(2, this.retryCount) * 1000;
        this.retryTimer = setTimeout(() => {
          this.retryCount += 1;
          if (this.appOpenAd) this.appOpenAd.load();
        }, delay);
      }
    });

    const onClosed = this.appOpenAd.addAdEventListener(AdEventType.CLOSED, () => {
      this.isAdLoaded = false;
    });

    this.unsubscribeEvents = [onLoaded, onError, onClosed];
    this.appOpenAd.load();
  }

  static cleanup() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.unsubscribeEvents.forEach((u) => u());
    this.unsubscribeEvents = [];
    this.hasInitialized = false;
    this.isAdLoaded = false;
    this.hasShownOnce = false;
    this.retryCount = 0;
  }
}

export default AppOpenAdManager;
