import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Platform } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { useNavigation } from '@react-navigation/native';
import config from '../../Helper/Environment';
import { useTranslation } from 'react-i18next';
import { Menu, MenuOption, MenuOptions, MenuTrigger } from 'react-native-popup-menu';
import { useHaptic } from '../../Helper/HepticFeedBack';
import PetGuessingGameScreen from '../../ValuesScreen/PetGuessingGame/PetGuessingGameScreen';
import { listenToUserInvites } from '../../ValuesScreen/PetGuessingGame/utils/gameInviteSystem';
import { collection, query, where, onSnapshot } from '@react-native-firebase/firestore';
const CommunityChatHeader = ({
  selectedTheme,
  unreadcount,
  setunreadcount,
  groupUnreadCount = 0,
  setGroupUnreadCount,
  triggerHapticFeedback,
  onOnlineUsersPress,
  onLeaderboardPress,
}) => {
  const { user, firestoreDB, theme, isInActiveGame = false, isAdmin, isModerator } = useGlobalState();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const [gameModalVisible, setGameModalVisible] = useState(false);
  const [hasValidInvite, setHasValidInvite] = useState(false);
  const [pendingGroupInvitationsCount, setPendingGroupInvitationsCount] = useState(0);
  const [pendingJoinRequestsCount, setPendingJoinRequestsCount] = useState(0);
  const isDarkMode = theme === 'dark';

  // Keep separate unread counts for private chats and group chats

  const INVITE_EXPIRY_MS = 60000; // 1 minute (same as gameInviteSystem.js)

  // ✅ Listen to game invitations to show badge on game controller icon
  useEffect(() => {
    // Don't listen if user is in active game or not logged in
    if (!firestoreDB || !user?.id || isInActiveGame) {
      setHasValidInvite(false);
      return;
    }

    const unsubscribe = listenToUserInvites(firestoreDB, user.id, (invites) => {
      if (invites.length === 0) {
        setHasValidInvite(false);
        return;
      }

      // ✅ Filter to only show valid (non-expired) invites
      const now = Date.now();
      const validInvites = invites.filter((invite) => {
        const timestamp = invite.timestamp?.toMillis?.() || invite.timestamp || Date.now();
        const expiresAt = invite.expiresAt || (timestamp + INVITE_EXPIRY_MS);
        return now <= expiresAt && invite.status === 'pending';
      });

      setHasValidInvite(validInvites.length > 0);
    });

    return () => {
      unsubscribe();
    };
  }, [firestoreDB, user?.id, isInActiveGame]);

  // ✅ Listen to pending group invitations
  useEffect(() => {
    if (!firestoreDB || !user?.id) {
      setPendingGroupInvitationsCount(0);
      return;
    }

    const invitationsQuery = query(
      collection(firestoreDB, 'group_invitations'),
      where('invitedUserId', '==', user.id),
      where('status', '==', 'pending')
    );

    const unsubscribe = onSnapshot(
      invitationsQuery,
      (snapshot) => {
        const now = Date.now();
        let validCount = 0;

        snapshot.forEach((doc) => {
          const data = doc.data();
          // Check if invitation is not expired
          if (data.expiresAt && now < data.expiresAt) {
            validCount++;
          } else if (!data.expiresAt) {
            // If no expiry, consider it valid
            validCount++;
          }
        });

        setPendingGroupInvitationsCount(validCount);
      },
      (error) => {
        console.error('Error loading group invitations:', error);
        setPendingGroupInvitationsCount(0);
      }
    );

    return () => unsubscribe();
  }, [firestoreDB, user?.id]);

  // ✅ Listen to pending join requests for groups where user is creator (optimized - only count)
  useEffect(() => {
    if (!firestoreDB || !user?.id) {
      setPendingJoinRequestsCount(0);
      return;
    }

    const joinRequestsQuery = query(
      collection(firestoreDB, 'group_join_requests'),
      where('creatorId', '==', user.id),
      where('status', '==', 'pending')
    );

    const unsubscribe = onSnapshot(
      joinRequestsQuery,
      (snapshot) => {
        setPendingJoinRequestsCount(snapshot.size);
      },
      (error) => {
        console.error('Error loading join requests count:', error);
        if (error.code === 'failed-precondition') {
          console.error('⚠️ Firestore index required. Please create index for group_join_requests: creatorId (Ascending), status (Ascending)');
        }
        setPendingJoinRequestsCount(0);
      }
    );

    return () => unsubscribe();
  }, [firestoreDB, user?.id]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8, }}>
      {user?.id && (
        <>
          {/* Fruit Guessing Game Button */}
          <TouchableOpacity
            onPress={() => {
              setGameModalVisible(true);
              triggerHapticFeedback?.('impactLight');
            }}
            style={{ position: 'relative', padding: 8, marginRight: 4 }}
          >
            <Icon
              name="game-controller-outline"
              size={24}
              color={ config.colors.primary}
            />
            {hasValidInvite && (
              <View style={{ position: 'absolute', top: 4, right: 4, backgroundColor: '#8B5CF6', borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 }}>
                <Text style={{ color: '#fff', fontSize: 8, fontWeight: 'bold' }}>
                  1
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Inbox Button (Private Chats) */}
          <TouchableOpacity
            onPress={() => {
              navigation.navigate('Inbox');
              triggerHapticFeedback('impactLight');
              setunreadcount(0);
            }}
            style={{ position: 'relative', padding: 8, marginRight: 4 }}
          >
            <Icon
              name="chatbox-outline"
              size={24}
              color={ config.colors.primary}
            />
            {unreadcount > 0 && (
              <View style={{ position: 'absolute', top: 4, right: 4, backgroundColor: 'red', borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 }}>
                <Text style={{ color: '#fff', fontSize: 8, fontWeight: 'bold' }}>
                  {unreadcount > 9 ? '9+' : unreadcount}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Groups Button */}
          <TouchableOpacity
            onPress={() => {
              navigation.navigate('Groups');
              triggerHapticFeedback('impactLight');
              if (setGroupUnreadCount && typeof setGroupUnreadCount === 'function') {
                setGroupUnreadCount(0);
              }
            }}
            style={{ position: 'relative', padding: 8, marginRight: 4 }}
          >
            <Icon
              name="people-circle-outline"
              size={24}
              color={ config.colors.primary}
            />
            {/* Show "!" if there are pending invitations or join requests (prioritized), otherwise show unread count */}
            {(pendingGroupInvitationsCount > 0 || pendingJoinRequestsCount > 0 || groupUnreadCount > 0) && (
              <View style={{ position: 'absolute', top: 4, right: 4, backgroundColor: '#10B981', borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 }}>
                <Text style={{ color: '#fff', fontSize: 8, fontWeight: 'bold' }}>
                  {(pendingGroupInvitationsCount > 0 || pendingJoinRequestsCount > 0) ? '!' : (groupUnreadCount > 9 ? '9+' : groupUnreadCount)}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Leaderboard Button */}
          <TouchableOpacity
            onPress={() => {
              if (onLeaderboardPress) {
                onLeaderboardPress();
              }
              triggerHapticFeedback('impactLight');
            }}
            style={{ position: 'relative', padding: 8, marginRight: 4 }}
          >
            <Icon
              name="trophy-outline"
              size={24}
              color={ config.colors.primary}
            />
          </TouchableOpacity>

          {/* Friends / Social Dashboard Button */}
          <TouchableOpacity
            onPress={() => {
              navigation.navigate('SocialDashboard');
              triggerHapticFeedback('impactLight');
            }}
            style={{ position: 'relative', padding: 8, marginRight: 4 }}
          >
            <Icon
              name="people-outline"
              size={24}
              color={ config.colors.primary}
            />
          </TouchableOpacity>

          {/* Admin Dashboard Button (Only for Admins/Moderators) */}
          {(isAdmin || isModerator) && (
            <TouchableOpacity
              onPress={() => {
                navigation.navigate('Admin');
                triggerHapticFeedback('impactLight');
              }}
              style={{ position: 'relative', padding: 8, marginRight: 4 }}
            >
              <Icon
                name="shield-checkmark-outline"
                size={24}
                color={ config.colors.primary}
              />
            </TouchableOpacity>
          )}
        </>
      )}
      {user?.id && (
        <Menu>
          <MenuTrigger>
            <View style={{ padding: 8 }}>
              <Icon name="ellipsis-vertical-outline" size={24} color={config.colors.primary} />
            </View>
          </MenuTrigger>
          <MenuOptions
            customStyles={{
              optionsContainer: {
                marginTop: 8,
                borderRadius: 8,
                width: 220,
                padding: 5,
                backgroundColor: config.colors.background || '#fff',
              },
            }}
          >
            <MenuOption onSelect={() => {
              if (onOnlineUsersPress) {
                onOnlineUsersPress();
              }
              triggerHapticFeedback('impactLight');
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10 }}>
                <Icon name="people-outline" size={20} color={config.colors.primary} style={{ marginRight: 10 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <Text style={{ fontSize: 16, color: config.colors.text || '#000' }}>
                    Online Users
                  </Text>
                </View>
              </View>
            </MenuOption>
            <MenuOption onSelect={() => navigation?.navigate('BlockedUsers')}>
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10 }}>
                <Icon name="ban-outline" size={20} color={config.colors.primary} style={{ marginRight: 10 }} />
                <Text style={{ fontSize: 16, color: config.colors.text || '#000' }}>
                  {t("chat.blocked_users")}
                </Text>
              </View>
            </MenuOption>
          </MenuOptions>
        </Menu>
      )}

      {/* Full-screen Fruit Guessing Game Modal */}
      <Modal
        animationType="slide"
        transparent={false}
        visible={gameModalVisible}
        onRequestClose={() => setGameModalVisible(false)}
      >
        <View style={{ flex: 1 }}>
          {/* Absolute-positioned close icon in top-right corner */}
          <TouchableOpacity
            onPress={() => setGameModalVisible(false)}
            style={{
              position: 'absolute',
              top: Platform.OS === 'android' ? 0 : 40,
              left: 5,
              zIndex: 10,
              padding: 8,
            }}
          >
            <Icon name="close-circle" size={30} color={config.colors.primary} />
          </TouchableOpacity>

          <PetGuessingGameScreen />
        </View>
      </Modal>

    </View>
  );
};

export default CommunityChatHeader;

