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
  ScrollView,
  Switch,
  Linking,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../GlobelStats';
import { getStyles } from './settingstyle';
import { handleGetSuggestions, handleOpenFacebook, handleOpenWebsite, handleRateApp, handleShareApp, imageOptions, } from './settinghelper';
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


export default function SettingsScreen({ selectedTheme }) {
  const [isDrawerVisible, setDrawerVisible] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [openSingnin, setOpenSignin] = useState(false);
  const { user, theme, updateLocalStateAndDatabase, setUser, appdatabase, analytics } = useGlobalState()
  const { updateLocalState, localState, mySubscriptions } = useLocalState()
  const [isPermissionGranted, setIsPermissionGranted] = useState(false);
  const [showOfferWall, setShowofferWall] = useState(false);
  const { language, changeLanguage } = useLanguage();

  const { t } = useTranslation();
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

  const handleSaveChanges = async () => {

    triggerHapticFeedback('impactLight');
    const MAX_NAME_LENGTH = 20;

    if (!user?.id) return;

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
      // console.error('Error updating profile:', error);
    }
  };



  const displayName = user?.id
    ? newDisplayName?.trim() || user?.displayName || 'Anonymous'
    : 'Guest User';




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


const handleSelect = (lang) => {
  if(!localState.isPro){
    setShowofferWall(true)
  } else
 { setAppLanguage(lang); 
  changeLanguage(lang)}
}


const formatPlanName = (plan) => {
  // console.log(plan, 'plan');

  if (plan === 'MONTHLY' || plan === 'Blox_values_199_1m') return '1 MONTH';
  if (plan === 'QUARTERLY' || plan === 'Blox_values_499_3m') return '3 MONTHS';
  if (plan === 'YEARLY' || plan === 'Blox_values_999_1y') return '1 YEAR';

  return 'Anonymous Plan';
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
              <Text style={!user?.id ? styles.userNameLogout : styles.userName}>
                {!user?.id ? t("settings.login_register") : displayName}
                {user?.isPro &&  
        <Icon
          name="checkmark-done-circle"
          size={16}
          color={config.colors.hasBlockGreen}
          
        />}
              </Text>
              {!user?.id && <Text style={styles.rewardLogout}>{t('settings.login_description')}</Text>}
              {user?.id && <Text style={styles.reward}>{t("settings.my_points")}: {user?.rewardPoints || 0}</Text>}
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={handleProfileUpdate}>
            {user?.id && <Icon name="create" size={24} color={'#566D5D'} />}
          </TouchableOpacity>
        </View>
      </View>

      {/* Options Section */}
      <ScrollView showsVerticalScrollIndicator={false}>
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
          <View style={styles.option} onPress={() => {
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

        <Text style={styles.subtitle}>{t('settings.language_settings')}</Text>
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
        </View>


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
          <TouchableOpacity style={styles.option} onPress={() => {
            handleGetSuggestions(user); triggerHapticFeedback('impactLight');
          }}>
            <Icon name="mail-outline" size={18} color={'white'}  style={{backgroundColor:'#566D5D', padding:5, borderRadius:5}}/>
            <Text style={styles.optionText}>{t('settings.give_suggestions')}</Text>
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
          {user?.id && <TouchableOpacity style={styles.option} onPress={handleLogout} >
            <Icon name="person-outline" size={18} color={'white'} style={{backgroundColor:'#4B4453', padding:5, borderRadius:5}} />
            <Text style={styles.optionTextLogout}>{t('settings.logout')}</Text>
          </TouchableOpacity>}
          {user?.id && <TouchableOpacity style={styles.optionDelete} onPress={handleDeleteUser} >
            <Icon name="warning-outline" size={24} color={'#4B4453'} />
            <Text style={styles.optionTextDelete}>{t('settings.delete_my_account')}</Text>
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
              <Text style={styles.drawerSubtitle}>{t('settings.change_display_name')}</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter new display name"
                value={newDisplayName}
                onChangeText={setNewDisplayName}
              />

              {/* Profile Image Selection */}
              <Text style={styles.drawerSubtitle}>{t('settings.select_profile_icon')}</Text>
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
                <Text style={styles.saveButtonText}>{t('settings.save_changes')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ConditionalKeyboardWrapper>
      </Modal>
     
      <SubscriptionScreen visible={showOfferWall} onClose={() => setShowofferWall(false)} track='Setting'/>
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