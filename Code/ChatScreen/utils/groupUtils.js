import { getDatabase, ref, set, update, get, increment, remove } from '@react-native-firebase/database';
import {
  upsertGroupMetaRow,
  fanOutGroupMessage,
  deleteGroupMetaForUser,
  updateGroupIdentityForMembers,
} from '../../Supabase/groupMetaBackend';
import { sendGroupMessage as sbSendGroupMessage } from '../../Supabase/groupMessagesBackend';
import { getAuth, getIdToken } from '@react-native-firebase/auth';
import { getStaffRank, STAFF_RANK, fetchUserRoles } from '../utils';
import { groupSearchToken, groupNameMatches } from './groupSearch';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
  serverTimestamp,
  query,
  where,
  getDocs,
  addDoc,
  orderBy,
  limit,
  startAfter,
} from '@react-native-firebase/firestore';
import i18n from 'i18next';

const MAX_GROUP_MEMBERS = 100; // Maximum members per group

// How many active groups one player may own at a time (owner decisions
// 2026-10-07: 2 (was 1); 2026-10-19: 10 for Senior Mod / Admin / owner). The
// server holds the line for every build (functions/groupMembership.js deletes
// a group created past the cap and undoes a hand-over to someone at it);
// these only decide what the app offers.
export const MAX_GROUPS_PER_USER = 2;
export const MAX_GROUPS_PER_STAFF = 10;

// ── Who may do what in a group (owner decision 2026-10-19) ──────────────
//   the creator                  manages their own group
//   Senior Mod / Admin / owner   manage ANY group, member or not: enter and
//                                read, rename, description, avatar, kick,
//                                delete messages, pin, delete the group
//   Mod / JMD                    nothing extra — a member like anyone else
// The server enforces the same: firestore.rules (groups, isSeniorStaff) and
// supabase/044 (is_group_staff, delete_group_message). `roles` is the
// useGlobalState() flags { isAdmin, isSeniorMod, isModerator, isBabyMod }
// (owners have isAdmin in the app); a bare boolean is read as isAdmin.
const asRoles = (roles) => (typeof roles === 'boolean' ? { isAdmin: roles } : roles || null);

export const isGroupStaff = (roles) => getStaffRank(asRoles(roles)) >= STAFF_RANK.seniorMod;

export const getGroupCap = (roles) => (isGroupStaff(roles) ? MAX_GROUPS_PER_STAFF : MAX_GROUPS_PER_USER);

/**
 * The one place the app decides group powers. `groupData` is the Firestore
 * group doc (or a group_meta_data row, which only carries createdBy).
 */
export const getGroupPermissions = (groupData, userId, roles = null) => {
  const memberIds = Array.isArray(groupData?.memberIds) ? groupData.memberIds : [];
  const isMember = !!userId && memberIds.includes(userId);
  const isCreator = !!userId && !!groupData?.createdBy && groupData.createdBy === userId;
  const staff = !!userId && isGroupStaff(roles);
  const canManage = isCreator || staff;
  return {
    isMember,
    isCreator,
    isGroupStaff: staff,
    canView: isMember || staff,
    canSend: (isMember && !groupData?.members?.[userId]?.muted) || staff,
    canManage, // rename, description, avatar, kick, pin, delete messages, delete the group
    canInvite: isCreator,
    canApprove: isCreator,
    canTransfer: isCreator,
  };
};

// Ask the server to record a membership now (functions/groupMembership.js
// groupSync) instead of waiting for its trigger, so a new member can read and
// send straight away. Never throws; the trigger catches up if this fails.
const GROUP_SYNC_URL = 'https://us-central1-fruiteblocks.cloudfunctions.net/groupSync';
export const syncGroupAccess = async (groupId) => {
  try {
    const current = getAuth().currentUser;
    if (!current || !groupId) return { ok: false };
    const token = await getIdToken(current);
    const res = await fetch(GROUP_SYNC_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId }),
    });
    let body = null;
    try { body = await res.json(); } catch (_) {}
    return { ok: res.ok, ...(body || {}) };
  } catch (e) {
    console.warn('[groups] groupSync failed:', e?.message);
    return { ok: false };
  }
};

/**
 * Every active group the user created (newest first).
 * @param {Object} firestoreDB - Firestore database instance
 * @param {String} userId - User ID
 * @returns {Promise<Array<{groupId: string, groupData: object}>>}
 */
export const getUserAdminGroups = async (firestoreDB, userId) => {
  if (!firestoreDB || !userId) return [];
  try {
    const snapshot = await getDocs(query(
      collection(firestoreDB, 'groups'),
      where('createdBy', '==', userId),
      where('isActive', '==', true),
    ));
    return snapshot.docs
      .map((d) => ({ groupId: d.id, groupData: d.data() }))
      .sort((a, b) => (b.groupData?.createdAt?.toMillis?.() || 0) - (a.groupData?.createdAt?.toMillis?.() || 0));
  } catch (error) {
    console.error('Error getting user admin groups:', error);
    return [];
  }
};

/**
 * Create a new group
 * @param {Object} firestoreDB - Firestore database instance
 * @param {Object} appdatabase - RTDB database instance
 * @param {Object} creatorData - { id, displayName, avatar }
 * @param {Array} memberIds - Array of user IDs to add (excluding creator)
 * @param {String} groupName - Optional group name
 * @returns {Promise<{success: boolean, groupId?: string, error?: string}>}
 */
/**
 * Create a new group
 * @param {Object} firestoreDB - Firestore database instance
 * @param {Object} appdatabase - RTDB database instance
 * @param {Object} creatorData - { id, displayName, avatar }
 * @param {Array} memberIds - Array of user IDs to invite
 * @param {String} groupName - Group name (required)
 * @param {Object} invitedUsersMap - Optional map of { userId: { displayName, avatar } } to avoid extra Firestore reads
 * @param {string} groupAvatarUrl - Optional group avatar URL
 * @param {string} groupDescription - Group description (required)
 * @param {Object} roles - creator's staff flags (useGlobalState), for the group cap
 * @returns {Promise<{success: boolean, groupId?: string, error?: string}>}
 */
export const createGroup = async (firestoreDB, appdatabase, creatorData, memberIds = [], groupName = null, invitedUsersMap = null, groupAvatarUrl = null, groupDescription = null, roles = null) => {
  if (!firestoreDB || !appdatabase || !creatorData?.id) {
    return { success: false, error: i18n.t('chat.group_utils.missing_required_parameters') };
  }

  // Group name is required
  if (!groupName || !groupName.trim()) {
    return { success: false, error: i18n.t('chat.group_utils.group_name_is_required') };
  }

  // Group description is required
  if (!groupDescription || !groupDescription.trim()) {
    return { success: false, error: i18n.t('chat.group_utils.group_description_is_required') };
  }

  // Up to getGroupCap() groups as admin/creator at a time.
  const cap = getGroupCap(roles);
  const ownGroups = await getUserAdminGroups(firestoreDB, creatorData.id);
  if (ownGroups.length >= cap) {
    return {
      success: false,
      error: i18n.t('groups.errors.group_limit', {
        max: cap,
        defaultValue: 'You can be the admin of up to {{max}} groups at a time. Delete one to create a new one.',
      }),
    };
  }

  // Validate member count (creator + members <= MAX_GROUP_MEMBERS)
  const totalMembers = 1 + (memberIds?.length || 0);
  if (totalMembers > MAX_GROUP_MEMBERS) {
    return { success: false, error: i18n.t('chat.group_utils.maximum_max_members_allowed', { max: MAX_GROUP_MEMBERS }) };
  }

  if (totalMembers < 2) {
    return { success: false, error: i18n.t('chat.group_utils.group_must_have_at_least_2') };
  }

  try {
    // Generate unique group ID
    const groupId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Group name is required (already validated above)
    const finalGroupName = groupName.trim();
    const finalDescription = (groupDescription || '').trim();

    // Create group document in Firestore (only creator as member initially)
    const groupRef = doc(firestoreDB, 'groups', groupId);
    await setDoc(groupRef, {
      id: groupId,
      name: finalGroupName,
      groupName: finalGroupName, // Also store as groupName for consistency
      description: finalDescription,
      createdBy: creatorData.id,
      creatorDisplayName: creatorData.displayName || 'Anonymous', // Store creator display name for explore feature
      creatorAvatar: creatorData.avatar || null, // All groups tab shows these without a profile read
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      avatar: groupAvatarUrl || null, // Store group avatar
      memberCount: 1, // Only creator initially
      memberIds: [creatorData.id], // Only creator initially
      members: {
        [creatorData.id]: {
          id: creatorData.id,
          displayName: creatorData.displayName || 'Anonymous',
          avatar: creatorData.avatar || null,
          // No role field - creator is determined by createdBy field
          joinedAt: serverTimestamp(),
        },
      },
      isPrivate: false,
      allowDirectJoin: false,
      allowMemberInvites: true,
      maxMembers: MAX_GROUP_MEMBERS,
      lastMessage: null,
      lastMessageTimestamp: null,
      lastMessageSenderId: null,
      isActive: true,
    });

    // Create group_meta_data row for the creator — Supabase.
    await upsertGroupMetaRow({
      userId: creatorData.id,
      groupId,
      groupName: finalGroupName,
      groupAvatar: groupAvatarUrl || null,
      lastMessage: null,
      lastMessageTimestampMs: 0,
      unreadCount: 0,
      muted: false,
      joinedAtMs: Date.now(),
      createdBy: creatorData.id,
    });

    // The creator can read and send right away (supabase/044).
    await syncGroupAccess(groupId);

    // ✅ Use provided user data map, or fetch from RTDB users node only if needed (OPTIMIZATION: avoid extra reads)
    let finalInvitedUsersMap = invitedUsersMap || {};
    const uniqueMemberIds = (memberIds || []).filter(
      (id) => id !== creatorData.id
    );
    
    if (!invitedUsersMap && uniqueMemberIds.length > 0 && appdatabase) {
      // Only fetch if not provided and we have members to invite
      try {
        // ✅ Fetch user data from RTDB users node in parallel
        const userPromises = uniqueMemberIds.map(async (userId) => {
          try {
            const userRef = ref(appdatabase, `users/${userId}`);
            const userSnapshot = await get(userRef);
            if (userSnapshot.exists()) {
              const userData = userSnapshot.val() || {};
              return {
                [userId]: {
                  displayName: userData.displayName || 'Anonymous',
                  avatar: userData.avatar || null,
                }
              };
            }
            return null;
          } catch (error) {
            return null;
          }
        });
        
        const userResults = await Promise.all(userPromises);
        userResults.forEach((result) => {
          if (result) {
            finalInvitedUsersMap = { ...finalInvitedUsersMap, ...result };
          }
        });
      } catch (error) {
        console.warn('Could not fetch invited users data:', error);
      }
    }

    // Send invitations to all other members
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

    for (const memberId of uniqueMemberIds) {
      // Check if pending invite already exists
      const existingInviteQuery = query(
        collection(firestoreDB, 'group_invitations'),
        where('groupId', '==', groupId),
        where('invitedUserId', '==', memberId),
        where('status', '==', 'pending')
      );
      const existingInvite = await getDocs(existingInviteQuery);

      if (existingInvite.empty) {
        // ✅ Get invited user's data from provided map
        const invitedUser = finalInvitedUsersMap[memberId] || {};
        const invitedUserDisplayName = invitedUser.displayName || 'Anonymous';
        const invitedUserAvatar = invitedUser.avatar || null;

        // Create invitation
        await addDoc(collection(firestoreDB, 'group_invitations'), {
          groupId,
          invitedBy: creatorData.id,
          invitedUserId: memberId,
          status: 'pending',
          timestamp: serverTimestamp(),
          expiresAt,
          groupName: finalGroupName,
          groupAvatar: groupAvatarUrl || null,
          invitedByDisplayName: creatorData.displayName || 'Anonymous',
          invitedByAvatar: creatorData.avatar || null,
          // ✅ Store invited user's data to prevent "Anonymous" entries
          invitedUserDisplayName: invitedUserDisplayName,
          invitedUserAvatar: invitedUserAvatar,
        });
      }
    }

    return { success: true, groupId };
  } catch (error) {
    console.error('Error creating group:', error);
    return { success: false, error: error.message || i18n.t('chat.group_utils.failed_to_create_group') };
  }
};

/**
 * Send group invitation
 * @param {Object} firestoreDB - Firestore database instance
 * @param {String} groupId - Group ID
 * @param {String} invitedUserId - User ID to invite
 * @param {Object} inviterData - { id, displayName, avatar }
 * @param {Object} invitedUserData - { displayName, avatar } (optional, will be fetched if not provided)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const sendGroupInvite = async (firestoreDB, groupId, invitedUserId, inviterData, invitedUserData = null) => {
  if (!firestoreDB || !groupId || !invitedUserId || !inviterData?.id) {
    return { success: false, error: i18n.t('chat.group_utils.missing_required_parameters') };
  }

  try {
    // Check if user is already in group (1 Firestore read)
    const groupDoc = await getDoc(doc(firestoreDB, 'groups', groupId));
    if (!groupDoc.exists()) {
      return { success: false, error: i18n.t('chat.group_utils.group_not_found') };
    }

    const groupData = groupDoc.data();
    const memberIds = groupData.memberIds || [];

    if (memberIds.includes(invitedUserId)) {
      return { success: false, error: i18n.t('chat.group_utils.user_is_already_in_group') };
    }

    // Check group size limit
    if (memberIds.length >= MAX_GROUP_MEMBERS) {
      return { success: false, error: i18n.t('chat.group_utils.group_is_full_max_max_members', { max: MAX_GROUP_MEMBERS }) };
    }

    // Check if pending invite exists (1 Firestore query)
    const existingInviteQuery = query(
      collection(firestoreDB, 'group_invitations'),
      where('groupId', '==', groupId),
      where('invitedUserId', '==', invitedUserId),
      where('status', '==', 'pending')
    );
    const existingInvite = await getDocs(existingInviteQuery);

    if (!existingInvite.empty) {
      return { success: false, error: i18n.t('chat.group_utils.invitation_already_sent') };
    }

    // ✅ Fetch invited user data if not provided
    let invitedUserDisplayName = 'Anonymous';
    let invitedUserAvatar = null;
    
    if (invitedUserData) {
      invitedUserDisplayName = invitedUserData.displayName || 'Anonymous';
      invitedUserAvatar = invitedUserData.avatar || null;
    } else {
      // Try to fetch from RTDB users node. This used to reference a bare
      // `appdatabase`, which is neither a parameter of this function nor an
      // import — the ReferenceError was swallowed by the catch below, so the
      // lookup never ran and every invite fell back to "Anonymous".
      try {
        const database = getDatabase();
        const userRef = ref(database, `users/${invitedUserId}`);
        const userSnapshot = await get(userRef);
        if (userSnapshot.exists()) {
          const userData = userSnapshot.val() || {};
          invitedUserDisplayName = userData.displayName || 'Anonymous';
          invitedUserAvatar = userData.avatar || null;
        }
      } catch (error) {
        console.warn('Could not fetch invited user data:', error);
      }
    }

    // Create invitation (expires in 7 days)
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    await addDoc(collection(firestoreDB, 'group_invitations'), {
      groupId,
      invitedBy: inviterData.id,
      invitedUserId,
      status: 'pending',
      timestamp: serverTimestamp(),
      expiresAt,
      groupName: groupData.name || 'Group',
      groupAvatar: groupData.avatar || null,
      invitedByDisplayName: inviterData.displayName || 'Anonymous',
      invitedByAvatar: inviterData.avatar || null,
      // ✅ Store invited user's data to prevent "Anonymous" entries
      invitedUserDisplayName: invitedUserDisplayName,
      invitedUserAvatar: invitedUserAvatar,
    });

    return { success: true };
  } catch (error) {
    console.error('Error sending group invite:', error);
    return { success: false, error: error.message || i18n.t('chat.group_utils.failed_to_send_invitation') };
  }
};

/**
 * Accept group invitation
 * @param {Object} firestoreDB - Firestore database instance
 * @param {Object} appdatabase - RTDB database instance
 * @param {String} inviteId - Invitation document ID
 * @param {Object} userData - { id, displayName, avatar }
 * @returns {Promise<{success: boolean, groupId?: string, error?: string}>}
 */
export const acceptGroupInvite = async (firestoreDB, appdatabase, inviteId, userData) => {
  if (!firestoreDB || !appdatabase || !inviteId || !userData?.id) {
    return { success: false, error: i18n.t('chat.group_utils.missing_required_parameters') };
  }

  try {
    const inviteRef = doc(firestoreDB, 'group_invitations', inviteId);
    const inviteSnap = await getDoc(inviteRef);

    if (!inviteSnap.exists()) {
      return { success: false, error: i18n.t('chat.group_utils.invitation_not_found') };
    }

    const inviteData = inviteSnap.data();

    // Validate
    if (inviteData.invitedUserId !== userData.id) {
      return { success: false, error: i18n.t('chat.group_utils.not_your_invitation') };
    }

    if (inviteData.status !== 'pending') {
      return { success: false, error: i18n.t('chat.group_utils.invitation_already_processed') };
    }

    if (Date.now() > inviteData.expiresAt) {
      return { success: false, error: i18n.t('chat.group_utils.invitation_expired') };
    }

    const groupRef = doc(firestoreDB, 'groups', inviteData.groupId);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists()) {
      return { success: false, error: i18n.t('chat.group_utils.group_not_found') };
    }

    const groupData = groupSnap.data();

    // Check if already member
    if (groupData.memberIds?.includes(userData.id)) {
      await updateDoc(inviteRef, { status: 'accepted' });
      return { success: false, error: i18n.t('chat.group_utils.already_in_group') };
    }

    // Check group size limit
    if (groupData.memberIds?.length >= MAX_GROUP_MEMBERS) {
      return { success: false, error: i18n.t('chat.group_utils.group_is_full_max_max_members', { max: MAX_GROUP_MEMBERS }) };
    }

    // Add user to group (transaction to prevent race conditions)
    await runTransaction(firestoreDB, async (transaction) => {
      const freshGroupSnap = await transaction.get(groupRef);
      if (!freshGroupSnap.exists()) {
        throw new Error(i18n.t('chat.group_utils.group_not_found'));
      }

      const freshData = freshGroupSnap.data();

      // Double-check not already member
      if (freshData.memberIds?.includes(userData.id)) {
        throw new Error(i18n.t('chat.group_utils.already_in_group'));
      }

      // Double-check group size
      if (freshData.memberIds?.length >= MAX_GROUP_MEMBERS) {
        throw new Error(i18n.t('chat.group_utils.group_is_full'));
      }

      // Add to members
      const newMemberIds = [...(freshData.memberIds || []), userData.id];
      const newMembers = {
        ...(freshData.members || {}),
        [userData.id]: {
          id: userData.id,
          displayName: userData.displayName || 'Anonymous',
          avatar: userData.avatar || null,
          role: 'member',
          joinedAt: serverTimestamp(),
        },
      };

      transaction.update(groupRef, {
        memberIds: newMemberIds,
        members: newMembers,
        memberCount: newMemberIds.length,
        updatedAt: serverTimestamp(),
      });

      // Mark invite as accepted
      transaction.update(inviteRef, { status: 'accepted' });
    });

    // Create group_meta_data row for the joining member — Supabase.
    await upsertGroupMetaRow({
      userId: userData.id,
      groupId: inviteData.groupId,
      groupName: groupData.name || 'Group',
      groupAvatar: groupData.avatar || null,
      lastMessage: null,
      lastMessageTimestampMs: 0,
      unreadCount: 0,
      muted: false,
      joinedAtMs: Date.now(),
      createdBy: groupData.createdBy || null,
    });

    // The server checks the invite and lets the new member read straight away.
    await syncGroupAccess(inviteData.groupId);

    return { success: true, groupId: inviteData.groupId };
  } catch (error) {
    console.error('Error accepting group invite:', error);
    return { success: false, error: error.message || i18n.t('chat.group_utils.failed_to_accept_invitation') };
  }
};

/**
 * Decline group invitation
 * @param {Object} firestoreDB - Firestore database instance
 * @param {String} inviteId - Invitation document ID
 * @param {String} userId - User ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const declineGroupInvite = async (firestoreDB, inviteId, userId) => {
  if (!firestoreDB || !inviteId || !userId) {
    return { success: false, error: i18n.t('chat.group_utils.missing_required_parameters') };
  }

  try {
    const inviteRef = doc(firestoreDB, 'group_invitations', inviteId);
    const inviteSnap = await getDoc(inviteRef);

    if (!inviteSnap.exists()) {
      return { success: false, error: i18n.t('chat.group_utils.invitation_not_found') };
    }

    const inviteData = inviteSnap.data();
    if (inviteData.invitedUserId !== userId) {
      return { success: false, error: i18n.t('chat.group_utils.not_your_invitation') };
    }

    await updateDoc(inviteRef, { status: 'declined' });
    return { success: true };
  } catch (error) {
    console.error('Error declining group invite:', error);
    return { success: false, error: error.message || i18n.t('chat.group_utils.failed_to_decline_invitation') };
  }
};

/**
 * Leave group
 * @param {Object} firestoreDB - Firestore database instance
 * @param {Object} appdatabase - RTDB database instance
 * @param {String} groupId - Group ID
 * @param {String} userId - User ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const leaveGroup = async (firestoreDB, appdatabase, groupId, userId) => {
  if (!firestoreDB || !appdatabase || !groupId || !userId) {
    return { success: false, error: i18n.t('chat.group_utils.missing_required_parameters') };
  }

  try {
    const groupRef = doc(firestoreDB, 'groups', groupId);

    const result = await runTransaction(firestoreDB, async (transaction) => {
      const groupSnap = await transaction.get(groupRef);
      if (!groupSnap.exists()) {
        // Group doesn't exist - return null to indicate group was not found
        // We'll handle cleanup outside the transaction
        return null;
      }

      const groupData = groupSnap.data();

      // Check if user is member
      if (!groupData.memberIds?.includes(userId)) {
        throw new Error(i18n.t('chat.group_utils.not_a_member'));
      }

      // Remove from members
      const newMemberIds = groupData.memberIds.filter((id) => id !== userId);
      const newMembers = { ...groupData.members };
      delete newMembers[userId];

      // If user is creator/admin and only member left, delete group
      const userRole = groupData.members[userId]?.role;
      const isCreator = groupData.createdBy === userId;

      if (newMemberIds.length === 0) {
        // Delete group if last member leaves
        transaction.delete(groupRef);
        // Return special flag to trigger full cleanup
        return { success: true, shouldDeleteGroup: true, groupId };
      } else if (isCreator || userRole === 'admin') {
        // Admin/creator is leaving - randomly select a new admin from remaining members
        const randomIndex = Math.floor(Math.random() * newMemberIds.length);
        const newOwnerId = newMemberIds[randomIndex];

        // Update the new admin's role in members object
        newMembers[newOwnerId] = {
          ...newMembers[newOwnerId],
          role: 'admin',
        };

        transaction.update(groupRef, {
          createdBy: newOwnerId, // Transfer creator status
          creatorDisplayName: newMembers[newOwnerId]?.displayName || 'Anonymous',
          creatorAvatar: newMembers[newOwnerId]?.avatar || null,
          memberIds: newMemberIds,
          members: newMembers,
          memberCount: newMemberIds.length,
          updatedAt: serverTimestamp(),
        });
      } else {
        // Regular member leaving
        transaction.update(groupRef, {
          memberIds: newMemberIds,
          members: newMembers,
          memberCount: newMemberIds.length,
          updatedAt: serverTimestamp(),
        });
      }

      return { success: true };
    });

    // If group doesn't exist, clean up and return success (user is effectively already "left")
    if (result === null) {
      try {
        await deleteGroupMetaForUser(userId, groupId);
      } catch (cleanupError) {
        console.warn('Could not delete group metadata:', cleanupError);
      }
      return { success: true, message: 'Group no longer exists' };
    }

    // If last person left, delete all group data. The messages and every
    // inbox row are purged by the server on the delete (functions/
    // groupMembership.js → supabase/044 purge_group_chat).
    if (result.shouldDeleteGroup) {
      try {
        // Delete group node
        const groupRef = ref(appdatabase, `groups/${groupId}`);
        const groupSnapshot = await get(groupRef);
        if (groupSnapshot.exists()) {
          await remove(groupRef);
        }

        // Delete group metadata for the leaving user — Supabase.
        try {
          await deleteGroupMetaForUser(userId, groupId);
        } catch (metaError) {
          console.warn('Could not delete group metadata for leaving user:', metaError);
        }

        // Delete related invitations from Firestore
        try {
          const invitationsQuery = query(
            collection(firestoreDB, 'group_invitations'),
            where('groupId', '==', groupId),
            limit(200)
          );
          const invitationsSnapshot = await getDocs(invitationsQuery);
          const deleteInvitationPromises = invitationsSnapshot.docs.map(doc => deleteDoc(doc.ref));
          await Promise.all(deleteInvitationPromises);
        } catch (inviteError) {
          console.warn('Could not delete group invitations:', inviteError);
        }

        // Delete related join requests from Firestore
        try {
          const joinRequestsQuery = query(
            collection(firestoreDB, 'group_join_requests'),
            where('groupId', '==', groupId),
            limit(200)
          );
          const joinRequestsSnapshot = await getDocs(joinRequestsQuery);
          const deleteJoinRequestPromises = joinRequestsSnapshot.docs.map(doc => deleteDoc(doc.ref));
          await Promise.all(deleteJoinRequestPromises);
        } catch (joinRequestError) {
          console.warn('Could not delete group join requests:', joinRequestError);
        }
      } catch (cleanupError) {
        console.error('Error cleaning up group data after last member left:', cleanupError);
      }
    }

    return result;
  } catch (error) {
    console.error('Error leaving group:', error);
    return { success: false, error: error.message || i18n.t('chat.group_utils.failed_to_leave_group') };
  } finally {
    // Always cleanup metadata (even if Firestore transaction fails) — Supabase.
    try {
      await deleteGroupMetaForUser(userId, groupId);
    } catch (cleanupError) {
      console.warn('Could not delete group metadata in finally block:', cleanupError);
      // Fallback: try the RTDB version too in case some old build still has it
      try {
        const groupMetaRef = ref(appdatabase, `group_meta_data/${userId}/${groupId}`);
        await set(groupMetaRef, null);
      } catch (fallbackError) {
        console.warn('Fallback delete also failed in finally block:', fallbackError);
      }
    }
  }
};

/**
 * Send group message (cost-optimized)
 * @param {Object} appdatabase - RTDB database instance
 * @param {Object} firestoreDB - Firestore database instance
 * @param {String} groupId - Group ID
 * @param {Object} messageData - Message data { text, senderId, imageUrl, fruits, etc. }
 * @param {Object} senderData - { id, displayName, avatar }
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const sendGroupMessage = async (appdatabase, firestoreDB, groupId, messageData, senderData) => {
  if (!appdatabase || !firestoreDB || !groupId || !messageData || !senderData?.id) {
    return { success: false, error: i18n.t('chat.group_utils.missing_required_parameters') };
  }

  try {
    const timestamp = Date.now();

    // 1. Get group members from Firestore (1 read).
    //
    // This read comes BEFORE the Supabase insert on purpose. It used to run
    // after, which meant a missing group or a transient Firestore failure left
    // the message durably stored with the fan-out skipped — the body was in the
    // group but nobody's chat-list preview or unread count ever moved. Reading
    // first makes the send atomic from the user's point of view: either we know
    // who to fan out to, or nothing is written at all.
    const groupDoc = await getDoc(doc(firestoreDB, 'groups', groupId));
    if (!groupDoc.exists()) {
      return { success: false, error: i18n.t('chat.group_utils.group_not_found') };
    }

    const groupData = groupDoc.data();
    const memberIds = groupData.memberIds || [];

    // 2. Save the message body to Supabase (idempotent via clientMsgId).
    // Sender profile fields (sender, avatar, isPro, etc.) come through
    // messageData unchanged — the backend snapshot-stores them.
    await sbSendGroupMessage({
      groupId,
      senderId: senderData.id,
      message: messageData,
      clientMsgId: messageData.clientMsgId ?? undefined,
    });

    // Last message preview
    const lastMessagePreview =
      messageData.text?.trim() ||
      (messageData.imageUrl ? '📷 Photo' : messageData.fruits?.length ? `🐾 ${messageData.fruits.length} pet(s)` : messageData.gif ? '✨ Sticker' : '');

    // 3. Fan-out group_meta_data to every member — Supabase. The helper
    // does:
    //   - one bulk upsert with last_message / timestamp / sender / groupName
    //   - per-member atomic increment of unread_count (sender excluded)
    // Active-member tracking via /activeGroupChats is no longer needed —
    // members on the group screen call resetGroupUnreadCount() in their
    // useFocusEffect, which reconciles within milliseconds.
    await fanOutGroupMessage({
      groupId,
      memberIds,
      senderId: senderData.id,
      senderName: senderData.displayName || 'Anonymous',
      lastMessage: lastMessagePreview,
      timestampMs: timestamp,
      groupName: groupData.name || 'Group Chat',
    });

    return { success: true };
  } catch (error) {
    // Inline-stringify so the dev console shows code/message/details/hint
    // instead of a collapsed `Object` (which forced expanding to debug).
    console.error(
      'Error sending group message:',
      error?.code, '|', error?.message, '|', error?.details, '|', error?.hint, '|', error,
    );
    return { success: false, error: error.message || i18n.t('chat.group_utils.failed_to_send_message') };
  }
};


/**
 * Add members to existing group (sends invitations instead of adding directly)
 * @param {Object} firestoreDB - Firestore database instance
 * @param {Object} appdatabase - RTDB database instance
 * @param {String} groupId - Group ID
 * @param {Array} newMemberIds - Array of user IDs to invite
 * @param {Object} inviterData - { id, displayName, avatar }
 * @returns {Promise<{success: boolean, error?: string, invitedCount?: number}>}
 */
/**
 * Add members to group (sends invitations)
 * @param {Object} firestoreDB - Firestore database instance
 * @param {Object} appdatabase - RTDB database instance
 * @param {String} groupId - Group ID
 * @param {Array} newMemberIds - Array of user IDs to invite
 * @param {Object} inviterData - { id, displayName, avatar }
 * @param {Object} invitedUsersMap - Optional map of { userId: { displayName, avatar } } to avoid extra Firestore reads
 * @returns {Promise<{success: boolean, invitedCount?: number, error?: string}>}
 */
export const addMembersToGroup = async (firestoreDB, appdatabase, groupId, newMemberIds, inviterData, invitedUsersMap = null) => {
  if (!firestoreDB || !appdatabase || !groupId || !Array.isArray(newMemberIds) || !inviterData?.id) {
    return { success: false, error: i18n.t('chat.group_utils.missing_required_parameters') };
  }

  if (newMemberIds.length === 0) {
    return { success: false, error: i18n.t('chat.group_utils.no_members_to_invite') };
  }

  try {
    const groupRef = doc(firestoreDB, 'groups', groupId);
    const groupSnap = await getDoc(groupRef);
    
    if (!groupSnap.exists()) {
      return { success: false, error: i18n.t('chat.group_utils.group_not_found') };
    }

    const groupData = groupSnap.data();
    const currentMemberIds = groupData.memberIds || [];
    const currentMembers = groupData.members || {};

    // ✅ Only creator can add members
    const isCreator = groupData.createdBy === inviterData.id;
    if (!isCreator) {
      return { success: false, error: i18n.t('chat.group_utils.only_the_creator_can_add_members') };
    }

    // Filter out users already in group
    const uniqueNewMembers = newMemberIds.filter(id => !currentMemberIds.includes(id));
    
    if (uniqueNewMembers.length === 0) {
      return { success: false, error: i18n.t('chat.group_utils.all_selected_users_are_already_in') };
    }

    // Check total member count (if all accept)
    const newTotal = currentMemberIds.length + uniqueNewMembers.length;
    if (newTotal > MAX_GROUP_MEMBERS) {
      return { success: false, error: i18n.t('chat.group_utils.group_cannot_exceed_max_members', { max: MAX_GROUP_MEMBERS }) };
    }

    // ✅ Use provided user data map, or fetch from RTDB users node only if needed (OPTIMIZATION: avoid extra reads)
    let finalInvitedUsersMap = invitedUsersMap || {};
    if (!invitedUsersMap && uniqueNewMembers.length > 0 && appdatabase) {
      // Only fetch if not provided and we have members to invite
      try {
        // ✅ Fetch user data from RTDB users node in parallel
        const userPromises = uniqueNewMembers.map(async (userId) => {
          try {
            const userRef = ref(appdatabase, `users/${userId}`);
            const userSnapshot = await get(userRef);
            if (userSnapshot.exists()) {
              const userData = userSnapshot.val() || {};
              return {
                [userId]: {
                  displayName: userData.displayName || 'Anonymous',
                  avatar: userData.avatar || null,
                }
              };
            }
            return null;
          } catch (error) {
            return null;
          }
        });
        
        const userResults = await Promise.all(userPromises);
        userResults.forEach((result) => {
          if (result) {
            finalInvitedUsersMap = { ...finalInvitedUsersMap, ...result };
          }
        });
      } catch (error) {
        console.warn('Could not fetch invited users data:', error);
      }
    }

    // Send invitations instead of adding directly
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    let invitedCount = 0;

    for (const memberId of uniqueNewMembers) {
      // Check if pending invite already exists
      const existingInviteQuery = query(
        collection(firestoreDB, 'group_invitations'),
        where('groupId', '==', groupId),
        where('invitedUserId', '==', memberId),
        where('status', '==', 'pending')
      );
      const existingInvite = await getDocs(existingInviteQuery);

      if (existingInvite.empty) {
        // ✅ Get invited user's data from provided map
        const invitedUser = finalInvitedUsersMap[memberId] || {};
        const invitedUserDisplayName = invitedUser.displayName || 'Anonymous';
        const invitedUserAvatar = invitedUser.avatar || null;

        // Create invitation
        await addDoc(collection(firestoreDB, 'group_invitations'), {
          groupId,
          invitedBy: inviterData.id,
          invitedUserId: memberId,
          status: 'pending',
          timestamp: serverTimestamp(),
          expiresAt,
          groupName: groupData.name || 'Group',
          groupAvatar: groupData.avatar || null,
          invitedByDisplayName: inviterData.displayName || 'Anonymous',
          invitedByAvatar: inviterData.avatar || null,
          // ✅ Store invited user's data to prevent "Anonymous" entries
          invitedUserDisplayName: invitedUserDisplayName,
          invitedUserAvatar: invitedUserAvatar,
        });
        invitedCount++;
      }
    }

    return { success: true, invitedCount };
  } catch (error) {
    console.error('Error adding members to group:', error);
    return { success: false, error: error.message || i18n.t('chat.group_utils.failed_to_send_invitations') };
  }
};

/**
 * Remove member from group (admin action)
 * @param {Object} firestoreDB - Firestore database instance
 * @param {Object} appdatabase - RTDB database instance
 * @param {String} groupId - Group ID
 * @param {String} memberIdToRemove - User ID to remove
 * @param {String} adminId - Admin/creator user ID
 * @param {Object} roles - caller's staff flags (Senior Mod+ may remove in any group)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const removeMemberFromGroup = async (firestoreDB, appdatabase, groupId, memberIdToRemove, adminId, roles = null) => {
  if (!firestoreDB || !appdatabase || !groupId || !memberIdToRemove || !adminId) {
    return { success: false, error: i18n.t('chat.group_utils.missing_required_parameters') };
  }

  try {
    const groupRef = doc(firestoreDB, 'groups', groupId);

    return await runTransaction(firestoreDB, async (transaction) => {
      const groupSnap = await transaction.get(groupRef);
      if (!groupSnap.exists()) {
        throw new Error(i18n.t('chat.group_utils.group_not_found'));
      }

      const groupData = groupSnap.data();
      const currentMemberIds = groupData.memberIds || [];
      const currentMembers = groupData.members || {};

      // The creator, or Senior Mod+ in any group.
      if (!getGroupPermissions(groupData, adminId, roles).canManage) {
        throw new Error(i18n.t('chat.group_utils.only_the_creator_can_remove_members'));
      }

      // Cannot remove creator
      if (groupData.createdBy === memberIdToRemove) {
        throw new Error(i18n.t('chat.group_utils.cannot_remove_the_group_creator'));
      }

      // Cannot remove yourself (use leaveGroup instead)
      if (memberIdToRemove === adminId) {
        throw new Error(i18n.t('chat.group_utils.cannot_remove_yourself_use_leave_group'));
      }

      // Check if member exists
      if (!currentMemberIds.includes(memberIdToRemove)) {
        throw new Error(i18n.t('chat.group_utils.user_is_not_a_member_of'));
      }

      // Remove member
      const updatedMemberIds = currentMemberIds.filter(id => id !== memberIdToRemove);
      const updatedMembers = { ...currentMembers };
      delete updatedMembers[memberIdToRemove];

      // If admin removed all members and is the only one left, delete group when admin leaves
      // (This will be handled when admin calls leaveGroup)
      // For now, just check if group becomes empty
      if (updatedMemberIds.length === 0) {
        // Delete group if no members left
        transaction.delete(groupRef);
      } else {
        // Update Firestore
        transaction.update(groupRef, {
          memberIds: updatedMemberIds,
          members: updatedMembers,
          memberCount: updatedMemberIds.length,
          updatedAt: serverTimestamp(),
        });
      }

      // The kicked member's inbox row and access go server-side
      // (functions/groupMembership.js): RLS never let us delete their row.
      return { success: true };
    });
  } catch (error) {
    console.error('Error removing member from group:', error);
    return { success: false, error: error.message || i18n.t('chat.group_utils.failed_to_remove_member') };
  }
};

/**
 * Get pending group invitations for a user
 * @param {Object} firestoreDB - Firestore database instance
 * @param {String} userId - User ID
 * @returns {Promise<Array>} Array of invitation objects
 */
export const getPendingGroupInvitations = async (firestoreDB, userId) => {
  if (!firestoreDB || !userId) {
    return [];
  }

  try {
    const invitationsQuery = query(
      collection(firestoreDB, 'group_invitations'),
      where('invitedUserId', '==', userId),
      where('status', '==', 'pending')
    );
    const snapshot = await getDocs(invitationsQuery);

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

    return invitations;
  } catch (error) {
    console.error('Error getting pending invitations:', error);
    return [];
  }
};

/**
 * Get pending invitation for a specific group
 * @param {Object} firestoreDB - Firestore database instance
 * @param {String} groupId - Group ID
 * @param {String} userId - User ID
 * @returns {Promise<{success: boolean, inviteId?: string, inviteData?: object}>}
 */
export const getPendingInviteForGroup = async (firestoreDB, groupId, userId) => {
  if (!firestoreDB || !groupId || !userId) {
    return { success: false };
  }

  try {
    const invitationsQuery = query(
      collection(firestoreDB, 'group_invitations'),
      where('groupId', '==', groupId),
      where('invitedUserId', '==', userId),
      where('status', '==', 'pending')
    );
    const snapshot = await getDocs(invitationsQuery);

    if (snapshot.empty) {
      return { success: false };
    }

    const inviteDoc = snapshot.docs[0];
    const inviteData = inviteDoc.data();

    // Check if expired
    if (inviteData.expiresAt && Date.now() > inviteData.expiresAt) {
      return { success: false };
    }

    return {
      success: true,
      inviteId: inviteDoc.id,
      inviteData,
    };
  } catch (error) {
    console.error('Error getting pending invite for group:', error);
    return { success: false };
  }
};

/**
 * Check if user has permission for group action (see getGroupPermissions).
 * @param {Object} groupData - Group document data
 * @param {String} userId - User ID
 * @param {String} permission - Permission to check
 * @param {Object} roles - caller's staff flags (useGlobalState)
 * @returns {boolean}
 */
export const hasGroupPermission = (groupData, userId, permission, roles = null) => {
  if (!groupData || !userId) return false;
  const p = getGroupPermissions(groupData, userId, roles);

  switch (permission) {
    case 'delete_group':
    case 'remove_member':
    case 'edit_group':
    case 'mute_member':
    case 'pin_message':
    case 'delete_message':
      return p.canManage;

    case 'add_member':
      return p.canInvite;

    case 'make_creator':
      return p.canTransfer;

    case 'send_message':
      return p.canSend;

    case 'view_group':
      return p.canView;

    default:
      return false;
  }
};

/**
 * Make a member creator (transfer creator status - only current creator can do this)
 * ⚠️ WARNING: This is IRREVERSIBLE - the current creator will lose creator status
 * @param {Object} firestoreDB - Firestore database instance
 * @param {Object} appdatabase - RTDB database instance
 * @param {String} groupId - Group ID
 * @param {String} memberIdToMakeCreator - User ID to make creator
 * @param {String} currentCreatorId - Current creator user ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const makeMemberCreator = async (firestoreDB, appdatabase, groupId, memberIdToMakeCreator, currentCreatorId) => {
  if (!firestoreDB || !appdatabase || !groupId || !memberIdToMakeCreator || !currentCreatorId) {
    return { success: false, error: i18n.t('chat.group_utils.missing_required_parameters') };
  }

  try {
    const groupRef = doc(firestoreDB, 'groups', groupId);

    // The new owner must be under their own group cap (the server undoes a
    // hand-over that isn't; this just says so up front).
    const [targetRoles, targetGroups] = await Promise.all([
      fetchUserRoles(memberIdToMakeCreator),
      getUserAdminGroups(firestoreDB, memberIdToMakeCreator),
    ]);
    const targetCap = getGroupCap(targetRoles);
    if (targetGroups.filter((g) => g.groupId !== groupId).length >= targetCap) {
      return {
        success: false,
        error: i18n.t('groups.errors.transfer_limit', {
          max: targetCap,
          defaultValue: 'This player already owns the most groups they can ({{max}}). They have to delete one before they can take over this group.',
        }),
      };
    }

    return await runTransaction(firestoreDB, async (transaction) => {
      const groupSnap = await transaction.get(groupRef);
      if (!groupSnap.exists()) {
        throw new Error(i18n.t('chat.group_utils.group_not_found'));
      }

      const groupData = groupSnap.data();
      const currentMemberIds = groupData.memberIds || [];

      // ✅ Only current creator can transfer creator status
      if (groupData.createdBy !== currentCreatorId) {
        throw new Error(i18n.t('chat.group_utils.only_the_creator_can_transfer_creator'));
      }

      // Check if member exists
      if (!currentMemberIds.includes(memberIdToMakeCreator)) {
        throw new Error(i18n.t('chat.group_utils.user_is_not_a_member_of'));
      }

      // Cannot make yourself creator (you already are)
      if (memberIdToMakeCreator === currentCreatorId) {
        throw new Error(i18n.t('chat.group_utils.you_are_already_the_creator'));
      }

      // ✅ Transfer creator status - update createdBy field
      // This is IRREVERSIBLE - current creator becomes regular member
      transaction.update(groupRef, {
        createdBy: memberIdToMakeCreator, // New creator
        creatorDisplayName: groupData.members?.[memberIdToMakeCreator]?.displayName || 'Anonymous',
        creatorAvatar: groupData.members?.[memberIdToMakeCreator]?.avatar || null,
        updatedAt: serverTimestamp(),
      });

      return { success: true };
    });
  } catch (error) {
    console.error('Error making member creator:', error);
    return { success: false, error: error.message || i18n.t('chat.group_utils.failed_to_make_member_creator') };
  }
};

/**
 * Update group avatar (only creator can do this)
 * @param {Object} firestoreDB - Firestore instance
 * @param {Object} appdatabase - Realtime Database instance
 * @param {string} groupId - Group ID
 * @param {string} creatorId - Current creator's user ID
 * @param {string} avatarUrl - New avatar URL
 * @returns {Promise<{success: boolean, error?: string}>}
 */
// Update group name — the creator, or Senior Mod+ in any group. `roles` =
// the caller's staff flags (a boolean is read as isAdmin, for old callers).
export const updateGroupName = async (firestoreDB, appdatabase, groupId, userId, groupName, roles = null) => {
  if (!firestoreDB || !appdatabase || !groupId || !userId || !groupName) {
    return { success: false, error: i18n.t('chat.group_utils.missing_required_parameters') };
  }

  try {
    const groupRef = doc(firestoreDB, 'groups', groupId);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists()) {
      return { success: false, error: i18n.t('chat.group_utils.group_not_found') };
    }

    const groupData = groupSnap.data();

    if (!getGroupPermissions(groupData, userId, roles).canManage) {
      return { success: false, error: i18n.t('chat.group_utils.only_creator_update_name') };
    }

    const trimmedName = groupName.trim();
    if (!trimmedName || trimmedName.length === 0) {
      return { success: false, error: i18n.t('chat.group_utils.group_name_cannot_be_empty') };
    }

    // Update Firestore
    await updateDoc(groupRef, {
      groupName: trimmedName,
      name: trimmedName, // Also update name field for compatibility
      updatedAt: serverTimestamp(),
    });

    // Fan-out the new groupName to every member's group_meta_data row — Supabase.
    const memberIds = groupData.memberIds || [];
    if (memberIds.length > 0) {
      await updateGroupIdentityForMembers({
        groupId,
        memberIds,
        groupName: trimmedName,
      });
    }

    return { success: true };
  } catch (error) {
    console.error('Error updating group name:', error);
    return { success: false, error: error.message || i18n.t('chat.group_utils.failed_to_update_group_name') };
  }
};

// Update group description (max 100 chars) — the creator, or Senior Mod+.
export const updateGroupDescription = async (firestoreDB, appdatabase, groupId, userId, description, roles = null) => {
  if (!firestoreDB || !appdatabase || !groupId || !userId) {
    return { success: false, error: i18n.t('chat.group_utils.missing_required_parameters') };
  }

  try {
    const groupRef = doc(firestoreDB, 'groups', groupId);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists()) {
      return { success: false, error: i18n.t('chat.group_utils.group_not_found') };
    }

    const groupData = groupSnap.data();

    if (!getGroupPermissions(groupData, userId, roles).canManage) {
      return { success: false, error: i18n.t('chat.group_utils.only_creator_update_description') };
    }

    // Limit description to 100 characters
    const trimmedDescription = description ? description.trim().substring(0, 100) : null;

    // Update Firestore
    await updateDoc(groupRef, {
      description: trimmedDescription || null,
      updatedAt: serverTimestamp(),
    });

    // Description lives only on the Firestore `groups` doc — there's no
    // `description` column on Supabase group_meta_data (we never wired it
    // through the schema since it isn't part of the chat-list UX). Reads
    // pull from Firestore on the group settings screen, so no fan-out is
    // needed here.

    return { success: true };
  } catch (error) {
    console.error('Error updating group description:', error);
    return { success: false, error: error.message || i18n.t('chat.group_utils.failed_to_update_group_description') };
  }
};

// Update group avatar — the creator, or Senior Mod+.
export const updateGroupAvatar = async (firestoreDB, appdatabase, groupId, userId, avatarUrl, roles = null) => {
  if (!firestoreDB || !appdatabase || !groupId || !userId) {
    return { success: false, error: i18n.t('chat.group_utils.missing_required_parameters') };
  }

  try {
    const groupRef = doc(firestoreDB, 'groups', groupId);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists()) {
      return { success: false, error: i18n.t('chat.group_utils.group_not_found') };
    }

    const groupData = groupSnap.data();

    if (!getGroupPermissions(groupData, userId, roles).canManage) {
      return { success: false, error: i18n.t('chat.group_utils.only_creator_update_icon') };
    }

    // Update Firestore
    await updateDoc(groupRef, {
      avatar: avatarUrl || null,
      updatedAt: serverTimestamp(),
    });

    // Fan-out the new avatar to every member's group_meta_data row — Supabase.
    const memberIds = groupData.memberIds || [];
    if (memberIds.length > 0) {
      await updateGroupIdentityForMembers({
        groupId,
        memberIds,
        groupAvatar: avatarUrl || null,
      });
    }

    return { success: true };
  } catch (error) {
    console.error('Error updating group avatar:', error);
    return { success: false, error: error.message || i18n.t('chat.group_utils.failed_to_update_group_icon') };
  }
};

/**
 * Send a join request to a group
 * @param {Object} firestoreDB - Firestore database instance
 * @param {String} groupId - Group ID
 * @param {Object} requesterData - { id, displayName, avatar }
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const sendJoinRequest = async (firestoreDB, groupId, requesterData) => {
  if (!firestoreDB || !groupId || !requesterData?.id) {
    return { success: false, error: i18n.t('chat.group_utils.missing_required_parameters') };
  }

  try {
    // Check if group exists and get current member count
    const groupRef = doc(firestoreDB, 'groups', groupId);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists()) {
      return { success: false, error: i18n.t('chat.group_utils.group_not_found') };
    }

    const groupData = groupSnap.data();

    // Check if group is full
    const memberCount = groupData.memberIds?.length || 0;
    if (memberCount >= MAX_GROUP_MEMBERS) {
      return { success: false, error: i18n.t('chat.group_utils.group_is_full_100_members_maximum') };
    }

    // Check if user is already a member
    if (groupData.memberIds?.includes(requesterData.id)) {
      return { success: false, error: i18n.t('chat.group_utils.you_are_already_a_member_of') };
    }

    // Check if user already has a pending request
    const existingRequestQuery = query(
      collection(firestoreDB, 'group_join_requests'),
      where('groupId', '==', groupId),
      where('requesterId', '==', requesterData.id),
      where('status', '==', 'pending')
    );
    const existingRequestSnap = await getDocs(existingRequestQuery);

    if (!existingRequestSnap.empty) {
      return { success: false, error: i18n.t('chat.group_utils.you_already_have_a_pending_request') };
    }

    // Create join request
    const requestData = {
      groupId,
      requesterId: requesterData.id,
      requesterDisplayName: requesterData.displayName || 'Anonymous',
      requesterAvatar: requesterData.avatar || null,
      status: 'pending',
      createdAt: serverTimestamp(),
      groupName: groupData.groupName || 'Group',
      creatorId: groupData.createdBy,
    };
    
    const requestRef = await addDoc(collection(firestoreDB, 'group_join_requests'), requestData);
    // console.log('✅ Join request created:', requestRef.id, 'for group:', groupId, 'creator:', groupData.createdBy);

    return { success: true };
  } catch (error) {
    console.error('Error sending join request:', error);
    return { success: false, error: error.message || i18n.t('chat.group_utils.failed_to_send_join_request') };
  }
};

/**
 * Approve a join request
 * @param {Object} firestoreDB - Firestore database instance
 * @param {Object} appdatabase - RTDB database instance
 * @param {String} requestId - Join request ID
 * @param {String} creatorId - Creator/Admin user ID (for authorization)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const approveJoinRequest = async (firestoreDB, appdatabase, requestId, creatorId) => {
  if (!firestoreDB || !appdatabase || !requestId || !creatorId) {
    return { success: false, error: i18n.t('chat.group_utils.missing_required_parameters') };
  }

  try {
    const requestRef = doc(firestoreDB, 'group_join_requests', requestId);
    const requestSnap = await getDoc(requestRef);

    if (!requestSnap.exists()) {
      return { success: false, error: i18n.t('chat.group_utils.join_request_not_found') };
    }

    const requestData = requestSnap.data();

    // Verify creator authorization
    if (requestData.creatorId !== creatorId) {
      return { success: false, error: i18n.t('chat.group_utils.only_the_group_creator_can_approve') };
    }

    // Check if request is still pending
    if (requestData.status !== 'pending') {
      return { success: false, error: i18n.t('chat.group_utils.this_request_has_already_been_processed') };
    }

    const groupId = requestData.groupId;
    const requesterId = requestData.requesterId;

    // Get fresh group data
    const groupRef = doc(firestoreDB, 'groups', groupId);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists()) {
      return { success: false, error: i18n.t('chat.group_utils.group_not_found') };
    }

    const groupData = groupSnap.data();

    // Check if group is still not full
    const memberCount = groupData.memberIds?.length || 0;
    if (memberCount >= MAX_GROUP_MEMBERS) {
      // Update request status to rejected
      await updateDoc(requestRef, {
        status: 'rejected',
        rejectedAt: serverTimestamp(),
        rejectionReason: 'Group is now full',
      });
      return { success: false, error: i18n.t('chat.group_utils.group_is_now_full') };
    }

    // Check if user is already a member
    if (groupData.memberIds?.includes(requesterId)) {
      // Update request status
      await updateDoc(requestRef, {
        status: 'approved',
        approvedAt: serverTimestamp(),
      });
      return { success: false, error: i18n.t('chat.group_utils.user_is_already_a_member') };
    }

    // Get requester data from the request document (already fetched above)
    const requesterDisplayName = requestData.requesterDisplayName || 'Anonymous';
    const requesterAvatar = requestData.requesterAvatar || null;

    // Use transaction to ensure atomicity
    await runTransaction(firestoreDB, async (transaction) => {
      const freshGroupSnap = await transaction.get(groupRef);
      const freshGroupData = freshGroupSnap.data();

      // Double-check member count
      const freshMemberCount = freshGroupData.memberIds?.length || 0;
      if (freshMemberCount >= MAX_GROUP_MEMBERS) {
        throw new Error(i18n.t('chat.group_utils.group_is_now_full'));
      }

      // Add user to group with displayName and avatar
      const newMemberIds = [...(freshGroupData.memberIds || []), requesterId];
      const newMembers = {
        ...(freshGroupData.members || {}),
        [requesterId]: {
          id: requesterId,
          displayName: requesterDisplayName,
          avatar: requesterAvatar,
          joinedAt: serverTimestamp(),
        },
      };

      transaction.update(groupRef, {
        memberIds: newMemberIds,
        members: newMembers,
        memberCount: newMemberIds.length,
        updatedAt: serverTimestamp(),
      });

      // Update request status
      transaction.update(requestRef, {
        status: 'approved',
        approvedAt: serverTimestamp(),
      });
    });

    // Create the approved member's group_meta_data row — Supabase.
    await upsertGroupMetaRow({
      userId: requesterId,
      groupId,
      groupName: groupData.groupName || 'Group',
      groupAvatar: groupData.avatar || null,
      unreadCount: 0,
      muted: false,
      joinedAtMs: Date.now(),
      createdBy: groupData.createdBy,
    });

    // The server checks the approval and lets the new member in at once.
    await syncGroupAccess(groupId);

    return { success: true };
  } catch (error) {
    console.error('Error approving join request:', error);
    return { success: false, error: error.message || i18n.t('chat.group_utils.failed_to_approve_join_request') };
  }
};

/**
 * Reject a join request
 * @param {Object} firestoreDB - Firestore database instance
 * @param {String} requestId - Join request ID
 * @param {String} creatorId - Creator/Admin user ID (for authorization)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const rejectJoinRequest = async (firestoreDB, requestId, creatorId) => {
  if (!firestoreDB || !requestId || !creatorId) {
    return { success: false, error: i18n.t('chat.group_utils.missing_required_parameters') };
  }

  try {
    const requestRef = doc(firestoreDB, 'group_join_requests', requestId);
    const requestSnap = await getDoc(requestRef);

    if (!requestSnap.exists()) {
      return { success: false, error: i18n.t('chat.group_utils.join_request_not_found') };
    }

    const requestData = requestSnap.data();

    // Verify creator authorization
    if (requestData.creatorId !== creatorId) {
      return { success: false, error: i18n.t('chat.group_utils.only_the_group_creator_can_reject') };
    }

    // Check if request is still pending
    if (requestData.status !== 'pending') {
      return { success: false, error: i18n.t('chat.group_utils.this_request_has_already_been_processed') };
    }

    // Update request status
    await updateDoc(requestRef, {
      status: 'rejected',
      rejectedAt: serverTimestamp(),
    });

    return { success: true };
  } catch (error) {
    console.error('Error rejecting join request:', error);
    return { success: false, error: error.message || i18n.t('chat.group_utils.failed_to_reject_join_request') };
  }
};

/**
 * Delete a group — the creator, Senior Mod+ (any group), or its last member.
 * The Firestore delete is the authority: the server then soft-deletes every
 * message and removes every member's inbox row and access in one go
 * (functions/groupMembership.js → supabase/044 purge_group_chat). The client
 * used to try that itself and failed for big groups and for other members'
 * rows (bug log 2026-10-19).
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const deleteGroup = async (firestoreDB, appdatabase, groupId, deletedByUserId = null, roles = null) => {
  if (!firestoreDB || !appdatabase || !groupId) {
    return { success: false, error: i18n.t('chat.group_utils.missing_required_parameters') };
  }

  try {
    const groupDocRef = doc(firestoreDB, 'groups', groupId);
    const groupSnap = await getDoc(groupDocRef);
    if (groupSnap.exists()) {
      const groupData = groupSnap.data();
      const memberIds = groupData.memberIds || [];
      const lastMember = memberIds.length === 1 && memberIds[0] === deletedByUserId;
      if (!getGroupPermissions(groupData, deletedByUserId, roles).canManage && !lastMember) {
        return { success: false, error: i18n.t('chat.groups_screen.only_admins_delete') };
      }
      await deleteDoc(groupDocRef);
    }

    // Legacy RTDB group node (pre-Firestore builds).
    try {
      const groupRef = ref(appdatabase, `groups/${groupId}`);
      const snapshot = await get(groupRef);
      if (snapshot.exists()) {
        await remove(groupRef);
      }
    } catch (rtdbError) {
      if (rtdbError?.code !== 'database/permission-denied') {
        console.warn('Could not delete group from RTDB:', rtdbError.message || rtdbError);
      }
    }

    // Our own inbox row goes at once; the server removes everyone else's.
    if (deletedByUserId) {
      try {
        await deleteGroupMetaForUser(deletedByUserId, groupId);
      } catch (metaError) {
        console.warn('Could not delete own group metadata:', metaError?.message || metaError);
      }
    }

    // Invitations and join requests (the server sweeps whatever is left).
    for (const col of ['group_invitations', 'group_join_requests']) {
      try {
        const snap = await getDocs(query(collection(firestoreDB, col), where('groupId', '==', groupId), limit(200)));
        await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
      } catch (sweepError) {
        console.warn(`Could not delete ${col}:`, sweepError?.message || sweepError);
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Error deleting group:', error);
    return { success: false, error: error.message || i18n.t('chat.group_utils.failed_to_delete_group') };
  }
};

/**
 * Server-side name search for the All groups tab: every group whose name has
 * a word starting with each word of `text` (groups/{id}.searchKeys, kept by
 * functions/groupMembership.js). Up to `limitCount` matches, most members first.
 * @returns {Promise<{success: boolean, groups?: Array, hasMore?: boolean, lastDoc?: null, error?: string}>}
 */
export const searchGroups = async (firestoreDB, text, limitCount = 30) => {
  if (!firestoreDB) {
    return { success: false, error: i18n.t('chat.group_utils.missing_firestore_database') };
  }
  const token = groupSearchToken(text);
  if (!token) return { success: true, groups: [], hasMore: false, lastDoc: null };
  try {
    const snapshot = await getDocs(query(
      collection(firestoreDB, 'groups'),
      where('searchKeys', 'array-contains', token),
      limit(limitCount),
    ));
    const groups = snapshot.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          createdAtTimestamp: data.createdAt?.toMillis ? data.createdAt.toMillis() : 0,
        };
      })
      .filter((g) => g.isActive !== false && groupNameMatches(g.groupName || g.name, text))
      .sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0) || b.createdAtTimestamp - a.createdAtTimestamp);
    return { success: true, groups, hasMore: false, lastDoc: null };
  } catch (error) {
    console.error('Error searching groups:', error);
    return { success: false, error: error.message || i18n.t('chat.group_utils.failed_to_get_groups') };
  }
};

/**
 * Get all groups (for explore feature)
 * @param {Object} firestoreDB - Firestore database instance
 * @param {String} filter - 'recent' or 'all'
 * @param {String} searchQuery - Optional search text: searches the server (searchGroups)
 * @returns {Promise<{success: boolean, groups?: Array, error?: string}>}
 */
export const getAllGroups = async (firestoreDB, filter = 'all', searchQuery = '', limitCount = 100, lastDoc = null) => {
  if (!firestoreDB) {
    return { success: false, error: i18n.t('chat.group_utils.missing_firestore_database') };
  }

  // Search text: ask the server instead of filtering the loaded page.
  if (searchQuery && searchQuery.trim()) {
    return searchGroups(firestoreDB, searchQuery);
  }

  try {
    let groupsQuery;

    // ✅ Query all groups ordered by createdAt (isActive filter applied client-side for backward compatibility)
    // This ensures groups without isActive field are still shown
    if (lastDoc) {
      groupsQuery = query(
        collection(firestoreDB, 'groups'),
        orderBy('createdAt', 'desc'),
        startAfter(lastDoc),
        limit(limitCount)
      );
    } else {
      groupsQuery = query(
        collection(firestoreDB, 'groups'),
        orderBy('createdAt', 'desc'),
        limit(limitCount)
      );
    }

    const snapshot = await getDocs(groupsQuery);
    let groups = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        // Convert Firestore timestamp to number for easier comparison
        createdAtTimestamp: data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now(),
      };
    });

    // ✅ Filter out inactive groups (isActive === false), but include groups without isActive field (backward compatibility)
    // This ensures old groups without isActive field are still shown
    groups = groups.filter(group => {
      // Include if isActive is true or undefined (backward compatibility)
      return group.isActive !== false;
    });

    // Filter by recent (last 7 days) if needed
    if (filter === 'recent') {
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      groups = groups.filter(group => group.createdAtTimestamp >= sevenDaysAgo);
    }

    // ✅ Check if there are more groups to load
    // Use the original snapshot length (before client-side filtering) to determine if more exist in Firestore
    // This ensures pagination works correctly even if client-side filtering reduces the count
    const hasMore = snapshot.docs.length === limitCount;
    const lastDocument = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;

    return { 
      success: true, 
      groups,
      hasMore,
      lastDoc: lastDocument
    };
  } catch (error) {
    console.error('Error getting all groups:', error);
    return { success: false, error: error.message || i18n.t('chat.group_utils.failed_to_get_groups') };
  }
};

