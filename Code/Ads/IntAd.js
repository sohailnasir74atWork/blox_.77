// InterstitialAdManager.js
import {
  InterstitialAd,
  AdEventType,
} from 'react-native-google-mobile-ads';

import getAdUnitId from './ads';

const interstitialAdUnitId = getAdUnitId('interstitial');


class InterstitialAdManager {
  static interstitialAd = InterstitialAd.createForAdRequest(interstitialAdUnitId);
  static isAdLoaded = false;
  static hasInitialized = false;
  static unsubscribeEvents = [];

  static retryCount = 0;
  static maxRetries = 5;
  
  static init() {
    if (this.hasInitialized) return;
  
    // console.log('[AdManager] Initializing interstitial...');
  
    const onAdLoaded = this.interstitialAd.addAdEventListener(
      AdEventType.LOADED,
      () => {
        this.isAdLoaded = true;
        this.retryCount = 0; // Reset on success
        // console.log('[AdManager] Interstitial ad loaded ✅');
      }
    );
  
    const onAdError = this.interstitialAd.addAdEventListener(
      AdEventType.ERROR,
      (error) => {
        this.isAdLoaded = false;
        console.error('[AdManager] Ad failed to load ❌', error);
  
        if (this.retryCount < this.maxRetries) {
          const delay = Math.pow(2, this.retryCount) * 1000; // 1s, 2s, 4s, etc.
          // console.log(`[AdManager] Retrying to load ad in ${delay}ms...`);
          setTimeout(() => {
            this.retryCount += 1;
            this.interstitialAd.load();
          }, delay);
        } else {
          console.warn('[AdManager] Max retry limit reached. Will not retry further.');
        }
      }
    );
  
    this.unsubscribeEvents = [onAdLoaded, onAdError];
    this.interstitialAd.load();
    this.hasInitialized = true;
  }
  
  

  static showAd(onAdClosedCallback, onAdUnavailableCallback) {
    if (!this.hasInitialized) {
      console.warn('[AdManager] AdManager not initialized. Calling init...');
      this.init();
    }
  
    if (this.isAdLoaded) {
      // console.log('[AdManager] Showing interstitial ad 🚀');
  
      const unsubscribeClose = this.interstitialAd.addAdEventListener(
        AdEventType.CLOSED,
        () => {
          // console.log('[AdManager] Interstitial ad closed 👋');
          this.isAdLoaded = false;
          this.interstitialAd.load(); // Preload next
  
          if (typeof onAdClosedCallback === 'function') {
            onAdClosedCallback();
            // console.log('function is executing');
          }
          unsubscribeClose(); // Clean up
        }
      );
  
      this.interstitialAd.show();
    } else {
      // console.log('[AdManager] Ad not ready yet, skipping 💤');
      if (typeof onAdUnavailableCallback === 'function') {
        onAdUnavailableCallback(); // Optional callback for fallback
      } else if (typeof onAdClosedCallback === 'function') {
        onAdClosedCallback(); // Fallback: proceed without ad
      }
    }
  }
  
  

  static cleanup() {
    // console.log('[AdManager] Cleaning up ad event listeners');
    this.unsubscribeEvents.forEach((unsubscribe) => unsubscribe());
    this.unsubscribeEvents = [];
    this.hasInitialized = false;
  }
}

export default InterstitialAdManager;
