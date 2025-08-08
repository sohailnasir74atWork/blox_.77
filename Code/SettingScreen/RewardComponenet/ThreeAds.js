import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useGlobalState } from '../../GlobelStats';
import RewardedAdComponent from './SecondRewardedad';

const ThreeRewardedAdParent = ({setOpenSignin}) => {
  const [adsWatched, setAdsWatched] = useState([false, false, false]); // Track if each ad is watched
  const { user, updateLocalStateAndDatabase, theme } = useGlobalState();
  const isDarkMode = theme === 'dark'

  // Fetch the ads watch state from the user's data on component mount
  useEffect(() => {
    const fetchAdsState = async () => {
      const adsState = user?.dailyAds || [false, false, false]; // Default to [false, false, false] if not available
      setAdsWatched(adsState);
    };

    fetchAdsState();
  }, [user.dailyAds]);

  // Update the ads state in the database whenever it changes
  useEffect(() => {
    if (adsWatched.length) {
        // console.log(adsWatched, 'adwatched')
      updateLocalStateAndDatabase('dailyAds', adsWatched); // Save the updated state in the database
    }
  }, []);

  return (
    <View style={[styles.container, {backgroundColor: isDarkMode ? '#003459' : '#ACE1AF'}]}>
      <Text style={[styles.title, {color : isDarkMode ? 'white' :'black'}]}>Earn Coins by Watching Ads</Text>
      <Text style={[styles.instructions, {color : isDarkMode ? 'white' :'black'}]}>
        Watch up to 3 ads per day and earn 30 coins per ad. Ads will reset at midnight.
      </Text>

      {/* Render RewardedAdComponent to handle showing the ad */}
      <RewardedAdComponent
        adsWatched={adsWatched}
        setAdsWatched={setAdsWatched}
        user={user}
        updateLocalStateAndDatabase={updateLocalStateAndDatabase}
        setOpenSignin={setOpenSignin}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius:12,
    marginBottom:10,
  },
  title: {
    fontSize: 20,
    fontFamily: 'Lato-Bold',
    marginBottom: 10,
  },
  instructions: {
    fontSize: 14,
    marginBottom: 20,
    textAlign: 'center',
    fontFamily:'Lato-Regular'
  },
});

export default ThreeRewardedAdParent;
