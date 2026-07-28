import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import config from '../../Helper/Environment';
import { useTranslation } from 'react-i18next';
import { Menu, MenuOption, MenuOptions, MenuTrigger } from 'react-native-popup-menu';
import { collection, query, where, getDocs, getCountFromServer } from '@react-native-firebase/firestore';
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
  const { user, firestoreDB, theme, isAdmin, isSeniorMod, isModerator, isUserBlocked } = useGlobalState();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const [pendingGroupInvitationsCount, setPendingGroupInvitationsCount] = useState(0);
  const [pendingJoinRequestsCount, setPendingJoinRequestsCount] = useState(0);

  // ✅ Pending group-invitations badge — fetched ON FOCUS only. Was an always-on
  // onSnapshot that kept streaming Firestore reads to render a "!" badge even
  // while the user was deep in other screens/tabs (and duplicated the
  // focus-gated listeners in GroupsScreen). A count badge doesn't need live data.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (!firestoreDB || !user?.id) {
        setPendingGroupInvitationsCount(0);
        return;
      }

      const invitationsQuery = query(
        collection(firestoreDB, 'group_invitations'),
        where('invitedUserId', '==', user.id),
        where('status', '==', 'pending')
      );

      getDocs(invitationsQuery)
        .then((snapshot) => {
          if (cancelled) return;
          const now = Date.now();
          let validCount = 0;
          snapshot.forEach((doc) => {
            const data = doc.data();
            // Not expired (or no expiry) → counts.
            if (data.expiresAt && now < data.expiresAt) validCount++;
            else if (!data.expiresAt) validCount++;
          });
          setPendingGroupInvitationsCount(validCount);
        })
        .catch((error) => {
          if (cancelled) return;
          console.error('Error loading group invitations:', error);
          setPendingGroupInvitationsCount(0);
        });

      return () => { cancelled = true; };
    }, [firestoreDB, user?.id])
  );

  // ✅ Pending join-requests badge (groups I created) — count-only aggregate ON
  // FOCUS. getCountFromServer bills a single read regardless of how many pending
  // requests match, vs the old always-on onSnapshot streaming every pending doc.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (!firestoreDB || !user?.id) {
        setPendingJoinRequestsCount(0);
        return;
      }

      const joinRequestsQuery = query(
        collection(firestoreDB, 'group_join_requests'),
        where('creatorId', '==', user.id),
        where('status', '==', 'pending')
      );

      getCountFromServer(joinRequestsQuery)
        .then((snapshot) => {
          if (cancelled) return;
          setPendingJoinRequestsCount(snapshot.data().count);
        })
        .catch((error) => {
          if (cancelled) return;
          console.error('Error loading join requests count:', error);
          if (error.code === 'failed-precondition') {
            console.error('⚠️ Firestore index required for group_join_requests: creatorId (Ascending), status (Ascending)');
          }
          setPendingJoinRequestsCount(0);
        });

      return () => { cancelled = true; };
    }, [firestoreDB, user?.id])
  );

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 0 }}>
      {user?.id && (
        <>
          {/* Inbox Button (Private Chats) */}
          <TouchableOpacity
            onPress={() => {
              navigation.navigate('Inbox');
              triggerHapticFeedback('impactLight');
              setunreadcount(0);
            }}
            style={{ position: 'relative', marginHorizontal: 3 }}
          >
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="chatbubbles-outline" size={20} color="#fff" />
            </View>
            {unreadcount > 0 && (
              <View style={{ position: 'absolute', top: -2, right: -2, backgroundColor: '#EF4444', borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4, borderWidth: 1.5, borderColor: '#4f46e5' }}>
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
            style={{ position: 'relative', marginHorizontal: 3 }}
          >
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="people-circle-outline" size={24} color="#fff" />
            </View>
            {/* Show "!" if there are pending invitations or join requests (prioritized), otherwise show unread count */}
            {(pendingGroupInvitationsCount > 0 || pendingJoinRequestsCount > 0 || groupUnreadCount > 0) && (
              <View style={{ position: 'absolute', top: -2, right: -2, backgroundColor: '#10B981', borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4, borderWidth: 1.5, borderColor: '#4f46e5' }}>
                <Text style={{ color: '#fff', fontSize: 8, fontWeight: 'bold' }}>
                  {(pendingGroupInvitationsCount > 0 || pendingJoinRequestsCount > 0) ? '!' : (groupUnreadCount > 9 ? '9+' : groupUnreadCount)}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Admin Dashboard Button (Only for Admins/Senior Mods/Moderators, never while banned) */}
          {(isAdmin || isSeniorMod || isModerator) && !isUserBlocked && (
            <TouchableOpacity
              onPress={() => {
                navigation.navigate('AdminDashboard');
                triggerHapticFeedback('impactLight');
              }}
              style={{ position: 'relative', marginHorizontal: 3 }}
            >
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="shield-checkmark-outline" size={20} color="#fff" />
              </View>
            </TouchableOpacity>
          )}
        </>
      )}
      {user?.id && (
        <Menu>
          <MenuTrigger>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginLeft: 3 }}>
              <Icon name="ellipsis-vertical" size={20} color="#fff" />
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

    </View>
  );
};

export default CommunityChatHeader;

