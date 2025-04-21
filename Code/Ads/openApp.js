import { AppOpenAd, AdEventType } from 'react-native-google-mobile-ads';
import getAdUnitId from './ads';

const adUnitId = getAdUnitId('openapp');

class AppOpenAdManager {
  static appOpenAd = AppOpenAd.createForAdRequest(adUnitId);
  static isAdLoaded = false;
  static hasInitialized = false;
  static retryCount = 0;
  static maxRetries = 5;
  static unsubscribeEvents = [];

  static init() {
    if (this.hasInitialized) return;

    // console.log('[AppOpenAdManager] Initializing App Open Ad...');

    const onLoaded = this.appOpenAd.addAdEventListener(AdEventType.LOADED, () => {
      this.isAdLoaded = true;
      this.retryCount = 0;
    //   console.log('[AppOpenAdManager] Ad loaded ✅');
    });

    const onError = this.appOpenAd.addAdEventListener(AdEventType.ERROR, (error) => {
      this.isAdLoaded = false;
    //   console.error('[AppOpenAdManager] Ad failed ❌', error);

      if (this.retryCount < this.maxRetries) {
        const delay = Math.pow(2, this.retryCount) * 1000;
        // console.log(`[AppOpenAdManager] Retrying in ${delay}ms...`);
        setTimeout(() => {
          this.retryCount += 1;
          this.appOpenAd.load();
        }, delay);
      } else {
        // console.warn('[AppOpenAdManager] Max retries reached.');
      }
    });

    const onClosed = this.appOpenAd.addAdEventListener(AdEventType.CLOSED, () => {
    //   console.log('[AppOpenAdManager] Ad closed 👋');
      this.isAdLoaded = false;
      this.appOpenAd.load(); // Preload next
    });

    this.unsubscribeEvents = [onLoaded, onError, onClosed];
    this.appOpenAd.load();
    this.hasInitialized = true;
  }

  static showAd() {
    return new Promise((resolve, reject) => {
      if (!this.hasInitialized) {
        this.init();
      }

      if (this.isAdLoaded) {
        try {
          const unsubscribeClose = this.appOpenAd.addAdEventListener(
            AdEventType.CLOSED,
            () => {
              this.isAdLoaded = false;
              this.appOpenAd.load(); // Preload next
              unsubscribeClose();
              resolve();
            }
          );

          const unsubscribeError = this.appOpenAd.addAdEventListener(
            AdEventType.ERROR,
            (error) => {
              this.isAdLoaded = false;
              unsubscribeError();
              reject(error);
            }
          );

          this.appOpenAd.show();
        } catch (error) {
          reject(error);
        }
      } else {
        resolve(); // Resolve immediately if ad is not loaded
      }
    });
  }

  static cleanup() {
    // console.log('[AppOpenAdManager] Cleaning up listeners');
    this.unsubscribeEvents.forEach((unsubscribe) => unsubscribe());
    this.unsubscribeEvents = [];
    this.hasInitialized = false;
  }
}

export default AppOpenAdManager;
