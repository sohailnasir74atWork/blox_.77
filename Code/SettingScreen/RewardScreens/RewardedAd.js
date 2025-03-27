import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, Alert } from 'react-native';
import { RewardedAd, RewardedAdEventType, AdEventType } from 'react-native-google-mobile-ads';
import { ref, get, update } from '@react-native-firebase/database';
import { showMessage } from 'react-native-flash-message';
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

const RewardedAdComponent = ({
  user,
  appdatabase,
  updateLocalStateAndDatabase,
  isAdsDrawerVisible,
  setIsAdsDrawerVisible,
}) => {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  useEffect(() => {
    if (!adListenersAttached) {
      rewardedAd.addAdEventListener(RewardedAdEventType.LOADED, () => {
        setLoaded(true);
        // console.log('[RewardedAd] Ad loaded ✅');
      });

      rewardedAd.addAdEventListener(RewardedAdEventType.EARNED_REWARD, async () => {
        // console.log('[RewardedAd] Reward earned 🎁');
        await updateUserPoints(user?.id, 100);
        updateLocalStateAndDatabase('lastRewardtime', Date.now());
        Alert.alert(t('settings.reward_granted'), t('settings.reward_granted_message'));
      });

      rewardedAd.addAdEventListener(AdEventType.CLOSED, () => {
        // console.log('[RewardedAd] Ad closed 👋');
        setLoaded(false);
        isCoolingDown = true;

        // Cooldown for 2 minutes
        setTimeout(() => {
          isCoolingDown = false;
        //   console.log('[RewardedAd] Cooldown ended. Reloading ad.');
          rewardedAd.load();
        }, 5 * 60 * 1000); // 2 mins
      });

      adListenersAttached = true;
    }

    if (!loaded && !isCoolingDown) {
    //   console.log('[RewardedAd] Initial load attempt...');
      rewardedAd.load();
    }
  }, [user?.id]);

  const getUserPoints = async (userId) => {
    if (!userId) return 0;
    try {
      const snapshot = await get(ref(appdatabase, `/users/${userId}/rewardPoints`));
      return snapshot.exists() ? snapshot.val() : 0;
    } catch (error) {
    //   console.error('[RewardedAd] Error fetching points:', error);
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
    } catch (error) {
    //   console.error('[RewardedAd] Error updating points:', error);
    }
  };

  const canClaimReward = () => {
    const now = Date.now();
    const last = user?.lastRewardtime;
    return !last || (now - last >= 5 * 60 * 1000); // 2 minutes cooldown
  };

  const showAd = async () => {
    // setIsAdsDrawerVisible(false);

    const now = Date.now();
  const last = user?.lastRewardtime || 0;
  const cooldown = 5 * 60 * 1000; // 2 mins in ms
  const remainingMs = cooldown - (now - last);

  if (remainingMs > 0) {
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;

    const formatted = mins > 0
      ? `${mins}m ${secs}s`
      : `${secs}s`;

    showMessage({
      message: t('settings.not_eligible_for_reward'),
      description: `Ad will be available in ${formatted}`,
      type: 'warning',
    });
    return;
  }

    if (loaded) {
      try {
        await rewardedAd.show();
        // console.log('[RewardedAd] Ad shown 🚀');
      } catch (err) {
        // console.error('[RewardedAd] Failed to show ad ❌', err);
        showMessage({
          message: t('settings.ad_not_ready'),
          type: 'danger',
        });
      }
    } else {
    //   console.log('[RewardedAd] Ad not loaded yet 💤');
      showMessage({
        message: t('settings.ad_not_ready'),
        type: 'danger',
      });
    }
  };

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={isAdsDrawerVisible}
    //   onRequestClose={() => setIsAdsDrawerVisible(false)}
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
