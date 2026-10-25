import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
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
  Linking,
  Platform,
  ActivityIndicator,
  Animated,
  StyleSheet,
  BackHandler,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import Clipboard from '@react-native-clipboard/clipboard';
import FramedAvatar from '../ChatScreen/GroupChat/FramedAvatar';
import ProfileBottomDrawer from '../ChatScreen/GroupChat/BottomDrawer';
import { getMyCosmetics } from '../Helper/cosmeticsCache';
import { useGlobalState, modGateText } from '../GlobelStats';
import { getStyles } from './settingstyle';
import { handleGetSuggestions, handleOpenFacebook, handleOpenWebsite, handleRateApp, handleadoptme, handleShareApp, imageOptions, handleBloxFruit, handleMM2, handleRefresh, handleReport, handleOpenPrivacy, handleOpenChild } from './settinghelper';
import EmailUpdatesRow from './EmailUpdatesRow';
import { SettingsGroup, SettingsRow, SubPageHeader, getRowStyles, legacyRowProps } from './SettingsUI';
import { getThemeColors } from '../Helper/themeColors';
import DeviceInfo from 'react-native-device-info';
import BirthdayVisibilityRow from '../Birthdays/BirthdayVisibilityRow';
import ScreenBottomBanner from '../Ads/ScreenBottomBanner';
import { usePrivacyOptionsRequired, showPrivacyOptionsForm } from '../Ads/consentOptions';
import { logoutUser } from '../Firebase/UserLogics';
import SignInDrawer from '../Firebase/SigninDrawer';
import { getAuth } from '@react-native-firebase/auth';
import { resetUserState } from '../Globelhelper';
import ConditionalKeyboardWrapper from '../Helper/keyboardAvoidingContainer';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useLocalState } from '../LocalGlobelStats';
import { setValueUpdateSubscription } from '../Helper/valueUpdateAlerts';
import config from '../Helper/Environment';
import notifee from '@notifee/react-native';
import SubscriptionScreen from './OfferWall';
import { ref, remove, get, update } from '@react-native-firebase/database';
import { Menu, MenuOption, MenuOptions, MenuTrigger } from 'react-native-popup-menu';
import { useLanguage } from '../Translation/LanguageProvider';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import { claimUsername } from '../Supabase/usernameBackend';
import { validateContent, validateUsername, isAllowedLink } from '../Helper/ContentModeration';
import { setAppLanguage } from '../../i18n';
import StyledUsernamePreview from './Store/StyledName';
import StyledDisplayName from './Store/NameDisplayReUser';
import { safeCompressImage } from '../Helper/safeCompressImage';
import RNFS from 'react-native-fs';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

// Initialize dayjs plugins
dayjs.extend(relativeTime);


import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  startAfter,
  deleteDoc,
  Timestamp,
  writeBatch,
} from '@react-native-firebase/firestore';
import PetModal from '../ChatScreen/PrivateChat/PetsModel';
import { openReportForm, reviewForReport } from '../Reports/openReportForm';
import { launchImageLibrary } from 'react-native-image-picker';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
// Avatars upload through the server (uploadImage); the app holds no storage key.
import { uploadImage, UPLOAD_KIND } from '../Helper/imageUpload';

// Glossy row tiles from scripts/app-icons/make-icons.mjs (same 28 pt box the
// padded font icons used).
const SETTINGS_IMAGES = {
  haptic: require('../../assets/settings-icons/haptic.png'),
  notifications: require('../../assets/settings-icons/notifications.png'),
  theme: require('../../assets/settings-icons/theme.png'),
  pro: require('../../assets/settings-icons/pro.png'),
  share: require('../../assets/settings-icons/share.png'),
  contact: require('../../assets/settings-icons/contact.png'),
  report: require('../../assets/settings-icons/report.png'),
  rate: require('../../assets/settings-icons/rate.png'),
  community: require('../../assets/settings-icons/community.png'),
  website: require('../../assets/settings-icons/website.png'),
  privacy: require('../../assets/settings-icons/privacy.png'),
  privacyOptions: require('../../assets/settings-icons/privacyOptions.png'),
  childSafety: require('../../assets/settings-icons/childSafety.png'),
  logout: require('../../assets/settings-icons/logout.png'),
};
const SETTINGS_IMAGE = { width: 28, height: 28 };

// ~500 KB max for avatar (small, DP-friendly)
const MAX_AVATAR_SIZE_BYTES = 500 * 1024;
// Stable empty list for the public-profile preview drawer.
const NO_BANNED_USERS = [];

// Icon map for trades
const iconMap = {
  "camping": require("../../assets/Icons/camping.png"),
  "dinamite": require("../../assets/Icons/dinamite.png"),
  "fire": require("../../assets/Icons/fire.png"),
  "grenade": require("../../assets/Icons/grenade.png"),
  "handheld-game": require("../../assets/Icons/handheld-game.png"),
  "paw-print": require("../../assets/Icons/paw-print.png"),
  "play": require("../../assets/Icons/play.png"),
  "shooting-star": require("../../assets/Icons/shooting-star.png"),
  "smile": require("../../assets/Icons/smile.png"),
  "symbol": require("../../assets/Icons/symbol.png"),
  "treasure-map": require("../../assets/Icons/treasure-map.png"),
};

// Helper function to format item names
const formatTradeName = (name) => {
  let formattedName = name.replace(/^\+/, '');
  formattedName = formattedName.replace(/\s+/g, '-');
  return formattedName;
};

// Helper function to format values
const formatTradeValue = (value) => {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  } else if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  } else if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  } else {
    return value.toLocaleString();
  }
};

// Helper function to group items
const groupTradeItems = (items) => {
  const grouped = {};
  items.forEach(({ name, type }) => {
    const key = `${name}-${type}`;
    if (grouped[key]) {
      grouped[key].count += 1;
    } else {
      grouped[key] = { name, type, count: 1 };
    }
  });
  return Object.values(grouped);
};

// Helper function to get trade deal
const getTradeDeal = (hasTotal, wantsTotal) => {
  if (!hasTotal || !hasTotal.value || hasTotal.value <= 0) {
    return { deal: { label: "trade.unknown_deal", color: "#8E8E93" }, tradeRatio: 0 };
  }

  const tradeRatio = wantsTotal?.value ? wantsTotal.value / hasTotal.value : 0;
  let deal;

  if (tradeRatio >= 0.05 && tradeRatio <= 0.6) {
    deal = { label: "trade.best_deal", color: "#34C759" };
  } else if (tradeRatio > 0.6 && tradeRatio <= 0.75) {
    deal = { label: "trade.great_deal", color: "#32D74B" };
  } else if (tradeRatio > 0.75 && tradeRatio <= 1.25) {
    deal = { label: "trade.fair_deal", color: "#FFCC00" };
  } else if (tradeRatio > 1.25 && tradeRatio <= 1.4) {
    deal = { label: "trade.decent_deal", color: "#FF9F0A" };
  } else if (tradeRatio > 1.4 && tradeRatio <= 1.55) {
    deal = { label: "trade.weak_deal", color: "#D65A31" };
  } else {
    deal = { label: "trade.risky_deal", color: "#7D1128" };
  }

  return { deal, tradeRatio };
};

// Roblox bio code for this account. Derived from the uid so it never changes
// between attempts. Consonants only: Roblox's filter can hashtag digit runs
// and letter combos that spell words.
const ROBLOX_CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
const robloxVerificationCode = (uid) => {
  let h = 2166136261;
  for (let i = 0; i < uid.length; i++) {
    h = Math.imul(h ^ uid.charCodeAt(i), 16777619);
  }
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROBLOX_CODE_LETTERS[(h >>> 0) % ROBLOX_CODE_LETTERS.length];
    h = Math.imul(h ^ (h >>> 15), 2246822507) + i;
  }
  return `BFV-${code}`;
};

// users.roblox.com rate-limits per IP (shared school/mobile IPs hit it fast):
// wait once and retry before giving up.
const fetchRoblox = async (url, options) => {
  const response = await fetch(url, options);
  if (response.status !== 429) return response;
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return fetch(url, options);
};

// Modern Minimalist Edit Profile Drawer Component
const EditProfileDrawerContent = ({
  isDarkMode,
  newDisplayName,
  setNewDisplayName,
  handlePickAndUploadAvatar,
  uploadingAvatar,
  avatarSearch,
  setAvatarSearch,
  filteredAvatarOptions,
  selectedImage,
  setSelectedImage,
  bio,
  setBio,
  handleSaveChanges,
  t,
  config,
  user,
  isVisible,
}) => {
  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const insets = useSafeAreaInsets();
  const PROFILE_EDIT_COOLDOWN_DAYS = 10;

  // ✅ Calculate cooldown status - only checks existing cooldown from last save, not unsaved changes
  const cooldownStatus = useMemo(() => {
    // ✅ Only check if user is in cooldown from their last saved edit
    // Cooldown is NOT triggered by making changes, only when they press "Save"
    if (!user?.lastProfileEditAt) {
      return { inCooldown: false, daysRemaining: 0 };
    }

    const lastEditTimestamp = typeof user.lastProfileEditAt === 'number'
      ? user.lastProfileEditAt
      : Date.parse(user.lastProfileEditAt);

    if (isNaN(lastEditTimestamp)) {
      return { inCooldown: false, daysRemaining: 0 };
    }

    const now = Date.now();
    const daysSinceLastEdit = (now - lastEditTimestamp) / (1000 * 60 * 60 * 24);
    const daysRemaining = Math.ceil(PROFILE_EDIT_COOLDOWN_DAYS - daysSinceLastEdit);

    return {
      inCooldown: daysSinceLastEdit < PROFILE_EDIT_COOLDOWN_DAYS,
      daysRemaining: daysRemaining > 0 ? daysRemaining : 0,
    };
  }, [user?.lastProfileEditAt]);

  // ✅ Check if user is trying to save name/avatar changes (for save button state)
  const isTryingToSaveNameOrAvatar = useMemo(() => {
    const displayNameChanged = newDisplayName.trim() !== (user?.displayName || '').trim();
    const avatarChanged = (selectedImage || '').trim() !== (user?.avatar || '').trim();
    return displayNameChanged || avatarChanged;
  }, [newDisplayName, selectedImage, user?.displayName, user?.avatar]);

  // ✅ Determine if save button should be disabled (only if in cooldown AND trying to save name/avatar)
  const shouldDisableSave = cooldownStatus.inCooldown && isTryingToSaveNameOrAvatar;

  // Animation removed - using Modal's built-in slide animation

  return (
    <Animated.View
      style={[
        styles.drawer,
        {
          padding: 14,
          paddingBottom: insets.bottom > 0 ? insets.bottom + 14 : 14,
          width: '100%',
          minHeight: 400,
        },
      ]}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 0 }}
      >
        {/* Display Name - Minimal Design */}
        <View style={{ marginBottom: 10 }}>
          <Text style={{ fontSize: 11, fontWeight: 'bold', color: isDarkMode ? '#9ca3af' : '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {t('settings.setting.display_name')}
          </Text>
          <TextInput
            style={{
              backgroundColor: isDarkMode ? '#1a1a1a' : '#f5f5f5',
              padding: 12,
              borderRadius: 10,
              fontSize: 14,
              color: isDarkMode ? '#fff' : '#000',
              borderWidth: 0,
            }}
            placeholder={t('settings.setting.enter_name')}
            placeholderTextColor={isDarkMode ? '#6b7280' : '#9ca3af'}
            value={newDisplayName}
            onChangeText={setNewDisplayName}
          />
        </View>

        {/* Profile Picture - Clean Section */}
        <View style={{ marginBottom: 10 }}>
          <Text style={{ fontSize: 11, fontWeight: 'bold', color: isDarkMode ? '#9ca3af' : '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {t('settings.setting.profile_picture')}
          </Text>

          <TouchableOpacity
            style={{
              backgroundColor: isDarkMode ? '#1a1a1a' : '#f5f5f5',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 11,
              borderRadius: 10,
              marginBottom: 8,
            }}
            onPress={handlePickAndUploadAvatar}
            disabled={uploadingAvatar}
            activeOpacity={0.7}
          >
            {uploadingAvatar ? (
              <ActivityIndicator color={config.colors.primary} size="small" />
            ) : (
              <>
                <Icon
                  name="cloud-upload-outline"
                  size={16}
                  color={config.colors.primary}
                  style={{ marginRight: 6 }}
                />
                <Text style={{ color: config.colors.primary, fontSize: 13, fontWeight: 'bold' }}>
                  {t('settings.setting.upload_photo')}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <View style={{
            backgroundColor: isDarkMode ? '#1a1a1a' : '#f5f5f5',
            borderRadius: 10,
            padding: 8,
            marginBottom: 8,
            flexDirection: 'row',
            alignItems: 'center',
          }}>
            <Icon name="search-outline" size={14} color={isDarkMode ? '#6b7280' : '#9ca3af'} style={{ marginRight: 8 }} />
            <TextInput
              style={{
                flex: 1,
                fontSize: 13,
                color: isDarkMode ? '#fff' : '#000',
                padding: 0,
              }}
              placeholder={t('settings.setting.search_fruits')}
              placeholderTextColor={isDarkMode ? '#6b7280' : '#9ca3af'}
              value={avatarSearch}
              onChangeText={setAvatarSearch}
            />
          </View>

          {/* Avatar Grid - Minimal */}
          <FlatList
            data={filteredAvatarOptions}
            keyExtractor={(item, index) => `${item.url}-${index}`}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingVertical: 4 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => setSelectedImage(item.url)}
                activeOpacity={0.7}
                style={{
                  marginRight: 8,
                  borderRadius: 20,
                  borderWidth: selectedImage === item.url ? 2.5 : 0,
                  borderColor: config.colors.primary,
                  padding: selectedImage === item.url ? 2 : 0,
                }}
              >
                <Image resizeMethod="resize"
                  source={{ uri: item.url }}
                  style={{ width: 40, height: 40, borderRadius: 20, opacity: selectedImage === item.url ? 1 : 0.6 }}
                />
              </TouchableOpacity>
            )}
          />
        </View>

        {/* Bio - Clean Design */}
        <View style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ fontSize: 11, fontWeight: 'bold', color: isDarkMode ? '#9ca3af' : '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {t('settings.setting.bio')}
            </Text>
            <Text style={{
              fontSize: 10,
              color: bio.length > 120 ? '#EF4444' : (isDarkMode ? '#6b7280' : '#9ca3af'),
              fontWeight: 'bold',
            }}>
              {bio.length}/120
            </Text>
          </View>
          <TextInput
            style={{
              backgroundColor: isDarkMode ? '#1a1a1a' : '#f5f5f5',
              minHeight: 65,
              textAlignVertical: 'top',
              padding: 12,
              borderRadius: 10,
              fontSize: 13,
              color: isDarkMode ? '#fff' : '#000',
              borderWidth: 0,
            }}
            placeholder={t('settings.setting.bio_placeholder')}
            placeholderTextColor={isDarkMode ? '#6b7280' : '#9ca3af'}
            value={bio}
            onChangeText={(text) => {
              if (text.length <= 120) {
                setBio(text);
              }
            }}
            maxLength={120}
            multiline={true}
            numberOfLines={3}
            autoCapitalize="sentences"
            autoCorrect={true}
          />
        </View>

        {/* ✅ Cooldown Warning Message - only show if trying to save name/avatar changes */}
        {shouldDisableSave && (
          <View
            style={{
              backgroundColor: isDarkMode ? '#1a1a1a' : '#fef3c7',
              padding: 12,
              borderRadius: 10,
              marginBottom: 12,
              borderWidth: 1,
              borderColor: isDarkMode ? '#F59E0B' : '#FCD34D',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              <Icon name="time-outline" size={16} color="#F59E0B" style={{ marginRight: 6 }} />
              <Text style={{
                fontSize: 12,
                fontWeight: 'bold',
                color: isDarkMode ? '#FCD34D' : '#92400E'
              }}>
                {t('settings.setting.cooldown_active')}
              </Text>
            </View>
            <Text style={{
              fontSize: 11,

              color: isDarkMode ? '#FCD34D' : '#92400E',
              lineHeight: 16,
            }}>
              {t('settings.setting.cooldown_body', { days: PROFILE_EDIT_COOLDOWN_DAYS, count: cooldownStatus.daysRemaining })}
            </Text>
          </View>
        )}

        {/* Modern Save Button */}
        <TouchableOpacity
          style={{
            backgroundColor: shouldDisableSave
              ? (isDarkMode ? '#374151' : '#9ca3af')
              : config.colors.primary,
            paddingVertical: 13,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: shouldDisableSave ? 0.6 : 1,
          }}
          onPress={handleSaveChanges}
          disabled={shouldDisableSave}
          activeOpacity={0.8}
        >
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: 'bold' }}>
            {shouldDisableSave
              ? t('settings.setting.edit_available_in', { count: cooldownStatus.daysRemaining })
              : t('settings.save_changes')}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </Animated.View>
  );
};

const formatName = (name) => name.replace(/^\+/, '').replace(/\s+/g, '-');

export default function SettingsScreen({ selectedTheme }) {
  const insets = useSafeAreaInsets();
  const [isDrawerVisible, setDrawerVisible] = useState(false);
  // Public-profile preview. The drawer starts loading the moment it has a
  // selectedUser (it does not wait for isVisible), so it is only mounted
  // while open or sliding closed: target = who it shows, visible = open.
  const [showPublicProfile, setShowPublicProfile] = useState(false);
  const [publicProfileTarget, setPublicProfileTarget] = useState(null);
  const publicProfileCloseTimer = useRef(null);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [openSingnin, setOpenSignin] = useState(false);
  const { user, theme, updateLocalStateAndDatabase, setUser, appdatabase, firestoreDB, single_offer_wall, getModGate } = useGlobalState()

  // Banned users can't change what others see on their profile (name,
  // avatar, bio, Roblox name, reviews). Returns true when blocked.
  const blockedByModGate = (action) => {
    const modGate = getModGate('content');
    if (!modGate) return false;
    const { title, message } = modGateText(modGate, action);
    showErrorMessage(title, message);
    return true;
  };
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
  // In-screen sub-page of the grouped list: null | 'privacy' | 'help' | 'legal'.
  const [subPage, setSubPage] = useState(null);
  const [showRobloxSheet, setShowRobloxSheet] = useState(false);
  // Own active cosmetics from MMKV cache (instant, no DB call) — re-read on
  // tab switch so a frame equipped in the store shows up when returning.
  const myActiveCosmetics = useMemo(() => getMyCosmetics(), [subPage]);
  const [userReviews, setUserReviews] = useState([]); // Reviews user gave to others
  const [receivedReviews, setReceivedReviews] = useState([]); // Reviews others gave to user
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [loadingReceivedReviews, setLoadingReceivedReviews] = useState(false);
  const [editingReview, setEditingReview] = useState(null);
  const [editReviewText, setEditReviewText] = useState('');
  const [editReviewRating, setEditReviewRating] = useState(0);
  const [lastGaveDoc, setLastGaveDoc] = useState(null); // Last document for pagination (gave)
  const [lastReceivedDoc, setLastReceivedDoc] = useState(null); // Last document for pagination (received)
  const [hasMoreGave, setHasMoreGave] = useState(false); // Whether there are more "gave" reviews
  const [hasMoreReceived, setHasMoreReceived] = useState(false); // Whether there are more "received" reviews
  const [showGaveReviewsModal, setShowGaveReviewsModal] = useState(false); // Modal visibility for gave reviews
  const [showReceivedReviewsModal, setShowReceivedReviewsModal] = useState(false); // Modal visibility for received reviews
  const [modalGaveReviews, setModalGaveReviews] = useState([]); // Reviews shown in gave modal
  const [modalReceivedReviews, setModalReceivedReviews] = useState([]); // Reviews shown in received modal
  const [modalLastGaveDoc, setModalLastGaveDoc] = useState(null); // Last doc for modal pagination (gave)
  const [modalLastReceivedDoc, setModalLastReceivedDoc] = useState(null); // Last doc for modal pagination (received)
  const [modalHasMoreGave, setModalHasMoreGave] = useState(false); // Whether there are more gave reviews
  const [modalHasMoreReceived, setModalHasMoreReceived] = useState(false); // Whether there are more received reviews
  const [loadingModalGaveReviews, setLoadingModalGaveReviews] = useState(false);
  const [loadingModalReceivedReviews, setLoadingModalReceivedReviews] = useState(false);
  const [showMyTradesModal, setShowMyTradesModal] = useState(false); // Modal visibility for My Trades
  const [modalMyTrades, setModalMyTrades] = useState([]); // Trades shown in modal

  // Followers modal (load 2 by 2 like adoptme)
  const [showFollowersModal, setShowFollowersModal] = useState(false);
  const [modalFollowers, setModalFollowers] = useState([]);
  const [modalLastFollowerDoc, setModalLastFollowerDoc] = useState(null);
  const [modalHasMoreFollowers, setModalHasMoreFollowers] = useState(false);
  const [loadingModalFollowers, setLoadingModalFollowers] = useState(false);
  const [modalLastTradeDoc, setModalLastTradeDoc] = useState(null); // Last doc for modal pagination
  const [modalHasMoreTrades, setModalHasMoreTrades] = useState(false); // Whether there are more trades
  const [loadingModalMyTrades, setLoadingModalMyTrades] = useState(false);
  const [deletingTradeId, setDeletingTradeId] = useState(null); // Track which trade is being deleted
  const [isDeletingAll, setIsDeletingAll] = useState(false); // Track if deleting all trades
  const [robloxUsername, setRobloxUsername] = useState('');
  const [robloxUsernameVerified, setRobloxUsernameVerified] = useState(false);
  const [isVerifyingRoblox, setIsVerifyingRoblox] = useState(false);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [bio, setBio] = useState('');
  const savedBioRef = useRef(null); // bio as stored, so an unchanged one is not re-checked
  const [isSavingBio, setIsSavingBio] = useState(false);
  const [ratingSummary, setRatingSummary] = useState(null);
  const [loadingRating, setLoadingRating] = useState(false);
  const [createdAtText, setCreatedAtText] = useState(null);
  const initializedUserIdRef = useRef(null); // ✅ Track which user ID we've initialized for
  const scrollViewRef = useRef(null); // ✅ Ref for ScrollView to scroll to input

  const { t } = useTranslation();
  const privacyOptionsRequired = usePrivacyOptionsRequired();
  const BASE_ADOPTME_URL = 'https://bloxfruitscalc.com/wp-content/uploads/2024/09';

  // ✅ Fixed: 't' → 'tab', added Pressable + haptic for smooth switching

  const parsedValuesData = useMemo(() => {
    try {
      const raw = localState?.data;
      if (!raw) return [];

      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

      // Convert object map to array if needed
      return Array.isArray(parsed) ? parsed : Object.values(parsed || {});
    } catch (e) {
      // console.log('Error parsing localState.data', e);
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
      const { uri: compressedUri } = await safeCompressImage(asset.uri, {
        maxWidth: 300,
        quality: 0.7,
      });

      const filePath = compressedUri.replace('file://', '');
      const stat = await RNFS.stat(filePath);

      // 🔹 Reject heavy images
      if (stat.size > MAX_AVATAR_SIZE_BYTES) {
        Alert.alert(
          t('settings.setting.image_too_large_title'),
          t('settings.setting.image_too_large_body')
        );
        setUploadingAvatar(false);
        return;
      }

      // Stored under avatars/<uid>/ as before; the server checks the token.
      let publicUrl;
      try {
        publicUrl = await uploadImage(compressedUri, UPLOAD_KIND.avatar);
      } catch (err) {
        console.warn('[Bunny avatar ERROR]', err?.code || err?.message);
        Alert.alert(t('settings.setting.upload_failed'), t('settings.setting.upload_failed_body'));
        setUploadingAvatar(false);
        return;
      }

      // ✅ Set as current selected profile image
      setSelectedImage(publicUrl);
    } catch (e) {
      console.warn('[Avatar upload]', e?.message || e);
      Alert.alert(t('settings.setting.upload_failed'), t('settings.setting.something_wrong'));
    } finally {
      setUploadingAvatar(false);
    }
  }, [t]);



  const platform = Platform.OS.toLowerCase();
  // console.log(analytics)



  const { triggerHapticFeedback } = useHaptic();

  const publicProfileUser = useMemo(() => {
    if (!user?.id) return null;
    return {
      id: user.id,
      senderId: user.id,
      sender: user.displayName || t('chat.anonymous'),
      displayName: user.displayName || t('chat.anonymous'),
      avatar: user.avatar || null,
      flage: user.flage || null,
      robloxUsername: user.robloxUsername || null,
      robloxUserId: user.robloxUserId || null,
      robloxUsernameVerified: !!user.robloxUsernameVerified,
      isPro: !!localState?.isPro,
    };
  }, [user?.id, user?.displayName, user?.avatar, user?.flage, user?.robloxUsername, user?.robloxUserId, user?.robloxUsernameVerified, localState?.isPro, t]);

  const openSubPage = useCallback((page) => {
    triggerHapticFeedback('impactLight');
    setSubPage(page);
  }, [triggerHapticFeedback]);
  const closeSubPage = useCallback(() => setSubPage(null), []);

  // Android back on a sub-page returns to the main list, not out of Settings.
  useEffect(() => {
    if (!subPage) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSubPage(null);
      return true;
    });
    return () => sub.remove();
  }, [subPage]);

  const handleViewPublicProfile = useCallback(() => {
    triggerHapticFeedback('impactLight');
    if (!publicProfileUser) {
      showErrorMessage(t('home.alert.error'), t('settings.setting.login_first'));
      return;
    }
    if (publicProfileCloseTimer.current) {
      clearTimeout(publicProfileCloseTimer.current);
      publicProfileCloseTimer.current = null;
    }
    setPublicProfileTarget(publicProfileUser);
    setShowPublicProfile(true);
  }, [publicProfileUser, triggerHapticFeedback, t]);

  // Hide first so the Modal slides out, then unmount once the animation is
  // done (400 ms, as in Adopt Me's copy of this preview).
  const closePublicProfile = useCallback(() => {
    setShowPublicProfile(false);
    if (publicProfileCloseTimer.current) clearTimeout(publicProfileCloseTimer.current);
    publicProfileCloseTimer.current = setTimeout(() => {
      publicProfileCloseTimer.current = null;
      setPublicProfileTarget(null);
    }, 400);
  }, []);

  useEffect(() => () => {
    if (publicProfileCloseTimer.current) clearTimeout(publicProfileCloseTimer.current);
  }, []);

  const themes = [t('settings.theme_system'), t('settings.theme_light'), t('settings.theme_dark')];
  // const themes = ['System', 'Light','Dark'];

  const handleToggle = (value) => {
    updateLocalState('isHaptic', value); // Update isHaptic state globally
  };

  // ✅ Handle read receipts toggle
  const handleToggleReadReceipts = (value) => {
    updateLocalState('showReadReceipts', value);
  };

  // ✅ Handle online status visibility toggle
  const handleToggleOnlineStatus = async (value) => {
    // ✅ Check if user is pro - if not, show upgrade alert
    if (!localState.isPro) {
      Alert.alert(
        t('settings.setting.pro_feature'),
        t('settings.setting.pro_feature_body'),
        [
          { text: t("home.cancel"), style: 'cancel' },
          {
            text: t('settings.setting.upgrade'),
            style: 'default',
            onPress: () => setShowofferWall(true),
          },
        ]
      );
      return;
    }

    // ✅ Pro users can toggle freely
    // ✅ Just update local state - GlobelStats.js will handle RTDB update (presence/{uid})
    // ✅ Cloud Function will sync RTDB changes to Firestore online_users_node/list
    updateLocalState('showOnlineStatus', value);
  };

  // ✅ Verify Roblox username exists and get user ID
  const verifyRobloxUsername = async (username) => {
    if (!username || username.trim().length < 3) {
      return { valid: false, error: t('settings.setting.roblox_min_length') };
    }

    try {
      // ✅ Use POST request with JSON body (correct Roblox API format)
      const response = await fetchRoblox(
        'https://users.roblox.com/v1/usernames/users',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            usernames: [username.trim()],
            excludeBannedUsers: false,
          }),
        }
      );

      if (response.status === 429) {
        return { valid: false, error: t('settings.setting.roblox_busy') };
      }
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      // ✅ Check if data exists and has results
      if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
        return { valid: false, error: t('settings.setting.roblox_not_found') };
      }

      const robloxUser = data.data[0];
      if (!robloxUser || !robloxUser.id) {
        return { valid: false, error: t('settings.setting.roblox_invalid_data') };
      }

      return {
        valid: true,
        userId: robloxUser.id,
        displayName: robloxUser.displayName || username,
      };
    } catch (error) {
      console.error('Error verifying Roblox username:', error);
      return { valid: false, error: t('settings.setting.roblox_verify_failed', { detail: error.message || t('settings.setting.please_try_again') }) };
    }
  };

  // ✅ Check if verification code exists in Roblox profile description.
  // userId comes from the lookup the caller already made — a second username
  // lookup only spent more of Roblox's per-IP rate limit.
  const checkVerificationCode = async (userId, code) => {
    try {
      // Get user profile (description is publicly accessible)
      const profileResponse = await fetchRoblox(
        `https://users.roblox.com/v1/users/${userId}`
      );
      // A 429 body has no description, which used to read as "code not found"
      // even when the code was in the bio.
      if (profileResponse.status === 429) {
        return { verified: false, retry: true, error: t('settings.setting.roblox_busy') };
      }
      if (!profileResponse.ok) {
        return { verified: false, retry: true, error: t('settings.setting.roblox_check_failed') };
      }
      const profileData = await profileResponse.json();

      // Case and spaces don't matter: players retype the code by hand.
      const description = (profileData.description || '').toUpperCase().replace(/\s+/g, '');
      if (description.includes(code)) {
        return { verified: true, userId };
      } else {
        return { verified: false, error: t('settings.setting.roblox_code_not_found') };
      }
    } catch (error) {
      console.error('Error checking verification code:', error);
      return { verified: false, retry: true, error: t('settings.setting.roblox_check_failed') };
    }
  };

  // ✅ Handle Roblox username update with verification
  const handleUpdateRobloxUsername = async () => {
    if (!user?.id) {
      showErrorMessage(t('home.alert.error'), t('settings.setting.login_first'));
      return;
    }
    if (blockedByModGate('profile')) return;

    const trimmedUsername = robloxUsername.trim();
    if (!trimmedUsername) {
      showErrorMessage(t('home.alert.error'), t('settings.setting.enter_roblox_username'));
      return;
    }

    // First verify username exists
    setIsVerifyingRoblox(true);
    const verifyResult = await verifyRobloxUsername(trimmedUsername);

    if (!verifyResult.valid) {
      setIsVerifyingRoblox(false);
      showErrorMessage(t('settings.setting.invalid_username'), verifyResult.error);
      return;
    }

    // Same code every time for this account, so the one already in the bio
    // still matches after a retry or after Android kills the app while the
    // player is in Roblox.
    const code = robloxVerificationCode(user.id);
    setIsVerifyingRoblox(false);

    // Show instructions
    Alert.alert(
      t('settings.setting.verify_roblox_title'),
      t('settings.setting.verify_roblox_body', { code }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.setting.roblox_copy_code'),
          onPress: () => {
            Clipboard.setString(code);
            showSuccessMessage(t('settings.setting.roblox_code_copied_title'), t('settings.setting.roblox_code_copied', { code }));
          },
        },
        {
          text: t('settings.setting.i_added_it'),
          onPress: async () => {
            setIsVerifyingRoblox(true);
            const result = await checkVerificationCode(verifyResult.userId, code);

            // Roblox busy or unreachable: nothing was checked, so keep what is saved.
            if (result.retry) {
              setIsVerifyingRoblox(false);
              showErrorMessage(t('home.alert.error'), result.error);
              return;
            }

            // ✅ Save username to database regardless of verification status
            const isVerified = result.verified;
            // Use userId from verification result if verified, otherwise from initial username check
            const userIdToSave = result.verified ? result.userId : (verifyResult.userId || null);

            await updateLocalStateAndDatabase({
              robloxUsername: trimmedUsername,
              robloxUsernameVerified: isVerified,
              robloxUserId: userIdToSave,
            });

            // ✅ Update local state
            setRobloxUsername(trimmedUsername);
            setRobloxUsernameVerified(isVerified);

            // ✅ Update user state immediately for UI
            setUser((prev) => ({
              ...prev,
              robloxUsername: trimmedUsername,
              robloxUsernameVerified: isVerified,
              robloxUserId: userIdToSave,
            }));

            if (isVerified) {
              showSuccessMessage(t('home.alert.success'), t('settings.setting.roblox_verified_saved'));
            } else {
              showErrorMessage(t('settings.setting.username_saved'), `${result.error}\n${t('settings.setting.username_saved_unverified')}`);
            }
            setIsVerifyingRoblox(false);
          },
        },
      ]
    );
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
    { code: "ar", label: t("settings.languages.ar"), flag: "🇸🇦" },
    { code: "ja", label: t("settings.languages.ja"), flag: "🇯🇵" }
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

  // ✅ Initialize form values when drawer opens or user ID changes
  useEffect(() => {
    // Only initialize when drawer opens (isDrawerVisible becomes true) or when user ID changes
    if (!isDrawerVisible) return; // Don't initialize when drawer is closed

    if (user && user?.id) {
      // Only reset if this is a different user or first time initialization for this user
      if (initializedUserIdRef.current !== user.id) {
        initializedUserIdRef.current = user.id;
        setNewDisplayName(user?.displayName?.trim() || 'Anonymous');
        setSelectedImage(user?.avatar?.trim() || 'https://bloxfruitscalc.com/wp-content/uploads/2025/placeholder.png');
        // ✅ Load Roblox username if exists
        setRobloxUsername(user?.robloxUsername || '');
        setRobloxUsernameVerified(user?.robloxUsernameVerified || false);
      }
    } else {
      // User logged out - reset everything
      initializedUserIdRef.current = null;
      setNewDisplayName('Guest User');
      setSelectedImage('https://bloxfruitscalc.com/wp-content/uploads/2025/placeholder.png');
      setRobloxUsername('');
      setRobloxUsernameVerified(false);
    }

  }, [isDrawerVisible, user?.id]); // ✅ Only initialize when drawer opens or user ID changes

  // ✅ Initialize selectedImage when user changes (for initial display)
  useEffect(() => {
    if (user && user?.id) {
      if (initializedUserIdRef.current !== user.id) {
        setSelectedImage(user?.avatar?.trim() || 'https://bloxfruitscalc.com/wp-content/uploads/2025/placeholder.png');
      }
    } else {
      setSelectedImage('https://bloxfruitscalc.com/wp-content/uploads/2025/placeholder.png');
    }
  }, [user?.id, user?.avatar]);

  // ✅ MIGRATED: Load bio and rating from Firestore (user_ratings_summary)
  const [userPoints, setUserPoints] = useState(null);

  useEffect(() => {
    if (!user?.id || !appdatabase || !firestoreDB) {
      setBio('Hi there, I am new here');
      setRatingSummary(null);
      setCreatedAtText(null);
      setUserPoints(null);
      setLoadingRating(false);
      return;
    }

    const loadBioAndRating = async () => {
      setLoadingRating(true);
      try {
        // ✅ MIGRATED: Fetch rating from Firestore user_ratings_summary instead of RTDB
        const [summarySnap, createdSnap, reviewDocSnap, rewardPointsSnap] = await Promise.all([
          getDoc(doc(firestoreDB, 'user_ratings_summary', user.id)), // ✅ Load rating from Firestore
          get(ref(appdatabase, `users/${user.id}/createdAt`)),
          getDoc(doc(firestoreDB, 'reviews', user.id)), // ✅ Load bio from Firestore
          get(ref(appdatabase, `users/${user.id}/rewardPoints`)), // ✅ Load rewardPoints
        ]);

        // ✅ Load bio from Firestore reviews/{userId}
        // ✅ If bio doesn't exist, initialize it with default value in Firestore
        if (reviewDocSnap.exists()) {
          const reviewData = reviewDocSnap.data();
          const loadedBio = (reviewData.bio && typeof reviewData.bio === 'string' && reviewData.bio.trim())
            ? reviewData.bio.trim()
            : 'Hi there, I am new here';
          setBio(loadedBio);
          savedBioRef.current = loadedBio;

          // ✅ If bio doesn't exist in Firestore, save default bio
          if (!reviewData.bio || !reviewData.bio.trim()) {
            await setDoc(
              doc(firestoreDB, 'reviews', user.id),
              {
                bio: 'Hi there, I am new here',
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
          }
        } else {
          // ✅ Bio doesn't exist - initialize with default value in Firestore
          setBio('Hi there, I am new here');
          savedBioRef.current = 'Hi there, I am new here';
          await setDoc(
            doc(firestoreDB, 'reviews', user.id),
            {
              bio: 'Hi there, I am new here',
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }

        // ✅ MIGRATED: Load rating from Firestore user_ratings_summary
        if (summarySnap.exists()) {
          const data = summarySnap.data() || {};
          setRatingSummary({
            value: Number(data.averageRating || 0),
            count: Number(data.count || 0),
          });
        } else {
          setRatingSummary(null);
        }

        // Load joined date
        if (createdSnap.exists()) {
          const raw = createdSnap.val();
          let ts = typeof raw === 'number' ? raw : Date.parse(raw);
          if (!Number.isNaN(ts)) {
            const now = Date.now();
            const diffMs = now - ts;
            if (diffMs >= 0) {
              const minutes = Math.floor(diffMs / 60000);
              if (minutes < 1) setCreatedAtText(i18next.t('settings.setting.just_now'));
              else if (minutes < 60) setCreatedAtText(i18next.t('settings.setting.minutes_ago', { count: minutes }));
              else {
                const hours = Math.floor(minutes / 60);
                if (hours < 24) setCreatedAtText(i18next.t('settings.setting.hours_ago', { count: hours }));
                else {
                  const days = Math.floor(hours / 24);
                  if (days < 30) setCreatedAtText(i18next.t('settings.setting.days_ago', { count: days }));
                  else {
                    const months = Math.floor(days / 30);
                    if (months < 12) setCreatedAtText(i18next.t('settings.setting.months_ago', { count: months }));
                    else {
                      const years = Math.floor(months / 12);
                      setCreatedAtText(i18next.t('settings.setting.years_ago', { count: years }));
                    }
                  }
                }
              }
            } else {
              setCreatedAtText(null);
            }
          } else {
            setCreatedAtText(null);
          }
        } else {
          setCreatedAtText(null);
        }

        // ✅ Load user points (rewardPoints from RTDB)
        if (rewardPointsSnap?.exists()) {
          setUserPoints(rewardPointsSnap.val() || 0);
        } else {
          setUserPoints(0);
        }
      } catch (error) {
        console.error('Error loading bio and rating:', error);
        setBio('Hi there, I am new here');
        setRatingSummary(null);
        setCreatedAtText(null);
        setUserPoints(null);
      } finally {
        setLoadingRating(false);
      }
    };

    loadBioAndRating();
  }, [user?.id, appdatabase, firestoreDB]);
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
            { text: t("home.cancel"), style: 'cancel' },
            {
              text: t("settings.go_to_settings"),
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

  // Value update notifications: the FCM topic `value-updates`
  // (Code/Helper/valueUpdateAlerts.js). Saved locally, default ON. Turning it
  // on also asks for notification permission, so the pushes can show.
  const handleToggleValueUpdates = async (value) => {
    updateLocalState('valueUpdateNotifications', value);
    setValueUpdateSubscription(value);
    if (value) {
      await requestPermission();
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
    const MAX_NAME_LENGTH = 15;
    const PROFILE_EDIT_COOLDOWN_DAYS = 10;

    if (!user?.id) return;
    if (blockedByModGate('profile')) return;

    if (newDisplayName.length > MAX_NAME_LENGTH) {
      showErrorMessage(
        t("home.alert.error"),
        t("settings.display_name_length_error")
      );
      return;
    }

    // ✅ Check if displayName or avatar changed (30-day cooldown only applies to these)
    const displayNameChanged = newDisplayName.trim() !== (user?.displayName || '').trim();
    const avatarChanged = (selectedImage || '').trim() !== (user?.avatar || '').trim();

    // ✅ Only check cooldown if displayName or avatar is being changed (not bio)
    if ((displayNameChanged || avatarChanged) && user?.lastProfileEditAt) {
      const lastEditTimestamp = typeof user.lastProfileEditAt === 'number'
        ? user.lastProfileEditAt
        : Date.parse(user.lastProfileEditAt);

      if (!isNaN(lastEditTimestamp)) {
        const now = Date.now();
        const daysSinceLastEdit = (now - lastEditTimestamp) / (1000 * 60 * 60 * 24);
        const daysRemaining = Math.ceil(PROFILE_EDIT_COOLDOWN_DAYS - daysSinceLastEdit);

        if (daysSinceLastEdit < PROFILE_EDIT_COOLDOWN_DAYS) {
          showErrorMessage(
            t('settings.setting.edit_cooldown'),
            t('settings.setting.cooldown_error', { days: PROFILE_EDIT_COOLDOWN_DAYS, count: daysRemaining })
          );
          return;
        }
      }
    }

    // Word filter (supabase/049), before any write: the name blocks slurs and
    // offensive words only; a CHANGED bio gets the same check as posts
    // (YouTube / TikTok links allowed, like group chat). An unchanged bio is
    // not re-checked, so an old one can't block a name or avatar change.
    if (displayNameChanged) {
      const nameCheck = validateUsername(newDisplayName.trim());
      if (!nameCheck.isValid) {
        showErrorMessage(t('home.alert.error'), nameCheck.reason);
        return;
      }
    }
    const newBio = bio.trim();
    if (newBio !== (savedBioRef.current || '').trim()) {
      const bioCheck = validateContent(newBio, { skipLinkCheck: isAllowedLink(newBio) });
      if (!bioCheck.isValid) {
        showErrorMessage(t('settings.setting.bio'), bioCheck.reason);
        return;
      }
    }

    try {
      const now = Date.now();

      // ✅ Only update lastProfileEditAt if displayName or avatar changed (not for bio-only changes)
      const displayNameChanged = newDisplayName.trim() !== (user?.displayName || '').trim();
      const avatarChanged = (selectedImage || '').trim() !== (user?.avatar || '').trim();

      // ✅ Update profile with timestamp (displayName, avatar, lastProfileEditAt)
      // Only update lastProfileEditAt if displayName or avatar changed
      const updateData = {};

      // Only include displayName if it actually changed and isn't a fallback value
      if (displayNameChanged) {
        const trimmedName = newDisplayName.trim();
        if (trimmedName && trimmedName !== 'Anonymous' && trimmedName !== 'Guest User') {
          // Enforce case-insensitive uniqueness BEFORE writing to RTDB (and
          // before the cooldown timestamp below is set) so a taken name costs
          // the user nothing. Aborts the whole save on conflict.
          try {
            await claimUsername(trimmedName);
          } catch (err) {
            showErrorMessage(
              t('home.alert.error'),
              err?.taken
                ? t('settings.setting.username_taken')
                : /USERNAME_NOT_ALLOWED/.test(err?.message || '')
                  ? t('app.word_filter.username_not_allowed')
                  : (err?.message || t('settings.setting.username_check_failed'))
            );
            return;
          }
          updateData.displayName = trimmedName;
        }
      }

      // Only include avatar if it actually changed
      if (avatarChanged) {
        updateData.avatar = (selectedImage || '').trim();
      }

      if (displayNameChanged || avatarChanged) {
        updateData.lastProfileEditAt = now;
      }

      await updateLocalStateAndDatabase(updateData);

      // ✅ Save bio to Firestore reviews/{userId} (alongside ownedPets and wishlistPets)
      // Bio can be changed anytime (no cooldown restriction)
      if (user?.id && firestoreDB) {
        const userReviewRef = doc(firestoreDB, 'reviews', user.id);

        // ✅ Trim bio and use default if empty/whitespace
        const trimmedBio = bio.trim();
        const bioToSave = trimmedBio || 'Hi there, I am new here';

        // Update bio in Firestore (merge to preserve existing ownedPets and wishlistPets)
        await setDoc(
          userReviewRef,
          {
            bio: bioToSave,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        savedBioRef.current = bioToSave;
      }

      setDrawerVisible(false);
      showSuccessMessage(
        t("home.alert.success"),
        t("settings.profile_success")
      );
    } catch (error) {
      console.error('Error updating profile:', error);
      showErrorMessage(
        t("home.alert.error"),
        t('settings.setting.save_profile_failed')
      );
    }
  };




  const displayName = user?.id
    ? newDisplayName?.trim() || user?.displayName || 'Anonymous'
    : 'Guest User';

  // ✅ Render stars for rating
  const renderStars = (value) => {
    const rounded = Math.round(value || 0);
    const full = '★'.repeat(Math.min(rounded, 5));
    const empty = '☆'.repeat(Math.max(0, 5 - rounded));
    return (
      <Text style={{ color: '#FFD700', fontSize: 14, fontWeight: '600' }}>
        {full}
        <Text style={{ color: '#999' }}>{empty}</Text>
      </Text>
    );
  };

  const renderPetBubble = (pet, index) => {
    // {console.log(pet,`${BASE_ADOPTME_URL}${formatName(pet.name)}_Icon.webp` )}

    return (
      <View key={`${pet.id || pet.name}-${index}`} style={styles.petBubble}>


        <Image resizeMethod="resize"
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
    owned === 'owned' ? setOwned(true) : setOwned(false)
    setPetModalVisible(true)
  };

  // ✅ OPTIMIZED: Load pets with getDoc instead of onSnapshot (pets rarely change, no need for real-time)
  // This reduces continuous Firestore reads by ~90% for this data
  useEffect(() => {
    if (!user?.id || !firestoreDB) {
      setOwnedPets([]);
      setWishlistPets([]);
      return;
    }

    const loadPets = async () => {
      try {
        const userReviewRef = doc(firestoreDB, 'reviews', user.id);
        const docSnap = await getDoc(userReviewRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          setOwnedPets(Array.isArray(data.ownedPets) ? data.ownedPets : []);
          setWishlistPets(Array.isArray(data.wishlistPets) ? data.wishlistPets : []);
        } else {
          setOwnedPets([]);
          setWishlistPets([]);
        }
      } catch (error) {
        console.error('Error loading pets:', error);
        setOwnedPets([]);
        setWishlistPets([]);
      }
    };

    loadPets();
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

  // Don't load reviews initially - only load when modals open

  // Load "gave" reviews modal when opens
  useEffect(() => {
    if (!showGaveReviewsModal || !user?.id || !firestoreDB || !appdatabase) {
      return;
    }

    const loadGaveModalReviews = async () => {
      setLoadingModalGaveReviews(true);
      try {
        // Load initial batch of 5 reviews
        const gaveQuery = await getDocs(query(
          collection(firestoreDB, 'reviews'),
          where('fromUserId', '==', user.id),
          orderBy('updatedAt', 'desc'),
          limit(5)
        ));

        const gaveDocs = gaveQuery.docs;

        // Fetch user names for gave reviews
        const gaveWithNames = await Promise.all(
          gaveDocs.map(async (doc) => {
            const data = doc.data();
            try {
              const userRef = ref(appdatabase, `users/${data.toUserId}`);
              const userSnapshot = await get(userRef);
              const userData = userSnapshot.val();
              return {
                id: doc.id,
                ...data,
                type: 'gave',
                reviewedUserName: userData?.displayName || i18next.t('settings.setting.unknown_user'),
                reviewedUserAvatar: userData?.avatar || null,
              };
            } catch (error) {
              return {
                id: doc.id,
                ...data,
                type: 'gave',
                reviewedUserName: i18next.t('settings.setting.unknown_user'),
                reviewedUserAvatar: null,
              };
            }
          })
        );

        setModalGaveReviews(gaveWithNames);
        setModalLastGaveDoc(gaveDocs[gaveDocs.length - 1] || null);
        setModalHasMoreGave(gaveDocs.length === 5);
      } catch (error) {
        console.error('Error loading gave modal reviews:', error);
        setModalGaveReviews([]);
      } finally {
        setLoadingModalGaveReviews(false);
      }
    };

    loadGaveModalReviews();
  }, [showGaveReviewsModal, user?.id, firestoreDB, appdatabase]);

  // Load "received" reviews modal when opens
  useEffect(() => {
    if (!showReceivedReviewsModal || !user?.id || !firestoreDB || !appdatabase) {
      return;
    }

    const loadReceivedModalReviews = async () => {
      setLoadingModalReceivedReviews(true);
      try {
        // Load initial batch of 5 reviews
        const receivedQuery = await getDocs(query(
          collection(firestoreDB, 'reviews'),
          where('toUserId', '==', user.id),
          orderBy('updatedAt', 'desc'),
          limit(5)
        ));

        const receivedDocs = receivedQuery.docs;

        // Fetch user names for received reviews
        const receivedWithNames = await Promise.all(
          receivedDocs.map(async (doc) => {
            const data = doc.data();
            try {
              const userRef = ref(appdatabase, `users/${data.fromUserId}`);
              const userSnapshot = await get(userRef);
              const userData = userSnapshot.val();
              return {
                id: doc.id,
                ...data,
                type: 'received',
                reviewerName: userData?.displayName || i18next.t('settings.setting.unknown_user'),
                reviewerAvatar: userData?.avatar || null,
              };
            } catch (error) {
              return {
                id: doc.id,
                ...data,
                type: 'received',
                reviewerName: i18next.t('settings.setting.unknown_user'),
                reviewerAvatar: null,
              };
            }
          })
        );

        setModalReceivedReviews(receivedWithNames);
        setModalLastReceivedDoc(receivedDocs[receivedDocs.length - 1] || null);
        setModalHasMoreReceived(receivedDocs.length === 5);
      } catch (error) {
        console.error('Error loading received modal reviews:', error);
        setModalReceivedReviews([]);
      } finally {
        setLoadingModalReceivedReviews(false);
      }
    };

    loadReceivedModalReviews();
  }, [showReceivedReviewsModal, user?.id, firestoreDB, appdatabase]);

  // Load more "gave" reviews in modal - keeps loading until all are fetched
  const loadMoreGaveModalReviews = useCallback(async () => {
    if (!user?.id || !firestoreDB || !appdatabase || loadingModalGaveReviews || !modalLastGaveDoc) return;

    setLoadingModalGaveReviews(true);
    try {
      let lastDoc = modalLastGaveDoc;
      let allNewReviews = [];
      let hasMore = true;

      // Keep loading in batches until all reviews are fetched
      while (hasMore && lastDoc) {
        const gaveQuery = await getDocs(query(
          collection(firestoreDB, 'reviews'),
          where('fromUserId', '==', user.id),
          orderBy('updatedAt', 'desc'),
          startAfter(lastDoc),
          limit(20) // Load 20 at a time for efficiency
        ));

        const gaveDocs = gaveQuery.docs;

        if (gaveDocs.length > 0) {
          const gaveWithNames = await Promise.all(
            gaveDocs.map(async (doc) => {
              const data = doc.data();
              try {
                const userRef = ref(appdatabase, `users/${data.toUserId}`);
                const userSnapshot = await get(userRef);
                const userData = userSnapshot.val();
                return {
                  id: doc.id,
                  ...data,
                  type: 'gave',
                  reviewedUserName: userData?.displayName || t('settings.setting.unknown_user'),
                  reviewedUserAvatar: userData?.avatar || null,
                };
              } catch (error) {
                return {
                  id: doc.id,
                  ...data,
                  type: 'gave',
                  reviewedUserName: t('settings.setting.unknown_user'),
                  reviewedUserAvatar: null,
                };
              }
            })
          );

          allNewReviews.push(...gaveWithNames);
          lastDoc = gaveDocs[gaveDocs.length - 1];
          hasMore = gaveDocs.length === 20; // If we got 20, there might be more
        } else {
          hasMore = false;
        }
      }

      if (allNewReviews.length > 0) {
        setModalGaveReviews((prev) => [...prev, ...allNewReviews]);
        setModalLastGaveDoc(lastDoc);
      }
      setModalHasMoreGave(hasMore);
    } catch (error) {
      console.error('Error loading more gave modal reviews:', error);
      setModalHasMoreGave(false);
    } finally {
      setLoadingModalGaveReviews(false);
    }
  }, [user?.id, firestoreDB, appdatabase, modalLastGaveDoc, loadingModalGaveReviews, t]);

  // Load more "received" reviews in modal - keeps loading until all are fetched
  const loadMoreReceivedModalReviews = useCallback(async () => {
    if (!user?.id || !firestoreDB || !appdatabase || loadingModalReceivedReviews || !modalLastReceivedDoc) return;

    setLoadingModalReceivedReviews(true);
    try {
      let lastDoc = modalLastReceivedDoc;
      let allNewReviews = [];
      let hasMore = true;

      // Keep loading in batches until all reviews are fetched
      while (hasMore && lastDoc) {
        const receivedQuery = await getDocs(query(
          collection(firestoreDB, 'reviews'),
          where('toUserId', '==', user.id),
          orderBy('updatedAt', 'desc'),
          startAfter(lastDoc),
          limit(20) // Load 20 at a time for efficiency
        ));

        const receivedDocs = receivedQuery.docs;

        if (receivedDocs.length > 0) {
          const receivedWithNames = await Promise.all(
            receivedDocs.map(async (doc) => {
              const data = doc.data();
              try {
                const userRef = ref(appdatabase, `users/${data.fromUserId}`);
                const userSnapshot = await get(userRef);
                const userData = userSnapshot.val();
                return {
                  id: doc.id,
                  ...data,
                  type: 'received',
                  reviewerName: userData?.displayName || t('settings.setting.unknown_user'),
                  reviewerAvatar: userData?.avatar || null,
                };
              } catch (error) {
                return {
                  id: doc.id,
                  ...data,
                  type: 'received',
                  reviewerName: t('settings.setting.unknown_user'),
                  reviewerAvatar: null,
                };
              }
            })
          );

          allNewReviews.push(...receivedWithNames);
          lastDoc = receivedDocs[receivedDocs.length - 1];
          hasMore = receivedDocs.length === 20; // If we got 20, there might be more
        } else {
          hasMore = false;
        }
      }

      if (allNewReviews.length > 0) {
        setModalReceivedReviews((prev) => [...prev, ...allNewReviews]);
        setModalLastReceivedDoc(lastDoc);
      }
      setModalHasMoreReceived(hasMore);
    } catch (error) {
      console.error('Error loading more received modal reviews:', error);
      setModalHasMoreReceived(false);
    } finally {
      setLoadingModalReceivedReviews(false);
    }
  }, [user?.id, firestoreDB, appdatabase, modalLastReceivedDoc, loadingModalReceivedReviews, t]);

  // Load "My Trades" modal when opens
  useEffect(() => {
    if (!showMyTradesModal || !user?.id || !firestoreDB) {
      return;
    }

    const loadMyTrades = async () => {
      setLoadingModalMyTrades(true);
      try {
        // Load initial batch of 3 trades
        const tradesQuery = await getDocs(query(
          collection(firestoreDB, 'trades_new_upgrade'),
          where('userId', '==', user.id),
          orderBy('timestamp', 'desc'),
          limit(3)
        ));

        const tradesDocs = tradesQuery.docs;
        const tradesData = tradesDocs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));

        setModalMyTrades(tradesData);
        setModalLastTradeDoc(tradesDocs[tradesDocs.length - 1] || null);
        setModalHasMoreTrades(tradesDocs.length === 3);
      } catch (error) {
        console.error('Error loading my trades:', error);
        setModalMyTrades([]);
        setModalHasMoreTrades(false);
      } finally {
        setLoadingModalMyTrades(false);
      }
    };

    loadMyTrades();
  }, [showMyTradesModal, user?.id, firestoreDB]);

  // Load Followers modal when opens (paginated)
  useEffect(() => {
    if (!showFollowersModal || !user?.id || !firestoreDB || !appdatabase) return;

    const PAGE_SIZE = 3;
    const loadFollowers = async () => {
      setLoadingModalFollowers(true);
      try {
        const q = query(
          collection(firestoreDB, 'following'),
          where('followingId', '==', user.id),
          orderBy('createdAt', 'desc'),
          limit(PAGE_SIZE)
        );
        const followersSnapshot = await getDocs(q);
        const docs = followersSnapshot.docs;
        const followerIds = docs.map(d => d.data().followerId).filter(Boolean);

        const followersWithDetails = await Promise.all(
          followerIds.map(async (followerId) => {
            try {
              const [displayNameSnap, avatarSnap] = await Promise.all([
                get(ref(appdatabase, `users/${followerId}/displayName`)),
                get(ref(appdatabase, `users/${followerId}/avatar`)),
              ]);
              return {
                id: followerId,
                displayName: displayNameSnap.val() || i18next.t('settings.setting.unknown'),
                avatar: avatarSnap.val() || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
              };
            } catch {
              return { id: followerId, displayName: i18next.t('settings.setting.unknown'), avatar: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' };
            }
          })
        );

        setModalFollowers(followersWithDetails);
        setModalLastFollowerDoc(docs.length > 0 ? docs[docs.length - 1] : null);
        setModalHasMoreFollowers(docs.length === PAGE_SIZE);
      } catch (error) {
        console.error('Error loading followers:', error);
        setModalFollowers([]);
        setModalHasMoreFollowers(false);
      } finally {
        setLoadingModalFollowers(false);
      }
    };

    loadFollowers();
  }, [showFollowersModal, user?.id, firestoreDB, appdatabase]);

  // Load more Followers (paginated)
  const loadMoreFollowers = useCallback(async () => {
    if (!user?.id || !firestoreDB || !appdatabase || loadingModalFollowers || !modalLastFollowerDoc) return;

    const PAGE_SIZE = 3;
    setLoadingModalFollowers(true);
    try {
      const followersQuery = query(
        collection(firestoreDB, 'following'),
        where('followingId', '==', user.id),
        orderBy('createdAt', 'desc'),
        startAfter(modalLastFollowerDoc),
        limit(PAGE_SIZE)
      );
      const followersSnapshot = await getDocs(followersQuery);
      const docs = followersSnapshot.docs;
      const followerIds = docs.map(d => d.data().followerId).filter(Boolean);

      const newFollowers = await Promise.all(
        followerIds.map(async (followerId) => {
          try {
            const [displayNameSnap, avatarSnap] = await Promise.all([
              get(ref(appdatabase, `users/${followerId}/displayName`)),
              get(ref(appdatabase, `users/${followerId}/avatar`)),
            ]);
            return {
              id: followerId,
              displayName: displayNameSnap.val() || t('settings.setting.unknown'),
              avatar: avatarSnap.val() || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
            };
          } catch {
            return { id: followerId, displayName: t('settings.setting.unknown'), avatar: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' };
          }
        })
      );

      setModalFollowers(prev => [...prev, ...newFollowers]);
      setModalLastFollowerDoc(docs.length > 0 ? docs[docs.length - 1] : null);
      setModalHasMoreFollowers(docs.length === PAGE_SIZE);
    } catch (error) {
      console.error('Error loading more followers:', error);
      setModalHasMoreFollowers(false);
    } finally {
      setLoadingModalFollowers(false);
    }
  }, [user?.id, firestoreDB, appdatabase, modalLastFollowerDoc, loadingModalFollowers, t]);

  // Load more "My Trades" in modal
  const loadMoreMyTrades = useCallback(async () => {
    if (!user?.id || !firestoreDB || loadingModalMyTrades || !modalLastTradeDoc) return;

    setLoadingModalMyTrades(true);
    try {
      const tradesQuery = await getDocs(query(
        collection(firestoreDB, 'trades_new_upgrade'),
        where('userId', '==', user.id),
        orderBy('timestamp', 'desc'),
        startAfter(modalLastTradeDoc),
        limit(10) // Load 10 at a time
      ));

      const tradesDocs = tradesQuery.docs;

      if (tradesDocs.length > 0) {
        const newTrades = tradesDocs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));

        setModalMyTrades((prev) => [...prev, ...newTrades]);
        setModalLastTradeDoc(tradesDocs[tradesDocs.length - 1]);
        setModalHasMoreTrades(tradesDocs.length === 10);
      } else {
        setModalHasMoreTrades(false);
      }
    } catch (error) {
      console.error('Error loading more trades:', error);
      setModalHasMoreTrades(false);
    } finally {
      setLoadingModalMyTrades(false);
    }
  }, [user?.id, firestoreDB, modalLastTradeDoc, loadingModalMyTrades]);

  // Delete a single trade
  const handleDeleteTrade = useCallback(async (tradeId, isFeatured) => {
    if (!user?.id || !firestoreDB) return;

    Alert.alert(
      t("trade.delete_confirmation_title") || "Delete Trade",
      t("trade.delete_confirmation_message") || "Are you sure you want to delete this trade?",
      [
        { text: t("trade.cancel") || "Cancel", style: "cancel" },
        {
          text: t("trade.delete") || "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              setDeletingTradeId(tradeId);
              const actualTradeId = tradeId.startsWith("featured-") ? tradeId.replace("featured-", "") : tradeId;
              await deleteDoc(doc(firestoreDB, "trades_new_upgrade", actualTradeId));

              if (isFeatured) {
                const currentFeaturedData = localState.featuredCount || { count: 0, time: null };
                const newFeaturedCount = Math.max(0, currentFeaturedData.count - 1);
                updateLocalState("featuredCount", {
                  count: newFeaturedCount,
                  time: currentFeaturedData.time,
                });
              }

              setModalMyTrades((prev) => prev.filter((trade) => trade.id !== tradeId));
              showSuccessMessage(
                t("trade.delete_success") || "Success",
                t("trade.delete_success_message") || "Trade deleted successfully"
              );
            } catch (error) {
              console.error("Error deleting trade:", error);
              showErrorMessage(
                t("trade.delete_error") || "Error",
                t("trade.delete_error_message") || "Failed to delete trade"
              );
            } finally {
              setDeletingTradeId(null);
            }
          },
        },
      ]
    );
  }, [user?.id, firestoreDB, localState.featuredCount, updateLocalState, t]);

  // Delete all trades
  const handleDeleteAllTrades = useCallback(async () => {
    if (!user?.id || !firestoreDB || modalMyTrades.length === 0) return;

    Alert.alert(
      t('settings.setting.delete_all_trades_title'),
      t('settings.setting.delete_all_trades_body', { count: modalMyTrades.length }),
      [
        { text: t("trade.cancel") || "Cancel", style: "cancel" },
        {
          text: t('settings.setting.delete_all'),
          style: "destructive",
          onPress: async () => {
            try {
              setIsDeletingAll(true);

              if (modalMyTrades.length === 0) {
                setIsDeletingAll(false);
                return;
              }

              const batch = writeBatch(firestoreDB);
              let featuredCount = 0;

              modalMyTrades.forEach((trade) => {
                const tradeId = trade.id.startsWith("featured-") ? trade.id.replace("featured-", "") : trade.id;
                if (trade.isFeatured) {
                  featuredCount++;
                }
                const tradeRef = doc(firestoreDB, "trades_new_upgrade", tradeId);
                batch.delete(tradeRef);
              });

              await batch.commit();

              // Update featured count if needed
              if (featuredCount > 0) {
                const currentFeaturedData = localState.featuredCount || { count: 0, time: null };
                const newFeaturedCount = Math.max(0, currentFeaturedData.count - featuredCount);
                updateLocalState("featuredCount", {
                  count: newFeaturedCount,
                  time: currentFeaturedData.time,
                });
              }

              setModalMyTrades([]);
              setModalLastTradeDoc(null);
              setModalHasMoreTrades(false);
              showSuccessMessage(t('home.alert.success'), t('settings.setting.all_trades_deleted'));
            } catch (error) {
              console.error("Error deleting all trades:", error);
              showErrorMessage(t('home.alert.error'), t('settings.setting.delete_all_failed'));
            } finally {
              setIsDeletingAll(false);
            }
          },
        },
      ]
    );
  }, [user?.id, firestoreDB, modalMyTrades, localState.featuredCount, updateLocalState, t]);

  // Render trade item for modal
  const renderTradeItem = useCallback((trade) => {
    const { deal, tradeRatio } = getTradeDeal(trade.hasTotal, trade.wantsTotal);
    const tradePercentage = Math.abs(((tradeRatio - 1) * 100).toFixed(0));
    const isProfit = tradeRatio > 1;
    const neutral = tradeRatio === 1;
    const formattedTime = trade.timestamp ? dayjs(trade.timestamp.toDate()).fromNow() : t('settings.setting.unknown');

    const groupedHasItems = groupTradeItems(trade.hasItems || []);
    const groupedWantsItems = groupTradeItems(trade.wantsItems || []);

    return (
      <View
        style={{
          backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
          borderRadius: 12,
          padding: 12,
          marginBottom: 12,
          borderWidth: 1,
          borderColor: isDarkMode ? '#1f2937' : '#e5e7eb',
          opacity: deletingTradeId === trade.id ? 0.5 : 1,
        }}
      >
        {/* Trade Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              {trade.isFeatured && (
                <View style={{
                  backgroundColor: config.colors.hasBlockGreen,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 4,
                  marginRight: 6,
                }}>
                  <Text style={{ color: '#fff', fontSize: 9, fontWeight: '600' }}>{t('settings.setting.featured')}</Text>
                </View>
              )}
              <Text style={{ fontSize: 11, color: isDarkMode ? '#9ca3af' : '#6b7280' }}>
                {formattedTime}
              </Text>
            </View>
            {(groupedHasItems.length > 0 && groupedWantsItems.length > 0) && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                <View style={{
                  backgroundColor: deal.color,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 6,
                  marginRight: 8,
                }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '600' }}>
                    {t(deal.label) || deal.label}
                  </Text>
                </View>
                <Text style={{
                  fontSize: 12,
                  color: !isProfit ? config.colors.hasBlockGreen : config.colors.wantBlockRed,
                  fontWeight: '600'
                }}>
                  {tradePercentage}% {!neutral && (
                    <Icon
                      name={isProfit ? 'arrow-down-outline' : 'arrow-up-outline'}
                      size={12}
                      color={isProfit ? config.colors.wantBlockRed : config.colors.hasBlockGreen}
                    />
                  )}
                </Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            onPress={() => handleDeleteTrade(trade.id, trade.isFeatured)}
            disabled={deletingTradeId === trade.id}
            style={{
              padding: 6,
              borderRadius: 6,
              backgroundColor: isDarkMode ? '#1f2937' : '#f3f4f6',
            }}
          >
            {deletingTradeId === trade.id ? (
              <ActivityIndicator size="small" color="#EF4444" />
            ) : (
              <Icon name="trash-outline" size={18} color="#EF4444" />
            )}
          </TouchableOpacity>
        </View>

        {/* Trade Items */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
          {/* Has Items */}
          <View style={{ flex: 1, alignItems: 'center', marginRight: 4 }}>
            <Text style={{ fontSize: 10, fontWeight: '600', color: isDarkMode ? '#9ca3af' : '#6b7280', marginBottom: 6 }}>
              {t('settings.setting.me')}
            </Text>
            {groupedHasItems.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 4 }}>
                {groupedHasItems.slice(0, 3).map((hasItem) => (
                  <View key={`${hasItem.name}-${hasItem.type}`} style={{ alignItems: 'center', marginBottom: 4 }}>
                    <Image resizeMethod="resize"
                      source={{
                        uri: hasItem.type === 'p'
                          ? `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatTradeName(hasItem.name)}_Icon.webp`
                          : `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatTradeName(hasItem.name)}_Icon.webp`,
                      }}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 4,
                        backgroundColor: hasItem.type === 'p' ? '#FFCC00' : 'transparent',
                      }}
                      resizeMode="contain"
                    />
                    <Text style={{ fontSize: 8, color: isDarkMode ? '#d1d5db' : '#4b5563', marginTop: 2 }}>
                      {hasItem.name}{hasItem.type === 'p' && " (P)"}
                    </Text>
                    {hasItem.count > 1 && (
                      <View style={{
                        position: 'absolute',
                        top: -2,
                        right: -2,
                        backgroundColor: 'purple',
                        borderRadius: 8,
                        minWidth: 14,
                        height: 14,
                        justifyContent: 'center',
                        alignItems: 'center',
                        paddingHorizontal: 2,
                      }}>
                        <Text style={{ color: '#fff', fontSize: 8, fontWeight: '600' }}>{hasItem.count}</Text>
                      </View>
                    )}
                  </View>
                ))}
                {groupedHasItems.length > 3 && (
                  <Text style={{ fontSize: 9, color: isDarkMode ? '#9ca3af' : '#6b7280' }}>
                    {t('settings.setting.plus_more', { count: groupedHasItems.length - 3 })}
                  </Text>
                )}
              </View>
            ) : (
              <Text style={{ fontSize: 10, color: isDarkMode ? '#6b7280' : '#9ca3af', fontStyle: 'italic' }}>
                {t('settings.setting.no_items')}
              </Text>
            )}
            {groupedHasItems.length > 0 && trade.hasTotal && (
              <Text style={{
                fontSize: 9,
                fontWeight: '600',
                color: config.colors.hasBlockGreen,
                marginTop: 4,
                backgroundColor: config.colors.hasBlockGreen + '20',
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 4,
              }}>
                {formatTradeValue(trade.hasTotal.value)}
              </Text>
            )}
          </View>

          {/* Transfer Icon */}
          <View style={{ justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 }}>
            <Image resizeMethod="resize"
              source={require('../../assets/transfer.png')}
              style={{ width: 20, height: 20, opacity: 0.6 }}
            />
          </View>

          {/* Wants Items */}
          <View style={{ flex: 1, alignItems: 'center', marginLeft: 4 }}>
            <Text style={{ fontSize: 10, fontWeight: '600', color: isDarkMode ? '#9ca3af' : '#6b7280', marginBottom: 6 }}>
              {t('settings.badges_screen.you')}
            </Text>
            {groupedWantsItems.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 4 }}>
                {groupedWantsItems.slice(0, 3).map((wantnItem) => (
                  <View key={`${wantnItem.name}-${wantnItem.type}`} style={{ alignItems: 'center', marginBottom: 4 }}>
                    <Image resizeMethod="resize"
                      source={{
                        uri: wantnItem.type === 'p'
                          ? `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatTradeName(wantnItem.name)}_Icon.webp`
                          : `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatTradeName(wantnItem.name)}_Icon.webp`,
                      }}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 4,
                        backgroundColor: wantnItem.type === 'p' ? '#FFCC00' : 'transparent',
                      }}
                      resizeMode="contain"
                    />
                    <Text style={{ fontSize: 8, color: isDarkMode ? '#d1d5db' : '#4b5563', marginTop: 2 }}>
                      {wantnItem.name}{wantnItem.type === 'p' && " (P)"}
                    </Text>
                    {wantnItem.count > 1 && (
                      <View style={{
                        position: 'absolute',
                        top: -2,
                        right: -2,
                        backgroundColor: 'purple',
                        borderRadius: 8,
                        minWidth: 14,
                        height: 14,
                        justifyContent: 'center',
                        alignItems: 'center',
                        paddingHorizontal: 2,
                      }}>
                        <Text style={{ color: '#fff', fontSize: 8, fontWeight: '600' }}>{wantnItem.count}</Text>
                      </View>
                    )}
                  </View>
                ))}
                {groupedWantsItems.length > 3 && (
                  <Text style={{ fontSize: 9, color: isDarkMode ? '#9ca3af' : '#6b7280' }}>
                    {t('settings.setting.plus_more', { count: groupedWantsItems.length - 3 })}
                  </Text>
                )}
              </View>
            ) : (
              <Text style={{ fontSize: 10, color: isDarkMode ? '#6b7280' : '#9ca3af', fontStyle: 'italic' }}>
                {t('settings.setting.no_items')}
              </Text>
            )}
            {groupedWantsItems.length > 0 && trade.wantsTotal && (
              <Text style={{
                fontSize: 9,
                fontWeight: '600',
                color: config.colors.wantBlockRed,
                marginTop: 4,
                backgroundColor: config.colors.wantBlockRed + '20',
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 4,
              }}>
                {formatTradeValue(trade.wantsTotal.value)}
              </Text>
            )}
          </View>
        </View>

        {/* Description */}
        {trade.description && (
          <Text style={{
            fontSize: 11,
            color: isDarkMode ? '#d1d5db' : '#4b5563',
            marginTop: 8,
            paddingTop: 8,
            borderTopWidth: 1,
            borderTopColor: isDarkMode ? '#1f2937' : '#e5e7eb',
          }}>
            {trade.description}
          </Text>
        )}
      </View>
    );
  }, [isDarkMode, deletingTradeId, handleDeleteTrade, t]);

  // Handle editing a review
  const handleEditReview = (review) => {
    setEditingReview(review);
    setEditReviewText(review.review || '');
    setEditReviewRating(review.rating || 0);
  };

  // Save edited review
  const handleSaveEditedReview = async () => {
    if (!editingReview || !firestoreDB || !user?.id) return;
    if (blockedByModGate('review')) return;

    const trimmedReview = (editReviewText || '').trim();
    if (!trimmedReview) {
      showErrorMessage(t('home.alert.error'), t('settings.setting.review_empty'));
      return;
    }

    try {
      // Document ID format: toUserId_fromUserId
      const reviewDocId = `${editingReview.toUserId}_${user.id}`;
      const reviewRef = doc(firestoreDB, 'reviews', reviewDocId);

      await setDoc(
        reviewRef,
        {
          fromUserId: user.id,
          toUserId: editingReview.toUserId,
          rating: editReviewRating,
          userName: user?.displayName || user?.displayname || null,
          review: trimmedReview,
          createdAt: editingReview.createdAt, // Preserve original
          updatedAt: serverTimestamp(),
          edited: true,
        },
        { merge: true }
      );

      // The reviewed user's rating summary and 5-Star badge follow on the
      // server (functions/reviewIntegrity.js), which also keeps the chat
      // verdict taken when the review was written — editing can't make a
      // no-chat review count.

      // Update local state
      setUserReviews((prev) =>
        prev.map((r) =>
          r.id === editingReview.id
            ? {
              ...r,
              review: trimmedReview,
              rating: editReviewRating,
              updatedAt: new Date(),
              edited: true,
            }
            : r
        )
      );

      showSuccessMessage(t('home.alert.success'), t('settings.setting.review_updated'));
      setEditingReview(null);
      setEditReviewText('');
      setEditReviewRating(0);
    } catch (error) {
      console.error('Error updating review:', error);
      showErrorMessage(t('home.alert.error'), t('settings.setting.review_update_failed'));
    }
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
              { text: t("settings.proceed"), style: 'destructive', onPress: resolve },
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
      const currentUser = getAuth().currentUser;
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

    if (plan === 'monthly:monthly' || plan === 'Blox_values_199_1m') return t('settings.setting.plan_1_month');
    if (plan === 'quarterly:quarterly' || plan === 'Blox_values_499_3m') return t('settings.setting.plan_3_months');
    if (plan === 'yearly:yearly' || plan === 'Blox_values_999_1y') return t('settings.setting.plan_1_year');

    return t('settings.setting.plan_anonymous');
  };


  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const c = useMemo(() => getThemeColors(isDarkMode), [isDarkMode]);
  const rs = useMemo(() => getRowStyles(c, isDarkMode), [c, isDarkMode]);
  return (
    <GestureHandlerRootView>
      <View style={[styles.container]}>
      {subPage === 'privacy' ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          <SubPageHeader title={t('settings.privacy_chat')} onBack={closeSubPage} c={c} color={config.colors.primary} />

          {user?.id && (
            <SettingsGroup rs={rs} title={t('settings.who_can_message')}>
              {/* Chat availability — two independent doors. Trade chat opens from
                  the Trades screen; general chat is everywhere else. Each blocks
                  both directions for that door. */}
              <SettingsRow
                rs={rs}
                icon="chatbubbles-outline"
                label={t('settings.allow_general_chat')}
                subtitle={t('settings.allow_general_chat_sub')}
                switchValue={!user?.chatOffGeneral}
                onSwitch={(v) => { triggerHapticFeedback('impactLight'); updateLocalStateAndDatabase('chatOffGeneral', !v); }}
              />
              <SettingsRow
                rs={rs}
                icon="swap-horizontal-outline"
                label={t('settings.allow_trade_chat')}
                subtitle={t('settings.allow_trade_chat_sub')}
                switchValue={!user?.chatOffTrade}
                onSwitch={(v) => { triggerHapticFeedback('impactLight'); updateLocalStateAndDatabase('chatOffTrade', !v); }}
              />
            </SettingsGroup>
          )}
          {user?.id && <Text style={rs.note}>{t('settings.chat_off_note')}</Text>}

          {user?.id && (
            <SettingsGroup rs={rs} title={t('settings.what_others_see')}>
              <SettingsRow
                rs={rs}
                icon="radio-button-on-outline"
                label={t('settings.setting.online_status')}
                switchValue={localState.showOnlineStatus ?? true}
                onSwitch={handleToggleOnlineStatus}
              />
              <SettingsRow
                rs={rs}
                icon="checkmark-done-outline"
                label={t('settings.read_receipts')}
                switchValue={localState.showReadReceipts ?? true}
                onSwitch={handleToggleReadReceipts}
              />
              {/* "Show my birthday" + the one-time birthday correction. */}
              <BirthdayVisibilityRow
                uid={user.id}
                {...legacyRowProps(rs)}
                onHaptic={() => triggerHapticFeedback('impactLight')}
              />
            </SettingsGroup>
          )}
        </ScrollView>
      ) : subPage === 'help' ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          <SubPageHeader title={t('settings.help_feedback')} onBack={closeSubPage} c={c} color={config.colors.primary} />
          <SettingsGroup rs={rs}>
            <SettingsRow rs={rs} icon="mail-outline" label={t('settings.setting.contact_us')} chevron
              onPress={() => { handleGetSuggestions(user); triggerHapticFeedback('impactLight'); }} />
            <SettingsRow rs={rs} icon="flag-outline" label={t('settings.setting.report_abusive')} chevron
              onPress={() => { handleReport(user); triggerHapticFeedback('impactLight'); }} />
            <SettingsRow rs={rs} icon="people-outline" label={t('settings.visit_facebook_group')} chevron="open-outline"
              onPress={() => { handleOpenFacebook(); triggerHapticFeedback('impactLight'); }} />
            <SettingsRow rs={rs} icon="briefcase-outline" label={t('settings.setting.business_enquiries')} subtitle="thesolanalabs@gmail.com" chevron
              onPress={() => Linking.openURL('mailto:thesolanalabs@gmail.com')} />
            <SettingsRow rs={rs} icon="globe-outline" label={t('settings.visit_website')} chevron="open-outline"
              onPress={() => { handleOpenWebsite(); triggerHapticFeedback('impactLight'); }} />
          </SettingsGroup>
        </ScrollView>
      ) : subPage === 'legal' ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          <SubPageHeader title={t('settings.legal_safety')} onBack={closeSubPage} c={c} color={config.colors.primary} />
          <SettingsGroup rs={rs}>
            <SettingsRow rs={rs} icon="document-text-outline" label={t('offer.privacyPolicy')} chevron="open-outline"
              onPress={() => { handleOpenPrivacy(); triggerHapticFeedback('impactLight'); }} />
            {privacyOptionsRequired && (
              <SettingsRow rs={rs} icon="options-outline" label={t('settings.privacy_options', { defaultValue: 'Privacy options' })} chevron
                onPress={() => { showPrivacyOptionsForm(); triggerHapticFeedback('impactLight'); }} />
            )}
            <SettingsRow rs={rs} icon="shield-outline" label={t('settings.setting.child_safety')} chevron="open-outline"
              onPress={() => { handleOpenChild(); triggerHapticFeedback('impactLight'); }} />
          </SettingsGroup>
        </ScrollView>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          {/* Profile card: tap opens the profile others see (bio and reviews
              live there); the pencil opens the edit drawer. */}
          <View style={[rs.card, { marginTop: 6 }]}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={user?.id ? handleViewPublicProfile : () => setOpenSignin(true)}
              style={{ flexDirection: 'row', alignItems: 'center', padding: 14 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }}>
                <FramedAvatar
                  avatarUri={
                    user?.avatar && typeof user.avatar === 'string' && user.avatar.trim()
                      ? user.avatar
                      : 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'
                  }
                  frame={myActiveCosmetics?.profileFrame || null}
                  isDarkMode={isDarkMode}
                  avatarSize={56}
                />
                <View style={{ paddingLeft: 12, flex: 1, minWidth: 0 }}>
                  {!user?.id ? (
                    <Text style={styles.userNameLogout} numberOfLines={1}>{t('settings.login_register')}</Text>
                  ) : (
                    /* Styled name (Store purchase) when the user has one. */
                    <StyledDisplayName
                      user={user}
                      localState={localState}
                      displayName={user?.displayName || 'Guest'}
                      fontSize={16}
                      lineHeight={20}
                      marginVertical={1}
                    />
                  )}
                  {!user?.id && <Text style={styles.rewardLogout}>{t('settings.login_description')}</Text>}
                  {user?.id && user?.robloxUsername && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                      <Text style={{ fontSize: 12, color: '#0EA5E9', fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>@{user.robloxUsername}</Text>
                      {user?.robloxUsernameVerified
                        ? <Icon name="checkmark-circle" size={13} color="#16a34a" style={{ marginLeft: 3 }} />
                        : <Text style={{ fontSize: 11, color: '#d97706', fontWeight: '600', marginLeft: 6 }}>{t('settings.setting.unverified')}</Text>}
                    </View>
                  )}
                </View>
              </View>
              {user?.id ? (
                <TouchableOpacity
                  onPress={handleProfileUpdate}
                  style={{ flexShrink: 0, paddingLeft: 8 }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.save_changes')}
                >
                  <Icon name="create-outline" size={22} color={c.textSecondary} />
                </TouchableOpacity>
              ) : (
                <Icon name="chevron-forward" size={16} color={c.textMuted} />
              )}
            </TouchableOpacity>

            {user?.id && (
              <View style={{ flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }}>
                {[
                  {
                    key: 'rating',
                    value: loadingRating ? '…' : ratingSummary ? `${ratingSummary.value.toFixed(1)} ★` : '–',
                    label: ratingSummary
                      ? t('settings.stat_reviews', { count: ratingSummary.count })
                      : t('settings.setting.not_rated'),
                  },
                  { key: 'points', value: userPoints !== null ? Number(userPoints).toLocaleString() : '0', label: t('settings.stat_points') },
                ].map((s, i) => (
                  <View key={s.key} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderLeftWidth: i ? StyleSheet.hairlineWidth : 0, borderLeftColor: c.border }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: c.text }} numberOfLines={1}>{s.value}</Text>
                    <Text style={{ fontSize: 11, color: c.textSecondary, marginTop: 1 }} numberOfLines={1}>{s.label}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Pro: one card. Free → upgrade; Pro → plan name + Manage. */}
          {localState.isPro ? (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={manageSubscription}
              style={[rs.card, { flexDirection: 'row', alignItems: 'center', padding: 14, marginTop: 12, borderWidth: 1, borderColor: '#FFD700' }]}
            >
              <Image resizeMethod="resize" source={require('../../assets/pro.png')} style={{ width: 22, height: 22, marginRight: 12 }} />
              <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: c.text }} numberOfLines={1}>
                {mySubscriptions.length === 0
                  ? t('settings.paid')
                  : `${t('settings.paid')} · ${mySubscriptions.map(sub => formatPlanName(sub.plan)).join(', ')}`}
              </Text>
              <View style={{ backgroundColor: isDarkMode ? '#273449' : '#f1f2f5', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: c.text }}>{t('settings.manage')}</Text>
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setShowofferWall(true)}
              style={{ flexDirection: 'row', alignItems: 'center', padding: 14, marginTop: 12, borderRadius: 14, backgroundColor: config.colors.primary }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>{t('settings.get_pro')}</Text>
                <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.92)', marginTop: 2 }} numberOfLines={2}>{t('settings.get_pro_sub')}</Text>
              </View>
              <View style={{ backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, marginLeft: 8 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: config.colors.primary }}>{t('settings.upgrade')}</Text>
              </View>
            </TouchableOpacity>
          )}

          {user?.id && (
            <SettingsGroup rs={rs} title={t('settings.section_account')}>
              <SettingsRow
                rs={rs}
                icon="game-controller-outline"
                label={t('settings.roblox_account')}
                value={robloxUsernameVerified
                  ? t('settings.setting.verified')
                  : user?.robloxUsername ? t('settings.setting.unverified') : t('settings.not_linked')}
                valueStyle={robloxUsernameVerified ? { color: '#16a34a', fontWeight: '600' } : user?.robloxUsername ? { color: '#d97706', fontWeight: '600' } : null}
                chevron
                onPress={() => { triggerHapticFeedback('impactLight'); setShowRobloxSheet(true); }}
              />
              <SettingsRow
                rs={rs}
                icon="star-outline"
                label={t('settings.setting.reviews')}
                value={ratingSummary ? t('settings.stat_reviews', { count: ratingSummary.count }) : null}
                chevron
                onPress={() => setShowReceivedReviewsModal(true)}
              />
              <SettingsRow rs={rs} icon="people-outline" label={t('settings.setting.followers')} chevron
                onPress={() => setShowFollowersModal(true)} />
            </SettingsGroup>
          )}

          <SettingsGroup rs={rs} title={t('settings.section_notifications')}>
            <SettingsRow rs={rs} icon="chatbubble-outline" label={t('settings.chat_notifications')}
              switchValue={isPermissionGranted} onSwitch={handleToggleNotification} />
            {/* Value-change push (topic value-updates), guests included. */}
            <SettingsRow rs={rs} icon="trending-up-outline" label={t('settings.value_update_notifications')}
              switchValue={localState.valueUpdateNotifications !== false} onSwitch={handleToggleValueUpdates} />
            {user?.id && (
              <EmailUpdatesRow
                uid={user.id}
                appdatabase={appdatabase}
                {...legacyRowProps(rs)}
                onHaptic={() => triggerHapticFeedback('impactLight')}
              />
            )}
          </SettingsGroup>

          {user?.id && (
            <SettingsGroup rs={rs} style={{ marginTop: 18 }}>
              <SettingsRow rs={rs} icon="lock-closed-outline" label={t('settings.privacy_chat')}
                subtitle={t('settings.privacy_chat_sub')} chevron onPress={() => openSubPage('privacy')} />
            </SettingsGroup>
          )}

          <SettingsGroup rs={rs} title={t('settings.section_appearance')}>
            <SettingsRow
              rs={rs}
              icon="contrast-outline"
              label={t('settings.theme')}
              right={
                <View style={{ flexDirection: 'row', backgroundColor: isDarkMode ? '#273449' : '#f1f2f5', borderRadius: 9, padding: 2 }}>
                  {['system', 'light', 'dark'].map((key, index) => {
                    const on = localState.theme === key;
                    const label = themes[index] || key;
                    return (
                      <TouchableOpacity
                        key={key}
                        onPress={() => { triggerHapticFeedback('impactLight'); updateLocalState('theme', key); }}
                        style={{ paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7, backgroundColor: on ? c.bgAlt : 'transparent' }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: on ? '700' : '500', color: on ? c.text : c.textSecondary }}>
                          {label.charAt(0).toUpperCase() + label.slice(1).toLowerCase()}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              }
            />
            <SettingsRow rs={rs} icon="pulse-outline" label={t('settings.haptic_feedback')}
              switchValue={localState.isHaptic} onSwitch={handleToggle} />
          </SettingsGroup>

          <SettingsGroup rs={rs} title={t('settings.section_help')}>
            <SettingsRow rs={rs} icon="help-buoy-outline" label={t('settings.help_feedback')} chevron onPress={() => openSubPage('help')} />
            <SettingsRow rs={rs} icon="shield-checkmark-outline" label={t('settings.legal_safety')} chevron onPress={() => openSubPage('legal')} />
            <SettingsRow rs={rs} icon="heart-outline" label={t('settings.rate_us')} chevron
              onPress={() => { handleRateApp(); triggerHapticFeedback('impactLight'); }} />
            <SettingsRow rs={rs} icon="share-social-outline" label={t('settings.share_app')} chevron
              onPress={() => { handleShareApp(); triggerHapticFeedback('impactLight'); }} />
          </SettingsGroup>

          <Text style={rs.sectionTitle}>{t('settings.setting.other_apps')}</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {[
              { key: 'adoptme', logo: require('../../assets/adoptme.png'), label: 'Adopt Me Values', onPress: handleadoptme },
              { key: 'mm2', logo: require('../../assets/logo2.png'), label: 'MM2 Values', onPress: handleMM2 },
            ].map((app) => (
              <TouchableOpacity
                key={app.key}
                activeOpacity={0.8}
                onPress={() => { app.onPress(); triggerHapticFeedback('impactLight'); }}
                style={[rs.card, { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 10 }]}
              >
                <Image resizeMethod="resize" source={app.logo} style={{ width: 36, height: 36, borderRadius: 8 }} />
                <Text style={{ flex: 1, marginLeft: 9, fontSize: 13, fontWeight: '600', color: c.text }} numberOfLines={2}>{app.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {user?.id && (
            <>
              <TouchableOpacity activeOpacity={0.8} onPress={handleLogout} style={[rs.card, { marginTop: 22, paddingVertical: 14, alignItems: 'center' }]}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: config.colors.primary }}>{t('settings.logout')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDeleteUser} style={{ paddingVertical: 16, alignItems: 'center' }}>
                <Text style={{ fontSize: 14, color: '#ef4444' }}>{t('settings.delete_my_account')}</Text>
              </TouchableOpacity>
            </>
          )}
          <Text style={{ textAlign: 'center', fontSize: 12, color: c.textMuted, marginTop: user?.id ? 0 : 18, lineHeight: 18 }}>
            {t('settings.version', { version: DeviceInfo.getVersion() })}
          </Text>
        </ScrollView>
      )}

      {/* Roblox account sheet: the username box + Verify used to sit inline. */}
      <Modal
        visible={showRobloxSheet}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowRobloxSheet(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setShowRobloxSheet(false)} />
        <ConditionalKeyboardWrapper>
          <View style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <View style={[styles.drawer, { backgroundColor: c.bgAlt, padding: 20, paddingBottom: Math.max(insets.bottom, 20) }]}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: c.text }}>{t('settings.roblox_account')}</Text>
              <Text style={{ fontSize: 13, color: c.textSecondary, marginTop: 4 }}>{t('settings.roblox_sheet_desc')}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 12, backgroundColor: c.bg }}>
                <Icon name="game-controller-outline" size={18} color={c.textSecondary} />
                <TextInput
                  style={{ flex: 1, color: c.text, fontSize: 16, paddingVertical: 12, marginLeft: 8 }}
                  placeholder={t('settings.setting.roblox_username_placeholder')}
                  placeholderTextColor={c.textMuted}
                  value={robloxUsername}
                  onChangeText={setRobloxUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {robloxUsernameVerified && (
                  <Text style={{ color: '#16a34a', fontSize: 12, fontWeight: '700' }}>{t('settings.setting.verified')}</Text>
                )}
              </View>
              {robloxUsername && !robloxUsernameVerified ? (
                <Text style={{ fontSize: 12, color: '#d97706', marginTop: 8 }}>{t('settings.setting.unverified_hint')}</Text>
              ) : null}
              <TouchableOpacity
                onPress={handleUpdateRobloxUsername}
                disabled={isVerifyingRoblox}
                style={{ backgroundColor: config.colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 18, marginBottom: 8 }}
              >
                {isVerifyingRoblox ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                    {robloxUsernameVerified ? t('settings.setting.reverify') : t('settings.setting.verify')}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </ConditionalKeyboardWrapper>
      </Modal>
        {/* Clears the system nav bar (edge-to-edge); transparent over the page colour. */}
        <ScreenBottomBanner ad={false} />

        {/* Public profile preview: the shared profile drawer pointed at yourself */}
        {publicProfileTarget && (
          <ProfileBottomDrawer
            isVisible={showPublicProfile}
            toggleModal={closePublicProfile}
            selectedUser={publicProfileTarget}
            isOnline={false}
            bannedUsers={NO_BANNED_USERS}
          />
        )}

        {/* Bottom Drawer */}
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
            <View style={{ flex: 1, justifyContent: 'flex-end' }}>
              <EditProfileDrawerContent
                isDarkMode={isDarkMode}
                newDisplayName={newDisplayName}
                setNewDisplayName={setNewDisplayName}
                handlePickAndUploadAvatar={handlePickAndUploadAvatar}
                uploadingAvatar={uploadingAvatar}
                avatarSearch={avatarSearch}
                setAvatarSearch={setAvatarSearch}
                filteredAvatarOptions={filteredAvatarOptions}
                selectedImage={selectedImage}
                setSelectedImage={setSelectedImage}
                bio={bio}
                setBio={setBio}
                handleSaveChanges={handleSaveChanges}
                t={t}
                config={config}
                user={user}
                isVisible={isDrawerVisible}
              />
            </View>
          </ConditionalKeyboardWrapper>
        </Modal>
        <PetModal fromSetting={true} ownedPets={ownedPets} setOwnedPets={setOwnedPets} wishlistPets={wishlistPets} setWishlistPets={setWishlistPets} onClose={async () => { { setPetModalVisible(false); await savePetsToReviews(ownedPets, wishlistPets) } }} visible={petModalVisible} owned={owned}
        />
        <SubscriptionScreen visible={showOfferWall} onClose={() => setShowofferWall(false)} track='Setting' oneWallOnly={single_offer_wall}
        />
        <SignInDrawer
          visible={openSingnin}
          onClose={() => setOpenSignin(false)}
          selectedTheme={selectedTheme}
          message={t('settings.setting.signin_message')}
          screen='Setting'
        />

        {/* Reviews I Gave Modal */}
        <Modal
          visible={showGaveReviewsModal}
          transparent={true}
          animationType="slide"
          onRequestClose={() => {
            setShowGaveReviewsModal(false);
            setModalGaveReviews([]);
            setModalLastGaveDoc(null);
            setModalHasMoreGave(false);
          }}
        >
          <Pressable
            style={styles.overlay}
            onPress={() => {
              setShowGaveReviewsModal(false);
              setModalGaveReviews([]);
              setModalLastGaveDoc(null);
              setModalHasMoreGave(false);
            }}
          />
          <View style={{
            flex: 1,
            justifyContent: 'flex-end',
            backgroundColor: 'rgba(0,0,0,0.5)'
          }}>
            <View style={[styles.drawer, { maxHeight: '90%', paddingBottom: Math.max(insets.bottom, 16) }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Text style={styles.drawerSubtitle}>{t('settings.setting.reviews_i_gave')}</Text>
                <TouchableOpacity onPress={() => {
                  setShowGaveReviewsModal(false);
                  setModalGaveReviews([]);
                  setModalLastGaveDoc(null);
                  setModalHasMoreGave(false);
                }}>
                  <Icon name="close" size={24} color={isDarkMode ? '#fff' : '#000'} />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                {loadingModalGaveReviews && modalGaveReviews.length === 0 ? (
                  <ActivityIndicator size="small" color={config.colors.primary} style={{ marginVertical: 20 }} />
                ) : modalGaveReviews.length === 0 ? (
                  <Text style={{ textAlign: 'center', color: isDarkMode ? '#9ca3af' : '#6b7280', marginVertical: 20 }}>
                    {t('settings.setting.no_reviews')}
                  </Text>
                ) : (
                  <>
                    {modalGaveReviews.map((review) => (
                      <View
                        key={review.id}
                        style={{
                          backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
                          borderRadius: 12,
                          padding: 8,
                          marginBottom: 8,
                          borderWidth: 1,
                          borderColor: isDarkMode ? '#1f2937' : '#e5e7eb',
                        }}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 14, fontWeight: '600', color: isDarkMode ? '#e5e7eb' : '#111827', marginBottom: 4 }}>
                              {review.reviewedUserName || t('settings.setting.unknown_user')}
                            </Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              {[1, 2, 3, 4, 5].map((star) => (
                                <Icon
                                  key={star}
                                  name={star <= review.rating ? 'star' : 'star-outline'}
                                  size={14}
                                  color={star <= review.rating ? '#FFD700' : '#ccc'}
                                  style={{ marginRight: 2 }}
                                />
                              ))}
                              {review.edited && (
                                <Text style={{ fontSize: 10, color: isDarkMode ? '#9ca3af' : '#6b7280', marginLeft: 6 }}>
                                  {t('settings.setting.edited')}
                                </Text>
                              )}
                            </View>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            {review.updatedAt && (
                              <Text style={{ fontSize: 10, color: isDarkMode ? '#9ca3af' : '#9ca3af' }}>
                                {review.updatedAt.toDate ?
                                  new Date(review.updatedAt.toDate()).toLocaleDateString() :
                                  new Date(review.updatedAt).toLocaleDateString()}
                              </Text>
                            )}
                            <TouchableOpacity
                              onPress={() => {
                                setShowGaveReviewsModal(false);
                                handleEditReview(review);
                              }}
                              style={{ padding: 4 }}
                            >
                              <Icon name="create-outline" size={18} color={config.colors.primary} />
                            </TouchableOpacity>
                          </View>
                        </View>
                        <Text style={{ fontSize: 13, color: isDarkMode ? '#d1d5db' : '#4b5563', lineHeight: 18 }}>
                          {review.review}
                        </Text>
                      </View>
                    ))}

                    {modalHasMoreGave && (
                      <TouchableOpacity
                        style={{
                          backgroundColor: config.colors.primary,
                          paddingVertical: 12,
                          paddingHorizontal: 16,
                          borderRadius: 8,
                          alignItems: 'center',
                          marginTop: 8,
                          marginBottom: 16,
                        }}
                        onPress={loadMoreGaveModalReviews}
                        disabled={loadingModalGaveReviews}
                      >
                        {loadingModalGaveReviews ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>
                            {t('settings.setting.load_more')}
                          </Text>
                        )}
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Reviews I Received Modal */}
        <Modal
          visible={showReceivedReviewsModal}
          transparent={true}
          animationType="slide"
          onRequestClose={() => {
            setShowReceivedReviewsModal(false);
            setModalReceivedReviews([]);
            setModalLastReceivedDoc(null);
            setModalHasMoreReceived(false);
          }}
        >
          <Pressable
            style={styles.overlay}
            onPress={() => {
              setShowReceivedReviewsModal(false);
              setModalReceivedReviews([]);
              setModalLastReceivedDoc(null);
              setModalHasMoreReceived(false);
            }}
          />
          <View style={{
            flex: 1,
            justifyContent: 'flex-end',
            backgroundColor: 'rgba(0,0,0,0.5)'
          }}>
            <View style={[styles.drawer, { maxHeight: '90%', paddingBottom: Math.max(insets.bottom, 16) }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Text style={[styles.drawerSubtitle, { flex: 1 }]} numberOfLines={1}>{t('settings.setting.reviews_i_received')}</Text>
                {/* Settings has one Reviews row; the reviews you gave are one tap away here. */}
                <TouchableOpacity
                  onPress={() => {
                    setShowReceivedReviewsModal(false);
                    setModalReceivedReviews([]);
                    setModalLastReceivedDoc(null);
                    setModalHasMoreReceived(false);
                    setShowGaveReviewsModal(true);
                  }}
                  style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: c.bg, marginRight: 10 }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '600', color: c.text }}>{t('settings.setting.i_gave')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => {
                  setShowReceivedReviewsModal(false);
                  setModalReceivedReviews([]);
                  setModalLastReceivedDoc(null);
                  setModalHasMoreReceived(false);
                }}>
                  <Icon name="close" size={24} color={isDarkMode ? '#fff' : '#000'} />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                {loadingModalReceivedReviews && modalReceivedReviews.length === 0 ? (
                  <ActivityIndicator size="small" color={config.colors.primary} style={{ marginVertical: 20 }} />
                ) : modalReceivedReviews.length === 0 ? (
                  <Text style={{ textAlign: 'center', color: isDarkMode ? '#9ca3af' : '#6b7280', marginVertical: 20 }}>
                    {t('settings.setting.no_reviews')}
                  </Text>
                ) : (
                  <>
                    {modalReceivedReviews.map((review) => (
                      <View
                        key={review.id}
                        style={{
                          backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
                          borderRadius: 12,
                          padding: 8,
                          marginBottom: 8,
                          borderWidth: 1,
                          borderColor: isDarkMode ? '#1f2937' : '#e5e7eb',
                        }}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 14, fontWeight: '600', color: isDarkMode ? '#e5e7eb' : '#111827', marginBottom: 4 }}>
                              {review.reviewerName || t('settings.setting.unknown_user')}
                            </Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              {[1, 2, 3, 4, 5].map((star) => (
                                <Icon
                                  key={star}
                                  name={star <= review.rating ? 'star' : 'star-outline'}
                                  size={14}
                                  color={star <= review.rating ? '#FFD700' : '#ccc'}
                                  style={{ marginRight: 2 }}
                                />
                              ))}
                              {review.edited && (
                                <Text style={{ fontSize: 10, color: isDarkMode ? '#9ca3af' : '#6b7280', marginLeft: 6 }}>
                                  {t('settings.setting.edited')}
                                </Text>
                              )}
                            </View>
                          </View>
                          <View style={styles.reviewSide}>
                            {review.updatedAt && (
                              <Text style={{ fontSize: 10, color: isDarkMode ? '#9ca3af' : '#9ca3af' }}>
                                {review.updatedAt.toDate ?
                                  new Date(review.updatedAt.toDate()).toLocaleDateString() :
                                  new Date(review.updatedAt).toLocaleDateString()}
                              </Text>
                            )}
                            {/* Report a false review: Complaints & ideas with it attached. */}
                            <TouchableOpacity
                              onPress={() => {
                                const payload = reviewForReport(review, user?.id);
                                setShowReceivedReviewsModal(false);
                                setModalReceivedReviews([]);
                                setModalLastReceivedDoc(null);
                                setModalHasMoreReceived(false);
                                openReportForm({ category: 'false_review', review: payload });
                              }}
                              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                              accessibilityRole="button"
                              accessibilityLabel={t('reports.report_review')}
                            >
                              <Icon name="flag-outline" size={15} color={isDarkMode ? '#9ca3af' : '#6b7280'} />
                            </TouchableOpacity>
                          </View>
                        </View>
                        <Text style={{ fontSize: 13, color: isDarkMode ? '#d1d5db' : '#4b5563', lineHeight: 18 }}>
                          {review.review}
                        </Text>
                      </View>
                    ))}

                    {modalHasMoreReceived && (
                      <TouchableOpacity
                        style={{
                          backgroundColor: config.colors.primary,
                          paddingVertical: 12,
                          paddingHorizontal: 16,
                          borderRadius: 8,
                          alignItems: 'center',
                          marginTop: 8,
                          marginBottom: 16,
                        }}
                        onPress={loadMoreReceivedModalReviews}
                        disabled={loadingModalReceivedReviews}
                      >
                        {loadingModalReceivedReviews ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>
                            {t('settings.setting.load_more')}
                          </Text>
                        )}
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Edit Review Modal */}
        <Modal
          visible={!!editingReview}
          transparent={true}
          animationType="slide"
          onRequestClose={() => {
            setEditingReview(null);
            setEditReviewText('');
            setEditReviewRating(0);
          }}
        >
          <Pressable
            style={styles.overlay}
            onPress={() => {
              setEditingReview(null);
              setEditReviewText('');
              setEditReviewRating(0);
            }}
          />
          <ConditionalKeyboardWrapper>
            <View style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
              <View style={[styles.drawer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <Text style={styles.drawerSubtitle}>{t('settings.setting.edit_review')}</Text>
                  <TouchableOpacity
                    onPress={() => {
                      setEditingReview(null);
                      setEditReviewText('');
                      setEditReviewRating(0);
                    }}
                  >
                    <Icon name="close" size={24} color={isDarkMode ? '#fff' : '#000'} />
                  </TouchableOpacity>
                </View>

                <Text style={[styles.drawerSubtitle, { marginBottom: 8 }]}>{t('settings.setting.rating')}</Text>
                <View style={{ flexDirection: 'row', marginBottom: 16 }}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <TouchableOpacity
                      key={star}
                      onPress={() => setEditReviewRating(star)}
                      style={{ marginRight: 8 }}
                    >
                      <Icon
                        name={star <= editReviewRating ? 'star' : 'star-outline'}
                        size={32}
                        color={star <= editReviewRating ? '#FFD700' : '#ccc'}
                      />
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={[styles.drawerSubtitle, { marginBottom: 8 }]}>{t('settings.setting.review')}</Text>
                <TextInput
                  style={[styles.input, { minHeight: 100, textAlignVertical: 'top' }]}
                  placeholder={t('settings.setting.review_placeholder')}
                  placeholderTextColor="#999"
                  value={editReviewText}
                  onChangeText={setEditReviewText}
                  multiline
                  numberOfLines={4}
                />

                <TouchableOpacity
                  style={[styles.saveButton, { marginTop: 16 }]}
                  onPress={handleSaveEditedReview}
                >
                  <Text style={styles.saveButtonText}>{t('settings.save_changes')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ConditionalKeyboardWrapper>
        </Modal>

        {/* My Trades Modal */}
        <Modal
          visible={showMyTradesModal}
          transparent={true}
          animationType="slide"
          onRequestClose={() => {
            setShowMyTradesModal(false);
            setModalMyTrades([]);
            setModalLastTradeDoc(null);
            setModalHasMoreTrades(false);
          }}
        >
          <Pressable
            style={styles.overlay}
            onPress={() => {
              setShowMyTradesModal(false);
              setModalMyTrades([]);
              setModalLastTradeDoc(null);
              setModalHasMoreTrades(false);
            }}
          />
          <View style={{
            flex: 1,
            justifyContent: 'flex-end',
            backgroundColor: 'rgba(0,0,0,0.5)'
          }}>
            <View style={[styles.drawer, { maxHeight: '90%', paddingBottom: Math.max(insets.bottom, 16) }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Text style={styles.drawerSubtitle}>{t('settings.setting.my_trades')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {modalMyTrades.length > 0 && (
                    <TouchableOpacity
                      onPress={handleDeleteAllTrades}
                      disabled={isDeletingAll}
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        borderRadius: 6,
                        backgroundColor: isDeletingAll ? (isDarkMode ? '#374151' : '#9ca3af') : '#EF4444',
                        opacity: isDeletingAll ? 0.6 : 1,
                      }}
                    >
                      {isDeletingAll ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>
                          {t('settings.setting.delete_all')}
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => {
                    setShowMyTradesModal(false);
                    setModalMyTrades([]);
                    setModalLastTradeDoc(null);
                    setModalHasMoreTrades(false);
                  }}>
                    <Icon name="close" size={24} color={isDarkMode ? '#fff' : '#000'} />
                  </TouchableOpacity>
                </View>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                {loadingModalMyTrades && modalMyTrades.length === 0 ? (
                  <ActivityIndicator size="small" color={config.colors.primary} style={{ marginVertical: 20 }} />
                ) : modalMyTrades.length === 0 ? (
                  <Text style={{ textAlign: 'center', color: isDarkMode ? '#9ca3af' : '#6b7280', marginVertical: 20 }}>
                    {t('settings.setting.no_trades')}
                  </Text>
                ) : (
                  <>
                    {modalMyTrades.map((trade) => (
                      <React.Fragment key={trade.id}>
                        {renderTradeItem(trade)}
                      </React.Fragment>
                    ))}

                    {modalHasMoreTrades && (
                      <TouchableOpacity
                        style={{
                          backgroundColor: config.colors.primary,
                          paddingVertical: 12,
                          paddingHorizontal: 16,
                          borderRadius: 8,
                          alignItems: 'center',
                          marginTop: 8,
                          marginBottom: 16,
                        }}
                        onPress={loadMoreMyTrades}
                        disabled={loadingModalMyTrades}
                      >
                        {loadingModalMyTrades ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>
                            {t('settings.setting.load_more')}
                          </Text>
                        )}
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Followers Modal */}
        <Modal
          visible={showFollowersModal}
          transparent={true}
          animationType="slide"
          onRequestClose={() => {
            setShowFollowersModal(false);
            setModalFollowers([]);
            setModalLastFollowerDoc(null);
            setModalHasMoreFollowers(false);
          }}
        >
          <Pressable
            style={styles.overlay}
            onPress={() => {
              setShowFollowersModal(false);
              setModalFollowers([]);
              setModalLastFollowerDoc(null);
              setModalHasMoreFollowers(false);
            }}
          />
          <View style={{
            flex: 1,
            justifyContent: 'flex-end',
            backgroundColor: 'rgba(0,0,0,0.5)'
          }}>
            <View style={[styles.drawer, { maxHeight: '90%', paddingBottom: Math.max(insets.bottom, 16) }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Text style={styles.drawerSubtitle}>{t('settings.setting.followers')}</Text>
                <TouchableOpacity onPress={() => {
                  setShowFollowersModal(false);
                  setModalFollowers([]);
                  setModalLastFollowerDoc(null);
                  setModalHasMoreFollowers(false);
                }}>
                  <Icon name="close" size={24} color={isDarkMode ? '#fff' : '#000'} />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                {loadingModalFollowers && modalFollowers.length === 0 ? (
                  <ActivityIndicator size="small" color={config.colors.primary} style={{ marginVertical: 20 }} />
                ) : modalFollowers.length === 0 ? (
                  <Text style={{ textAlign: 'center', color: isDarkMode ? '#9ca3af' : '#6b7280', marginVertical: 20 }}>
                    {t('settings.setting.no_followers')}
                  </Text>
                ) : (
                  <>
                    {modalFollowers.map((follower) => (
                      <TouchableOpacity
                        key={follower.id}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingVertical: 12,
                          paddingHorizontal: 8,
                          borderBottomWidth: 1,
                          borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb',
                        }}
                        activeOpacity={0.7}
                      >
                        <Image resizeMethod="resize"
                          source={{ uri: follower.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                          style={{ width: 44, height: 44, borderRadius: 22 }}
                        />
                        <Text style={{ marginLeft: 12, fontSize: 15, fontWeight: '600', color: isDarkMode ? '#e5e7eb' : '#111827' }} numberOfLines={1}>
                          {follower.displayName}
                        </Text>
                      </TouchableOpacity>
                    ))}

                    {modalHasMoreFollowers && (
                      <TouchableOpacity
                        style={{
                          backgroundColor: config.colors.primary,
                          paddingVertical: 12,
                          paddingHorizontal: 16,
                          borderRadius: 8,
                          alignItems: 'center',
                          marginTop: 8,
                          marginBottom: 16,
                        }}
                        onPress={loadMoreFollowers}
                        disabled={loadingModalFollowers}
                      >
                        {loadingModalFollowers ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>
                            {t('settings.setting.load_more')}
                          </Text>
                        )}
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

      </View>
    </GestureHandlerRootView>
  );
}
