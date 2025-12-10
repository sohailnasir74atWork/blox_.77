import React, { useEffect, useState, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Image,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useGlobalState } from '../../GlobelStats';
import config from '../../Helper/Environment';
import Icon from 'react-native-vector-icons/Ionicons';
import { getStyles } from '../../SettingScreen/settingstyle';
import { useLocalState } from '../../LocalGlobelStats';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import { mixpanel } from '../../AppHelper/MixPenel';
import Clipboard from '@react-native-clipboard/clipboard';
import { useHaptic } from '../../Helper/HepticFeedBack';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from '@react-native-firebase/firestore';
import { ref, get } from '@react-native-firebase/database';



const ProfileBottomDrawer = ({
  isVisible,
  toggleModal,
  startChat,
  selectedUser,
  isOnline,
  bannedUsers,
  fromPvtChat
}) => {
  const { theme, user, firestoreDB, appdatabase } = useGlobalState();
  const { updateLocalState,  } = useLocalState();
  const { t } = useTranslation();
  const { triggerHapticFeedback } = useHaptic();

  const isDarkMode = theme === 'dark';
  const styles = getStyles(isDarkMode);

  const selectedUserId = selectedUser?.senderId || selectedUser?.id || null;
  const userName = selectedUser?.sender || null;
  const avatar = selectedUser?.avatar || null;

  // 🔒 ban state
  const isBlock = bannedUsers?.includes(selectedUserId);

  // ⭐ rating summary (from RTDB /averageRatings)
  const [ratingSummary, setRatingSummary] = useState(null); // { value, count }
  const [createdAt, setCreatedAt] = useState(null); // { value, count }

  const [loadingRating, setLoadingRating] = useState(false);

  // 📝 reviews list (from Firestore /reviews where toUserId == selectedUserId)
  const [reviews, setReviews] = useState([]);
  const [loadingReviews, setLoadingReviews] = useState(false);

  // 🐾 pets (owned + wishlist) from Firestore doc /reviews/{userId}
  const [ownedPets, setOwnedPets] = useState([]);
  const [wishlistPets, setWishlistPets] = useState([]);
  const [loadingPets, setLoadingPets] = useState(false);
  // state
const [loadDetails, setLoadDetails] = useState(false);
const [createdAtText, setCreatedAtText] = useState(null);



  // ─────────────────────────────────────────────
  // Clipboard
  const copyToClipboard = (code) => {
    triggerHapticFeedback('impactLight');
    Clipboard.setString(code);
    showSuccessMessage(t('value.copy'), 'Copied to Clipboard');
    mixpanel.track('Code UserName', { UserName: code });
  };
  const formatCreatedAt = (timestamp) => {
    if (!timestamp) return null;
  
    const now = Date.now();
    const diffMs = now - timestamp;
  
    if (diffMs < 0) return null; // future / invalid
  
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  
    const years = Math.floor(months / 12);
    return `${years} year${years === 1 ? '' : 's'} ago`;
  };
  
  // ─────────────────────────────────────────────
  // Ban / Unban
  const handleBanToggle = async () => {
    if (!selectedUserId) return;

    const action = isBlock ? t('chat.unblock') : t('chat.block');

    Alert.alert(
      `${action}`,
      `${t('chat.are_you_sure')} ${action.toLowerCase()} ${userName}?`,
      [
        { text: t('chat.cancel'), style: 'cancel' },
        {
          text: action,
          style: 'destructive',
          onPress: async () => {
            try {
              let updatedBannedUsers;

              if (isBlock) {
                updatedBannedUsers = bannedUsers.filter(
                  (id) => id !== selectedUserId,
                );
              } else {
                updatedBannedUsers = [...bannedUsers, selectedUserId];
              }

              await updateLocalState('bannedUsers', updatedBannedUsers);

              setTimeout(() => {
                showSuccessMessage(
                  t('home.alert.success'),
                  isBlock
                    ? `${userName} ${t('chat.user_unblocked')}`
                    : `${userName} ${t('chat.user_blocked')}`,
                );
              }, 100);
            } catch (error) {
              console.error('❌ Error toggling ban status:', error);
            }
          },
        },
      ],
    );
  };
// console.log(selectedUser)
  // ─────────────────────────────────────────────
  // Start chat
  const handleStartChat = () => {
    if (startChat) startChat();
  };

  useEffect(() => {
    if (!isVisible) {
      setLoadDetails(false);
      setRatingSummary(null);
      setOwnedPets([]);
      setWishlistPets([]);
      setReviews([]);
    }
  }, [isVisible]);
  
  // ─────────────────────────────────────────────
  // Fetch profile data when drawer opens
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;
  
    let isMounted = true;
  
    const loadRatingSummary = async () => {
      setLoadingRating(true);
      try {
        const [avgSnap, createdSnap] = await Promise.all([
          get(ref(appdatabase, `averageRatings/${selectedUserId}`)),
          get(ref(appdatabase, `users/${selectedUserId}/createdAt`)),
        ]);
    
        if (!isMounted) return;
    
        // ⭐ rating
        if (avgSnap.exists()) {
          const val = avgSnap.val();
          setRatingSummary({
            value: Number(val.value || 0),
            count: Number(val.count || 0),
          });
        } else {
          setRatingSummary(null);
        }
    
        // 🕒 createdAt
        if (createdSnap.exists()) {
          const raw = createdSnap.val(); // should be Date.now() (number) from your code
    
          let ts = typeof raw === 'number' ? raw : Date.parse(raw);
          if (!Number.isNaN(ts)) {
            setCreatedAtText(formatCreatedAt(ts));
          } else {
            setCreatedAtText(null);
          }
        } else {
          setCreatedAtText(null);
        }
      } catch (err) {
        console.log('Rating load error:', err);
        if (isMounted) {
          setRatingSummary(null);
          setCreatedAtText(null);
        }
      } finally {
        if (isMounted) setLoadingRating(false);
      }
    };
    
  
    const loadPets = async () => {
      setLoadingPets(true);
      try {
        const reviewDocSnap = await getDoc(
          doc(firestoreDB, 'reviews', selectedUserId)
        );
        
        if (!isMounted) return;
        
        if (reviewDocSnap.exists) {
          const data = reviewDocSnap.data() || {};
          setOwnedPets(Array.isArray(data.ownedPets) ? data.ownedPets : []);
          setWishlistPets(
            Array.isArray(data.wishlistPets) ? data.wishlistPets : [],
          );
        } else {
          setOwnedPets([]);
          setWishlistPets([]);
        }
      } catch (err) {
        console.log('Pets load error:', err);
        if (isMounted) {
          setOwnedPets([]);
          setWishlistPets([]);
        }
      } finally {
        if (isMounted) setLoadingPets(false);
      }
    };
  
    const loadReviews = async () => {
      setLoadingReviews(true);
      try {
        const snap = await getDocs(
          query(
            collection(firestoreDB, 'reviews'),
            where('toUserId', '==', selectedUserId),
            orderBy('updatedAt', 'desc'),
            limit(10)
          )
        );
        if (!isMounted) return;
  
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
  
        setReviews(list);
      } catch (err) {
        console.log('Reviews load error:', err);
        if (isMounted) setReviews([]);
      } finally {
        if (isMounted) setLoadingReviews(false);
      }
    };
  
    loadRatingSummary();
    loadPets();
    loadReviews();
  
    return () => {
      isMounted = false;
    };
  }, [isVisible, selectedUserId, loadDetails]);
  

  // ─────────────────────────────────────────────
  // Helpers for rendering

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
    const valueType = (pet.valueType || 'd').toLowerCase(); // 'd' | 'n' | 'm'
    let rarityBg = '#FF6666';
    if (valueType === 'n') rarityBg = '#2ecc71';
    if (valueType === 'm') rarityBg = '#9b59b6';
    const formatName = (name) => {
      let formattedName = name.replace(/^\+/, '');
      formattedName = formattedName.replace(/\s+/g, '-');
      return formattedName;
    }

    return (
      <View
      key={`${pet.id || pet.name}-${index}`}
        style={{
          width: 42,
          height: 42,
          marginRight: 6,
          borderRadius: 10,
          overflow: 'hidden',
          backgroundColor: isDarkMode ? '#0f172a' : '#e5e7eb',
        }}
      >
        <Image
          source={{ uri: `https://bloxfruitscalc.com/wp-content/uploads/2024/${pet.type === 'n' ? '09' : '08'}/${formatName(pet.name)}_Icon.webp` }}
          style={{ width: '100%', height: '100%' }}
        />
        <View
          style={{
            position: 'absolute',
            right: 2,
            bottom: 2,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >        
        </View>
      </View>
    );
  };

  // ─────────────────────────────────────────────
  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={isVisible}
      onRequestClose={toggleModal}
    >
      {/* Overlay */}
      <Pressable style={styles.overlay} onPress={toggleModal} />

      {/* Drawer Content */}
      <View style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <View style={styles.drawer}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: 480 }}
          >
            {/* HEADER: user row */}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <View style={{ flexDirection: 'row' }}>
                <Image
                  source={{
                    uri: avatar
                      ? avatar
                      : 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                  }}
                  style={styles.profileImage2}
                />
                <View style={{ justifyContent: 'center' }}>
                  <Text style={styles.drawerSubtitleUser}>
                    {userName}{' '}
                    {selectedUser?.isPro && (
                      <Image
                        source={require('../../../assets/pro.png')}
                        style={{ width: 14, height: 14 }}
                      />
                    )}{' '}{selectedUser?.flage}{'   '}
                    <Icon
                      name="copy-outline"
                      size={16}
                      color="#007BFF"
                      onPress={() => copyToClipboard(userName)}
                    />
                  </Text>

                  <Text
                    style={{
                      color: !isOnline
                        ? config.colors.hasBlockGreen
                        : config.colors.wantBlockRed,
                      fontSize: 10,
                      marginTop: 2,
                    }}
                  >
                    {isOnline ? 'Online' : 'Offline'}
                  </Text>
                </View>
              </View>

              {/* Ban/Unban Icon */}
              <TouchableOpacity onPress={handleBanToggle}>
                <Icon
                  name={isBlock ? 'shield-checkmark-outline' : 'ban-outline'}
                  size={30}
                  color={
                    isBlock
                      ? config.colors.hasBlockGreen
                      : config.colors.wantBlockRed
                  }
                />
              </TouchableOpacity>
            </View>

            {/* ⭐ Rating summary */}
           {loadDetails &&  <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              {loadingRating ? (
                <ActivityIndicator size="small" color={config.colors.primary} />
              ) : ratingSummary ? (
                <>
                  {renderStars(ratingSummary.value)}
                  <Text
                    style={{
                      marginLeft: 6,
                      fontSize: 12,
                      color: isDarkMode ? '#e5e7eb' : '#4b5563',
                    }}
                  >
                    {ratingSummary.value.toFixed(1)} / 5 ·{' '}
                    {ratingSummary.count} rating
                    {ratingSummary.count === 1 ? '' : 's'}
                  </Text>
                </>
              ) : (
                <Text
                  style={{
                    fontSize: 12,
                    color: isDarkMode ? '#9ca3af' : '#6b7280',
                  }}
                >
                  Not rated yet
                </Text>
              )}
              {!loadingRating && <Text
  style={{
    fontSize: 10,
    backgroundColor: isDarkMode ? '#FACC15' : '#16A34A', 
    paddingHorizontal:5,
    borderRadius:4,
    paddingVertical:1,
    color:'white',
    marginLeft:5
    // paddingBottom:5
  }}
>
  Joined {createdAtText}
</Text>}
            </View>}
            
            {/* 🐾 Pets section */}
           {loadDetails && <View
              style={{
                borderRadius: 12,
                padding: 10,
                backgroundColor: isDarkMode ? '#0f172a' : '#f3f4f6',
                marginBottom: 12,
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '600',
                  marginBottom: 6,
                  color: isDarkMode ? '#e5e7eb' : '#111827',
                }}
              >
                Pets
              </Text>

              {loadingPets ? (
                <ActivityIndicator size="small" color={config.colors.primary} />
              ) : (
                <>
                  {/* Owned */}
                  <View style={{ marginBottom: 8 }}>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        marginBottom: 4,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: '500',
                          color: isDarkMode ? '#e5e7eb' : '#111827',
                        }}
                      >
                        Owned items
                      </Text>
                    </View>

                    {ownedPets.length === 0 ? (
                      <Text
                        style={{
                          fontSize: 11,
                          color: isDarkMode ? '#9ca3af' : '#6b7280',
                        }}
                      >
                        No pets listed.
                      </Text>
                    ) : (
                      <ScrollView
  horizontal
  showsHorizontalScrollIndicator={false}
  contentContainerStyle={{ paddingRight: 6 }}
>
  <View style={{ flexDirection: 'row' }}>
    {ownedPets.map((pet, index) => renderPetBubble(pet, index))}

    
      
  
  </View>
</ScrollView>

                    )}
                  </View>

                  {/* Wishlist */}
                  <View>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        marginBottom: 4,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: '500',
                          color: isDarkMode ? '#e5e7eb' : '#111827',
                        }}
                      >
                        Wishlist
                      </Text>
                    </View>

                    {wishlistPets.length === 0 ? (
                      <Text
                        style={{
                          fontSize: 11,
                          color: isDarkMode ? '#9ca3af' : '#6b7280',
                        }}
                      >
                        No wishlist pets yet.
                      </Text>
                    ) : (
                      <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ paddingRight: 6 }}
                    >
                      <View style={{ flexDirection: 'row' }}>
                        {wishlistPets.map((pet, index) => renderPetBubble(pet, index))}
                          </View>
                          </ScrollView>
                    )}
                  </View>
                </>
              )}
            </View>}
           


            {/* 📝 Reviews section */}
           {loadDetails &&  <View
              style={{
                borderRadius: 12,
                padding: 10,
                backgroundColor: isDarkMode ? '#020617' : '#f3f4f6',
                marginBottom: 16,
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '600',
                  marginBottom: 6,
                  color: isDarkMode ? '#e5e7eb' : '#111827',
                }}
              >
                Recent Reviews
              </Text>

              {loadingReviews ? (
                <ActivityIndicator size="small" color={config.colors.primary} />
              ) : reviews.length === 0 ? (
                <Text
                  style={{
                    fontSize: 11,
                    color: isDarkMode ? '#9ca3af' : '#6b7280',
                  }}
                >
                  No reviews yet.
                </Text>
              ) : (
                reviews.map((rev) => (
                  <View
                    key={rev.id}
                    style={{
                      paddingVertical: 6,
                      borderBottomWidth: 1,
                      borderBottomColor: isDarkMode
                        ? '#1f2937'
                        : '#e5e7eb',
                    }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 2,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: '600',
                          color: isDarkMode ? '#e5e7eb' : '#111827',
                        }}
                      >
                        {rev.userName || 'Anonymous'}
                      </Text>
                      {renderStars(rev.rating || 0)}
                    </View>

                    {!!rev.review && (
                      <Text
                        style={{
                          fontSize: 11,
                          color: isDarkMode ? '#d1d5db' : '#4b5563',
                        }}
                      >
                        {rev.review}
                      </Text>
                    )}

                    {rev.edited && (
                      <Text
                        style={{
                          fontSize: 10,
                          color: isDarkMode ? '#9ca3af' : '#9ca3af',
                          marginTop: 2,
                        }}
                      >
                        Edited
                      </Text>
                    )}
                  </View>
                ))
              )}
            </View>}

            {/* Buttons */}
           {!loadDetails &&  <TouchableOpacity
  style={styles.saveButtonProfile}
  onPress={() => setLoadDetails(true)}
>
  <Text style={[styles.saveButtonTextProfile, { color: isDarkMode ? 'white' : 'black',}]}>
    View Detail Profile
  </Text>
</TouchableOpacity>}


           {!fromPvtChat && <TouchableOpacity style={styles.saveButton} onPress={handleStartChat}>
              <Text style={styles.saveButtonText}>{t('chat.start_chat')}</Text>
            </TouchableOpacity>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export default ProfileBottomDrawer;
