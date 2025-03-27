import { AppOpenAd, AdEventType, TestIds } from 'react-native-google-mobile-ads';

const adUnitId = __DEV__ ? TestIds.APP_OPEN : 'ca-app-pub-xxxxxxxxxxxxx/yyyyyyyyyyyyyy';

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
      console.error('[AppOpenAdManager] Ad failed ❌', error);

      if (this.retryCount < this.maxRetries) {
        const delay = Math.pow(2, this.retryCount) * 1000;
        // console.log(`[AppOpenAdManager] Retrying in ${delay}ms...`);
        setTimeout(() => {
          this.retryCount += 1;
          this.appOpenAd.load();
        }, delay);
      } else {
        console.warn('[AppOpenAdManager] Max retries reached.');
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
    if (this.isAdLoaded) {
    //   console.log('[AppOpenAdManager] Showing app open ad 🚀');
      this.appOpenAd.show();
    } else {
    //   console.log('[AppOpenAdManager] Ad not ready yet 💤');
    }
  }

  static cleanup() {
    // console.log('[AppOpenAdManager] Cleaning up listeners');
    this.unsubscribeEvents.forEach((unsubscribe) => unsubscribe());
    this.unsubscribeEvents = [];
    this.hasInitialized = false;
  }
}

export default AppOpenAdManager;
