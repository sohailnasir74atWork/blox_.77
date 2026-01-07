// GameInterstitialAdManager.js - Game-specific interstitial ads
import {
  InterstitialAd,
  AdEventType,
} from 'react-native-google-mobile-ads';
import { Platform } from 'react-native';
import config from '../Helper/Environment';

// Game-specific ad unit IDs
const gameInterstitialAdUnitId = Platform.OS === 'ios' 
  ? config.gameInterstitialIOS 
  : config.gameInterstitialAndroid;

class GameInterstitialAdManager {
  static interstitialAd = InterstitialAd.createForAdRequest(gameInterstitialAdUnitId);
  static isAdLoaded = false;
  static hasInitialized = false;
  static unsubscribeEvents = [];

  static retryCount = 0;
  static maxRetries = 5;
  
  static init() {
    if (this.hasInitialized) return;

    const onAdLoaded = this.interstitialAd.addAdEventListener(
      AdEventType.LOADED,
      () => {
        this.isAdLoaded = true;
        this.retryCount = 0; // Reset on success
      }
    );

    const onAdError = this.interstitialAd.addAdEventListener(
      AdEventType.ERROR,
      (error) => {
        this.isAdLoaded = false;

        if (this.retryCount < this.maxRetries) {
          const delay = Math.pow(2, this.retryCount) * 1000; // 1s, 2s, 4s, etc.
          setTimeout(() => {
            this.retryCount += 1;
            this.interstitialAd.load();
          }, delay);
        }
      }
    );

    this.unsubscribeEvents = [onAdLoaded, onAdError];
    this.interstitialAd.load();
    this.hasInitialized = true;
  }

  static showAd(onAdClosedCallback, onAdUnavailableCallback) {
    if (!this.hasInitialized) {
      this.init();
    }

    if (this.isAdLoaded) {
      const unsubscribeClose = this.interstitialAd.addAdEventListener(
        AdEventType.CLOSED,
        () => {
          this.isAdLoaded = false;
          this.interstitialAd.load(); // Preload next

          if (typeof onAdClosedCallback === 'function') {
            onAdClosedCallback();
          }
          unsubscribeClose(); // Clean up
        }
      );

      this.interstitialAd.show();
    } else {
      if (typeof onAdUnavailableCallback === 'function') {
        onAdUnavailableCallback(); // Optional callback for fallback
      } else if (typeof onAdClosedCallback === 'function') {
        onAdClosedCallback(); // Fallback: proceed without ad
      }
    }
  }

  static cleanup() {
    this.unsubscribeEvents.forEach((unsubscribe) => unsubscribe());
    this.unsubscribeEvents = [];
    this.hasInitialized = false;
  }
}

export default GameInterstitialAdManager;

