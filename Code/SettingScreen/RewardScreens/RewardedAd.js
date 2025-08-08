import React, { useEffect, useState, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, Alert } from 'react-native';
import {
  RewardedAd,
  RewardedAdEventType,
  AdEventType,
} from 'react-native-google-mobile-ads';
import { ref, get, update } from '@react-native-firebase/database';
import { showErrorMessage, showWarningMessage } from '../../Helper/MessageHelper';
import { getStyles } from '../settingstyle';
import getAdUnitId from '../../Ads/ads';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../../GlobelStats';
import { showMessage } from 'react-native-flash-message';

const adUnitId = getAdUnitId('rewarded');

const RewardedAdComponent = ({
  user,
  appdatabase,
  isAdsDrawerVisible,
  setIsAdsDrawerVisible,
  handleAdComplete,
  pendingCoinReward
}) => {
  const { t } = useTranslation();
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  const [loaded, setLoaded] = useState(false);
  const [lastRewardTime, setLastRewardTime] = useState(user?.lastRewardtime || 0);
  const rewardedAdRef = useRef(null);

  const loadRewardedAd = () => {
    const newAd = RewardedAd.createForAdRequest(adUnitId, {
      requestNonPersonalizedAdsOnly: true,
    });

    rewardedAdRef.current = newAd;

    newAd.addAdEventListener(RewardedAdEventType.LOADED, () => {
      setLoaded(true);
    });

    newAd.addAdEventListener(RewardedAdEventType.EARNED_REWARD, async () => {
      const reward = pendingCoinReward?.coins || 5;
      // await updateUserPoints(user?.id, reward);

      const now = Date.now();

      if (handleAdComplete) handleAdComplete();
      showMessage({
        message: `You earned ${reward} coins!`,  // Corrected the message syntax
        type: "success",  // Use lowercase for the type
        icon: "success",  // Use lowercase for the icon
        // backgroundColor: config.colors.hasBlockGreen,  // Customize color if needed
        // color: 'white',  // Customize text color if needed
    });
    
      // Alert.alert(t('settings.reward_granted'), `You earned ${reward} coins!`);
    });

    newAd.addAdEventListener(AdEventType.CLOSED, () => {
      setLoaded(false);
      loadRewardedAd();
    });

    newAd.addAdEventListener(AdEventType.ERROR, () => {
      setLoaded(false);
      setTimeout(() => loadRewardedAd(), 1000);
    });

    newAd.load();
  };

  useEffect(() => {
    loadRewardedAd();
    return () => {
      if (rewardedAdRef.current) rewardedAdRef.current = null;
    };
  }, [user?.id]);

  // const getUserPoints = async (userId) => {
  //   if (!userId) return 0;
  //   try {
  //     const snapshot = await get(ref(appdatabase, `/users/${userId}/rewardPoints`));
  //     return snapshot.exists() ? snapshot.val() : 0;
  //   } catch {
  //     return 0;
  //   }
  // };

  // const updateUserPoints = async (userId, pointsToAdd) => {
  //   if (!userId) return;
  //   try {
  //     const latestPoints = await getUserPoints(userId);
  //     const newPoints = latestPoints + pointsToAdd;
  //     await update(ref(appdatabase, `/users/${userId}`), { rewardPoints: newPoints });
  //     updateLocalStateAndDatabase('rewardPoints', newPoints);
  //   } catch (error) {
  //     console.error('Error updating points:', error);
  //   }
  // };
  const showAd = async () => {
    const now = Date.now();
    const remainingMs = 30 * 1000 - (now - lastRewardTime);
  
    if (remainingMs > 0) {
      const seconds = Math.ceil(remainingMs / 1000);
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
  
      showWarningMessage(
        t('settings.not_eligible_for_reward'),
        `Ad will be available in ${mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}`
      );
      return;
    }
  
    const reward = pendingCoinReward?.coins || 5;
  
    const grantCoinsDirectly = async () => {
      const userRef = ref(appdatabase, `/users/${user?.id}/coins`);
      const currentSnapshot = await get(userRef);
      const currentCoins = currentSnapshot.exists() ? currentSnapshot.val() : 0;
      await update(ref(appdatabase, `/users/${user?.id}`), {
        coins: currentCoins + reward,
        lastRewardtime: Date.now(),
      });
      if (handleAdComplete) handleAdComplete();
      Alert.alert(t('settings.reward_granted'), `You earned ${reward} coins!`);
    };
  
    if (rewardedAdRef.current?.loaded) {
      try {
        setTimeout(() => {
          rewardedAdRef.current.show();
        }, 150); // allow state to stabilize
      } catch {
        await grantCoinsDirectly();
      }
    } else {
      await grantCoinsDirectly();
    }
  };
  

  return (
    <Modal animationType="slide" transparent={true} visible={isAdsDrawerVisible}>
      <Pressable style={styles.overlay} onPress={() => setIsAdsDrawerVisible(false)} />
      <View style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <View style={styles.drawer}>
          <Text style={styles.drawerSubtitle}>{t('settings.watch_ad')}</Text>
          <Text style={styles.rewardDescription}>{t('settings.watch_ad_message')}</Text>
          <TouchableOpacity style={styles.saveButton} onPress={showAd}>
            <Text style={styles.saveButtonText}>{t('settings.earn_reward')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

export default RewardedAdComponent;
