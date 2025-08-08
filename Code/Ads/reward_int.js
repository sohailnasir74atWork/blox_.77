import { useState, useEffect } from 'react';
import { RewardedInterstitialAd, RewardedAdEventType, TestIds } from 'react-native-google-mobile-ads';

// Use your actual Ad Unit ID or use TestIds for testing
const interstitialAdUnitId = TestIds.REWARDED_INTERSTITIAL; // Or replace with your actual ad unit ID

// Create the rewarded interstitial ad instance
const rewardedInterstitial = RewardedInterstitialAd.createForAdRequest(interstitialAdUnitId, {
  keywords: ['fashion', 'clothing'],
});

export function useAd() {
  const [adLoaded, setAdLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load the ad and track events
  useEffect(() => {
    const unsubscribeLoaded = rewardedInterstitial.addAdEventListener(
      RewardedAdEventType.LOADED,
      () => {
        setAdLoaded(true);
        setIsLoading(false);
      }
    );

    const unsubscribeEarned = rewardedInterstitial.addAdEventListener(
      RewardedAdEventType.EARNED_REWARD,
      (reward) => {
        console.log('User earned reward of', reward);
      }
    );

    // const unsubscribeError = rewardedInterstitial.addAdEventListener(
    //   RewardedAdEventType.ERROR,
    //   (error) => {
    //     setIsLoading(false);
    //     setAdLoaded(false);
    //     console.error('Ad loading failed:', error);
    //   }
    // );

    // Start loading the rewarded interstitial ad
    rewardedInterstitial.load();

    // Cleanup event listeners on unmount
    return () => {
      unsubscribeLoaded();
      unsubscribeEarned();
      unsubscribeError();
    };
  }, []);

  // Function to check if ad is loaded
  const isAdLoaded = () => adLoaded;

  // Function to show the ad
  const showAd = () => {
    if (adLoaded) {
      rewardedInterstitial.show().catch((err) => {
        console.error('Error showing the ad: ', err);
      });
    } else {
      console.log('Ad is not ready yet.');
    }
  };

  return {
    isAdLoaded,
    showAd,
    isLoading,
  };
}
