import React, { useMemo, useCallback, useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  Alert,
  TextInput,
  Switch,
  Modal,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGlobalState } from '../../GlobelStats';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import { useTranslation } from 'react-i18next';
import { leaveGroup, acceptGroupInvite, declineGroupInvite, updateGroupAvatar, approveJoinRequest, rejectJoinRequest, getAllGroups, sendJoinRequest, deleteGroup, MAX_GROUPS_PER_USER } from '../utils/groupUtils';
import { showSuccessMessage, showErrorMessage } from '../../Helper/MessageHelper';
import { collection, query, where, onSnapshot, doc, getDoc, getCountFromServer, limit } from '@react-native-firebase/firestore';
import { ref, get, set } from '@react-native-firebase/database';
import { setGroupMuted as sbSetGroupMuted } from '../../Supabase/groupMetaBackend';
import { useLocalState } from '../../LocalGlobelStats';
import GroupsGuideModal from './GroupsGuideModal';
import OnlineUsersList from './OnlineUsersList';
import CreateGroupModal from './CreateGroupModal';
import { launchImageLibrary } from 'react-native-image-picker';
import RNFS from 'react-native-fs';

const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_ACCESS_KEY = '1b7e1a85-dff7-4a98-ba701fc7f9b9-6542-46e2';
const BUNNY_CDN_BASE = 'https://pull-gag.b-cdn.net';

const base64ToBytes = (base64) => {
  if (!base64 || typeof base64 !== 'string') {
    throw new Error('Invalid base64 input');
  }

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = base64.replace(/[\r\n]+/g, '');
  let output = [];

  let i = 0;
  while (i < str.length) {
    const enc1 = chars.indexOf(str.charAt(i++));
    const enc2 = chars.indexOf(str.charAt(i++));
    const enc3 = chars.indexOf(str.charAt(i++));
    const enc4 = chars.indexOf(str.charAt(i++));

    if (enc1 === -1 || enc2 === -1 || enc3 === -1 || enc4 === -1) {
      throw new Error('Invalid base64 character');
    }

    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;

    if (enc3 !== 64) {
      output.push(chr1, chr2);
    } else {
      output.push(chr1);
    }
    if (enc4 !== 64 && enc3 !== 64) {
      output.push(chr3);
    }
  }

  return Uint8Array.from(output);
};

// Helper function to truncate group names
const truncateGroupName = (name, maxLength = 25) => {
  if (!name || typeof name !== 'string') return 'Group';
  if (name.length <= maxLength) return name;
  return name.substring(0, maxLength).trim() + '...';
};

const GroupsScreen = ({ groups = [], setGroups, groupsLoading = false }) => {
  const navigation = useNavigation();
  const { user, theme, appdatabase, firestoreDB, isAdmin, isModerator } = useGlobalState();
  const { localState } = useLocalState();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [pendingInvitations, setPendingInvitations] = useState([]);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [pendingJoinRequests, setPendingJoinRequests] = useState([]); // Join requests for groups where user is creator
  const [myPendingJoinRequests, setMyPendingJoinRequests] = useState([]); // Join requests sent by current user
  const [joinRequestsLoading, setJoinRequestsLoading] = useState(false);
  const [guideModalVisible, setGuideModalVisible] = useState(false);
  const [onlineUsersListVisible, setOnlineUsersListVisible] = useState(false);
  const [activeTab, setActiveTab] = useState('joined'); // 'joined' or 'all'
  const [allGroups, setAllGroups] = useState([]);
  const [allGroupsLoading, setAllGroupsLoading] = useState(false);
  const [allGroupsLoadingMore, setAllGroupsLoadingMore] = useState(false);
  const [allGroupsSearchQuery, setAllGroupsSearchQuery] = useState('');
  const [creatorNames, setCreatorNames] = useState({}); // Cache creator names
  const [allGroupsHasMore, setAllGroupsHasMore] = useState(true);
  const [allGroupsLastDoc, setAllGroupsLastDoc] = useState(null);
  const [joinRequestsExpanded, setJoinRequestsExpanded] = useState(false);
  const [invitationsExpanded, setInvitationsExpanded] = useState(false);
  const [editGroupModalVisible, setEditGroupModalVisible] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);
  const [mutedGroups, setMutedGroups] = useState({}); // { groupId: boolean } - Track muted status
  const [groupInfoModalVisible, setGroupInfoModalVisible] = useState(false);
  const [selectedGroupInfo, setSelectedGroupInfo] = useState(null);
  const [groupInfoLoading, setGroupInfoLoading] = useState(false);
  const [totalGroupCount, setTotalGroupCount] = useState(null);

  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  // ✅ Fetch total group count (same as adoptme pattern)
  useEffect(() => {
    if (!firestoreDB) return;
    const fetchCount = async () => {
      try {
        const coll = collection(firestoreDB, 'groups');
        const q = query(coll, where('isActive', '==', true));
        const snapshot = await getCountFromServer(q);
        setTotalGroupCount(snapshot.data().count);
      } catch (err) {
        console.error('Error fetching group count:', err);
      }
    };
    fetchCount();
  }, [firestoreDB]);

  // Set header with info icon
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => setGuideModalVisible(true)}
          style={{ marginRight: 15, padding: 4 }}
        >
          <Icon
            name="information-circle-outline"
            size={24}
            color={isDarkMode ? '#fff' : '#000'}
          />
        </TouchableOpacity>
      ),
    });
  }, [navigation, isDarkMode]);

  // Load pending group invitations
  // ✅ OPTIMIZED: one listener per mount (keyed on uid) instead of a fresh
  // listener on every focus, bounded with limit(50). Same query, same UI.
  useEffect(() => {
    if (!firestoreDB || !user?.id) {
      setPendingInvitations([]);
      return;
    }

    setInvitationsLoading(true);
    // Invitations only add a section above the list; never let a listener
    // that hasn't answered yet hold the whole groups list on the spinner
    // (Adopt Me b369893).
    const invitationsFallback = setTimeout(() => setInvitationsLoading(false), 4000);
    const invitationsQuery = query(
      collection(firestoreDB, 'group_invitations'),
      where('invitedUserId', '==', user.id),
      where('status', '==', 'pending'),
      limit(50)
    );

    const unsubscribe = onSnapshot(
      invitationsQuery,
      (snapshot) => {
        const invitations = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          // Check if invitation is expired
          if (data.expiresAt && Date.now() < data.expiresAt) {
            invitations.push({
              id: doc.id,
              ...data,
            });
          }
        });
        setPendingInvitations(invitations);
        clearTimeout(invitationsFallback);
        setInvitationsLoading(false);
      },
      (error) => {
        console.error('Error loading invitations:', error);
        clearTimeout(invitationsFallback);
        setInvitationsLoading(false);
      }
    );

    return () => {
      clearTimeout(invitationsFallback);
      unsubscribe();
    };
  }, [firestoreDB, user?.id]);

  // ✅ OPTIMIZED: pending join requests (groups I created) — one listener per
  // mount instead of per focus, bounded with limit(50)
  useEffect(() => {
    if (!firestoreDB || !user?.id) {
      setPendingJoinRequests([]);
      return;
    }

    setJoinRequestsLoading(true);
    const joinRequestsQuery = query(
      collection(firestoreDB, 'group_join_requests'),
      where('creatorId', '==', user.id),
      where('status', '==', 'pending'),
      limit(50)
    );

    const unsubscribe = onSnapshot(
      joinRequestsQuery,
      (snapshot) => {
        const requests = [];
        snapshot.forEach((doc) => {
          requests.push({
            id: doc.id,
            ...doc.data(),
          });
        });
        setPendingJoinRequests(requests);
        setJoinRequestsLoading(false);
      },
      (error) => {
        console.error('Error loading join requests:', error);
        if (error.code === 'failed-precondition') {
          console.error('⚠️ Firestore index required. Please create index for group_join_requests: creatorId (Ascending), status (Ascending)');
        }
        setJoinRequestsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [firestoreDB, user?.id]);

  // ✅ OPTIMIZED: user's own pending join requests — one listener per mount
  // instead of per focus, bounded with limit(50)
  useEffect(() => {
    if (!firestoreDB || !user?.id) {
      setMyPendingJoinRequests([]);
      return;
    }

    const myJoinRequestsQuery = query(
      collection(firestoreDB, 'group_join_requests'),
      where('requesterId', '==', user.id),
      where('status', '==', 'pending'),
      limit(50)
    );

    const unsubscribe = onSnapshot(
      myJoinRequestsQuery,
      (snapshot) => {
        const requests = [];
        snapshot.forEach((doc) => {
          requests.push({
            id: doc.id,
            ...doc.data(),
          });
        });
        setMyPendingJoinRequests(requests);
      },
      (error) => {
        console.error('Error loading my join requests:', error);
        if (error.code === 'failed-precondition') {
          console.error('⚠️ Firestore index required. Please create index for group_join_requests: requesterId (Ascending), status (Ascending)');
        }
      }
    );

    return () => unsubscribe();
  }, [firestoreDB, user?.id]);

  // Handle accept invitation
  const handleAcceptInvitation = useCallback(async (inviteId, groupId) => {
    const callbackFunction = async () => {
      try {
        const result = await acceptGroupInvite(
          firestoreDB,
          appdatabase,
          inviteId,
          {
            id: user.id,
            displayName: user.displayName || 'Anonymous',
            avatar: user.avatar || null,
          }
        );
        if (result.success) {
          showSuccessMessage(t('home.alert.success'), result.groupName ? t('chat.groups_screen.joined_group', { name: result.groupName }) : t('chat.groups_screen.joined_group_unnamed'));

          // 🐝 Track group joins for socialBee badge
          try {
            const { incrementAndCheckBadge, GROUP_CHAT_BADGE_THRESHOLDS } = require('./badgeUtils');
            incrementAndCheckBadge(appdatabase, user.id, 'groupJoinCount', GROUP_CHAT_BADGE_THRESHOLDS);
          } catch (e) {}

          // Remove from pending list locally
          setPendingInvitations(prev => prev.filter(invite => invite.id !== inviteId));
          // Navigate to the group chat
          navigation.navigate('GroupChatDetail', { groupId, groupName: result.groupName });
        } else {
          showErrorMessage(t('chat.error'), result.error || t('chat.groups_screen.accept_failed'));
        }
      } catch (error) {
        console.error('Error accepting invitation:', error);
        showErrorMessage(t('chat.error'), t('chat.groups_screen.accept_failed_retry'));
      }
    };

    callbackFunction();
  }, [user?.id, firestoreDB, appdatabase, navigation, t]);

  const handleDeclineInvitation = useCallback(async (inviteId) => {
    if (!user?.id) return;
    try {
      const result = await declineGroupInvite(firestoreDB, inviteId, user.id);
      if (result.success) {
        showSuccessMessage(t('home.alert.success'), t('chat.groups_screen.invitation_declined'));
        setPendingInvitations(prev => prev.filter(invite => invite.id !== inviteId));
      } else {
        showErrorMessage(t('chat.error'), result.error || t('chat.groups_screen.decline_failed'));
      }
    } catch (error) {
      console.error('Error declining invitation:', error);
      showErrorMessage(t('chat.error'), t('chat.groups_screen.decline_failed_retry'));
    }
  }, [user?.id, firestoreDB, t]);

  // Handle open group
  const handleOpenGroup = useCallback((groupId, groupName) => {
    if (!groupId) {
      console.warn('Cannot open group: missing groupId');
      showErrorMessage(t('chat.error'), t('chat.groups_screen.group_id_missing'));
      return;
    }

    if (navigation && typeof navigation.navigate === 'function') {
      navigation.navigate('GroupChatDetail', {
        groupId,
        groupName: groupName || 'Group',
      });
    }
  }, [navigation, t]);

  // Handle delete group (Group Admin only)
  const handleDeleteGroup = useCallback((groupId, groupName) => {
    if (!groupId || !user?.id) {
      console.warn('Cannot delete group: missing groupId or user.id', { groupId, userId: user?.id });
      return;
    }

    // Check if user is admin in this specific group
    const group = groups.find(g => g.groupId === groupId);
    const isCreator = group?.createdBy === user.id;
    const isGroupAdmin = isCreator || (group?.members?.[user.id]?.role === 'admin') || ((isAdmin || isModerator) && group?.members?.[user.id]);

    if (!isGroupAdmin) {
      showErrorMessage(t('chat.error'), t('chat.groups_screen.only_admins_delete'));
      return;
    }

    Alert.alert(
      t('chat.groups_screen.delete_group_title'),
      groupName ? t('chat.groups_screen.delete_group_confirm', { name: groupName }) : t('chat.groups_screen.delete_group_confirm_unnamed'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await deleteGroup(firestoreDB, appdatabase, groupId, user?.id ?? null);
              if (result.success) {
                showSuccessMessage(t('home.alert.success'), t('chat.groups_screen.group_deleted'));
                // Update local state
                if (setGroups && typeof setGroups === 'function') {
                  setGroups((prevGroups) => {
                    if (!Array.isArray(prevGroups)) return [];
                    return prevGroups.filter((group) => group?.groupId !== groupId);
                  });
                }
              } else {
                showErrorMessage(t('chat.error'), result.error || t('chat.groups_screen.delete_failed'));
              }
            } catch (error) {
              console.error('Error deleting group:', error);
              showErrorMessage(t('chat.error'), t('chat.groups_screen.delete_failed_retry'));
            }
          },
        },
      ]
    );
  }, [user?.id, isAdmin, isModerator, firestoreDB, appdatabase, setGroups, groups, t]);

  // Handle leave group
  const handleLeaveGroup = useCallback((groupId, groupName) => {
    if (!groupId || !user?.id) {
      console.warn('Cannot leave group: missing groupId or user.id', { groupId, userId: user?.id });
      return;
    }

    Alert.alert(
      t('chat.groups_screen.leave_group_title'),
      groupName ? t('chat.groups_screen.leave_group_confirm', { name: groupName }) : t('chat.groups_screen.leave_group_confirm_unnamed'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('chat.groups_screen.leave'),
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await leaveGroup(firestoreDB, appdatabase, groupId, user.id);
              if (result.success) {
                showSuccessMessage(t('home.alert.success'), t('chat.groups_screen.left_group'));
                // Update local state
                if (setGroups && typeof setGroups === 'function') {
                  setGroups((prevGroups) => {
                    if (!Array.isArray(prevGroups)) return [];
                    return prevGroups.filter((group) => group?.groupId !== groupId);
                  });
                }
              } else {
                showErrorMessage(t('chat.error'), result.error || t('chat.groups_screen.leave_failed'));
              }
            } catch (error) {
              console.error('Error leaving group:', error);
              showErrorMessage(t('chat.error'), t('chat.groups_screen.leave_failed_retry'));
            }
          },
        },
      ]
    );
  }, [user?.id, firestoreDB, appdatabase, setGroups, t]);

  // Upload image to BunnyCDN
  const uploadToBunny = useCallback(async (imagePath) => {
    try {
      const base64 = await RNFS.readFile(imagePath.replace('file://', ''), 'base64');
      const bytes = base64ToBytes(base64);
      const fileName = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
      const filePath = `groups/${fileName}`;

      const response = await fetch(`https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${filePath}`, {
        method: 'PUT',
        headers: {
          AccessKey: BUNNY_ACCESS_KEY,
          'Content-Type': 'image/jpeg',
        },
        body: bytes,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      return `${BUNNY_CDN_BASE}/${filePath}`;
    } catch (error) {
      console.error('Error uploading to BunnyCDN:', error);
      throw error;
    }
  }, []);

  // Handle edit group (Group creator, group admin, or global admin) - Opens CreateGroupModal in edit mode
  const handleEditGroup = useCallback((groupId) => {
    if (!groupId || !user?.id) return;

    const group = groups.find(g => g.groupId === groupId);
    if (!group) {
      showErrorMessage(t('chat.error'), t('chat.groups_screen.group_not_found'));
      return;
    }

    // Check if user has permission to edit (group creator, group admin, or global admin)
    const isCreator = group.createdBy === user.id;
    const isGroupAdmin = group.members?.[user.id]?.role === 'admin';
    const canEdit = isCreator || isGroupAdmin || ((isAdmin || isModerator) && group.members?.[user.id]);

    if (!canEdit) {
      showErrorMessage(t('chat.error'), t('chat.groups_screen.only_admins_edit'));
      return;
    }

    setEditingGroup({
      id: groupId,
      name: group.groupName || group.name || '',
      description: group.description || '',
      avatar: group.groupAvatar || group.avatar || null,
    });
    setEditGroupModalVisible(true);
  }, [isAdmin, isModerator, groups, user?.id, showErrorMessage, t]);

  // Handle group updated callback
  const handleGroupUpdated = useCallback(() => {
    // Refresh groups list
    if (setGroups && typeof setGroups === 'function') {
      // The groups will be refreshed from the parent component's listener
      // But we can trigger a re-render if needed
    }
  }, [setGroups]);

  // ✅ Mute status comes free with the group rows ChatNavigator already
  // streams over the group-meta realtime channel — no extra Supabase
  // round-trip (this used to re-download every group_meta_data row on
  // each groups change).
  useEffect(() => {
    if (groups.length === 0) return;
    const muteStatusMap = {};
    for (const g of groups) {
      if (g.groupId) muteStatusMap[g.groupId] = !!g.muted;
    }
    setMutedGroups(muteStatusMap);
  }, [groups]);

  // Handle show group info
  const handleShowGroupInfo = useCallback(async (groupId) => {
    // console.log('handleShowGroupInfo called with groupId:', groupId);
    if (!groupId || !firestoreDB || !appdatabase) {
      // console.log('Missing required data:', { groupId, firestoreDB: !!firestoreDB, appdatabase: !!appdatabase });
      return;
    }

    setGroupInfoLoading(true);
    setGroupInfoModalVisible(true);
    // console.log('Modal visibility set to true');

    try {
      // Get group data from Firestore
      const groupDocRef = doc(firestoreDB, 'groups', groupId);
      const groupDocSnapshot = await getDoc(groupDocRef);

      if (!groupDocSnapshot.exists()) {
        showErrorMessage(t('chat.error'), t('chat.groups_screen.group_not_found'));
        setGroupInfoModalVisible(false);
        return;
      }

      const groupData = groupDocSnapshot.data();
      // console.log('Group data:', groupData);
      const createdBy = groupData.createdBy;
      let createdAt = groupData.createdAt || groupData.createdAtTimestamp || groupData.createdAt?.toMillis?.() || null;

      // Handle Firestore Timestamp
      if (createdAt && typeof createdAt === 'object' && createdAt.toMillis) {
        createdAt = createdAt.toMillis();
      } else if (createdAt && typeof createdAt === 'object' && createdAt.seconds) {
        createdAt = createdAt.seconds * 1000;
      }

      // ✅ OPTIMIZED: Fetch only displayName and avatar instead of full user object
      let creatorName = t('chat.groups_screen.unknown');
      let creatorAvatar = null;
      if (createdBy) {
        try {
          const [displayNameSnap, avatarSnap] = await Promise.all([
            get(ref(appdatabase, `users/${createdBy}/displayName`)).catch(() => null),
            get(ref(appdatabase, `users/${createdBy}/avatar`)).catch(() => null),
          ]);
          if (displayNameSnap?.exists()) {
            creatorName = displayNameSnap.val() || t('chat.groups_screen.unknown');
          }
          if (avatarSnap?.exists()) {
            creatorAvatar = avatarSnap.val();
          }
        } catch (error) {
          console.error('Error fetching creator info:', error);
        }
      }

      // Get member count only (don't fetch member details to reduce Firebase costs)
      const memberIds = groupData.memberIds || [];
      const memberCount = memberIds.length;

      const groupInfo = {
        groupId,
        name: groupData.name || t('chat.groups_screen.group_fallback'),
        description: groupData.description || t('chat.groups_screen.no_description'),
        avatar: groupData.avatar || groupData.groupAvatar || null,
        createdBy: {
          id: createdBy,
          name: creatorName,
          avatar: creatorAvatar,
        },
        createdAt: createdAt,
        memberCount: memberCount,
      };

      // console.log('Setting group info:', groupInfo);
      setSelectedGroupInfo(groupInfo);
    } catch (error) {
      // console.error('Error loading group info:', error);
      showErrorMessage(t('chat.error'), t('chat.groups_screen.load_info_failed'));
      setGroupInfoModalVisible(false);
    } finally {
      setGroupInfoLoading(false);
      // console.log('Loading finished');
    }
  }, [firestoreDB, appdatabase, showErrorMessage, t]);

  // ✅ Toggle mute notifications for a group
  const handleToggleMute = useCallback(async (groupId, groupName) => {
    if (!user?.id || !groupId) return;

    const currentMuted = mutedGroups[groupId] || false;
    const newMutedStatus = !currentMuted;

    try {
      await sbSetGroupMuted(user.id, groupId, newMutedStatus);

      // Update local state
      setMutedGroups(prev => ({
        ...prev,
        [groupId]: newMutedStatus,
      }));

      showSuccessMessage(
        t('home.alert.success'),
        newMutedStatus
          ? (groupName ? t('chat.groups_screen.notifications_muted', { name: groupName }) : t('chat.groups_screen.notifications_muted_unnamed'))
          : (groupName ? t('chat.groups_screen.notifications_enabled', { name: groupName }) : t('chat.groups_screen.notifications_enabled_unnamed'))
      );
    } catch (error) {
      console.error('Error toggling mute status:', error);
      showErrorMessage(t('chat.error'), t('chat.groups_screen.mute_failed'));
    }
  }, [appdatabase, user?.id, mutedGroups, t]);

  // Handle update group icon (Admin or creator)
  const handleUpdateGroupIcon = useCallback(async (groupId) => {
    if (!groupId || !user?.id || !firestoreDB || !appdatabase) return;

    // Check if user is admin or creator
    const group = groups.find(g => g.groupId === groupId);
    const isCreator = group?.createdBy === user.id;
    if (!isAdmin && !isModerator && !isCreator) {
      showErrorMessage(t('chat.error'), t('chat.groups_screen.only_admins_icon'));
      return;
    }

    launchImageLibrary(
      {
        mediaType: 'photo',
        selectionLimit: 1,
        quality: 0.8,
      },
      async (response) => {
        if (response.didCancel || response.errorCode) {
          return;
        }

        const asset = response.assets?.[0];
        if (asset?.uri) {
          try {
            // Upload image
            const avatarUrl = await uploadToBunny(asset.uri);

            // Update group avatar
            const result = await updateGroupAvatar(firestoreDB, appdatabase, groupId, user.id, avatarUrl, isAdmin);

            if (result.success) {
              showSuccessMessage(t('home.alert.success'), t('chat.groups_screen.icon_updated'));
              // Refresh groups list
              if (setGroups && typeof setGroups === 'function') {
                setGroups((prevGroups) => {
                  if (!Array.isArray(prevGroups)) return prevGroups;
                  return prevGroups.map((group) =>
                    group?.groupId === groupId
                      ? { ...group, groupAvatar: avatarUrl }
                      : group
                  );
                });
              }
            } else {
              showErrorMessage(t('chat.error'), result.error || t('chat.groups_screen.icon_update_failed'));
            }
          } catch (error) {
            console.error('Error updating group icon:', error);
            showErrorMessage(t('chat.error'), t('chat.groups_screen.icon_update_failed_retry'));
          }
        }
      }
    );
  }, [user?.id, firestoreDB, appdatabase, uploadToBunny, setGroups, isAdmin, groups, t]);

  // Render group item
  const renderGroupItem = useCallback(({ item }) => {
    if (!item || typeof item !== 'object') return null;

    const groupId = item.groupId;
    if (!groupId) {
      console.warn('Group item missing groupId:', item);
      return null;
    }

    const groupName = item.groupName || t('chat.groups_screen.group_fallback');
    const truncatedName = truncateGroupName(groupName, 25);
    const groupAvatar = item.groupAvatar || null;
    const lastMessage = item.lastMessage || t('chat.groups_screen.no_messages_yet');
    const unreadCount = item.unreadCount || 0;
    const memberCount = item.memberCount || 0;
    const isMyGroup = item.createdBy === user?.id;
    // Check if user is admin in this specific group (creator or has admin role)
    const isGroupAdmin = isMyGroup || (item.members?.[user?.id]?.role === 'admin') || ((isAdmin || isModerator) && item.members?.[user?.id]); // Global admin/moderator can also delete if they're a member

    return (
      <View style={styles.itemContainer}>
        <TouchableOpacity
          style={styles.chatItem}
          onPress={() => handleOpenGroup(groupId, groupName)}
        >
          <Image resizeMethod="resize"
            source={groupAvatar ? { uri: groupAvatar } : require('../../../assets/groups.png')}
            style={styles.avatar}
          />
          <View style={styles.textContainer}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
              <Text style={styles.userName} numberOfLines={1} ellipsizeMode="tail">
                {truncatedName}
              </Text>
              {isMyGroup && (
                <View style={{
                  backgroundColor: isDarkMode ? '#8B5CF6' : '#7C3AED',
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 4,
                  marginLeft: 6,
                }}>
                  <Text style={{
                    color: '#FFF',
                    fontSize: 10,
                    fontWeight: '600'
                  }}>{t('chat.groups_screen.my_group')}</Text>
                </View>
              )}
              {memberCount > 0 && (
                <Text style={styles.memberCountText}> · {t('chat.groups_screen.member_count', { count: memberCount })}</Text>
              )}
            </View>
            <Text style={styles.lastMessage} numberOfLines={1}>
              {lastMessage}
            </Text>
          </View>
          {unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </Text>
            </View>
          )}
        </TouchableOpacity>
        <Menu>
          <MenuTrigger>
            <Icon
              name="ellipsis-vertical-outline"
              size={20}
              color={config.colors.primary}
              style={{ paddingLeft: 10 }}
            />
          </MenuTrigger>
          <MenuOptions>
            {/* Group Info */}
            <MenuOption onSelect={() => handleShowGroupInfo(groupId)}>
              <Text style={{ fontSize: 16, padding: 10 }}>{t('chat.groups_screen.group_info')}</Text>
            </MenuOption>
            {/* Mute/Unmute Notifications */}
            <MenuOption onSelect={() => { }} closeOnSelect={false}>
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: 10,
                paddingVertical: 10,
              }}>
                <Text style={{ fontSize: 16, flex: 1 }}>{t('chat.groups_screen.mute_notifications')}</Text>
                <Switch
                  value={mutedGroups[groupId] || false}
                  onValueChange={() => handleToggleMute(groupId, groupName)}
                  trackColor={{ false: '#767577', true: config.colors.primary }}
                  thumbColor={mutedGroups[groupId] ? '#fff' : '#f4f3f4'}
                />
              </View>
            </MenuOption>
            {isGroupAdmin && (
              <>
                <MenuOption onSelect={() => handleEditGroup(groupId)}>
                  <Text style={{ fontSize: 16, padding: 10 }}>{t('chat.groups_screen.edit')}</Text>
                </MenuOption>
                <MenuOption onSelect={() => handleDeleteGroup(groupId, groupName)}>
                  <Text style={{ color: 'red', fontSize: 16, padding: 10, fontWeight: 'bold' }}>{t('chat.groups_screen.delete_group_admin')}</Text>
                </MenuOption>
              </>
            )}
            {!isGroupAdmin && isMyGroup && (
              <MenuOption onSelect={() => handleUpdateGroupIcon(groupId)}>
                <Text style={{ fontSize: 16, padding: 10 }}>{t('chat.groups_screen.update_group_icon')}</Text>
              </MenuOption>
            )}
            <MenuOption onSelect={() => handleLeaveGroup(groupId, groupName)}>
              <Text style={{ color: 'red', fontSize: 16, padding: 10 }}>{t('chat.groups_screen.leave_group_title')}</Text>
            </MenuOption>
          </MenuOptions>
        </Menu>
      </View>
    );
  }, [styles, handleOpenGroup, handleLeaveGroup, handleUpdateGroupIcon, handleEditGroup, handleDeleteGroup, handleToggleMute, user?.id, isDarkMode, isAdmin, isModerator, groups, mutedGroups, t]);

  const filteredGroups = useMemo(() => {
    if (!Array.isArray(groups)) return [];
    // Filter out any groups without a valid groupId
    return groups
      .filter(group => group && typeof group === 'object' && group.groupId)
      .sort((a, b) => (b?.lastMessageTimestamp || 0) - (a?.lastMessageTimestamp || 0));
  }, [groups]);

  // Up to MAX_GROUPS_PER_USER own groups: below that the button still
  // creates (the picker then offers "Add to <group>" too); at the limit it
  // only adds players.
  const atGroupLimit = useMemo(() => {
    return filteredGroups.filter(g => g.createdBy === user?.id).length >= MAX_GROUPS_PER_USER;
  }, [filteredGroups, user?.id]);

  // ✅ Load initial 10 groups when "All Groups" tab is active
  useEffect(() => {
    if (activeTab === 'all' && firestoreDB && appdatabase && !allGroupsLoading) {
      const loadAllGroups = async () => {
        setAllGroupsLoading(true);
        setAllGroupsHasMore(true);
        setAllGroupsLastDoc(null);
        try {
          const result = await getAllGroups(firestoreDB, 'all', allGroupsSearchQuery, 10, null);
          if (result.success) {
            // Show all groups (including user's own groups)
            const availableGroups = (result.groups || []).filter(group => {
              const groupId = group.id || group.groupId;
              return groupId; // Only filter out groups without valid ID
            });
            setAllGroups(availableGroups);
            setAllGroupsHasMore(result.hasMore || false);
            setAllGroupsLastDoc(result.lastDoc || null);

            // ✅ OPTIMIZED: Fetch only displayName instead of full user object
            const creatorIds = [...new Set(availableGroups.map(g => g.createdBy).filter(Boolean))];
            const creatorPromises = creatorIds.map(async (creatorId) => {
              try {
                const { ref, get } = await import('@react-native-firebase/database');
                const displayNameRef = ref(appdatabase, `users/${creatorId}/displayName`);
                const snapshot = await get(displayNameRef);
                if (snapshot.exists()) {
                  return { [creatorId]: snapshot.val() || t('chat.groups_screen.creator_fallback') };
                }
                return { [creatorId]: t('chat.groups_screen.creator_fallback') };
              } catch (error) {
                return { [creatorId]: t('chat.groups_screen.creator_fallback') };
              }
            });

            const creatorResults = await Promise.all(creatorPromises);
            const namesMap = creatorResults.reduce((acc, curr) => ({ ...acc, ...curr }), {});
            setCreatorNames(namesMap);
          } else {
            setAllGroups([]);
            setAllGroupsHasMore(false);
          }
        } catch (error) {
          console.error('Error loading all groups:', error);
          setAllGroups([]);
          setAllGroupsHasMore(false);
        } finally {
          setAllGroupsLoading(false);
        }
      };

      loadAllGroups();
    }
  }, [activeTab, firestoreDB, appdatabase, allGroupsSearchQuery]); // ✅ Removed filteredGroups to prevent reloading when joined groups get new messages

  // ✅ Load more groups on scroll
  const loadMoreGroups = useCallback(async () => {
    if (!allGroupsHasMore || allGroupsLoadingMore || !firestoreDB || !appdatabase || activeTab !== 'all') {
      return;
    }

    setAllGroupsLoadingMore(true);
    try {
      const result = await getAllGroups(firestoreDB, 'all', allGroupsSearchQuery, 15, allGroupsLastDoc);
      if (result.success) {
        // Filter out groups user is already a member of
        // Show all groups (including user's own groups)
        const newGroups = (result.groups || []).filter(group => {
          const groupId = group.id || group.groupId;
          return groupId; // Only filter out groups without valid ID
        });

        // ✅ OPTIMIZED: Fetch only displayName instead of full user object
        const creatorIds = [...new Set(newGroups.map(g => g.createdBy).filter(Boolean))];
        const creatorPromises = creatorIds.map(async (creatorId) => {
          try {
            const { ref, get } = await import('@react-native-firebase/database');
            const displayNameRef = ref(appdatabase, `users/${creatorId}/displayName`);
            const snapshot = await get(displayNameRef);
            if (snapshot.exists()) {
              return { [creatorId]: snapshot.val() || t('chat.groups_screen.creator_fallback') };
            }
            return { [creatorId]: t('chat.groups_screen.creator_fallback') };
          } catch (error) {
            return { [creatorId]: t('chat.groups_screen.creator_fallback') };
          }
        });

        const creatorResults = await Promise.all(creatorPromises);
        const namesMap = creatorResults.reduce((acc, curr) => ({ ...acc, ...curr }), {});

        setAllGroups(prev => [...prev, ...newGroups]);
        setCreatorNames(prev => ({ ...prev, ...namesMap }));
        setAllGroupsHasMore(result.hasMore || false);
        setAllGroupsLastDoc(result.lastDoc || null);
      } else {
        setAllGroupsHasMore(false);
      }
    } catch (error) {
      console.error('Error loading more groups:', error);
      setAllGroupsHasMore(false);
    } finally {
      setAllGroupsLoadingMore(false);
    }
  }, [allGroupsHasMore, allGroupsLoadingMore, firestoreDB, appdatabase, activeTab, allGroupsSearchQuery, allGroupsLastDoc, t]);

  // ✅ Reset all groups when switching to joined tab
  useEffect(() => {
    if (activeTab === 'joined') {
      setAllGroups([]);
      setAllGroupsSearchQuery('');
      setCreatorNames({});
      setAllGroupsHasMore(true);
      setAllGroupsLastDoc(null);
    }
  }, [activeTab]);

  // Render invitation item
  const renderInvitationItem = useCallback(({ item }) => {
    const inviteGroupName = item.groupName || t('chat.groups_screen.group_fallback');
    const truncatedInviteName = truncateGroupName(inviteGroupName, 20);

    return (
      <View style={{
        backgroundColor: isDarkMode ? '#1F2937' : '#FFFFFF',
        marginBottom: 10,
        borderRadius: 12,
        padding: 14,
        borderWidth: 1,
        borderColor: isDarkMode ? '#374151' : '#E5E7EB',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 2,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <View style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: config.colors.primary + '20',
            justifyContent: 'center',
            alignItems: 'center',
            marginRight: 12,
          }}>
            <Icon name="mail-outline" size={22} color={config.colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{
              fontSize: 15,
              fontWeight: 'bold',
              color: isDarkMode ? '#fff' : '#111827',
              marginBottom: 4,
            }} numberOfLines={1} ellipsizeMode="tail">
              {truncatedInviteName}
            </Text>
            <Text style={{
              fontSize: 12,
              color: isDarkMode ? '#9CA3AF' : '#6B7280',

            }}>
              {t('chat.groups_screen.invited_by', { name: item.invitedByDisplayName || t('chat.groups_screen.someone') })}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            onPress={() => handleDeclineInvitation(item.id)}
            style={{
              flex: 1,
              paddingVertical: 10,
              backgroundColor: isDarkMode ? '#374151' : '#F3F4F6',
              borderRadius: 8,
              borderWidth: 1,
              borderColor: isDarkMode ? '#4B5563' : '#E5E7EB',
            }}
            activeOpacity={0.7}
          >
            <Text style={{
              color: '#EF4444',
              fontWeight: 'bold',
              fontSize: 13,
              textAlign: 'center',
            }}>{t('chat.groups_screen.decline')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleAcceptInvitation(item.id, item.groupId)}
            style={{
              flex: 1,
              paddingVertical: 10,
              backgroundColor: config.colors.primary,
              borderRadius: 8,
            }}
            activeOpacity={0.8}
          >
            <Text style={{
              color: '#fff',
              fontWeight: 'bold',
              fontSize: 13,
              textAlign: 'center',
            }}>{t('chat.groups_screen.accept')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [styles, isDarkMode, handleAcceptInvitation, handleDeclineInvitation, t]);

  // Render join request item (for groups where user is creator)
  const renderJoinRequestItem = useCallback(({ item }) => {
    const requestGroupName = item.groupName || t('chat.groups_screen.group_fallback');
    const truncatedGroupName = truncateGroupName(requestGroupName, 20);

    return (
      <View style={{
        backgroundColor: isDarkMode ? '#1F2937' : '#FFFFFF',
        marginBottom: 10,
        borderRadius: 12,
        padding: 14,
        borderWidth: 1,
        borderColor: isDarkMode ? '#374151' : '#E5E7EB',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 2,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <View style={{ position: 'relative', marginRight: 12 }}>
            <Image resizeMethod="resize"
              source={{ uri: item.requesterAvatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                borderWidth: 2,
                borderColor: '#4CAF50',
              }}
            />
            <View style={{
              position: 'absolute',
              bottom: -2,
              right: -2,
              width: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: '#4CAF50',
              borderWidth: 2,
              borderColor: isDarkMode ? '#1F2937' : '#FFFFFF',
              justifyContent: 'center',
              alignItems: 'center',
            }}>
              <Icon name="person-add" size={8} color="#fff" />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{
              fontSize: 15,
              fontWeight: 'bold',
              color: isDarkMode ? '#fff' : '#111827',
              marginBottom: 4,
            }} numberOfLines={1} ellipsizeMode="tail">
              {item.requesterDisplayName || t('chat.anonymous')}
            </Text>
            <Text style={{
              fontSize: 12,
              color: isDarkMode ? '#9CA3AF' : '#6B7280',

            }}>
              {t('chat.groups_screen.wants_to_join', { name: truncatedGroupName })}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            onPress={async () => {
              const result = await rejectJoinRequest(firestoreDB, item.id, user.id);
              if (result.success) {
                showSuccessMessage(t('home.alert.success'), t('chat.groups_screen.request_rejected'));
              } else {
                showErrorMessage(t('chat.error'), result.error || t('chat.groups_screen.reject_failed'));
              }
            }}
            style={{
              flex: 1,
              paddingVertical: 10,
              backgroundColor: isDarkMode ? '#374151' : '#F3F4F6',
              borderRadius: 8,
              borderWidth: 1,
              borderColor: isDarkMode ? '#4B5563' : '#E5E7EB',
            }}
            activeOpacity={0.7}
          >
            <Text style={{
              color: '#EF4444',
              fontWeight: 'bold',
              fontSize: 13,
              textAlign: 'center',
            }}>{t('chat.groups_screen.reject')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={async () => {
              const result = await approveJoinRequest(firestoreDB, appdatabase, item.id, user.id);
              if (result.success) {
                showSuccessMessage(t('home.alert.success'), t('chat.groups_screen.request_approved'));
              } else {
                showErrorMessage(t('chat.error'), result.error || t('chat.groups_screen.approve_failed'));
              }
            }}
            style={{
              flex: 1,
              paddingVertical: 10,
              backgroundColor: '#4CAF50',
              borderRadius: 8,
            }}
            activeOpacity={0.8}
          >
            <Text style={{
              color: '#fff',
              fontWeight: 'bold',
              fontSize: 13,
              textAlign: 'center',
            }}>{t('chat.groups_screen.approve')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [styles, isDarkMode, firestoreDB, appdatabase, user?.id, t]);

  return (
    <View style={styles.container}>
      {/* Tab Bar - Modern & Compact */}
      <View style={{
        flexDirection: 'row',
        backgroundColor: isDarkMode ? '#1F2937' : '#F3F4F6',
        marginHorizontal: 12,
        marginTop: 12,
        marginBottom: 8,
        borderRadius: 10,
        padding: 3,
        borderWidth: 0,
      }}>
        <TouchableOpacity
          onPress={() => setActiveTab('joined')}
          style={{
            flex: 1,
            paddingVertical: 6,
            paddingHorizontal: 12,
            borderRadius: 8,
            backgroundColor: activeTab === 'joined'
              ? (isDarkMode ? '#8B5CF6' : '#8B5CF6')
              : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          activeOpacity={0.7}
        >
          <Text style={{
            fontSize: 12,
            fontWeight: '700',
            color: activeTab === 'joined'
              ? '#FFFFFF'
              : (isDarkMode ? '#9CA3AF' : '#6B7280'),
            letterSpacing: 0.3,
          }}>
            {t('chat.groups_screen.joined_tab')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setActiveTab('all')}
          style={{
            flex: 1,
            paddingVertical: 6,
            paddingHorizontal: 12,
            borderRadius: 8,
            backgroundColor: activeTab === 'all'
              ? (isDarkMode ? '#8B5CF6' : '#8B5CF6')
              : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          activeOpacity={0.7}
        >
          <Text style={{
            fontSize: 12,
            fontWeight: '700',
            color: activeTab === 'all'
              ? '#FFFFFF'
              : (isDarkMode ? '#9CA3AF' : '#6B7280'),
            letterSpacing: 0.3,
          }}>
            {totalGroupCount != null ? t('chat.groups_screen.all_tab_count', { total: totalGroupCount.toLocaleString() }) : t('chat.groups_screen.all_tab')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Pending Join Requests Banner (for groups where user is creator) - Only show in Joined Groups tab */}
      {activeTab === 'joined' && pendingJoinRequests.length > 0 && (
        <View style={{
          backgroundColor: isDarkMode ? '#111827' : '#FFFFFF',
          borderBottomWidth: 1,
          borderBottomColor: isDarkMode ? '#374151' : '#E5E7EB',
          marginBottom: 8,
          borderRadius: 12,
          marginHorizontal: 12,
          marginTop: 0,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
          elevation: 3,
        }}>
          <TouchableOpacity
            onPress={() => setJoinRequestsExpanded(!joinRequestsExpanded)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 16,
              backgroundColor: isDarkMode ? '#1F2937' : '#F9FAFB',
              borderTopLeftRadius: 12,
              borderTopRightRadius: 12,
            }}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <View style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: '#4CAF50',
                justifyContent: 'center',
                alignItems: 'center',
                marginRight: 12,
              }}>
                <Icon name="person-add-outline" size={18} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{
                  color: isDarkMode ? '#fff' : '#111827',
                  fontWeight: 'bold',
                  fontSize: 12,
                  marginBottom: 2,
                }}>
                  {t('chat.groups_screen.join_requests')}
                </Text>
                <Text style={{
                  color: isDarkMode ? '#9CA3AF' : '#6B7280',

                  fontSize: 10,
                }}>
                  {t('chat.groups_screen.pending_approval', { count: pendingJoinRequests.length })}
                </Text>
              </View>
            </View>
            <View style={{
              width: 28,
              height: 28,
              borderRadius: 12,
              backgroundColor: isDarkMode ? '#374151' : '#E5E7EB',
              justifyContent: 'center',
              alignItems: 'center',
            }}>
              <Icon
                name={joinRequestsExpanded ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={isDarkMode ? '#fff' : '#111827'}
              />
            </View>
          </TouchableOpacity>
          {joinRequestsExpanded && (
            <View style={{ padding: 12 }}>
              <FlatList
                data={pendingJoinRequests}
                keyExtractor={(item) => item.id}
                renderItem={renderJoinRequestItem}
                scrollEnabled={false}
                nestedScrollEnabled={true}
              />
            </View>
          )}
        </View>
      )}

      {/* Pending Invitations Banner - Only show in Joined Groups tab */}
      {activeTab === 'joined' && pendingInvitations.length > 0 && (
        <View style={{
          backgroundColor: isDarkMode ? '#111827' : '#FFFFFF',
          borderBottomWidth: 1,
          borderBottomColor: isDarkMode ? '#374151' : '#E5E7EB',
          marginBottom: 8,
          borderRadius: 12,
          marginHorizontal: 12,
          marginTop: 0,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
          elevation: 3,
        }}>
          <TouchableOpacity
            onPress={() => setInvitationsExpanded(!invitationsExpanded)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 16,
              backgroundColor: isDarkMode ? '#1F2937' : '#F9FAFB',
              borderTopLeftRadius: 12,
              borderTopRightRadius: 12,
            }}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <View style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: config.colors.primary,
                justifyContent: 'center',
                alignItems: 'center',
                marginRight: 12,
              }}>
                <Icon name="mail-outline" size={18} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{
                  color: isDarkMode ? '#fff' : '#111827',
                  fontWeight: 'bold',
                  fontSize: 12,
                  marginBottom: 2,
                }}>
                  {t('chat.groups_screen.pending_invitations')}
                </Text>
                <Text style={{
                  color: isDarkMode ? '#9CA3AF' : '#6B7280',

                  fontSize: 12,
                }}>
                  {t('chat.groups_screen.waiting_for_you', { count: pendingInvitations.length })}
                </Text>
              </View>
            </View>
            <View style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: isDarkMode ? '#374151' : '#E5E7EB',
              justifyContent: 'center',
              alignItems: 'center',
            }}>
              <Icon
                name={invitationsExpanded ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={isDarkMode ? '#fff' : '#111827'}
              />
            </View>
          </TouchableOpacity>
          {invitationsExpanded && (
            <View style={{ padding: 12 }}>
              <FlatList
                data={pendingInvitations}
                keyExtractor={(item) => item.id}
                renderItem={renderInvitationItem}
                scrollEnabled={false}
                nestedScrollEnabled={true}
              />
            </View>
          )}
        </View>
      )}

      {/* Groups List */}
      {groupsLoading || invitationsLoading ? (
        <ActivityIndicator size="large" color="#1E88E5" style={{ flex: 1 }} />
      ) : activeTab === 'joined' ? (
        // Joined Groups Tab
        filteredGroups.length === 0 && pendingInvitations.length === 0 && pendingJoinRequests.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{t('chat.groups_screen.no_groups_yet')}</Text>
          </View>
        ) : (
          <FlatList
            data={filteredGroups}
            keyExtractor={(item, index) => item?.groupId || `group-${index}`}
            renderItem={renderGroupItem}
            removeClippedSubviews={false}
            maxToRenderPerBatch={10}
            windowSize={10}
          />
        )
      ) : (
        // All Groups Tab
        allGroupsLoading ? (
          <View style={styles.emptyContainer}>
            <ActivityIndicator size="large" color="#8B5CF6" />
          </View>
        ) : allGroups.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {allGroupsSearchQuery ? t('chat.groups_screen.no_groups_found') : t('chat.groups_screen.no_groups_available')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={allGroups}
            keyExtractor={(item, index) => item?.id || item?.groupId || `all-group-${index}`}
            onEndReached={() => {
              if (allGroupsHasMore && !allGroupsLoadingMore) {
                loadMoreGroups();
              }
            }}
            onEndReachedThreshold={0.5}
            removeClippedSubviews={false}
            maxToRenderPerBatch={10}
            windowSize={10}
            ListFooterComponent={
              allGroupsLoadingMore ? (
                <View style={{ padding: 16, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={isDarkMode ? '#8B5CF6' : '#8B5CF6'} />
                </View>
              ) : null
            }
            renderItem={({ item }) => {
              const groupId = item.id || item.groupId;
              const groupName = item.groupName || item.name || t('chat.groups_screen.group_fallback');
              const groupAvatar = item.groupAvatar || item.avatar || null;
              const memberCount = item.memberCount || (item.members ? Object.keys(item.members).length : 0) || 0;
              const createdBy = item.createdBy || null;
              const description = item.description || null;
              const truncatedName = truncateGroupName(groupName, 30);
              const creatorName = createdBy ? (creatorNames[createdBy] || t('chat.groups_screen.creator_fallback')) : null;

              // Check if user is already a member
              const isAlreadyJoined = filteredGroups.some(g => g.groupId === groupId);
              // Check if user has a pending join request
              const hasPendingRequest = myPendingJoinRequests.some(r => r.groupId === groupId);

              return (
                <View
                  style={{
                    padding: 12,
                    marginHorizontal: 12,
                    marginBottom: 4,
                    backgroundColor: isDarkMode ? '#1F2937' : '#FFFFFF',
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: isDarkMode ? '#374151' : '#E5E7EB',
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                    <Image resizeMethod="resize"
                      source={groupAvatar ? { uri: groupAvatar } : require('../../../assets/groups.png')}
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        marginRight: 10,
                      }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={{
                        fontSize: 12,
                        fontWeight: 'bold',
                        color: isDarkMode ? '#FFFFFF' : '#111827',
                        marginBottom: 4,
                      }} numberOfLines={1}>
                        {truncatedName}
                      </Text>
                      {createdBy && (
                        <Text style={{
                          fontSize: 10,

                          color: isDarkMode ? '#9CA3AF' : '#6B7280',
                          marginBottom: 4,
                        }}>
                          {t('chat.groups_screen.created_by_name', { name: creatorName })}
                        </Text>
                      )}
                      {description && (
                        <Text style={{
                          fontSize: 11,

                          color: isDarkMode ? '#D1D5DB' : '#4B5563',
                          marginBottom: 4,
                        }} numberOfLines={2}>
                          {description}
                        </Text>
                      )}
                      <Text style={{
                        fontSize: 10,

                        color: isDarkMode ? '#9CA3AF' : '#6B7280',
                      }}>
                        {t('chat.groups_screen.member_count', { count: memberCount })}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 2 }}>
                      {isAlreadyJoined ? (
                        <View style={{
                          backgroundColor: isDarkMode ? '#10B981' : '#D1FAE5',
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 6,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          <Text style={{
                            color: isDarkMode ? '#FFFFFF' : '#065F46',
                            fontSize: 11,
                            fontWeight: 'bold',
                            letterSpacing: 0.2,
                          }}>
                            {t('chat.groups_screen.joined_badge')}
                          </Text>
                        </View>
                      ) : (isAdmin || !!user?.isModerator) ? (
                        <TouchableOpacity
                          onPress={() => handleOpenGroup(groupId, groupName)}
                          style={{
                            backgroundColor: '#3B82F6',
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            borderRadius: 6,
                            alignItems: 'center',
                            justifyContent: 'center',
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 1 },
                            shadowOpacity: 0.1,
                            shadowRadius: 2,
                            elevation: 2,
                          }}
                          activeOpacity={0.8}
                        >
                          <Text style={{
                            color: '#FFFFFF',
                            fontSize: 11,
                            fontWeight: 'bold',
                            letterSpacing: 0.2,
                          }}>
                            Enter
                          </Text>
                        </TouchableOpacity>
                      ) : hasPendingRequest ? (
                        <View style={{
                          backgroundColor: isDarkMode ? '#F59E0B' : '#FEF3C7',
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 6,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          <Text style={{
                            color: isDarkMode ? '#FFFFFF' : '#92400E',
                            fontSize: 11,
                            fontWeight: 'bold',
                            letterSpacing: 0.2,
                          }}>
                            {t('chat.groups_screen.pending_badge')}
                          </Text>
                        </View>
                      ) : (
                        <TouchableOpacity
                          onPress={async () => {
                            // Send join request
                            if (!firestoreDB || !user?.id) {
                              showErrorMessage(t('chat.error'), t('chat.groups_screen.login_to_request'));
                              return;
                            }

                            try {
                              const result = await sendJoinRequest(
                                firestoreDB,
                                groupId,
                                {
                                  id: user.id,
                                  displayName: user.displayName || 'Anonymous',
                                  avatar: user.avatar || null,
                                }
                              );

                              if (result.success) {
                                showSuccessMessage(t('home.alert.success'), t('chat.groups_screen.request_sent'));
                              } else {
                                showErrorMessage(t('chat.error'), result.error || t('chat.groups_screen.request_failed'));
                              }
                            } catch (error) {
                              console.error('Error sending join request:', error);
                              showErrorMessage(t('chat.error'), t('chat.groups_screen.request_failed'));
                            }
                          }}
                          style={{
                            backgroundColor: config.colors.primary || '#8B5CF6',
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            borderRadius: 6,
                            alignItems: 'center',
                            justifyContent: 'center',
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 1 },
                            shadowOpacity: 0.1,
                            shadowRadius: 2,
                            elevation: 2,
                          }}
                          activeOpacity={0.8}
                        >
                          <Text style={{
                            color: '#FFFFFF',
                            fontSize: 11,
                            fontWeight: 'bold',
                            letterSpacing: 0.2,
                          }}>
                            {t('chat.groups_screen.send_request')}
                          </Text>
                        </TouchableOpacity>
                      )}
                      {(isAdmin || isModerator) && (
                        <TouchableOpacity
                          onPress={() => {
                            Alert.alert(
                              'Delete Group',
                              `Are you sure you want to delete "${groupName || 'this group'}"? This action cannot be undone.`,
                              [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Delete',
                                  style: 'destructive',
                                  onPress: async () => {
                                    try {
                                      const result = await deleteGroup(firestoreDB, appdatabase, groupId, user?.id ?? null);
                                      if (result.success) {
                                        showSuccessMessage('Success', 'Group deleted successfully');
                                        // Remove from allGroups list
                                        setAllGroups((prev) => prev.filter((g) => (g.id || g.groupId) !== groupId));
                                      } else {
                                        showErrorMessage('Error', result.error || 'Failed to delete group');
                                      }
                                    } catch (error) {
                                      console.error('Error deleting group:', error);
                                      showErrorMessage('Error', 'Failed to delete group. Please try again.');
                                    }
                                  },
                                },
                              ]
                            );
                          }}
                          style={{
                            backgroundColor: '#EF4444',
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            borderRadius: 6,
                            alignItems: 'center',
                            justifyContent: 'center',
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 1 },
                            shadowOpacity: 0.1,
                            shadowRadius: 2,
                            elevation: 2,
                          }}
                          activeOpacity={0.8}
                        >
                          <Icon name="trash-outline" size={14} color="#FFFFFF" />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>
              );
            }}
          />
        )
      )}

      {/* Create Group / Add Members Button (Only show in Joined Groups tab) */}
      {activeTab === 'joined' && (
        <TouchableOpacity
          onPress={() => setOnlineUsersListVisible(true)}
          style={{
            position: 'absolute',
            bottom: 20,
            right: 20,
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: config.colors.primary || '#8B5CF6',
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderRadius: 24,
            elevation: 4,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.25,
            shadowRadius: 2,
            zIndex: 1000,
          }}
        >
          <Icon
            name={atGroupLimit ? 'person-add' : 'add'}
            size={20}
            color="#fff"
          />
          <Text style={{ color: '#fff', marginLeft: 6, fontWeight: '600', fontSize: 13 }} numberOfLines={1}>
            {atGroupLimit ? t('chat.add_players', { defaultValue: 'Add players' }) : t('chat.create_group_modal.create_title')}
          </Text>
        </TouchableOpacity>
      )}

      {/* Online Users List for Group Creation/Adding Members */}
      <OnlineUsersList
        visible={onlineUsersListVisible}
        onClose={() => setOnlineUsersListVisible(false)}
        mode="select"
      />

      {/* Groups Guide Modal */}
      <GroupsGuideModal
        visible={guideModalVisible}
        onClose={() => setGuideModalVisible(false)}
      />

      {/* Edit Group Modal */}
      <CreateGroupModal
        visible={editGroupModalVisible}
        onClose={() => {
          setEditGroupModalVisible(false);
          setEditingGroup(null);
        }}
        editGroupId={editingGroup?.id || null}
        editGroupName={editingGroup?.name || null}
        editGroupDescription={editingGroup?.description || null}
        editGroupAvatar={editingGroup?.avatar || null}
        isAdmin={isAdmin}
        onGroupUpdated={handleGroupUpdated}
      />

      {/* Group Info Modal */}
      <Modal
        visible={groupInfoModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          setGroupInfoModalVisible(false);
          setSelectedGroupInfo(null);
        }}
      >
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          justifyContent: 'flex-end',
        }}>
          <View style={{
            backgroundColor: isDarkMode ? '#1F2937' : '#FFFFFF',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            maxHeight: '90%',
            minHeight: 400,
            paddingBottom: Math.max(insets.bottom, 16),
          }}>
            {/* Header */}
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 20,
              borderBottomWidth: 1,
              borderBottomColor: isDarkMode ? '#374151' : '#E5E7EB',
            }}>
              <Text style={{
                fontSize: 20,
                fontWeight: 'bold',
                color: isDarkMode ? '#fff' : '#000',
              }}>
                {t('chat.groups_screen.group_information')}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setGroupInfoModalVisible(false);
                  setSelectedGroupInfo(null);
                }}
              >
                <Icon name="close" size={24} color={isDarkMode ? '#fff' : '#000'} />
              </TouchableOpacity>
            </View>

            {/* Content */}
            {groupInfoLoading ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#8B5CF6" />
              </View>
            ) : selectedGroupInfo ? (
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ flexGrow: 1, paddingBottom: 20 }}
                showsVerticalScrollIndicator={false}
              >
                <View style={{ padding: 20 }}>
                  {/* Group Avatar */}
                  <View style={{ alignItems: 'center', marginBottom: 24 }}>
                    <Image resizeMethod="resize"
                      source={selectedGroupInfo.avatar ? { uri: selectedGroupInfo.avatar } : require('../../../assets/groups.png')}
                      style={{
                        width: 100,
                        height: 100,
                        borderRadius: 50,
                        borderWidth: 3,
                        borderColor: config.colors.primary,
                      }}
                    />
                    <Text style={{
                      fontSize: 22,
                      fontWeight: 'bold',
                      color: isDarkMode ? '#fff' : '#000',
                      marginTop: 12,
                      textAlign: 'center',
                    }}>
                      {selectedGroupInfo.name}
                    </Text>
                  </View>

                  {/* Description */}
                  <View style={{ marginBottom: 24 }}>
                    <Text style={{
                      fontSize: 14,
                      fontWeight: 'bold',
                      color: isDarkMode ? '#9CA3AF' : '#6B7280',
                      marginBottom: 8,
                    }}>
                      {t('chat.create_group_modal.description_label')}
                    </Text>
                    <Text style={{
                      fontSize: 15,

                      color: isDarkMode ? '#E5E7EB' : '#374151',
                      lineHeight: 22,
                    }}>
                      {selectedGroupInfo.description || t('chat.groups_screen.no_description')}
                    </Text>
                  </View>

                  {/* Created By */}
                  {selectedGroupInfo.createdBy && (
                    <View style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      marginBottom: 24,
                      padding: 12,
                      backgroundColor: isDarkMode ? '#111827' : '#F9FAFB',
                      borderRadius: 12,
                    }}>
                      <Image resizeMethod="resize"
                        source={{
                          uri: selectedGroupInfo.createdBy.avatar ||
                            'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                        }}
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 20,
                          marginRight: 12,
                        }}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={{
                          fontSize: 12,

                          color: isDarkMode ? '#9CA3AF' : '#6B7280',
                          marginBottom: 4,
                        }}>
                          {t('chat.groups_screen.created_by')}
                        </Text>
                        <Text style={{
                          fontSize: 16,
                          fontWeight: 'bold',
                          color: isDarkMode ? '#fff' : '#000',
                        }}>
                          {selectedGroupInfo.createdBy.name}
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* Created Date */}
                  {selectedGroupInfo.createdAt && (
                    <View style={{ marginBottom: 24 }}>
                      <Text style={{
                        fontSize: 14,
                        fontWeight: 'bold',
                        color: isDarkMode ? '#9CA3AF' : '#6B7280',
                        marginBottom: 8,
                      }}>
                        {t('chat.groups_screen.created_on')}
                      </Text>
                      <Text style={{
                        fontSize: 15,

                        color: isDarkMode ? '#E5E7EB' : '#374151',
                      }}>
                        {new Date(selectedGroupInfo.createdAt).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </Text>
                    </View>
                  )}

                  {/* Members Count */}
                  <View style={{ marginBottom: 24 }}>
                    <View style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      padding: 16,
                      backgroundColor: isDarkMode ? '#111827' : '#F9FAFB',
                      borderRadius: 12,
                    }}>
                      <Icon
                        name="people-outline"
                        size={24}
                        color={isDarkMode ? '#8B5CF6' : '#8B5CF6'}
                        style={{ marginRight: 12 }}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={{
                          fontSize: 14,
                          fontWeight: 'bold',
                          color: isDarkMode ? '#9CA3AF' : '#6B7280',
                          marginBottom: 4,
                        }}>
                          {t('chat.groups_screen.members_label')}
                        </Text>
                        <Text style={{
                          fontSize: 18,
                          fontWeight: 'bold',
                          color: isDarkMode ? '#fff' : '#000',
                        }}>
                          {t('chat.groups_screen.member_count', { count: selectedGroupInfo.memberCount || 0 })}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
              </ScrollView>
            ) : (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <Text style={{
                  fontSize: 16,

                  color: isDarkMode ? '#9CA3AF' : '#6B7280',
                }}>
                  {t('chat.groups_screen.no_group_info')}
                </Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

    </View>
  );
};

// Styles
const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? '#0f172a' : '#f2f2f7',
    },
    itemContainer: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',

      paddingHorizontal: 10,
    },
    chatItem: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 15,
      justifyContent: 'space-between'
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      marginRight: 10,
      backgroundColor: 'white'
    },
    textContainer: {
      flex: 1,
      minWidth: 0, // Important for text truncation
    },
    userName: {
      fontSize: 12,
      fontWeight: 'bold',
      color: isDarkMode ? '#fff' : '#333',
      flexShrink: 1, // Allow text to shrink and truncate
    },
    memberCountText: {
      fontSize: 9,

      color: isDarkMode ? '#9ca3af' : '#6b7280',
    },
    lastMessage: {
      fontSize: 12,
      color: '#555',
    },
    unreadBadge: {
      backgroundColor: config.colors.hasBlockGreen,
      borderRadius: 12,
      minWidth: 24,
      height: 24,
      justifyContent: 'center',
      alignItems: 'center',
    },
    unreadBadgeText: {
      color: '#fff',
      fontSize: 12,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyText: {
      color: isDarkMode ? 'white' : 'black',
      textAlign: 'center'
    }
  });

export default GroupsScreen;

