import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, Alert } from 'react-native';
import { RewardedAd, RewardedAdEventType, AdEventType } from 'react-native-google-mobile-ads';
import { ref, get, update } from '@react-native-firebase/database';
import {  showErrorMessage, showWarningMessage } from '../../Helper/MessageHelper';
import { getStyles } from '../settingstyle';
import getAdUnitId from '../../Ads/ads';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../../GlobelStats';

const adUnitId = getAdUnitId('rewarded');
const rewardedAd = RewardedAd.createForAdRequest(adUnitId, {
  requestNonPersonalizedAdsOnly: true,
});

let adListenersAttached = false;
let isCoolingDown = false;
const COOLDOWN_MS = 40 * 1000; // 1 minute cooldown

const RewardedAdComponent = ({
  user,
  appdatabase,
  updateLocalStateAndDatabase,
  isAdsDrawerVisible,
  setIsAdsDrawerVisible,
}) => {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  const [lastRewardTime, setLastRewardTime] = useState(user?.lastRewardtime || 0);
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  useEffect(() => {
    if (!adListenersAttached) {
      rewardedAd.addAdEventListener(RewardedAdEventType.LOADED, () => {
        setLoaded(true);
      });

      rewardedAd.addAdEventListener(RewardedAdEventType.EARNED_REWARD, async () => {
        await updateUserPoints(user?.id, 100);
        const now = Date.now();
        updateLocalStateAndDatabase('lastRewardtime', now);
        setLastRewardTime(now);
        Alert.alert(t('settings.reward_granted'), t('settings.reward_granted_message'));
      });

      rewardedAd.addAdEventListener(AdEventType.CLOSED, () => {
        setLoaded(false);
        isCoolingDown = true;
        setTimeout(() => {
          isCoolingDown = false;
          if (!rewardedAd.loaded) rewardedAd.load();
        }, COOLDOWN_MS);
      });

      adListenersAttached = true;
    }

    if (!loaded && !isCoolingDown && !rewardedAd.loaded) {
      rewardedAd.load();
    }
  }, [user?.id]);

  const getUserPoints = async (userId) => {
    if (!userId) return 0;
    try {
      const snapshot = await get(ref(appdatabase, `/users/${userId}/rewardPoints`));
      return snapshot.exists() ? snapshot.val() : 0;
    } catch (error) {
      return 0;
    }
  };

  const updateUserPoints = async (userId, pointsToAdd) => {
    if (!userId) return;
    try {
      const latestPoints = await getUserPoints(userId);
      const newPoints = latestPoints + pointsToAdd;
      await update(ref(appdatabase, `/users/${userId}`), { rewardPoints: newPoints });
      updateLocalStateAndDatabase('rewardPoints', newPoints);
    } catch (error) {}
  };

  const showAd = async () => {
    setIsAdsDrawerVisible(false)
    const now = Date.now();
    const remainingMs = COOLDOWN_MS - (now - lastRewardTime);

    if (remainingMs > 0) {
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      const mins = Math.floor(remainingSeconds / 60);
      const secs = remainingSeconds % 60;
      const formatted = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

      showWarningMessage(
        t('settings.not_eligible_for_reward'),
        `Ad will be available in ${formatted}`
      );
      return;
    }

    if (loaded) {
      try {
        await rewardedAd.show();
      } catch (err) {
        showErrorMessage(
          t('settings.ad_not_ready'),
          ''
        );
      }
    } else {
      showErrorMessage(
        t('settings.ad_not_ready'),
        ''
      );
    }
  };

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={isAdsDrawerVisible}
    >
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