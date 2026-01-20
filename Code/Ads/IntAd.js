// InterstitialAdManager.js - Optimized with A/B Testing & Max Show Rate
import {
  InterstitialAd,
  AdEventType,
} from 'react-native-google-mobile-ads';
import { Platform } from 'react-native';
import getAdUnitId from './ads';
import config from '../Helper/Environment';

// ✅ Two ad unit IDs for A/B testing
const interstitialAdUnitId = getAdUnitId('interstitial');
const gameInterstitialAdUnitId = Platform.OS === 'ios' 
  ? config.gameInterstitialIOS 
  : config.gameInterstitialAndroid;

class InterstitialAdManager {
  // ✅ Two ad instances for A/B testing
  static adA = InterstitialAd.createForAdRequest(interstitialAdUnitId);
  static adB = InterstitialAd.createForAdRequest(gameInterstitialAdUnitId);
  
  static isAdALoaded = false;
  static isAdBLoaded = false;
  static hasInitialized = false;
  static unsubscribeEvents = [];

  static retryCountA = 0;
  static retryCountB = 0;
  static maxRetries = 5;
  
  // ✅ A/B test tracking (50/50 split)
  static abTestCounter = 0;
  
  static init() {
    if (this.hasInitialized) return;

    // ============ AD A (Primary Interstitial) ============
    const onAdALoaded = this.adA.addAdEventListener(
      AdEventType.LOADED,
      () => {
        this.isAdALoaded = true;
        this.retryCountA = 0;
      }
    );

    const onAdAError = this.adA.addAdEventListener(
      AdEventType.ERROR,
      (error) => {
        this.isAdALoaded = false;
        this.retryLoadAdA();
      }
    );

    // ============ AD B (Game/Chat Interstitial) ============
    const onAdBLoaded = this.adB.addAdEventListener(
      AdEventType.LOADED,
      () => {
        this.isAdBLoaded = true;
        this.retryCountB = 0;
      }
    );

    const onAdBError = this.adB.addAdEventListener(
      AdEventType.ERROR,
      (error) => {
        this.isAdBLoaded = false;
        this.retryLoadAdB();
      }
    );

    this.unsubscribeEvents = [onAdALoaded, onAdAError, onAdBLoaded, onAdBError];
    
    // ✅ Load both ads immediately
    this.adA.load();
    this.adB.load();
    
    this.hasInitialized = true;
  }

  // ✅ Retry with shorter delays (1s, 2s, 4s, 8s, 16s) then continue with 30s interval
  static retryLoadAdA() {
    if (this.retryCountA < this.maxRetries) {
      const delay = Math.pow(2, this.retryCountA) * 1000; // 1s, 2s, 4s, 8s, 16s
      setTimeout(() => {
        this.retryCountA += 1;
        this.adA.load();
      }, delay);
    } else {
      // ✅ Continue retrying every 30 seconds (don't give up)
      setTimeout(() => {
        this.retryCountA = 0; // Reset and try again
        this.adA.load();
      }, 30000);
    }
  }

  static retryLoadAdB() {
    if (this.retryCountB < this.maxRetries) {
      const delay = Math.pow(2, this.retryCountB) * 1000;
      setTimeout(() => {
        this.retryCountB += 1;
        this.adB.load();
      }, delay);
    } else {
      setTimeout(() => {
        this.retryCountB = 0;
        this.adB.load();
      }, 30000);
    }
  }

  // ✅ Show ad with A/B testing and fallback
  static showAd(onAdClosedCallback, onAdUnavailableCallback) {
    if (!this.hasInitialized) {
      this.init();
    }

    // ✅ Determine which ad to try first (A/B test: 50/50 split)
    this.abTestCounter += 1;
    const tryAdAFirst = this.abTestCounter % 2 === 0;

    // ✅ Try to show an ad with fallback to the other
    if (tryAdAFirst) {
      if (this.isAdALoaded) {
        this.showAdA(onAdClosedCallback);
        return;
      } else if (this.isAdBLoaded) {
        this.showAdB(onAdClosedCallback);
        return;
      }
    } else {
      if (this.isAdBLoaded) {
        this.showAdB(onAdClosedCallback);
        return;
      } else if (this.isAdALoaded) {
        this.showAdA(onAdClosedCallback);
        return;
      }
    }

    // ✅ Neither ad is ready - call unavailable callback
    if (typeof onAdUnavailableCallback === 'function') {
      onAdUnavailableCallback();
    } else if (typeof onAdClosedCallback === 'function') {
      onAdClosedCallback();
    }

    // ✅ Trigger immediate reload for both ads
    if (!this.isAdALoaded) this.adA.load();
    if (!this.isAdBLoaded) this.adB.load();
  }

  static showAdA(onAdClosedCallback) {
    const unsubscribeClose = this.adA.addAdEventListener(
      AdEventType.CLOSED,
      () => {
        this.isAdALoaded = false;
        this.adA.load(); // Preload next immediately
        
        if (typeof onAdClosedCallback === 'function') {
          onAdClosedCallback();
        }
        unsubscribeClose();
      }
    );

    this.adA.show();
  }

  static showAdB(onAdClosedCallback) {
    const unsubscribeClose = this.adB.addAdEventListener(
      AdEventType.CLOSED,
      () => {
        this.isAdBLoaded = false;
        this.adB.load(); // Preload next immediately
        
        if (typeof onAdClosedCallback === 'function') {
          onAdClosedCallback();
        }
        unsubscribeClose();
      }
    );

    this.adB.show();
  }

  // ✅ Check if any ad is available
  static isReady() {
    return this.isAdALoaded || this.isAdBLoaded;
  }

  // ✅ Force reload both ads (useful after network recovery)
  static forceReload() {
    this.adA.load();
    this.adB.load();
  }

  static cleanup() {
    this.unsubscribeEvents.forEach((unsubscribe) => unsubscribe());
    this.unsubscribeEvents = [];
    this.hasInitialized = false;
    this.isAdALoaded = false;
    this.isAdBLoaded = false;
  }
}

export default InterstitialAdManager;
