import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList } from 'react-native';
import { useGlobalState } from '../GlobelStats';
import SignInDrawer from '../Firebase/SigninDrawer';
import UserProfileSection from './RewardScreens/RewardProfile';
import DailyCheckIn from './RewardComponenet/Checkin';
import SocialTasks from './RewardComponenet/SocialMedia';
import AdminSubmissions from './RewardComponenet/Admin';
import { getStyles } from './RewardScreens/rewardstyle';
import CoinStore from './Store/Store';
import config from '../Helper/Environment';
import { get, ref } from '@react-native-firebase/database';
import UserPurchases from './Store/MyPurchases';
import { RewardedIntAd } from '../Ads/reward_int';
import ThreeRewardedAdComponent from './RewardComponenet/ThreeAds';

const RewardCenterScreenWithTabs = ({ selectedTheme }) => {
  const { user, appdatabase, theme, updateLocalStateAndDatabase } = useGlobalState();
  const isDarkMode = theme === 'dark';

  const styles = useMemo(() => getStyles(isDarkMode, config), [isDarkMode]);

  const [activeTab, setActiveTab] = useState('RewardCenter'); // Default active tab

  const [openSingnin, setOpenSignin] = useState(false);
  const [isAdsDrawerVisible, setIsAdsDrawerVisible] = useState(false);
  const [hasClaimed, setHasClaimed] = useState(false);
  const [latestWinner, setLatestWinner] = useState(null);

  useEffect(() => {
    const fetchWinners = async () => {
      try {
        const winnersRef = ref(appdatabase, 'winners');
        const snapshot = await get(winnersRef);
        if (snapshot.exists()) {
          const data = snapshot.val();
          const winnersArray = Object.keys(data).map((key) => ({
            id: key,
            ...data[key],
          }));
          winnersArray.sort((a, b) => new Date(b.date) - new Date(a.date));
          if (winnersArray.length > 0) {
            setLatestWinner(winnersArray[0]);
          }
        }
      } catch (error) {
        console.error("Error fetching winners:", error);
      }
    };

    fetchWinners();
  }, [appdatabase]);

  const handleLoginSuccess = () => {
    setOpenSignin(false);
  };

  const handleClaimReward = () => {
    setHasClaimed(true);
    showSuccessMessage("Success", "Your reward claim has been submitted!");
  };

  return (
    <View style={styles.container}>
      {/* Profile Section */}
      <UserProfileSection
        user={user}
        currentUser={user || null}
        setOpenSignin={setOpenSignin}
        latestWinner={latestWinner}
        handleClaimReward={handleClaimReward}
        styles={styles}
        appdatabase={appdatabase}
        hasClaimed={hasClaimed}
        setHasClaimed={setHasClaimed}
      />

      {/* Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabButtonLeft, activeTab === 'RewardCenter' && styles.activeTab]}
          onPress={() => setActiveTab('RewardCenter')}
        >
          <Text style={[styles.tabText, activeTab === 'RewardCenter' && styles.tabTextActive]}>Reward Center</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButtonRight, activeTab === 'Store' && styles.activeTab]}
          onPress={() => setActiveTab('Store')}
        >
          <Text style={[styles.tabText, activeTab === 'Store' && styles.tabTextActive]}>Store</Text>
        </TouchableOpacity>
      </View>

      {/* Tab Content */}
      {activeTab === 'RewardCenter' && (
        <FlatList
          data={[<DailyCheckIn
            user={user}
            appdatabase={appdatabase}
            updateLocalStateAndDatabase={updateLocalStateAndDatabase}
            isAdsDrawerVisible={isAdsDrawerVisible}
            setIsAdsDrawerVisible={setIsAdsDrawerVisible}
            setOpenSignin={setOpenSignin}
          />,
          <ThreeRewardedAdComponent setOpenSignin={setOpenSignin}/>,
          <SocialTasks
            user={user}
            appdatabase={appdatabase}
            updateLocalStateAndDatabase={updateLocalStateAndDatabase}
            isAdsDrawerVisible={isAdsDrawerVisible}
            setIsAdsDrawerVisible={setIsAdsDrawerVisible}
            setOpenSignin={setOpenSignin}
          />,
          <UserPurchases user={user}/>,
          <AdminSubmissions appdatabase={appdatabase} />
        ]}
          renderItem={({ item }) => item}
          keyExtractor={(item, index) => index.toString()}
          showsVerticalScrollIndicator={false}
        />
       
      )}

      {activeTab === 'Store' && <CoinStore selectedTheme={selectedTheme} />}

      <SignInDrawer
        visible={openSingnin}
        onClose={handleLoginSuccess}
        selectedTheme={selectedTheme}
        message='To participate in rewards you need to sign in'
        screen='Reward'
      />
    </View>
  );
};

export default RewardCenterScreenWithTabs;
