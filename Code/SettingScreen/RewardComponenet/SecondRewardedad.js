import React, { useEffect, useState, useRef } from 'react';
import { TouchableOpacity, Text, View } from 'react-native';
import { RewardedAd, RewardedAdEventType, AdEventType } from 'react-native-google-mobile-ads';
import { showMessage } from 'react-native-flash-message';
import getAdUnitId from '../../Ads/ads';
import { useGlobalState } from '../../GlobelStats';

const adUnitId = getAdUnitId('rewarded');

const RewardedAdComponent = ({ adsWatched, setAdsWatched, user, updateLocalStateAndDatabase, setOpenSignin }) => {
  const [loaded, setLoaded] = useState(false);
  const { theme } = useGlobalState();
  const rewardedAdRef = useRef(null);
  const isDarkMode = theme === 'dark';

  useEffect(() => {
    // Clean up ad when the component is unmounted or reloaded
    return () => {
      if (rewardedAdRef.current) rewardedAdRef.current = null;
    };
  }, []);
  useEffect(()=>{if(user.id){loadAd()} },[user.id])

  // Function to load the ad when the button is pressed
  const loadAd = () => {
    const newAd = RewardedAd.createForAdRequest(adUnitId, {
      requestNonPersonalizedAdsOnly: true,
    });

    rewardedAdRef.current = newAd;

    newAd.addAdEventListener(RewardedAdEventType.LOADED, () => {
      setLoaded(true); // Ad is loaded
    });

    newAd.addAdEventListener(RewardedAdEventType.EARNED_REWARD, async () => {
      const reward = 30; // 30 coins per ad
      await grantCoinsDirectly(reward); // Grant coins to user
    });

    newAd.addAdEventListener(AdEventType.CLOSED, () => {
      setLoaded(false); // Ad closed, set loaded to false
    });

    newAd.addAdEventListener(AdEventType.ERROR, (error) => {
      // console.log("Error occurred while loading the ad:", error);
      setLoaded(false);
      // showMessage({
      //   message: "Failed to load ad. Please try again later.",
      //   type: "error",
      //   icon: "error",
      // });
    });

    newAd.load(); // Load the ad
  };

  // Function to grant coins directly to the user
  const grantCoinsDirectly = async (reward) => {
    const coins = reward || 5;
    let currentCoins = user?.coins || 0;
    currentCoins += coins;

    await updateLocalStateAndDatabase('coins', currentCoins); // Save coins to the user

    showMessage({
      message: `You earned ${coins} coins!`,
      type: 'success',
      icon: 'success',
    });

    // Mark this ad as watched after the reward is granted
    const updatedAds = [...adsWatched];
    const adIndex = adsWatched.findIndex((ad) => ad === false);
    if (adIndex !== -1) {
      updatedAds[adIndex] = true; // Mark this ad as watched
    }
    setAdsWatched(updatedAds);
    updateLocalStateAndDatabase('dailyAds', updatedAds);
  };

  // Show the ad when the button is pressed
  const showAd = (index) => {
    if (!user?.id) return setOpenSignin(true);
    if (adsWatched[index]) {
      showMessage({
        message: "You've already watched this ad today.",
        type: "info",
        icon: "info",
        backgroundColor: "#FF5722",
        color: 'white',
      });
      return;
    }

    // If the ad is loaded, show it, else load it first
    if (rewardedAdRef.current?.loaded) {
      rewardedAdRef.current.show();
    } else {
      loadAd(); // Load the ad first if it's not already loaded
      showMessage({
        message: "Ad not loaded yet, please try again.",
        type: "warning",
        icon: "warning",
      });
    }
  };

  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-evenly', width: '100%', flexWrap: 'wrap' }}>
      {adsWatched.slice(0, 3).map((watched, index) => (
      <TouchableOpacity
      key={index}
      style={{
        marginBottom: 20,
        backgroundColor: watched ? 'gray' : '#4CAF50',
        padding: 10,
        borderRadius: 12,
        width: 120,
        justifyContent: 'center',
        alignItems: 'center', // Ensure content is centered horizontally
      }}
      onPress={() => showAd(index)}
    >
      <Text
        style={{
          color: isDarkMode ? 'white' : 'black',
          textAlign: 'center', // Center the text horizontally
          fontFamily:'Lato-Regular',
          fontSize:12
        }}
      >
        {watched ? `Ad ${index + 1} Watched` : `Watch Ad ${index + 1} ${'\n'}(Earn 5 Coins)`}
      </Text>
    </TouchableOpacity>
    
      ))}
    </View>
  );
};

export default RewardedAdComponent;
