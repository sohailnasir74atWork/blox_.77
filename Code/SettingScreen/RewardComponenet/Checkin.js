import React, { useEffect, useState, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Image } from 'react-native';
import { useGlobalState } from '../../GlobelStats';
import RewardedAdComponent from '../RewardScreens/RewardedAd';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { showMessage } from 'react-native-flash-message';

const dailyRewards = [5, 10, 20, 30, 40, 50, 60];

export default function DailyCheckIn({
  user,
  appdatabase,
  isAdsDrawerVisible,
  setIsAdsDrawerVisible,
  updateLocalStateAndDatabase,
  setOpenSignin,
}) {
  const [claimedDates, setClaimedDates] = useState([]);
  const [pendingCoinReward, setPendingCoinReward] = useState(null);
  const pendingCoinRewardRef = useRef(null);

  const today = new Date(); // Current date (local time)
  const todayFormatted = today.toISOString().split('T')[0]; // Format to YYYY-MM-DD
  const currentHour = today.getHours(); // Get current hour in local time
  const currentMinutes = today.getMinutes(); // Get current minutes in local time

  // Debug: Log current time

  const [todayClaimed, setTodayClaimed] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);


  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  useEffect(() => {
    const saved = user?.checkin?.claimedDates || [];
    const last = saved[saved.length - 1];  // Corrected index
  
    // Reset if the user missed a claim (skipped day)
    const updated = last && last !== todayFormatted ? [] : saved;
    console.log(updated, last, todayFormatted, saved);
  
    setClaimedDates(updated);
  }, [user?.id]);
  
  // console.log(todayFormatted)

  const isTodayClaimed = claimedDates.includes(todayFormatted) || todayClaimed;

  const currentDayIndex = claimedDates.length >= 7 ? 0 : claimedDates.length;
  
  const nextClaimableDay = claimedDates.length === 0
    ? today
    : new Date(claimedDates[claimedDates.length - 1]);
  
  nextClaimableDay.setDate(nextClaimableDay.getDate() + 1);
  nextClaimableDay.setHours(0, 0, 0, 0);
  
  const isNextClaimable = today.getTime() >= nextClaimableDay.getTime();
  
  // Debug: Log the next claimable day and its time
  // console.log(`Next claimable day (midnight): ${nextClaimableDay.toLocaleString()}`);

  // Unlock the next day's reward at 12:00 AM (midnight) local time
  // const isNextClaimable = (currentHour === 0 && currentMinutes === 0) || (today.getTime() >= nextClaimableDay.getTime());

  // Debug: Log if the next day is claimable
  // console.log(`Is next day claimable? ${isNextClaimable}`);

  // Live countdown logic for the next claimable day (based on local time)
  const [timeLeft, setTimeLeft] = useState(null);

  useEffect(() => {
    if (isNextClaimable) return; // No countdown if next is claimable

    const interval = setInterval(() => {
      const timeRemaining = Math.max(0, nextClaimableDay.getTime() - today.getTime());
      setTimeLeft(timeRemaining);

      // Debug: Log remaining time
      // console.log(`Remaining time for next claimable day: ${timeRemaining / 1000} seconds`);



      if (timeRemaining === 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isNextClaimable]);

  // Convert time to HH:MM:SS format
  const formatTime = (timeInMillis) => {
    const hours = Math.floor(timeInMillis / (1000 * 60 * 60));
    const minutes = Math.floor((timeInMillis % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((timeInMillis % (1000 * 60)) / 1000);

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const remainingTime = timeLeft ? formatTime(timeLeft) : "00:00:00"; // Format time in HH:MM:SS

  const handleCheckIn = (isClaimed, isLocked, isNextDay, countdownMessage) => {
    if (!user?.id) return setOpenSignin(true);
  
    if (isClaiming) return; // 🔒 prevent double-tap
  
    if (isClaimed) {
      showMessage({
        message: "You’ve already claimed today’s reward.",
        type: "info",
        icon: "info",
        backgroundColor: config.colors.hasBlockGreen,
        color: 'white',
      });
      return;
    }
  
    if (isLocked && !isNextDay) {
      showMessage({
        message: "This day is locked. Please try again later.",
        type: "warning",
        icon: "warning",
      });
      return;
    }
  
    if (isNextDay && isLocked) {
      showMessage({
        message: countdownMessage || "Available to claim",
        type: "success",
        icon: "success",
        backgroundColor: config.colors.hasBlockGreen,
        color: 'white',
      });
      return;
    }
  
    if (!isClaimed && !isLocked && isNextDay) {
      const reward = { dayIndex: currentDayIndex, coins: dailyRewards[currentDayIndex] };
      setIsClaiming(true); // 🔐 lock UI
      setPendingCoinReward(reward);
      pendingCoinRewardRef.current = reward;
      setIsAdsDrawerVisible(true);
    }
  };
  


  const handleAdComplete = async () => {
    const reward = pendingCoinRewardRef.current;
    if (!reward) return;
  
    const updatedDates = claimedDates.length >= 7
      ? [todayFormatted]
      : [...claimedDates, todayFormatted];
  
    setClaimedDates(updatedDates); // 🧠 IMMEDIATE update
    setTodayClaimed(true); // ✅ Avoid false clicks
    setPendingCoinReward(null);
    pendingCoinRewardRef.current = null;
  
    try {
      await updateLocalStateAndDatabase({
        coins: (user?.coins || 0) + reward.coins,
        lastRewardtime: Date.now(),
        checkin: {
          ...(user?.checkin || {}),
          claimedDates: updatedDates,
        },
      });
  
      Alert.alert('✅ Success', `You earned ${reward.coins} coins!`);
    } catch (e) {
      Alert.alert('⚠️ Error', 'Failed to update your reward. Please try again.');
    } finally {
      setIsAdsDrawerVisible(false);
      setIsClaiming(false); // 🔓 Unlock UI
    }
  };
  

  return (
    <View style={styles.container}>
      <Text style={styles.title}>DAILY CHECK-IN</Text>
      <View style={styles.grid}>
        {dailyRewards.map((coins, index) => {
          // {console.log(dailyRewards, claimedDates)}
          const isClaimed = index < claimedDates.length;
          const isCurrent = index === claimedDates.length && !isTodayClaimed;
          const isLocked = index > claimedDates.length || !isNextClaimable; // Lock next day until claimable

          // Apply custom background color for next claimable day
          const isNextDay = index === claimedDates.length;

          let claimStatusMessage = '';
          let countdownMessage = '';

          if (isClaimed) {
            claimStatusMessage = 'You’ve already claimed today’s reward.';
          } else if (isLocked) {
            claimStatusMessage = "This day is locked. Please try again later.";
            if (isNextDay) {
              countdownMessage = `Available in ${remainingTime}`;
            }
          } else {
            claimStatusMessage = 'Available to claim';
          }
          // Debug log to check if any non-Text content is being rendered
          // console.log(`Day ${index + 1} claim status: ${claimStatusMessage}`);

          return (
            <TouchableOpacity
              key={index}
              onPress={() => handleCheckIn(isClaimed, isLocked, isNextDay, countdownMessage)} 
              style={[
                styles.dayBox,
                isClaimed ? styles.claimedBox : styles.lockedBox,
                isNextDay && styles.nextClaimableDayBox, 
              ]}
            >
              <Text style={styles.dayLabel}>DAY {index + 1}</Text>
              <Image source={require('../../../assets/money-bag.png')} style={{ width: 30, height: 30 }} />
              <Text style={styles.coinText}>{`${coins} coins`}</Text>

              {isClaimed && <Icon name="checkmark-circle" size={16} color={config.colors.hasBlockGreen} style={styles.overlayIcon} />}
              {isLocked && !isClaimed && <Icon name="lock-closed" size={16} color={'lightgrey'} style={styles.overlayIcon} />}
              
              {/* <Text style={styles.statusMessage}>{claimStatusMessage}</Text> */}
              {isNextDay && <Text style={styles.countdownMessage}>{countdownMessage}</Text>} 
            </TouchableOpacity>
          );
        })}
      </View>

      <RewardedAdComponent
        user={user}
        appdatabase={appdatabase}
        updateLocalStateAndDatabase={updateLocalStateAndDatabase}
        isAdsDrawerVisible={isAdsDrawerVisible}
        setIsAdsDrawerVisible={setIsAdsDrawerVisible}
        handleAdComplete={handleAdComplete}
        pendingCoinReward={pendingCoinRewardRef.current}
      />
    </View>
  );
}

const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: {
      padding: 8,
      backgroundColor: isDarkMode ? '#34495E' : '#CCCCFF',
      borderRadius: 12,
      marginBottom: 10,
    },
    title: {
      fontSize: 16,
      fontFamily: 'Lato-Bold',
      marginBottom: 12,
      alignSelf: 'center',
      color: isDarkMode ? 'white' : 'black'
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    dayBox: {
      width: '31%',
      backgroundColor: '#6A5ACD',
      padding: 6,
      marginTop: 4,
      borderRadius: 20,
      alignItems: 'center',
      marginHorizontal: '1%',
      minHeight:80,
      justifyContent:'center'
    },
    claimedBox: {
      backgroundColor: config.colors.hasBlockGreen,
    },
    lockedBox: {
      backgroundColor: 'grey',
    },
    nextClaimableDayBox: {
      backgroundColor: config.colors.primary, // Use an orange color for the next claimable day
    },
    dayLabel: {
      fontSize: 12,
      fontFamily: 'Lato-Bold',
      color: 'white',
      marginBottom: 4,
    },
    coinText: {
      fontSize: 10,
      color: 'lightgrey',
      fontFamily: 'Lato-Regular',
    },
    overlayIcon: {
      position: 'absolute',
      top: 5,  // Place the icon 10 units from the top
      right: 5,  // Place the icon at the center horizontally
    },
    statusMessage: {
      marginTop: 5,
      fontSize: 10,
      color: 'white',
      fontFamily: 'Lato-Regular',
      textAlign: 'center',
    },
    countdownMessage: {
      marginTop: 3,
      fontSize: 9,
      color: 'yellow',
      fontFamily: 'Lato-Regular',
      textAlign: 'center',
    },
  });
