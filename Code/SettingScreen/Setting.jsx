import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  ScrollView,
  Switch,
  Linking,
  Platform,
  ActivityIndicator,

} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../GlobelStats';
import { getStyles } from './settingstyle';
import { handleGetSuggestions, handleOpenFacebook, handleOpenWebsite, handleRateApp, handleadoptme, handleShareApp, imageOptions, handleBloxFruit, handleRefresh, handleReport, handleOpenPrivacy, handleOpenChild} from './settinghelper';
import { logoutUser } from '../Firebase/UserLogics';
import SignInDrawer from '../Firebase/SigninDrawer';
import auth from '@react-native-firebase/auth';
import { resetUserState } from '../Globelhelper';
import ConditionalKeyboardWrapper from '../Helper/keyboardAvoidingContainer';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useLocalState } from '../LocalGlobelStats';
import config from '../Helper/Environment';
import notifee from '@notifee/react-native';
import SubscriptionScreen from './OfferWall';
import { ref, remove } from '@react-native-firebase/database';
import { Menu, MenuOption, MenuOptions, MenuTrigger } from 'react-native-popup-menu';
import { useLanguage } from '../Translation/LanguageProvider';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import { setAppLanguage } from '../../i18n';
import StyledUsernamePreview from './Store/StyledName';
import StyledDisplayName from './Store/NameDisplayReUser';
import { Image as CompressorImage } from 'react-native-compressor';
import RNFS from 'react-native-fs';


import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from '@react-native-firebase/firestore';
import PetModal from '../ChatScreen/PrivateChat/PetsModel';
import { launchImageLibrary } from 'react-native-image-picker';
const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_ACCESS_KEY   = '1b7e1a85-dff7-4a98-ba701fc7f9b9-6542-46e2';
const BUNNY_CDN_BASE     = 'https://pull-gag.b-cdn.net';

// ~500 KB max for avatar (small, DP-friendly)
const MAX_AVATAR_SIZE_BYTES = 500 * 1024;


const formatName = (name) => name.replace(/^\+/, '').replace(/\s+/g, '-');

export default function SettingsScreen({ selectedTheme }) {
  const [isDrawerVisible, setDrawerVisible] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [openSingnin, setOpenSignin] = useState(false);
  const { user, theme, updateLocalStateAndDatabase, setUser, appdatabase, firestoreDB, single_offer_wall } = useGlobalState()
  const { updateLocalState, localState, mySubscriptions } = useLocalState()
  const [isPermissionGranted, setIsPermissionGranted] = useState(false);
  const [showOfferWall, setShowofferWall] = useState(false);
  const { language, changeLanguage } = useLanguage();
  const [ownedPets, setOwnedPets] = useState([]);
  const [wishlistPets, setWishlistPets] = useState([]);
  const [petModalVisible, setPetModalVisible] = useState(false);
  const [owned, setOwned] = useState(false);
  const [avatarSearch, setAvatarSearch] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  
  const { t } = useTranslation();
  const BASE_ADOPTME_URL = 'https://bloxfruitscalc.com/wp-content/uploads/2024/09';

  const parsedValuesData = useMemo(() => {
    try {
      const raw = localState?.data;
      if (!raw) return [];

      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

      // Convert object map to array if needed
      return Array.isArray(parsed) ? parsed : Object.values(parsed || {});
    } catch (e) {
      console.log('Error parsing localState.data', e);
      return [];
    }
  }, [localState?.data]);

  const petAvatarOptions = useMemo(() => {
    if (!parsedValuesData?.length) return [];

    return parsedValuesData
      .filter(item => item?.name)
      .map(item => {
        const path = `${formatName(item.name)}_Icon.webp`;
        return {
          url: `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${path}`,
          // name: item.name,
          // type: item.type || 'pet',
        };
      });
  }, [parsedValuesData]);

  const defaultAvatarOptions = useMemo(
    () =>
      imageOptions.map((url, index) => ({
        url,
        name: `Icon ${index + 1}`,
        type: 'default',
      })),
    [imageOptions]
  );

  const avatarOptions = useMemo(
    () => [...petAvatarOptions, ...defaultAvatarOptions],
    [defaultAvatarOptions, petAvatarOptions]
  );
  


  // Final list: existing `imageOptions` + options from values data
  const filteredAvatarOptions = useMemo(() => {
    const q = avatarSearch.trim().toLowerCase();
    if (!q) return avatarOptions;

    return avatarOptions.filter(opt => {
      // Always keep default icons
      if (opt.type === 'default') return true;
      return opt.name?.toLowerCase().includes(q);
    });
  }, [avatarSearch, avatarOptions]);
  const handlePickAndUploadAvatar = useCallback(async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: 1,
      });

      if (!result.assets?.length) return;

      const asset = result.assets[0];

      setUploadingAvatar(true);

      // 🔹 Compress to small DP-friendly size
      const compressedUri = await CompressorImage.compress(asset.uri, {
        maxWidth: 300,
        quality: 0.7,
      });

      const filePath = compressedUri.replace('file://', '');
      const stat = await RNFS.stat(filePath);

      // 🔹 Reject heavy images
      if (stat.size > MAX_AVATAR_SIZE_BYTES) {
        Alert.alert(
          'Image too large',
          'Please choose a smaller image (max ~500 KB) or crop it before uploading.'
        );
        setUploadingAvatar(false);
        return;
      }

      const userId = user?.id ?? 'anon';
      const filename = `${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
      const remotePath = `avatars/${encodeURIComponent(userId)}/${encodeURIComponent(filename)}`;
      const uploadUrl = `https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${remotePath}`;

      const base64 = await RNFS.readFile(filePath, 'base64');
      const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          AccessKey: BUNNY_ACCESS_KEY,
          'Content-Type': 'application/octet-stream',
        },
        body: binary,
      });

      const txt = await res.text().catch(() => '');

      if (!res.ok) {
        console.warn('[Bunny avatar ERROR]', res.status, txt?.slice(0, 200));
        Alert.alert('Upload failed', 'Could not upload image. Please try again.');
        setUploadingAvatar(false);
        return;
      }

      const publicUrl = `${BUNNY_CDN_BASE}/${decodeURIComponent(remotePath)}`;

      // ✅ Set as current selected profile image
      setSelectedImage(publicUrl);
    } catch (e) {
      console.warn('[Avatar upload]', e?.message || e);
      Alert.alert('Upload failed', 'Something went wrong. Please try again.');
    } finally {
      setUploadingAvatar(false);
    }
  }, [user?.id]);



  const platform = Platform.OS.toLowerCase();
  // console.log(analytics)



  const { triggerHapticFeedback } = useHaptic();
  const themes = [t('settings.theme_system'), t('settings.theme_light'), t('settings.theme_dark')];
    // const themes = ['System', 'Light','Dark'];

  const handleToggle = (value) => {
    updateLocalState('isHaptic', value); // Update isHaptic state globally
  };



  const languageOptions = [
    { code: "en", label: t("settings.languages.en"), flag: "🇺🇸" },
    { code: "fil", label: t("settings.languages.fil"), flag: "🇵🇭" },
    { code: "vi", label: t("settings.languages.vi"), flag: "🇻🇳" },
    { code: "pt", label: t("settings.languages.pt"), flag: "🇵🇹" },
    { code: "id", label: t("settings.languages.id"), flag: "🇮🇩" },
    { code: "es", label: t("settings.languages.es"), flag: "🇪🇸" },
    { code: "fr", label: t("settings.languages.fr"), flag: "🇫🇷" },
    { code: "de", label: t("settings.languages.de"), flag: "🇩🇪" },
    { code: "ru", label: t("settings.languages.ru"), flag: "🇷🇺" },
    { code: "ar", label: t("settings.languages.ar"), flag: "🇸🇦" }
  ];
  const iconMap = {
    camping: require('../../assets/Icons/camping.png'),
    dinamite: require('../../assets/Icons/dinamite.png'),
    fire: require('../../assets/Icons/fire.png'),
    grenade: require('../../assets/Icons/grenade.png'),
    'handheld-game': require('../../assets/Icons/handheld-game.png'),
    'paw-print': require('../../assets/Icons/paw-print.png'),
    play: require('../../assets/Icons/play.png'),
    'shooting-star': require('../../assets/Icons/shooting-star.png'),
    smile: require('../../assets/Icons/smile.png'),
    symbol: require('../../assets/Icons/symbol.png'),
    'treasure-map': require('../../assets/Icons/treasure-map.png'),
  };
  


  const isDarkMode = theme === 'dark';
  useEffect(() => {
    if (user && user?.id) {
      setNewDisplayName(user?.displayName?.trim() || 'Anonymous');
      setSelectedImage(user?.avatar?.trim() || 'https://bloxfruitscalc.com/wp-content/uploads/2025/placeholder.png');
    } else {
      setNewDisplayName('Guest User');
      setSelectedImage('https://bloxfruitscalc.com/wp-content/uploads/2025/placeholder.png');
    }

  }, [user]);
  useEffect(() => { }, [mySubscriptions])

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
          t("settings.permission_required"),
          t("settings.notification_permissions_disabled"),
          [
            { text:  t("home.cancel"), style: 'cancel' },
            {
              text:  t("settings.go_to_settings"),
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
      // console.error('Error requesting notification permission:', error);
      // Alert.alert(t("home.error"), 'An error occurred while requesting notification permissions.');
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
  const USERNAME_REGEX = /^[A-Za-z0-9_-]+$/;

  const handleSaveChanges = async () => {
    triggerHapticFeedback('impactLight');
    const MAX_NAME_LENGTH = 20;
  
    if (!user?.id) return;
  
    if (!newDisplayName) {
      showErrorMessage(
        t("home.alert.error"),
        "Display name is required."
      );
      return;
    }
  
    if (!USERNAME_REGEX.test(newDisplayName)) {
      showErrorMessage(
        t("home.alert.error"),
        "Only letters, numbers, '-' and '_' are allowed in the username."
      );
      return;
    }
  
    if (newDisplayName.length > MAX_NAME_LENGTH) {
      showErrorMessage(
        t("home.alert.error"),
        t("settings.display_name_length_error")
      );
      return;
    }
  
    try {
      await updateLocalStateAndDatabase({
        displayName: newDisplayName.trim(),
        avatar: selectedImage.trim(),
      });
  
      setDrawerVisible(false);
      showSuccessMessage(
        t("home.alert.success"),
        t("settings.profile_success")
      );
    } catch (error) {
      // handle error if needed
    }
  };
  



  const displayName = user?.id
    ? newDisplayName?.trim() || user?.displayName || 'Anonymous'
    : 'Guest User';


    const renderPetBubble = (pet, index) => {
    // {console.log(pet,`${BASE_ADOPTME_URL}${formatName(pet.name)}_Icon.webp` )}
    
      return (
        <View key={`${pet.id || pet.name}-${index}`} style={styles.petBubble}>

        
          <Image
            source={{ uri: `https://bloxfruitscalc.com/wp-content/uploads/2024/${pet.type === 'n' ? '09' : '08'}/${formatName(pet.name)}_Icon.webp` }}
            style={styles.petImageSmall}
          />
    
          {/* Badge stack on bottom-right of the bubble */}
          <View
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              flexDirection: 'row',
              alignItems: 'center',
              padding: 2,
            }}
          >
      
          </View>
        </View>
      );
    };
    
    
    // Later you’ll hook these into a modal / selector
    const handleManagePets = (owned) => {
      // e.g. open modal to pick owned pets
      owned === 'owned' ?  setOwned(true) : setOwned(false)
      setPetModalVisible(true)
    };
    
 // Load owned / wishlist pets from Firestore on screen load
 useEffect(() => {
  if (!user?.id || !firestoreDB) {
    setOwnedPets([]);
    setWishlistPets([]);
    return;
  }

  const userReviewRef = doc(firestoreDB, 'reviews', user.id);

  const unsubscribe = onSnapshot(userReviewRef, (docSnap) => {
    const data = docSnap.data();
    if (!data) {
      setOwnedPets([]);
      setWishlistPets([]);
      return;
    }

    setOwnedPets(Array.isArray(data.ownedPets) ? data.ownedPets : []);
    setWishlistPets(Array.isArray(data.wishlistPets) ? data.wishlistPets : []);
  });

  return () => unsubscribe();
}, [user?.id, firestoreDB]);


    // Call this after user finishes editing selection
    const savePetsToReviews = async (newOwned, newWishlist) => {
      if (!user?.id || !firestoreDB) return;
    
      const userReviewRef = doc(firestoreDB, 'reviews', user.id);
    
      await setDoc(
        userReviewRef,
        {
          ownedPets: newOwned,
          wishlistPets: newWishlist,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    
      setOwnedPets(newOwned);
      setWishlistPets(newWishlist);
    };

  const handleLogout = async () => {
    triggerHapticFeedback('impactLight');
    try {
      await logoutUser(setUser);
      showSuccessMessage(
        t("home.alert.success"),
        t("settings.logout_success")
      );
    } catch (error) {
      console.error('Error during logout:', error);
      showErrorMessage(
        t("home.alert.error"),
        t("settings.logout_error")
      );
    }
  };
  
  const handleDeleteUser = async () => {
    triggerHapticFeedback('impactLight');
    try {
      if (!user || !user?.id) {
        showErrorMessage(
          t("home.alert.error"),
          t("settings.delete_error")
        );
        return;
      }
  
      const userId = user?.id;
  
      // Step 1: Acknowledge the irreversible action
      const showAcknowledgment = () =>
        new Promise((resolve, reject) => {
          Alert.alert(
            t("settings.delete_account"),
            t("settings.delete_account_warning"),
            [
              { text: t("home.cancel"), style: 'cancel', onPress: reject },
              { text:  t("settings.proceed"), style: 'destructive', onPress: resolve },
            ]
          );
        });
  
      // Step 2: Confirm the action again
      const showFinalConfirmation = () =>
        new Promise((resolve, reject) => {
          Alert.alert(
            t("settings.confirm_deletion"),
            t("settings.confirm_deletion_warning"),
            [
              { text: t("home.cancel"), style: 'cancel', onPress: reject },
              { text: t("trade.delete"), style: 'destructive', onPress: resolve },
            ]
          );
        });
  
      // Await acknowledgment and confirmation
      await showAcknowledgment();
      await showFinalConfirmation();
  
      // Step 3: Remove user data from Firebase Realtime Database
      const userRef = ref(appdatabase, `users/${userId}`);

  
      await Promise.all([
        remove(userRef), // ✅ Delete user profile
      ]);
      // Step 4: Delete user from Firebase Authentication
      const currentUser = auth().currentUser;
      if (currentUser) {
        await currentUser.delete();

      } else {
        // Alert.alert(t(".alerthome.error"), t("settings.user_not_found"));
        showErrorMessage(
          t("home.alert.error"),
          t("settings.user_not_found")
        );
        return;
      }
  
      // Step 5: Reset local state
      await resetUserState(setUser);
  
      // Alert.alert(t("home.alert.success"), t("home.alert.success"));
      showSuccessMessage(
        t("home.alert.success"),
        t("home.alert.success")
      );
    } catch (error) {
      // console.error('Error deleting user:', error.message);
  
      if (error.code === 'auth/requires-recent-login') {
        // Alert.alert(
        //   t("settings.session_expired"),
        //   t("settings.session_expired_message"),
        //   [{ text: 'OK' }]
        // );
        showErrorMessage(
          t("settings.session_expired"),
          t("settings.session_expired_message")
        );
      } else {
        // Alert.alert(t("home.alert.error"), t("settings.delete_error"));
        showErrorMessage(
          t("home.alert.error"),
          t("settings.delete_error")
        );
      }
    }
  };
  
  const manageSubscription = () => {
    const url = Platform.select({
      ios: 'https://apps.apple.com/account/subscriptions',
      android: 'https://play.google.com/store/account/subscriptions',
    });
  
    if (url) {
      Linking.openURL(url).catch((err) => {
        console.error('Error opening subscription manager:', err);
      });
    }
  };



  const handleProfileUpdate = () => {
    triggerHapticFeedback('impactLight');
    if (user?.id) {
      setDrawerVisible(true); // Open the profile drawer if the user is logged in
    } else {
      // Alert.alert(t("settings.notice"), t("settings.login_to_customize_profile")); // Show alert if user is not logged in
      showErrorMessage(
        t("settings.notice"),
        t("settings.login_to_customize_profile")
      );
    }
  };



const formatPlanName = (plan) => {
  // console.log(plan, 'plan');

  if (plan === 'monthly:monthly' || plan === 'Blox_values_199_1m') return '1 MONTH';
  if (plan === 'quarterly:quarterly' || plan === 'Blox_values_499_3m') return '3 MONTHS';
  if (plan === 'yearly:yearly' || plan === 'Blox_values_999_1y') return '1 YEAR';

  return 'Anonymous Plan';
};


  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  return (
    <View style={styles.container}>
      {/* User Profile Section */}
      <View style={styles.cardContainer}>
        <View style={[styles.optionuserName, styles.option]}>
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
            {!user?.id ? (
  <Text style={styles.userNameLogout}>
    {t('settings.login_register')}
  </Text>
) : (
  <View style={{ flexDirection: 'column' }}>
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {/* Styled name if available */}
      {user?.id &&
     
        <StyledDisplayName
        user={user}
        localState={localState}
        displayName={user?.displayName || 'Guest'}
        fontSize={16}
        lineHeight={20}
        marginVertical={1}
      />
     }
     {user?.flage && <Text>{user.flage}</Text>}

      {/* Pro badges */}
      {/* {localState?.isPro && (
        <Image
          source={require('../../assets/pro.png')}
          style={{ width: 18, height: 18, marginLeft: 4 }}
        />
      )}
      {localState?.proGranted && (
        <Image
          source={require('../../assets/progranted.png')}
          style={{ width: 18, height: 18, marginLeft: 4 }}
        />
      )} */}
    </View>
  </View>
)}

              {!user?.id && <Text style={styles.rewardLogout}>{t('settings.login_description')}</Text>}
              {user?.id && <Text style={styles.reward}>My Coins: {user?.coins || 0}</Text>}
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={handleProfileUpdate}>
            {user?.id && <Icon name="create" size={24} color={'#566D5D'} />}
          </TouchableOpacity>
        </View>
        <View style={styles.petsSection}>
  {/* Owned Pets */}
  <View style={[styles.petsColumn]}>
    <View style={styles.petsHeaderRow}>
      <Text style={styles.petsTitle}>
       Owned Items
      </Text>
      {user?.id && (
        <TouchableOpacity onPress={()=>handleManagePets('owned')}>
          {user?.id && <Icon name="create" size={24} color={'#566D5D'} />}
        </TouchableOpacity>
      )}
    </View>

    {ownedPets.length === 0 ? (
      <Text style={styles.petsEmptyText}>
       {user?.id ? 'Select the pets you own' : 'Login to selected owned pets'}
      </Text>
    ) : (
      <View style={styles.petsAvatarRow}>
        {ownedPets.map((pet, index) => renderPetBubble(pet, index))}
       
         
        
      </View>
    )}
  </View>

  {/* Wishlist */}
  <View style={styles.petsColumn}>
    <View style={styles.petsHeaderRow}>
      <Text style={styles.petsTitle}>
        Wishlist
      </Text>
      {user?.id && (
        <TouchableOpacity onPress={()=>handleManagePets('wish')}>
         {user?.id && <Icon name="create" size={24} color={'#566D5D'} />}
        </TouchableOpacity>
      )}
    </View>

    {wishlistPets.length === 0 ? (
      <Text style={styles.petsEmptyText}>
     {user?.id ? 'Add pets you want' : 'Login & Add pets you want'}
      </Text>
    ) : (
      <View style={styles.petsAvatarRow}>
        {wishlistPets.map((pet, index)=>(renderPetBubble(pet, index)))}
       
        
      
      </View>
    )}
  </View>
</View>
      </View>

     

      {/* Options Section */}
      <ScrollView showsVerticalScrollIndicator={false}>
         {/* Purchases Section */}
    


        <Text style={styles.subtitle}>{t('settings.app_settings')}</Text>
        <View style={styles.cardContainer}>
          <View style={styles.option} onPress={() => {
            handleShareApp(); triggerHapticFeedback('impactLight');
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Icon name="radio-outline" size={18} color={'white'} style={{backgroundColor:'#B76E79', padding:5, borderRadius:5}} />
                <Text style={styles.optionText}>{t('settings.haptic_feedback')}</Text></TouchableOpacity>
              <Switch value={localState.isHaptic} onValueChange={handleToggle} />
            </View>

          </View>
          <View style={styles.optionLast} onPress={() => {
            handleShareApp(); triggerHapticFeedback('impactLight');
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Icon name="notifications" size={18} color={'white'} style={{backgroundColor:config.colors.hasBlockGreen, padding:5, borderRadius:5}}/>
                <Text style={styles.optionText}>{t('settings.chat_notifications')}</Text></TouchableOpacity>
              <Switch
                value={isPermissionGranted}
                onValueChange={handleToggleNotification}
              />
            </View>

          </View>

          <View style={styles.optionLast} onPress={() => {
            handleShareApp(); triggerHapticFeedback('impactLight');
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Icon name="contrast-outline" size={18} color={'white'} style={{backgroundColor:'#4A90E2', padding:5, borderRadius:5}}/>
                <Text style={styles.optionText}>{t('settings.theme')}</Text></TouchableOpacity>
              <View style={styles.containertheme}>
                {themes.map((theme, index) => (
                  <TouchableOpacity
                    key={theme}
                    style={[
                      styles.box,
                      localState.theme === ['system', 'light', 'dark'][index].toLowerCase() && styles.selectedBox, // Highlight selected box
                    ]}
                    onPress={() => updateLocalState('theme', ['system', 'light', 'dark'][index])}
                  >
                    
                    <Text
                    style={[
                      styles.text,
                      localState.theme === ['system', 'light', 'dark'][index] && styles.selectedText, // Highlight selected text
                    ]}
                  >
                    {theme}
                  </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* <Text style={styles.subtitle}>{t('settings.language_settings')}</Text>
        <View style={styles.cardContainer}>
          <View style={[styles.optionLast, { flexDirection: 'row', justifyContent: 'space-between' }]}>
            <View style={{ flexDirection: 'row', }}>
          <Icon name="language-outline" size={18} color={'white'} style={{backgroundColor:'purple', padding:5, borderRadius:5}}/>

            <Text style={styles.optionText}>{t('settings.select_language')}</Text></View>

            <Menu>
              <MenuTrigger style={styles.menuTrigger}>
                <Text style={styles.optionText}>
                  {languageOptions.find(l => l.code === language)?.flag} {language.toUpperCase()} ▼
                </Text>
              </MenuTrigger>

              <MenuOptions style={styles.options}>
                {languageOptions.map((lang) => (
                  <MenuOption key={lang.code} onSelect={()=>handleSelect(lang.code)} style={styles.option_menu}>
                    <Text>
                      {lang.flag} {lang.label}
                    </Text>
                  </MenuOption>
                ))}
              </MenuOptions>
            </Menu>
          </View>
        </View> */}


        <Text style={styles.subtitle}>{t('settings.pro_subscription')}</Text>
        <View style={[styles.cardContainer, {backgroundColor:'#FFD700'}]}>

          <TouchableOpacity style={[styles.optionLast]} onPress={() => { setShowofferWall(true);     
 }}>
            <Icon name="prism-outline" size={18} color={'white'} style={{backgroundColor:config.colors.hasBlockGreen, padding:5, borderRadius:5}}/>
            <Text style={[styles.optionText, {color:'black'}]}>
            {t('settings.active_plan')} : {localState.isPro ? t('settings.paid') : t('settings.free')}
            </Text>
          </TouchableOpacity>
          {localState.isPro && (
            <View style={styles.subscriptionContainer}>
              <Text style={styles.subscriptionText}>
              {t('settings.active_plan')} - 
                  {mySubscriptions.length === 0
                  ?   t('settings.paid')
                  : mySubscriptions.map(sub => formatPlanName(sub.plan)).join(', ')}
              </Text>

              <TouchableOpacity onPress={manageSubscription} style={styles.manageButton}>
                <Text style={styles.manageButtonText}>{t('settings.manage')}</Text>
              </TouchableOpacity>

            </View>
          )}
        </View>
     

        <Text style={styles.subtitle}>{t('settings.other_settings')}</Text>

        <View style={styles.cardContainer}>


          <TouchableOpacity style={styles.option} onPress={() => {
            handleShareApp(); triggerHapticFeedback('impactLight');
          }}>
            <Icon name="share-social-outline" size={18} color={'white'} style={{backgroundColor:'#B76E79', padding:5, borderRadius:5}}/>
            <Text style={styles.optionText}>{t('settings.share_app')}</Text>
          </TouchableOpacity>
          {/* <TouchableOpacity style={styles.option} onPress={() => {
            handleGetSuggestions(user); triggerHapticFeedback('impactLight');
          }}>
            <Icon name="color-filter-outline" size={18} color={'white'}  style={{backgroundColor:'#066D5D', padding:5, borderRadius:5}}/>
            <Text style={styles.optionText}>Partner with Us</Text>
          </TouchableOpacity> */}
          <TouchableOpacity style={styles.option} onPress={() => {
            handleGetSuggestions(user); triggerHapticFeedback('impactLight');
          }}>
            <Icon name="mail-outline" size={18} color={'white'}  style={{backgroundColor:'#566D5D', padding:5, borderRadius:5}}/>
            <Text style={styles.optionText}>Contact Us</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.option} onPress={() => {
            handleReport(user); triggerHapticFeedback('impactLight');
          }}>
            <Icon name="warning" size={18} color={'pink'}  style={{backgroundColor:'#566D5D', padding:5, borderRadius:5}}/>
            <Text style={styles.optionText}>Report Abusive Content</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.option} onPress={() => { handleRateApp(); triggerHapticFeedback('impactLight'); }
          }>
            <Icon name="star-outline" size={18} color={'white'} style={{backgroundColor:'#A2B38B', padding:5, borderRadius:5}}/>
            <Text style={styles.optionText}>{t('settings.rate_us')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.option} onPress={() => {
            handleOpenFacebook(); triggerHapticFeedback('impactLight');
          }}>
            <Icon name="logo-facebook" size={18} color={'white'} style={{backgroundColor:'#566D5D', padding:5, borderRadius:5}}/>
            <Text style={styles.optionText}>{t('settings.visit_facebook_group')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={user?.id ? styles.option : styles.optionLast} onPress={() => {
            handleOpenWebsite(); triggerHapticFeedback('impactLight');
          }}>
            <Icon name="link-outline" size={18} color={'white'}  style={{backgroundColor:'#4B4453', padding:5, borderRadius:5}}/>
            <Text style={styles.optionText}>{t('settings.visit_website')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={user?.id ? styles.option : styles.optionLast} onPress={() => {
            handleOpenPrivacy(); triggerHapticFeedback('impactLight');
          }}>
            <Icon name="link-outline" size={18} color={'white'}  style={{backgroundColor:'green', padding:5, borderRadius:5}}/>
            <Text style={styles.optionText}>Privacy Policy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={user?.id ? styles.option : styles.optionLast} onPress={() => {
            handleOpenChild(); triggerHapticFeedback('impactLight');
          }}>
            <Icon name="link-outline" size={18} color={'white'}  style={{backgroundColor:'blue', padding:5, borderRadius:5}}/>
            <Text style={styles.optionText}>Child Safety Standards</Text>
          </TouchableOpacity>
          {user?.id && <TouchableOpacity style={styles.option} onPress={handleLogout} >
            <Icon name="person-outline" size={18} color={'white'} style={{backgroundColor:'#4B4453', padding:5, borderRadius:5}} />
            <Text style={styles.optionTextLogout}>{t('settings.logout')}</Text>
          </TouchableOpacity>}
          {user?.id && <TouchableOpacity style={styles.optionDelete} onPress={handleDeleteUser} >
            <Icon name="warning-outline" size={24} color={'#4B4453'} />
            <Text style={styles.optionTextDelete}>{t('settings.delete_my_account')}</Text>
          </TouchableOpacity>}

         

        </View>
        <Text style={styles.subtitle}>Our Other APPS</Text>
       
        <View style={styles.cardContainer}>


<TouchableOpacity style={styles.option} onPress={() => {
  handleadoptme(); triggerHapticFeedback('impactLight');
}}>
 <Image 
  source={require('../../assets/adoptme.png')} 
  style={{ width: 40, height: 40,   borderRadius: 5 }} 
/>

  <Text style={styles.optionText}>Adopt Me Values</Text>
</TouchableOpacity>
<TouchableOpacity style={styles.optionLast} onPress={() => {
            handleMM2(); triggerHapticFeedback('impactLight');
          }}>
            <Image
              source={require('../../assets/logo2.png')}
              style={{ width: 40, height: 40, borderRadius: 5 }}
            />

            <Text style={styles.optionText}>MM2 Values</Text>
          </TouchableOpacity>


</View>
<Text style={styles.subtitle}>Business Enquiries
</Text>

<Text style={styles.text}>
    For collaborations, partnerships, or other business-related queries, feel free to contact us at:{' '}
    <TouchableOpacity onPress={() => Linking.openURL('mailto:thesolanalabs@gmail.com')}>
      <Text style={styles.emailText}>thesolanalabs@gmail.com</Text>
    </TouchableOpacity>
  </Text>


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
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                {/* <Image
                  source={
                    typeof selectedImage === 'string' && selectedImage.trim()
                      ? { uri: selectedImage }
                      : { uri: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }
                  }
                  style={[
                    styles.profileImage,
                    { marginRight: 10, width: 30, height: 30, borderRadius: 15 },
                  ]}
                /> */}
                <View style={{ flex: 1 }}>

              {/* Name Input */}
              <Text style={styles.drawerSubtitle}>{t('settings.change_display_name')}</Text>
              <TextInput
                 style={[styles.input, { marginTop: 4 }]}
                placeholder="Enter new display name"
                value={newDisplayName}
                onChangeText={setNewDisplayName}
              />
  </View>
  </View>
              {/* Profile Image Selection */}
              <Text style={[styles.drawerSubtitle]}>
                {t('settings.select_profile_icon')}
              </Text>

          
              <TouchableOpacity
                style={[
                  styles.saveButton,
                  {
                    backgroundColor: config.colors.secondary,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 10,
                  },
                ]}
                onPress={handlePickAndUploadAvatar}
                disabled={uploadingAvatar}
              >
                {uploadingAvatar ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Icon
                      name="cloud-upload-outline"
                      size={18}
                      color="#fff"
                      style={{ marginRight: 6 }}
                    />
                    <Text style={styles.saveButtonText}>
                      Upload from gallery
                    </Text>
                  </>
                )}
              </TouchableOpacity>
              <TextInput
                style={[
                  styles.input,
                  // { marginBottom: 8, fontSize: 12, paddingVertical: 6 },
                ]}
                placeholder="Search pets (e.g. Giraffe, Egg...)"
                placeholderTextColor="#999"
                value={avatarSearch}
                onChangeText={setAvatarSearch}
              />

<FlatList
                data={filteredAvatarOptions}
                keyExtractor={(item, index) => `${item.url}-${index}`}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingVertical: 4 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    onPress={() => setSelectedImage(item.url)}
                    style={[
                      styles.imageOptionWrapper,
                      selectedImage === item.url && styles.imageOptionSelected,
                      { alignItems: 'center', marginRight: 10 },
                    ]}
                  >
                    <Image
                      source={{ uri: item.url }}
                      style={styles.imageOption}
                    />
                    {/* {item.type !== 'default' && (
                      <Text
                        numberOfLines={1}
                        style={{
                          fontSize: 10,
                          marginTop: 4,
                          maxWidth: 70,
                          color: isDarkMode ? '#ddd' : '#333',
                        }}
                      >
                        {item.name}
                      </Text>
                    )} */}
                  </TouchableOpacity>
                )}
              />


              <TouchableOpacity
                   style={[styles.saveButton, { marginTop: 16 }]}
                onPress={handleSaveChanges}
              >
                <Text style={styles.saveButtonText}>{t('settings.save_changes')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ConditionalKeyboardWrapper>
      </Modal>
      <PetModal fromSetting={true} ownedPets={ownedPets} setOwnedPets={setOwnedPets} wishlistPets={wishlistPets} setWishlistPets={setWishlistPets} onClose={async ()=>{{ setPetModalVisible(false); await savePetsToReviews(ownedPets, wishlistPets)}}}       visible={petModalVisible} owned={owned}
            />
      <SubscriptionScreen visible={showOfferWall} onClose={() => setShowofferWall(false)} track='Setting'   oneWallOnly={single_offer_wall}
      />
      <SignInDrawer
        visible={openSingnin}
        onClose={() => setOpenSignin(false)}
        selectedTheme={selectedTheme}
        message='Signin to access all features'
         screen='Setting'
      />
 
    </View>
  );
}