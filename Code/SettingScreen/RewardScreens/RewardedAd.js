import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, Alert } from 'react-native';
import { RewardedAd, RewardedAdEventType, AdEventType } from 'react-native-google-mobile-ads';
import { ref, get, update } from '@react-native-firebase/database';
import { showMessage } from 'react-native-flash-message';
import { getStyles } from '../settingstyle'; // Ensure you have a styles file
import getAdUnitId from '../../Ads/ads';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../../GlobelStats';

const adUnitId = getAdUnitId('rewarded');

const RewardedAdComponent = ({ user, appdatabase, updateLocalStateAndDatabase, isAdsDrawerVisible, setIsAdsDrawerVisible }) => {
    const { t } = useTranslation();
    const [loaded, setLoaded] = useState(false);
    const { theme } = useGlobalState();
    const isDarkMode = theme === 'dark';
    const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

    // Initialize the rewarded ad
    const rewardedAd = useMemo(() => {
        return RewardedAd.createForAdRequest(adUnitId, {
            requestNonPersonalizedAdsOnly: true,
        });
    }, []);

    useEffect(() => {
        // Load the ad when the component mounts
        rewardedAd.load();

        // Listener for ad loaded
        const unsubscribeLoaded = rewardedAd.addAdEventListener(RewardedAdEventType.LOADED, () => {
            setLoaded(true);
        });

        // Listener for ad closed
        const unsubscribeClosed = rewardedAd.addAdEventListener(AdEventType.CLOSED, () => {
            setLoaded(false);
            rewardedAd.load(); // Load a new ad
        });

        // Listener for user earning reward
        const unsubscribeEarned = rewardedAd.addAdEventListener(RewardedAdEventType.EARNED_REWARD, async (reward) => {
            await updateUserPoints(user?.id, 100); // Grant reward points
            updateLocalStateAndDatabase('lastRewardtime', new Date().getTime());
            Alert.alert(t("settings.reward_granted"), t("settings.reward_granted_message"));
        });

        // Clean up listeners on unmount
        return () => {
            unsubscribeLoaded();
            unsubscribeClosed();
            unsubscribeEarned();
        };
    }, [rewardedAd, user?.id]);

    // Fetch latest user points
    const getUserPoints = async (userId) => {
        if (!userId) return 0;
        try {
            const snapshot = await get(ref(appdatabase, `/users/${userId}/rewardPoints`));
            return snapshot.exists() ? snapshot.val() : 0;
        } catch (error) {
            console.error("Error fetching user points:", error);
            return 0;
        }
    };

    // Update user points safely
    const updateUserPoints = async (userId, pointsToAdd) => {
        if (!userId) return;
        try {
            const latestPoints = await getUserPoints(user?.id);
            const newPoints = latestPoints + pointsToAdd;
            await update(ref(appdatabase, `/users/${userId}`), { rewardPoints: newPoints });
            updateLocalStateAndDatabase('rewardPoints', newPoints);
        } catch (error) {
            console.error("Error updating user points:", error);
        }
    };

    // Check if user can claim reward (cooldown logic)
    const canClaimReward = () => {
        const now = new Date().getTime();
        const lastRewardTime = user?.lastRewardtime;
        if (!lastRewardTime) return true;
        return (now - lastRewardTime) >= 30 * 1000; // 10 seconds cooldown
    };

    // Handle Ad Display & Rewards
    const showAd = async () => {
        setIsAdsDrawerVisible(false);
        if (!canClaimReward()) {
            showMessage({
                message: t("settings.not_eligible_for_reward"),
                description: t("settings.reward_wait_time"),
                type: "warning",
            });
            return;
        }

        if (loaded) {
            await rewardedAd.show();
        } else {
            showMessage({
                message: t("settings.ad_not_ready"),
                type: "danger",
            });
        }
    };

    return (
        <Modal
            animationType="slide"
            transparent={true}
            visible={isAdsDrawerVisible}
            onRequestClose={() => setIsAdsDrawerVisible(false)}
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
