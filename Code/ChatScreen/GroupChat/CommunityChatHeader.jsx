import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import config from '../../Helper/Environment';
import { useTranslation } from 'react-i18next';
import { Menu, MenuOption, MenuOptions, MenuTrigger } from 'react-native-popup-menu';
import { collection, query, where, getDocs, getCountFromServer } from '@react-native-firebase/firestore';
import SlowModeSheet from './SlowModeSheet';
import { getActivePublicRoom } from '../../Supabase/chatSlowMode';
import { getCurrentUserOwner } from '../../Helper/ownerFlag';
import { useChatBadges, acknowledgeDmBadge, acknowledgeGroupBadge } from '../chatBadgeStore';
// Focus re-fetch throttle for the two header badges (see the effects below).
const BADGE_REFETCH_MS = 2 * 60 * 1000;
let invitationsBadgeCache = { uid: null, ts: 0, count: 0 };
let joinRequestsBadgeCache = { uid: null, ts: 0, count: 0 };
const resetBadgeThrottle = () => {
  invitationsBadgeCache = { ...invitationsBadgeCache, ts: 0 };
  joinRequestsBadgeCache = { ...joinRequestsBadgeCache, ts: 0 };
};

// The two unread badges read chatBadgeStore themselves, so a new message
// re-renders only the badge, not this header.
const InboxBadge = () => {
  const { dm } = useChatBadges();
  if (dm <= 0) return null;
  return (
    <View style={{ position: 'absolute', top: -2, right: -2, backgroundColor: '#EF4444', borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4, borderWidth: 1.5, borderColor: '#4f46e5' }}>
      <Text style={{ color: '#fff', fontSize: 8, fontWeight: 'bold' }}>
        {dm > 9 ? '9+' : dm}
      </Text>
    </View>
  );
};

// "!" for pending invitations or join requests (prioritized), else the unread count.
const GroupsBadge = ({ hasPending }) => {
  const { group } = useChatBadges();
  if (!hasPending && group <= 0) return null;
  return (
    <View style={{ position: 'absolute', top: -2, right: -2, backgroundColor: '#10B981', borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4, borderWidth: 1.5, borderColor: '#4f46e5' }}>
      <Text style={{ color: '#fff', fontSize: 8, fontWeight: 'bold' }}>
        {hasPending ? '!' : (group > 9 ? '9+' : group)}
      </Text>
    </View>
  );
};

const CommunityChatHeader = ({
  selectedTheme,
  triggerHapticFeedback,
  onOnlineUsersPress,
  onLeaderboardPress,
}) => {
  const { user, firestoreDB, theme, isAdmin, isSeniorMod, isModerator, isUserBlocked } = useGlobalState();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const [pendingGroupInvitationsCount, setPendingGroupInvitationsCount] = useState(0);
  const [pendingJoinRequestsCount, setPendingJoinRequestsCount] = useState(0);
  // Slow mode (supabase/046): Senior Mod, Admin, owner. The rpc re-checks.
  const canSetSlowMode = (!!(isAdmin || isSeniorMod) || getCurrentUserOwner(user?.id)) && !isUserBlocked;
  const [slowModeOpen, setSlowModeOpen] = useState(false);
  const [slowModeRoom, setSlowModeRoom] = useState(null);

  // ✅ Pending group-invitations badge — fetched ON FOCUS only. Was an always-on
  // onSnapshot that kept streaming Firestore reads to render a "!" badge even
  // while the user was deep in other screens/tabs (and duplicated the
  // focus-gated listeners in GroupsScreen). A count badge doesn't need live data.
  // Focus re-fetches are throttled to once per 2 min per uid (the cached count
  // is re-applied in between); opening Groups resets the throttle so the badge
  // is fresh when the user comes back from acting on invites/requests.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (!firestoreDB || !user?.id) {
        setPendingGroupInvitationsCount(0);
        return;
      }

      if (invitationsBadgeCache.uid === user.id && (Date.now() - invitationsBadgeCache.ts) < BADGE_REFETCH_MS) {
        setPendingGroupInvitationsCount(invitationsBadgeCache.count);
        return;
      }

      const invitationsQuery = query(
        collection(firestoreDB, 'group_invitations'),
        where('invitedUserId', '==', user.id),
        where('status', '==', 'pending')
      );

      getDocs(invitationsQuery)
        .then((snapshot) => {
          const now = Date.now();
          let validCount = 0;
          snapshot.forEach((doc) => {
            const data = doc.data();
            // Not expired (or no expiry) → counts.
            if (data.expiresAt && now < data.expiresAt) validCount++;
            else if (!data.expiresAt) validCount++;
          });
          invitationsBadgeCache = { uid: user.id, ts: Date.now(), count: validCount };
          if (cancelled) return;
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
  // Throttled to once per 2 min per uid like the invitations badge above.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (!firestoreDB || !user?.id) {
        setPendingJoinRequestsCount(0);
        return;
      }

      if (joinRequestsBadgeCache.uid === user.id && (Date.now() - joinRequestsBadgeCache.ts) < BADGE_REFETCH_MS) {
        setPendingJoinRequestsCount(joinRequestsBadgeCache.count);
        return;
      }

      const joinRequestsQuery = query(
        collection(firestoreDB, 'group_join_requests'),
        where('creatorId', '==', user.id),
        where('status', '==', 'pending')
      );

      getCountFromServer(joinRequestsQuery)
        .then((snapshot) => {
          const count = snapshot.data().count;
          joinRequestsBadgeCache = { uid: user.id, ts: Date.now(), count };
          if (cancelled) return;
          setPendingJoinRequestsCount(count);
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
              acknowledgeDmBadge();
            }}
            style={{ position: 'relative', marginHorizontal: 3 }}
          >
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="chatbubbles-outline" size={20} color="#fff" />
            </View>
            <InboxBadge />
          </TouchableOpacity>

          {/* Groups Button */}
          <TouchableOpacity
            onPress={() => {
              resetBadgeThrottle(); // user is about to act on invites/requests — refetch on return
              navigation.navigate('Groups');
              triggerHapticFeedback('impactLight');
              acknowledgeGroupBadge();
            }}
            style={{ position: 'relative', marginHorizontal: 3 }}
          >
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="people-circle-outline" size={24} color="#fff" />
            </View>
            <GroupsBadge hasPending={pendingGroupInvitationsCount > 0 || pendingJoinRequestsCount > 0} />
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
                    {t("chat.community_chat_header.online_users")}
                  </Text>
                </View>
              </View>
            </MenuOption>
            {canSetSlowMode && (
              <MenuOption onSelect={() => {
                setSlowModeRoom(getActivePublicRoom());
                setSlowModeOpen(true);
                triggerHapticFeedback('impactLight');
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10 }}>
                  <Icon name="time-outline" size={20} color={config.colors.primary} style={{ marginRight: 10 }} />
                  <Text style={{ fontSize: 16, color: config.colors.text || '#000' }}>Slow mode</Text>
                </View>
              </MenuOption>
            )}
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
      {canSetSlowMode && (
        <SlowModeSheet
          visible={slowModeOpen}
          onClose={() => setSlowModeOpen(false)}
          room={slowModeRoom}
          isDark={theme === 'dark'}
        />
      )}

    </View>
  );
};

export default CommunityChatHeader;

