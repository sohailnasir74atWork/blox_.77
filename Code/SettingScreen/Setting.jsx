import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  TextInput,
  FlatList,
  Modal,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  ScrollView,
  Switch,
  Linking,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../GlobelStats';
import { getStyles } from './settingstyle';
import { handleGetSuggestions, handleOpenFacebook, handleOpenWebsite, handleRateApp, handleShareApp, imageOptions,  } from './settinghelper';
import { logoutUser } from '../Firebase/UserLogics';
import SignInDrawer from '../Firebase/SigninDrawer';
import auth from '@react-native-firebase/auth';

import { RewardedAd, RewardedAdEventType } from 'react-native-google-mobile-ads';
import getAdUnitId from '../Ads/ads';
import { appleAuth } from '@invertase/react-native-apple-authentication';
import { deleteUser } from '@react-native-firebase/auth';
import { resetUserState } from '../Globelhelper';
import ConditionalKeyboardWrapper from '../Helper/keyboardAvoidingContainer';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useLocalState } from '../LocalGlobelStats';
import config from '../Helper/Environment';
import notifee, { AuthorizationStatus } from '@notifee/react-native';
import SubscriptionScreen from './OfferWall';
import { ref, get, update } from '@react-native-firebase/database';

const adUnitId = getAdUnitId('rewarded')

const rewarded = RewardedAd.createForAdRequest(adUnitId, {
  keywords: ['fashion', 'clothing'],
});


export default function SettingsScreen({ selectedTheme }) {
  const [isDrawerVisible, setDrawerVisible] = useState(false);
  const [isAdsDrawerVisible, setIsAdsDrawerVisible] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [openSingnin, setOpenSignin] = useState(false);
  const { user, theme, updateLocalStateAndDatabase, setUser, appdatabase } = useGlobalState()
  const {updateLocalState, localState, mySubscriptions} = useLocalState()
  const [isPermissionGranted, setIsPermissionGranted] = useState(false);
  const [showOfferWall, setShowofferWall] = useState(false);

  const { triggerHapticFeedback } = useHaptic();
  const themes = ['system', 'light', 'dark'];
  const handleToggle = (value) => {
    updateLocalState('isHaptic', value); // Update isHaptic state globally
  };
  const isDarkMode = theme === 'dark';
  useEffect(() => {
    if (user && user?.id) {
      setNewDisplayName(user?.displayName?.trim() || user?.displayname?.trim() || 'Anonymous');
      setSelectedImage(user?.avatar?.trim() || 'https://bloxfruitscalc.com/wp-content/uploads/2025/placeholder.png');
    } else {
      setNewDisplayName('Guest User');
      setSelectedImage('https://bloxfruitscalc.com/wp-content/uploads/2025/placeholder.png');
    }

  }, [user]);
  useEffect(()=>{},[mySubscriptions])

  useEffect(() => {
    const checkPermission = async () => {
      const settings = await notifee.getNotificationSettings();
      setIsPermissionGranted(settings.authorizationStatus === 1); // 1 means granted
    };

    checkPermission();
  }, []);

  // Request permission
  const requestPermission = async () => {
    try {
      const settings = await notifee.requestPermission();
      if (settings.authorizationStatus === 0) {
        Alert.alert(
          'Permission Required',
          'Notification permissions are disabled. Please enable them in the app settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Go to Settings',
              onPress: () => Linking.openSettings(), // Redirect to app settings
            },
          ]
        );
        return false; // Permission not granted
      }

      if (settings.authorizationStatus === 1) {
        setIsPermissionGranted(true); // Update state if permission granted
        return true;
      }
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      Alert.alert('Error', 'An error occurred while requesting notification permissions.');
      return false;
    }
  };

  // Handle toggle
  const handleToggleNotification = async (value) => {
    if (value) {
      // If enabling notifications, request permission
      const granted = await requestPermission();
      setIsPermissionGranted(granted);
    } else {
      // If disabling, update the state
      setIsPermissionGranted(false);
    }
  };

  const handleSaveChanges = async () => {
    triggerHapticFeedback('impactLight');
    const MAX_NAME_LENGTH = 20;

    if (!user?.id) return;

    if (newDisplayName.length > MAX_NAME_LENGTH) {
      Alert.alert(
        'Error',
        `Display name cannot exceed ${MAX_NAME_LENGTH} characters.`
      );
      return;
    }

    try {
      await updateLocalStateAndDatabase({
        displayName: newDisplayName.trim(),
        displayname: newDisplayName.trim(), // Sync both properties
        avatar: selectedImage.trim(),
      });

      setDrawerVisible(false);
      // Alert.alert('Success', 'Profile updated successfully!');
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('Error', 'Failed to update profile. Please try again.');
    }
  };



  const displayName = user?.id
    ? newDisplayName?.trim() || user?.displayName?.trim() || user?.displayname?.trim() || 'Anonymous'
    : 'Guest User';




  const handleLogout = async () => {
    triggerHapticFeedback('impactLight');
    try {
      await logoutUser(setUser); // Await the logout process
      // setSelectedImage('https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png');
      // setNewDisplayName('Guest User');
      Alert.alert('Success', 'You have been logged out successfully.');
    } catch (error) {
      console.error('Error during logout:', error);
      Alert.alert('Error', 'Failed to log out. Please try again.');
    }
  };
  const handleDeleteUser = async () => {
    triggerHapticFeedback('impactLight');
    try {
      if (!user || !user?.id) {
        Alert.alert('Error', 'No user is currently logged in.');
        return;
      }

      // Step 1: Acknowledge the irreversible action
      const showAcknowledgment = () =>
        new Promise((resolve, reject) => {
          Alert.alert(
            'Delete Account',
            'Deleting your account will permanently erase all your data, including chat history, points, and profile details. This action is irreversible.',
            [
              { text: 'Cancel', style: 'cancel', onPress: reject },
              { text: 'Proceed', style: 'destructive', onPress: resolve },
            ]
          );
        });

      // Step 2: Confirm the action again
      const showFinalConfirmation = () =>
        new Promise((resolve, reject) => {
          Alert.alert(
            'Confirm Deletion',
            'Are you sure you want to delete your account? This action cannot be undone.',
            [
              { text: 'Cancel', style: 'cancel', onPress: reject },
              { text: 'Delete', style: 'destructive', onPress: resolve },
            ]
          );
        });

      // Await acknowledgment and confirmation
      await showAcknowledgment();
      await showFinalConfirmation();

      // Proceed to delete the user account
      const currentUser = auth().currentUser;
      if (currentUser) {
        await currentUser.delete(); // Delete the user account
        await resetUserState(setUser); // Reset the user state
        Alert.alert('Success', 'Your account and all associated data have been permanently deleted.');
      } else {
        Alert.alert('Error', 'User not found. Please log in again.');
      }
    } catch (error) {
      console.error('Error deleting user:', error.message);
      if (error.code === 'auth/requires-recent-login') {
        Alert.alert(
          'Session Expired',
          'Please log in again to delete your account.',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Error', 'Failed to delete account. Please try again.');
      }
    }
  };
  const manageSubscription = () => {
    const url = 'https://play.google.com/store/account/subscriptions';
    Linking.openURL(url).catch((err) => console.error('Error opening subscription manager:', err));
  };

  const handleProfileUpdate = () => {
    triggerHapticFeedback('impactLight');
    if (user?.id) {
      setDrawerVisible(true); // Open the profile drawer if the user is logged in
    } else {
      Alert.alert('Notice', 'Please log in to customize your profile.'); // Show alert if user is not logged in
    }
  };


// 🔥 Completely delete the `points` field from the database
// 🔥 Update user points safely
const updateUserPoints = async (userId, pointsToAdd, updateLocalStateAndDatabase) => {
  if (!userId) {
    console.error("updateUserPoints: User ID is undefined");
    return;
  }

  try {
    const userPointsRef = ref(appdatabase, `/users/${userId}`);

    // Fetch latest points first
    const latestPoints = await getUserPoints(user?.id);
    const newPoints = latestPoints + pointsToAdd;

    // 🔥 Correcting the .update() call by using an object
    await update(userPointsRef, { points: newPoints });
    // console.log(`✅ User points updated in Firebase: ${newPoints}`);

    // Update local & global state after Firebase update
    updateLocalStateAndDatabase('points', newPoints);
  } catch (error) {
    console.error("❌ Error updating user points:", error);
  }
};

// 🔥 Fetch latest user points from Firebase
const getUserPoints = async (userId) => {
  if (!userId) {
    // console.error("getUserPoints: User ID is undefined");
    return 0;
  }

  try {
    
    const snapshot = await get(ref(appdatabase, `/users/${userId}/points`));

    if (snapshot.exists()) {
      // console.log(`Fetched user points: ${snapshot.val()}`);
      return snapshot.val(); // Returns the points
    } else {
      console.warn("User points not found, defaulting to 0");
      return 0;
    }
  } catch (error) {
    console.error("Error fetching user points:", error);
    return 0;
  }
};



useEffect(() => {
  const fetchUserPoints = async () => {
    const latestPoints = await getUserPoints(user?.id);
    // console.log("Setting user points in state:", latestPoints);
    updateLocalStateAndDatabase('points', latestPoints); // Store latest points
  };

  fetchUserPoints(); // Fetch points when component mounts

  const unsubscribeLoaded = rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
    setLoaded(true);
  });

  const unsubscribeEarned = rewarded.addAdEventListener(
    RewardedAdEventType.EARNED_REWARD,
    async (reward) => {
      // console.log("Ad shown, User earned reward:", reward.amount);

      // 🔥 Fetch latest points, add reward, update Firebase
      await updateUserPoints(user?.id, 100, updateLocalStateAndDatabase);

      updateLocalStateAndDatabase('lastRewardtime', new Date().getTime());
      Alert.alert('Reward Granted', `You earned ${100} points!`);
    }
  );

  return () => {
    unsubscribeLoaded();
    unsubscribeEarned();
  };
}, [user?.id]);






  
  const canClaimReward = () => {
    const now = new Date().getTime();
    const lastRewardTime = user?.lastRewardtime;

    if (!lastRewardTime) return true;

    const timeDifference = now - lastRewardTime;
    return timeDifference >=   10 * 1000; 
  };
  // console.log(user)
  const showAd = async () => {
    setIsAdsDrawerVisible(false);
    try {
      if (!canClaimReward()) {
        const remainingTime = 1 - Math.floor((new Date().getTime() - user?.lastRewardtime) / 60000);
        Alert.alert('Not Eligible', `Please wait at least 10 seconds to claim the next reward.`);
        return;
      }
  
      if (loaded) {
        await rewarded.show();
        setLoaded(false);
      } else {
        // console.log("No ad available, granting fallback reward...");
  
        // 🔥 Fetch latest points, add fallback reward (50 points)
        await updateUserPoints(user?.id, 50, updateLocalStateAndDatabase);
  
        updateLocalStateAndDatabase('lastRewardtime', new Date().getTime());
        Alert.alert('Ad not ready', 'However, you got 50 points.');
      }
    } catch (error) {
      console.error('Error displaying ad:', error);
    }
  };
  


  const handleGetPoints = () => {
    triggerHapticFeedback('impactLight');
    if (!user?.id) {
      setOpenSignin(true);
    } else {
      setIsAdsDrawerVisible(true)
      rewarded.load()
    }
  };
  const formatPlanName = (plan) => {
    if (plan.includes('monthly')) return '1 MONTH';
    if (plan.includes('quarterly')) return '3 MONTHS';
    if (plan.includes('yearly')) return '1 YEAR';
    return 'Unknown Plan';
  };
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  return (
    <View style={styles.container}>
      {/* User Profile Section */}
      <View style={styles.cardContainer}>
        <View style={styles.optionuserName}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Image
              source={
                typeof selectedImage === 'string' && selectedImage.trim()
                  ? { uri: selectedImage }
                  : { uri: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }
              }
              style={styles.profileImage}
            />
            <TouchableOpacity onPress={user?.id ? () => { } : () => { setOpenSignin(true) }} disabled={user?.id !== null}>
              <Text style={!user.id ? styles.userNameLogout : styles.userName}>
                {!user?.id ? 'Login / Register' : displayName}
              </Text>
              {!user?.id && <Text style={styles.rewardLogout}>Login to access notification, trading, chat and much more</Text>}
              {user.id && <Text style={styles.reward}>My Points: {user?.points || 0}</Text>}
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={handleProfileUpdate}>
            {user?.id && <Icon name="create-outline" size={24} color={'#566D5D'} />}
          </TouchableOpacity>
        </View>
      </View>

      {/* Options Section */}
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>APP SETTINGS</Text>
      <View style={styles.cardContainer}>
        <View style={styles.option} onPress={()=>{handleShareApp(); triggerHapticFeedback('impactLight');
}}>
  <View style={{flexDirection:'row', justifyContent:'space-between', width:'100%'}}>
    <TouchableOpacity style={{flexDirection:'row', alignItems:'center'}}>
          <Icon name="radio-outline" size={24} color={'#B76E79'} />
          <Text style={styles.optionText}>Heptic Feedback</Text></TouchableOpacity>
          <Switch value={localState.isHaptic} onValueChange={handleToggle} />
          </View>
          
        </View>
        <View style={styles.option} onPress={()=>{handleShareApp(); triggerHapticFeedback('impactLight');
}}>
  <View style={{flexDirection:'row', justifyContent:'space-between', width:'100%'}}>
    <TouchableOpacity style={{flexDirection:'row', alignItems:'center'}}>
          <Icon name="notifications" size={24} color={config.colors.hasBlockGreen} />
          <Text style={styles.optionText}>Chat Notifications</Text></TouchableOpacity>
          <Switch
        value={isPermissionGranted}
        onValueChange={handleToggleNotification}
      />
          </View>
          
        </View>
        
        <View style={styles.optionLast} onPress={()=>{handleShareApp(); triggerHapticFeedback('impactLight');
}}>
  <View style={{flexDirection:'row', justifyContent:'space-between', width:'100%'}}>
    <TouchableOpacity style={{flexDirection:'row', alignItems:'center'}}>
          <Icon name="contrast-outline" size={24} color={'#4A90E2'} />
          <Text style={styles.optionText}>Theme</Text></TouchableOpacity>
          <View style={styles.containertheme}>
      {themes.map((theme) => (
        <TouchableOpacity
          key={theme}
          style={[
            styles.box,
            localState.theme === theme.toLowerCase() && styles.selectedBox, // Highlight selected box
          ]}
          onPress={() => updateLocalState('theme', theme.toLowerCase())}
        >
          <Text
            style={[
              styles.text,
              localState.theme === theme.toLowerCase() && styles.selectedText, // Highlight selected text
            ]}
          >
                       {theme.toUpperCase()}

          </Text>
        </TouchableOpacity>
      ))}
    </View>
          </View>
        </View>
      </View>
      <Text style={styles.subtitle}>REWARD SETTINGS</Text>
      <View style={styles.cardContainer}>
        
        <TouchableOpacity style={styles.optionLast} onPress={handleGetPoints}>
          <Icon name="trophy-outline" size={24} color={'#4B4453'} />
          <Text style={styles.optionText}>Get Points</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.subtitle}>Pro Subscription</Text>
      <View style={styles.cardContainer}>
        
        <TouchableOpacity style={styles.optionLast} onPress={()=>{setShowofferWall(true)}}>
          <Icon name="prism-outline" size={24} color={config.colors.hasBlockGreen} />
          <Text style={[styles.optionText]}>
  Active Plan: {localState.isPro ? 'PRO' : 'FREE'}
        </Text>
        </TouchableOpacity>
        {localState.isPro && (
  <View style={styles.subscriptionContainer}>
    <Text style={styles.subscriptionText}>
      Plan Name:  
      {mySubscriptions.length === 0 
        ? 'Pro' 
        : mySubscriptions.map(sub => formatPlanName(sub.plan)).join(', ')}
    </Text>
    
      <TouchableOpacity onPress={manageSubscription} style={styles.manageButton}>
        <Text style={styles.manageButtonText}>Manage</Text>
      </TouchableOpacity>
  
  </View>
)}
      </View>
      <Text style={styles.subtitle}>OTHER SETTINGS</Text>

      <View style={styles.cardContainer}>
  
     
        <TouchableOpacity style={styles.option} onPress={()=>{handleShareApp(); triggerHapticFeedback('impactLight');
}}>
          <Icon name="share-social-outline" size={24} color={'#B76E79'} />
          <Text style={styles.optionText}>Share App</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.option} onPress={()=>{handleGetSuggestions(user);        triggerHapticFeedback('impactLight');
}}>
          <Icon name="mail-outline" size={24} color={'#566D5D'} />
          <Text style={styles.optionText}>Give Suggestions</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.option} onPress={()=>{handleRateApp(); triggerHapticFeedback('impactLight');}
}>
          <Icon name="star-outline" size={24} color={'#A2B38B'} />
          <Text style={styles.optionText}>Rate Us</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.option} onPress={()=>{handleOpenFacebook();         triggerHapticFeedback('impactLight');
}}>
          <Icon name="logo-facebook" size={24} color={'#566D5D'} />
          <Text style={styles.optionText}>Visit Facebook Group</Text>
        </TouchableOpacity>
        <TouchableOpacity style={user?.id ? styles.option : styles.optionLast} onPress={()=>{handleOpenWebsite();         triggerHapticFeedback('impactLight');
}}>
          <Icon name="link-outline" size={24} color={'#4B4453'} />
          <Text style={styles.optionText}>Visit Website</Text>
        </TouchableOpacity>
        {user?.id && <TouchableOpacity style={styles.option} onPress={handleLogout} >
          <Icon name="person-outline" size={24} color={'#4B4453'} />
          <Text style={styles.optionTextLogout}>Logout</Text>
        </TouchableOpacity>}
        {user?.id && <TouchableOpacity style={styles.optionDelete} onPress={handleDeleteUser} >
          <Icon name="warning-outline" size={24} color={'#4B4453'} />
          <Text style={styles.optionTextDelete}>Delete My Account</Text>
        </TouchableOpacity>}

      </View>
      </ScrollView>

      {/* Bottom Drawer */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isDrawerVisible}
        onRequestClose={() => setDrawerVisible(false)}
      >

        <Pressable
          style={styles.overlay}
          onPress={() => setDrawerVisible(false)}
        />
      <ConditionalKeyboardWrapper>
          <View style={{ backgroundColor: 'rgba(0,0,0,0.5)', }}>
            <View style={styles.drawer}>

              {/* Name Input */}
              <Text style={styles.drawerSubtitle}>Change Display Name</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter new display name"
                value={newDisplayName}
                onChangeText={setNewDisplayName}
              />

              {/* Profile Image Selection */}
              <Text style={styles.drawerSubtitle}>Select Profile Icon</Text>
              <FlatList
                data={imageOptions}
                keyExtractor={(item, index) => item.toString()}
                horizontal
                renderItem={({ item }) => (
                  <TouchableOpacity
                    onPress={() => {
                      setSelectedImage(item);
                    }}
                  >
                    <Image source={{
                      uri: item,
                    }} style={styles.imageOption} />
                  </TouchableOpacity>
                )}
              />

              <TouchableOpacity
                style={styles.saveButton}
                onPress={handleSaveChanges}
              >
                <Text style={styles.saveButtonText}>Save Changes</Text>
              </TouchableOpacity>
            </View>
          </View>
          </ConditionalKeyboardWrapper>
      </Modal>
      <Modal
        animationType="slide"
        transparent={true}
        visible={isAdsDrawerVisible}
        onRequestClose={() => setIsAdsDrawerVisible(false)}
      >
        <Pressable
          style={styles.overlay}
          onPress={() => setIsAdsDrawerVisible(false)}
        />
        <View style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={styles.drawer}>
            {/* Explanation of Rewards */}
            <Text style={styles.drawerSubtitle}>
              Watch an ad to earn rewards!
            </Text>
            <Text style={styles.rewardDescription}>
              Earn points by watching ads. These points can be used to participate in app contests and unlock special features.
            </Text>

            {/* Button to Show Ad */}
            <TouchableOpacity
              style={styles.saveButton}
              onPress={showAd}
            >
              <Text style={styles.saveButtonText}>Earn Reward</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <SubscriptionScreen visible={showOfferWall} onClose={() => setShowofferWall(false)} />
      <SignInDrawer
        visible={openSingnin}
        onClose={() => setOpenSignin(false)}
        selectedTheme={selectedTheme}
        message='To collect points, you need to sign in'
      />
    </View>
  );
}