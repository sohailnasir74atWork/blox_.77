import { getDatabase, ref, set, update, get, increment, remove } from '@react-native-firebase/database';
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

const MAX_GROUP_MEMBERS = 20; // Maximum members per group

/**
 * Get user's group where they are admin/creator
 * @param {Object} firestoreDB - Firestore database instance
 * @param {String} userId - User ID
 * @returns {Promise<{success: boolean, groupId?: string, groupData?: object}>}
 */
export const getUserAdminGroup = async (firestoreDB, userId) => {
  if (!firestoreDB || !userId) {
    return { success: false };
  }

  try {
    const groupsQuery = query(
      collection(firestoreDB, 'groups'),
      where('createdBy', '==', userId),
      where('isActive', '==', true)
    );
    const snapshot = await getDocs(groupsQuery);

    if (!snapshot.empty) {
      const groupDoc = snapshot.docs[0];
      return {
        success: true,
        groupId: groupDoc.id,
        groupData: groupDoc.data(),
      };
    }

    return { success: false };
  } catch (error) {
    console.error('Error getting user admin group:', error);
    return { success: false };
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
 * @returns {Promise<{success: boolean, groupId?: string, error?: string}>}
 */
export const createGroup = async (firestoreDB, appdatabase, creatorData, memberIds = [], groupName = null, invitedUsersMap = null, groupAvatarUrl = null, groupDescription = null) => {
  if (!firestoreDB || !appdatabase || !creatorData?.id) {
    return { success: false, error: 'Missing required parameters' };
  }

  // Group name is required
  if (!groupName || !groupName.trim()) {
    return { success: false, error: 'Group name is required' };
  }

  // Group description is required
  if (!groupDescription || !groupDescription.trim()) {
    return { success: false, error: 'Group description is required' };
  }

  // Check if user already has a group as admin/creator
  const existingGroup = await getUserAdminGroup(firestoreDB, creatorData.id);
  if (existingGroup.success) {
    return {
      success: false,
      error: 'You can only be admin of one group at a time. Please delete your existing group to create a new one.',
      existingGroupId: existingGroup.groupId,
    };
  }

  // Validate member count (creator + members <= MAX_GROUP_MEMBERS)
  const totalMembers = 1 + (memberIds?.length || 0);
  if (totalMembers > MAX_GROUP_MEMBERS) {
    return { success: false, error: `Maximum ${MAX_GROUP_MEMBERS} members allowed` };
  }

  if (totalMembers < 2) {
    return { success: false, error: 'Group must have at least 2 members' };
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

    // Create group_meta_data in RTDB only for creator
    const metaUpdates = {};
    metaUpdates[`group_meta_data/${creatorData.id}/${groupId}/groupId`] = groupId;
    metaUpdates[`group_meta_data/${creatorData.id}/${groupId}/groupName`] = finalGroupName;
    metaUpdates[`group_meta_data/${creatorData.id}/${groupId}/groupAvatar`] = groupAvatarUrl || null;
    metaUpdates[`group_meta_data/${creatorData.id}/${groupId}/lastMessage`] = null;
    metaUpdates[`group_meta_data/${creatorData.id}/${groupId}/lastMessageTimestamp`] = 0;
    metaUpdates[`group_meta_data/${creatorData.id}/${groupId}/unreadCount`] = 0;
    metaUpdates[`group_meta_data/${creatorData.id}/${groupId}/muted`] = false;
    metaUpdates[`group_meta_data/${creatorData.id}/${groupId}/joinedAt`] = Date.now();
    metaUpdates[`group_meta_data/${creatorData.id}/${groupId}/createdBy`] = creatorData.id; // Store creator ID

    // Batch update creator metadata
    await update(ref(appdatabase, '/'), metaUpdates);

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
    return { success: false, error: error.message || 'Failed to create group' };
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
    return { success: false, error: 'Missing required parameters' };
  }

  try {
    // Check if user is already in group (1 Firestore read)
    const groupDoc = await getDoc(doc(firestoreDB, 'groups', groupId));
    if (!groupDoc.exists) {
      return { success: false, error: 'Group not found' };
    }

    const groupData = groupDoc.data();
    const memberIds = groupData.memberIds || [];

    if (memberIds.includes(invitedUserId)) {
      return { success: false, error: 'User is already in group' };
    }

    // Check group size limit
    if (memberIds.length >= MAX_GROUP_MEMBERS) {
      return { success: false, error: `Group is full (max ${MAX_GROUP_MEMBERS} members)` };
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
      return { success: false, error: 'Invitation already sent' };
    }

    // ✅ Fetch invited user data if not provided
    let invitedUserDisplayName = 'Anonymous';
    let invitedUserAvatar = null;
    
    if (invitedUserData) {
      invitedUserDisplayName = invitedUserData.displayName || 'Anonymous';
      invitedUserAvatar = invitedUserData.avatar || null;
    } else {
      // Try to fetch from RTDB users node
      try {
        if (appdatabase) {
          const userRef = ref(appdatabase, `users/${invitedUserId}`);
          const userSnapshot = await get(userRef);
          if (userSnapshot.exists()) {
            const userData = userSnapshot.val() || {};
            invitedUserDisplayName = userData.displayName || 'Anonymous';
            invitedUserAvatar = userData.avatar || null;
          }
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
    return { success: false, error: error.message || 'Failed to send invitation' };
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
    return { success: false, error: 'Missing required parameters' };
  }

  try {
    const inviteRef = doc(firestoreDB, 'group_invitations', inviteId);
    const inviteSnap = await getDoc(inviteRef);

    if (!inviteSnap.exists) {
      return { success: false, error: 'Invitation not found' };
    }

    const inviteData = inviteSnap.data();

    // Validate
    if (inviteData.invitedUserId !== userData.id) {
      return { success: false, error: 'Not your invitation' };
    }

    if (inviteData.status !== 'pending') {
      return { success: false, error: 'Invitation already processed' };
    }

    if (Date.now() > inviteData.expiresAt) {
      return { success: false, error: 'Invitation expired' };
    }

    const groupRef = doc(firestoreDB, 'groups', inviteData.groupId);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists) {
      return { success: false, error: 'Group not found' };
    }

    const groupData = groupSnap.data();

    // Check if already member
    if (groupData.memberIds?.includes(userData.id)) {
      await updateDoc(inviteRef, { status: 'accepted' });
      return { success: false, error: 'Already in group' };
    }

    // Check group size limit
    if (groupData.memberIds?.length >= MAX_GROUP_MEMBERS) {
      return { success: false, error: `Group is full (max ${MAX_GROUP_MEMBERS} members)` };
    }

    // Add user to group (transaction to prevent race conditions)
    await runTransaction(firestoreDB, async (transaction) => {
      const freshGroupSnap = await transaction.get(groupRef);
      if (!freshGroupSnap.exists) {
        throw new Error('Group not found');
      }

      const freshData = freshGroupSnap.data();

      // Double-check not already member
      if (freshData.memberIds?.includes(userData.id)) {
        throw new Error('Already in group');
      }

      // Double-check group size
      if (freshData.memberIds?.length >= MAX_GROUP_MEMBERS) {
        throw new Error('Group is full');
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

    // Create group_meta_data for new member (1 RTDB write)
    const groupMetaRef = ref(appdatabase, `group_meta_data/${userData.id}/${inviteData.groupId}`);
    await set(groupMetaRef, {
      groupId: inviteData.groupId,
      groupName: groupData.name || 'Group',
      groupAvatar: groupData.avatar || null,
      lastMessage: null,
      lastMessageTimestamp: 0,
      unreadCount: 0,
      createdBy: groupData.createdBy || null, // Store creator ID
      muted: false,
      joinedAt: Date.now(),
    });

    return { success: true, groupId: inviteData.groupId };
  } catch (error) {
    console.error('Error accepting group invite:', error);
    return { success: false, error: error.message || 'Failed to accept invitation' };
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
    return { success: false, error: 'Missing required parameters' };
  }

  try {
    const inviteRef = doc(firestoreDB, 'group_invitations', inviteId);
    const inviteSnap = await getDoc(inviteRef);

    if (!inviteSnap.exists) {
      return { success: false, error: 'Invitation not found' };
    }

    const inviteData = inviteSnap.data();
    if (inviteData.invitedUserId !== userId) {
      return { success: false, error: 'Not your invitation' };
    }

    await updateDoc(inviteRef, { status: 'declined' });
    return { success: true };
  } catch (error) {
    console.error('Error declining group invite:', error);
    return { success: false, error: error.message || 'Failed to decline invitation' };
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
    return { success: false, error: 'Missing required parameters' };
  }

  try {
    const groupRef = doc(firestoreDB, 'groups', groupId);

    const result = await runTransaction(firestoreDB, async (transaction) => {
      const groupSnap = await transaction.get(groupRef);
      if (!groupSnap.exists) {
        // Group doesn't exist - return null to indicate group was not found
        // We'll handle cleanup outside the transaction
        return null;
      }

      const groupData = groupSnap.data();

      // Check if user is member
      if (!groupData.memberIds?.includes(userId)) {
        throw new Error('Not a member');
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
        const groupMetaRef = ref(appdatabase, `group_meta_data/${userId}/${groupId}`);
        // Use remove() to explicitly delete the node
        await remove(groupMetaRef);
      } catch (cleanupError) {
        console.warn('Could not delete group metadata:', cleanupError);
        // Fallback: try setting to null if remove fails
        try {
          const groupMetaRef = ref(appdatabase, `group_meta_data/${userId}/${groupId}`);
          await set(groupMetaRef, null);
        } catch (fallbackError) {
          console.warn('Fallback delete also failed:', fallbackError);
        }
      }
      return { success: true, message: 'Group no longer exists' };
    }

    // If last person left, delete all group data from RTDB
    if (result.shouldDeleteGroup) {
      try {
        // Delete group messages
        const messagesRef = ref(appdatabase, `group_messages/${groupId}`);
        const messagesSnapshot = await get(messagesRef);
        if (messagesSnapshot.exists()) {
          await remove(messagesRef);
        }

        // Delete group node
        const groupRef = ref(appdatabase, `groups/${groupId}`);
        const groupSnapshot = await get(groupRef);
        if (groupSnapshot.exists()) {
          await remove(groupRef);
        }

        // Delete group metadata for the leaving user (others already cleaned up)
        try {
          const groupMetaRef = ref(appdatabase, `group_meta_data/${userId}/${groupId}`);
          // Use remove() to explicitly delete the node
          await remove(groupMetaRef);
        } catch (metaError) {
          console.warn('Could not delete group metadata for leaving user:', metaError);
          // Fallback: try setting to null if remove fails
          try {
            const groupMetaRef = ref(appdatabase, `group_meta_data/${userId}/${groupId}`);
            await set(groupMetaRef, null);
          } catch (fallbackError) {
            console.warn('Fallback delete also failed:', fallbackError);
          }
        }

        // Delete related invitations from Firestore
        try {
          const invitationsQuery = query(
            collection(firestoreDB, 'group_invitations'),
            where('groupId', '==', groupId)
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
            where('groupId', '==', groupId)
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
    return { success: false, error: error.message || 'Failed to leave group' };
  } finally {
    // Always cleanup RTDB metadata (even if Firestore transaction fails)
    try {
      const groupMetaRef = ref(appdatabase, `group_meta_data/${userId}/${groupId}`);
      // Use remove() to explicitly delete the node
      await remove(groupMetaRef);
    } catch (cleanupError) {
      console.warn('Could not delete group metadata in finally block:', cleanupError);
      // Fallback: try setting to null if remove fails
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
    return { success: false, error: 'Missing required parameters' };
  }

  try {
    const timestamp = Date.now();
    const messageRef = ref(appdatabase, `group_messages/${groupId}/messages/${timestamp}`);

    // 1. Save message to RTDB
    await set(messageRef, {
      ...messageData,
      timestamp,
    });

    // 2. Get group members from Firestore (1 read)
    const groupDoc = await getDoc(doc(firestoreDB, 'groups', groupId));
    if (!groupDoc.exists) {
      return { success: false, error: 'Group not found' };
    }

    const groupData = groupDoc.data();
    const memberIds = groupData.memberIds || [];

    // Last message preview
    const lastMessagePreview =
      messageData.text?.trim() ||
      (messageData.imageUrl ? '📷 Photo' : messageData.fruits?.length ? `🐾 ${messageData.fruits.length} pet(s)` : '');

    // 3. Batch check active members (1 read for all)
    const activeGroupRef = ref(appdatabase, `activeGroupChats/${groupId}`);
    const activeMembersSnap = await get(activeGroupRef);
    const activeMemberIds = activeMembersSnap.exists()
      ? Object.keys(activeMembersSnap.val() || {})
      : [];

    // 4. Prepare batch updates for all members
    const updates = {};
    const inactiveMemberIds = [];

    for (const memberId of memberIds) {
      const isActive = activeMemberIds.includes(memberId);
      const isSender = memberId === senderData.id;

      // Always update lastMessage, timestamp, and groupName (for notifications)
      updates[`group_meta_data/${memberId}/${groupId}/lastMessage`] = lastMessagePreview;
      updates[`group_meta_data/${memberId}/${groupId}/lastMessageTimestamp`] = timestamp;
      updates[`group_meta_data/${memberId}/${groupId}/lastMessageSenderId`] = senderData.id;
      updates[`group_meta_data/${memberId}/${groupId}/lastMessageSenderName`] = senderData.displayName || 'Anonymous';
      updates[`group_meta_data/${memberId}/${groupId}/groupName`] = groupData.name || 'Group Chat';

      if (isSender) {
        // Sender: always 0 unread
        updates[`group_meta_data/${memberId}/${groupId}/unreadCount`] = 0;
      } else if (isActive) {
        // Active member: 0 unread
        updates[`group_meta_data/${memberId}/${groupId}/unreadCount`] = 0;
      } else {
        // Inactive member: need to get current count
        inactiveMemberIds.push(memberId);
      }
    }

    // 5. Get current unreadCounts for inactive members (N reads, but only for inactive)
    if (inactiveMemberIds.length > 0) {
      const unreadCountPromises = inactiveMemberIds.map(async (memberId) => {
        const metaRef = ref(appdatabase, `group_meta_data/${memberId}/${groupId}`);
        const metaSnap = await get(metaRef);
        const currentUnread = metaSnap.exists() ? metaSnap.val().unreadCount || 0 : 0;
        return { memberId, currentUnread };
      });

      const unreadCounts = await Promise.all(unreadCountPromises);

      // Add increment updates
      unreadCounts.forEach(({ memberId, currentUnread }) => {
        updates[`group_meta_data/${memberId}/${groupId}/unreadCount`] = currentUnread + 1;
      });
    }

    // 6. Batch update all metadata at once (cost-optimized: 1 write operation)
    await update(ref(appdatabase, '/'), updates);

    return { success: true };
  } catch (error) {
    console.error('Error sending group message:', error);
    return { success: false, error: error.message || 'Failed to send message' };
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
    return { success: false, error: 'Missing required parameters' };
  }

  if (newMemberIds.length === 0) {
    return { success: false, error: 'No members to invite' };
  }

  try {
    const groupRef = doc(firestoreDB, 'groups', groupId);
    const groupSnap = await getDoc(groupRef);
    
    if (!groupSnap.exists) {
      return { success: false, error: 'Group not found' };
    }

    const groupData = groupSnap.data();
    const currentMemberIds = groupData.memberIds || [];
    const currentMembers = groupData.members || {};

    // ✅ Only creator can add members
    const isCreator = groupData.createdBy === inviterData.id;
    if (!isCreator) {
      return { success: false, error: 'Only the creator can add members' };
    }

    // Filter out users already in group
    const uniqueNewMembers = newMemberIds.filter(id => !currentMemberIds.includes(id));
    
    if (uniqueNewMembers.length === 0) {
      return { success: false, error: 'All selected users are already in the group' };
    }

    // Check total member count (if all accept)
    const newTotal = currentMemberIds.length + uniqueNewMembers.length;
    if (newTotal > MAX_GROUP_MEMBERS) {
      return { success: false, error: `Group cannot exceed ${MAX_GROUP_MEMBERS} members` };
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
    return { success: false, error: error.message || 'Failed to send invitations' };
  }
};

/**
 * Remove member from group (admin action)
 * @param {Object} firestoreDB - Firestore database instance
 * @param {Object} appdatabase - RTDB database instance
 * @param {String} groupId - Group ID
 * @param {String} memberIdToRemove - User ID to remove
 * @param {String} adminId - Admin/creator user ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const removeMemberFromGroup = async (firestoreDB, appdatabase, groupId, memberIdToRemove, adminId) => {
  if (!firestoreDB || !appdatabase || !groupId || !memberIdToRemove || !adminId) {
    return { success: false, error: 'Missing required parameters' };
  }

  try {
    const groupRef = doc(firestoreDB, 'groups', groupId);

    return await runTransaction(firestoreDB, async (transaction) => {
      const groupSnap = await transaction.get(groupRef);
      if (!groupSnap.exists) {
        throw new Error('Group not found');
      }

      const groupData = groupSnap.data();
      const currentMemberIds = groupData.memberIds || [];
      const currentMembers = groupData.members || {};

      // ✅ Check if user has permission (must be creator)
      const isCreator = groupData.createdBy === adminId;
      if (!isCreator) {
        throw new Error('Only the creator can remove members');
      }

      // Cannot remove creator
      if (groupData.createdBy === memberIdToRemove) {
        throw new Error('Cannot remove the group creator');
      }

      // Cannot remove yourself (use leaveGroup instead)
      if (memberIdToRemove === adminId) {
        throw new Error('Cannot remove yourself. Use leave group instead.');
      }

      // Check if member exists
      if (!currentMemberIds.includes(memberIdToRemove)) {
        throw new Error('User is not a member of this group');
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

      // Remove RTDB group_meta_data for the removed member
      try {
        const metaRef = ref(appdatabase, `group_meta_data/${memberIdToRemove}/${groupId}`);
        // Use remove() to explicitly delete the node
        await remove(metaRef);
      } catch (metaError) {
        console.warn(`Could not delete group metadata for removed member ${memberIdToRemove}:`, metaError);
        // Fallback: try setting to null if remove fails
        try {
          const metaRef = ref(appdatabase, `group_meta_data/${memberIdToRemove}/${groupId}`);
          await set(metaRef, null);
        } catch (fallbackError) {
          console.warn(`Fallback delete also failed for removed member ${memberIdToRemove}:`, fallbackError);
        }
      }

      return { success: true };
    });
  } catch (error) {
    console.error('Error removing member from group:', error);
    return { success: false, error: error.message || 'Failed to remove member' };
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
 * Check if user has permission for group action
 * @param {Object} groupData - Group document data
 * @param {String} userId - User ID
 * @param {String} permission - Permission to check
 * @returns {boolean}
 */
// ✅ Simplified: Only creator has special permissions (no admin role)
export const hasGroupPermission = (groupData, userId, permission) => {
  if (!groupData || !userId) return false;

  const isCreator = groupData.createdBy === userId;

  switch (permission) {
    case 'delete_group':
    case 'add_member':
    case 'remove_member':
    case 'make_creator':
    case 'edit_group':
    case 'mute_member':
      return isCreator; // Only creator has these permissions

    case 'send_message':
      return groupData.memberIds?.includes(userId) && !groupData.members?.[userId]?.muted;

    case 'view_group':
      return groupData.memberIds?.includes(userId);

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
    return { success: false, error: 'Missing required parameters' };
  }

  try {
    const groupRef = doc(firestoreDB, 'groups', groupId);

    return await runTransaction(firestoreDB, async (transaction) => {
      const groupSnap = await transaction.get(groupRef);
      if (!groupSnap.exists) {
        throw new Error('Group not found');
      }

      const groupData = groupSnap.data();
      const currentMemberIds = groupData.memberIds || [];

      // ✅ Only current creator can transfer creator status
      if (groupData.createdBy !== currentCreatorId) {
        throw new Error('Only the creator can transfer creator status');
      }

      // Check if member exists
      if (!currentMemberIds.includes(memberIdToMakeCreator)) {
        throw new Error('User is not a member of this group');
      }

      // Cannot make yourself creator (you already are)
      if (memberIdToMakeCreator === currentCreatorId) {
        throw new Error('You are already the creator');
      }

      // ✅ Transfer creator status - update createdBy field
      // This is IRREVERSIBLE - current creator becomes regular member
      transaction.update(groupRef, {
        createdBy: memberIdToMakeCreator, // New creator
        updatedAt: serverTimestamp(),
      });

      return { success: true };
    });
  } catch (error) {
    console.error('Error making member creator:', error);
    return { success: false, error: error.message || 'Failed to make member creator' };
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
// ✅ Update group name (Group creator only)
export const updateGroupName = async (firestoreDB, appdatabase, groupId, userId, groupName, isAdmin = false) => {
  if (!firestoreDB || !appdatabase || !groupId || !userId || !groupName) {
    return { success: false, error: 'Missing required parameters' };
  }

  try {
    const groupRef = doc(firestoreDB, 'groups', groupId);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists) {
      return { success: false, error: 'Group not found' };
    }

    const groupData = groupSnap.data();

    // ✅ Only group creator can update name (not global admin)
    const isCreator = groupData.createdBy === userId;
    if (!isCreator) {
      return { success: false, error: 'Only the group creator can update the group name' };
    }

    const trimmedName = groupName.trim();
    if (!trimmedName || trimmedName.length === 0) {
      return { success: false, error: 'Group name cannot be empty' };
    }

    // Update Firestore
    await updateDoc(groupRef, {
      groupName: trimmedName,
      name: trimmedName, // Also update name field for compatibility
      updatedAt: serverTimestamp(),
    });

    // Update RTDB group_meta_data for all members
    const memberIds = groupData.memberIds || [];
    const updates = {};

    for (const memberId of memberIds) {
      updates[`group_meta_data/${memberId}/${groupId}/groupName`] = trimmedName;
      updates[`group_meta_data/${memberId}/${groupId}/name`] = trimmedName;
    }

    if (Object.keys(updates).length > 0) {
      const dbRef = ref(appdatabase);
      await update(dbRef, updates);
    }

    return { success: true };
  } catch (error) {
    console.error('Error updating group name:', error);
    return { success: false, error: error.message || 'Failed to update group name' };
  }
};

// ✅ Update group description (Group creator only, max 100 chars)
export const updateGroupDescription = async (firestoreDB, appdatabase, groupId, userId, description, isAdmin = false) => {
  if (!firestoreDB || !appdatabase || !groupId || !userId) {
    return { success: false, error: 'Missing required parameters' };
  }

  try {
    const groupRef = doc(firestoreDB, 'groups', groupId);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists) {
      return { success: false, error: 'Group not found' };
    }

    const groupData = groupSnap.data();

    // ✅ Only group creator can update description (not global admin)
    const isCreator = groupData.createdBy === userId;
    if (!isCreator) {
      return { success: false, error: 'Only the group creator can update the group description' };
    }

    // Limit description to 100 characters
    const trimmedDescription = description ? description.trim().substring(0, 100) : null;

    // Update Firestore
    await updateDoc(groupRef, {
      description: trimmedDescription || null,
      updatedAt: serverTimestamp(),
    });

    // Update RTDB group_meta_data for all members
    const memberIds = groupData.memberIds || [];
    const updates = {};

    for (const memberId of memberIds) {
      updates[`group_meta_data/${memberId}/${groupId}/description`] = trimmedDescription || null;
    }

    if (Object.keys(updates).length > 0) {
      const dbRef = ref(appdatabase);
      await update(dbRef, updates);
    }

    return { success: true };
  } catch (error) {
    console.error('Error updating group description:', error);
    return { success: false, error: error.message || 'Failed to update group description' };
  }
};

export const updateGroupAvatar = async (firestoreDB, appdatabase, groupId, userId, avatarUrl, isAdmin = false) => {
  if (!firestoreDB || !appdatabase || !groupId || !userId) {
    return { success: false, error: 'Missing required parameters' };
  }

  try {
    const groupRef = doc(firestoreDB, 'groups', groupId);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists) {
      return { success: false, error: 'Group not found' };
    }

    const groupData = groupSnap.data();

    // ✅ Only group creator can update avatar (not global admin)
    const isCreator = groupData.createdBy === userId;
    if (!isCreator) {
      return { success: false, error: 'Only the group creator can update the group icon' };
    }

    // Update Firestore
    await updateDoc(groupRef, {
      avatar: avatarUrl || null,
      updatedAt: serverTimestamp(),
    });

    // Update RTDB group_meta_data for all members
    const memberIds = groupData.memberIds || [];
    const updates = {};

    for (const memberId of memberIds) {
      updates[`group_meta_data/${memberId}/${groupId}/groupAvatar`] = avatarUrl || null;
    }

    if (Object.keys(updates).length > 0) {
      await update(ref(appdatabase, '/'), updates);
    }

    return { success: true };
  } catch (error) {
    console.error('Error updating group avatar:', error);
    return { success: false, error: error.message || 'Failed to update group icon' };
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
    return { success: false, error: 'Missing required parameters' };
  }

  try {
    // Check if group exists and get current member count
    const groupRef = doc(firestoreDB, 'groups', groupId);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists) {
      return { success: false, error: 'Group not found' };
    }

    const groupData = groupSnap.data();

    // Check if group is full
    const memberCount = groupData.memberIds?.length || 0;
    if (memberCount >= MAX_GROUP_MEMBERS) {
      return { success: false, error: 'Group is full (20 members maximum)' };
    }

    // Check if user is already a member
    if (groupData.memberIds?.includes(requesterData.id)) {
      return { success: false, error: 'You are already a member of this group' };
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
      return { success: false, error: 'You already have a pending request for this group' };
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
    return { success: false, error: error.message || 'Failed to send join request' };
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
    return { success: false, error: 'Missing required parameters' };
  }

  try {
    const requestRef = doc(firestoreDB, 'group_join_requests', requestId);
    const requestSnap = await getDoc(requestRef);

    if (!requestSnap.exists) {
      return { success: false, error: 'Join request not found' };
    }

    const requestData = requestSnap.data();

    // Verify creator authorization
    if (requestData.creatorId !== creatorId) {
      return { success: false, error: 'Only the group creator can approve requests' };
    }

    // Check if request is still pending
    if (requestData.status !== 'pending') {
      return { success: false, error: 'This request has already been processed' };
    }

    const groupId = requestData.groupId;
    const requesterId = requestData.requesterId;

    // Get fresh group data
    const groupRef = doc(firestoreDB, 'groups', groupId);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists) {
      return { success: false, error: 'Group not found' };
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
      return { success: false, error: 'Group is now full' };
    }

    // Check if user is already a member
    if (groupData.memberIds?.includes(requesterId)) {
      // Update request status
      await updateDoc(requestRef, {
        status: 'approved',
        approvedAt: serverTimestamp(),
      });
      return { success: false, error: 'User is already a member' };
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
        throw new Error('Group is now full');
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

    // Update RTDB metadata for the new member
    const updates = {};
    updates[`group_meta_data/${requesterId}/${groupId}/groupName`] = groupData.groupName || 'Group';
    updates[`group_meta_data/${requesterId}/${groupId}/groupAvatar`] = groupData.avatar || null;
    updates[`group_meta_data/${requesterId}/${groupId}/unreadCount`] = 0;
    updates[`group_meta_data/${requesterId}/${groupId}/lastReadAt`] = Date.now();
    updates[`group_meta_data/${requesterId}/${groupId}/createdBy`] = groupData.createdBy;

    await update(ref(appdatabase, '/'), updates);

    return { success: true };
  } catch (error) {
    console.error('Error approving join request:', error);
    return { success: false, error: error.message || 'Failed to approve join request' };
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
    return { success: false, error: 'Missing required parameters' };
  }

  try {
    const requestRef = doc(firestoreDB, 'group_join_requests', requestId);
    const requestSnap = await getDoc(requestRef);

    if (!requestSnap.exists) {
      return { success: false, error: 'Join request not found' };
    }

    const requestData = requestSnap.data();

    // Verify creator authorization
    if (requestData.creatorId !== creatorId) {
      return { success: false, error: 'Only the group creator can reject requests' };
    }

    // Check if request is still pending
    if (requestData.status !== 'pending') {
      return { success: false, error: 'This request has already been processed' };
    }

    // Update request status
    await updateDoc(requestRef, {
      status: 'rejected',
      rejectedAt: serverTimestamp(),
    });

    return { success: true };
  } catch (error) {
    console.error('Error rejecting join request:', error);
    return { success: false, error: error.message || 'Failed to reject join request' };
  }
};

/**
 * Get all groups (for explore feature)
 * @param {Object} firestoreDB - Firestore database instance
 * @param {String} filter - 'recent' or 'all'
 * @param {String} searchQuery - Optional search query for group name
 * @returns {Promise<{success: boolean, groups?: Array, error?: string}>}
 */
// ✅ Delete group (Admin only)
export const deleteGroup = async (firestoreDB, appdatabase, groupId) => {
  if (!firestoreDB || !appdatabase || !groupId) {
    return { success: false, error: 'Missing required parameters' };
  }

  try {
    // First, get group data to find all members for metadata cleanup
    // Get memberIds from Firestore BEFORE deleting
    let memberIds = [];
    let groupData = null;
    try {
      const groupDocRef = doc(firestoreDB, 'groups', groupId);
      const groupSnap = await getDoc(groupDocRef);
      // Fix: exists is a property, not a function
      if (groupSnap.exists) {
        groupData = groupSnap.data();
        memberIds = groupData.memberIds || [];
      }
    } catch (fetchError) {
      console.warn('Could not fetch group data from Firestore before deletion:', fetchError.message || fetchError);
    }

    // Also try to get memberIds from RTDB as fallback
    let rtdbMemberIds = [];
    try {
      const groupRef = ref(appdatabase, `groups/${groupId}`);
      const groupSnapshot = await get(groupRef);
      if (groupSnapshot.exists()) {
        const rtdbGroupData = groupSnapshot.val();
        if (rtdbGroupData) {
          // Try different possible structures
          if (rtdbGroupData.memberIds) {
            rtdbMemberIds = Array.isArray(rtdbGroupData.memberIds) 
              ? rtdbGroupData.memberIds 
              : Object.keys(rtdbGroupData.memberIds || {});
          } else if (rtdbGroupData.members) {
            // If members is an object, get the keys
            rtdbMemberIds = Object.keys(rtdbGroupData.members || {});
          }
        }
      }
    } catch (rtdbFetchError) {
      // Permission errors are expected if user doesn't have read access
      // We'll still try to delete metadata if we have memberIds from Firestore
      if (rtdbFetchError?.code !== 'database/permission-denied') {
        console.warn('Could not fetch group data from RTDB:', rtdbFetchError.message || rtdbFetchError);
      }
    }
    
    // Try to get memberIds from group_invitations as additional fallback
    let invitationMemberIds = [];
    if (memberIds.length === 0 && rtdbMemberIds.length === 0) {
      try {
        const invitationsQuery = query(
          collection(firestoreDB, 'group_invitations'),
          where('groupId', '==', groupId)
        );
        const invitationsSnapshot = await getDocs(invitationsQuery);
        invitationMemberIds = invitationsSnapshot.docs
          .map(doc => doc.data().invitedUserId)
          .filter(id => id && typeof id === 'string');
      } catch (inviteError) {
        console.warn('Could not fetch memberIds from invitations:', inviteError.message || inviteError);
      }
    }

    // Combine memberIds from all sources (remove duplicates and filter out invalid values)
    const allMemberIds = [...new Set([...memberIds, ...rtdbMemberIds, ...invitationMemberIds].filter(id => id && typeof id === 'string' && id.length > 0))];
    
    if (allMemberIds.length === 0) {
      console.warn(`⚠️ Warning: Could not find any memberIds for group ${groupId}. Metadata may not be fully cleaned up.`);
    } else {
      // console.log(`🗑️ Deleting group ${groupId} - Found ${allMemberIds.length} members to clean up metadata for`);
    }

    // Delete from Firestore
    const groupDocRef = doc(firestoreDB, 'groups', groupId);
    await deleteDoc(groupDocRef);

    // Delete from RTDB - group node
    try {
      const groupRef = ref(appdatabase, `groups/${groupId}`);
      const snapshot = await get(groupRef);
      if (snapshot.exists()) {
        await remove(groupRef);
      }
    } catch (rtdbError) {
      // Permission errors might occur, but we'll still try to delete metadata
      if (rtdbError?.code === 'database/permission-denied') {
        console.warn('⚠️ Permission denied when deleting group from RTDB. This may be expected if user lacks write permissions.');
      } else {
        console.warn('Could not delete group from RTDB:', rtdbError.message || rtdbError);
      }
    }

    // Delete group messages from RTDB
    try {
      const messagesRef = ref(appdatabase, `group_messages/${groupId}`);
      const messagesSnapshot = await get(messagesRef);
      if (messagesSnapshot.exists()) {
        await remove(messagesRef);
      }
    } catch (messagesError) {
      console.warn('Could not delete group messages from RTDB:', messagesError);
    }

    // Delete group metadata for all members from RTDB
    // This is critical - if metadata isn't deleted, groups will reappear on app restart
    // Groups are loaded from group_meta_data/${userId} in ChatNavigator.js
    try {
      let deletedCount = 0;
      let failedCount = 0;
      
      const deleteMetaPromises = allMemberIds.map(async (memberId) => {
        if (!memberId || typeof memberId !== 'string') {
          console.warn(`⚠️ Skipping invalid memberId: ${memberId}`);
          return { success: false, memberId, reason: 'invalid_id' };
        }
        
        try {
          const metaRef = ref(appdatabase, `group_meta_data/${memberId}/${groupId}`);
          
          // First, verify it exists (skip if permission denied)
          let exists = true;
          try {
            const metaSnapshot = await get(metaRef);
            exists = metaSnapshot.exists();
            if (!exists) {
              // Already deleted, that's fine
              return { success: true, memberId, alreadyDeleted: true };
            }
          } catch (checkError) {
            if (checkError?.code === 'database/permission-denied') {
              // Can't check, but we'll still try to delete
              console.warn(`⚠️ Permission denied when checking metadata for ${memberId}, attempting deletion anyway...`);
            } else {
              throw checkError;
            }
          }
          
          // Use remove() to explicitly delete the node
          await remove(metaRef);
          
          // Verify deletion was successful (skip if permission denied)
          try {
            const verifySnapshot = await get(metaRef);
            if (verifySnapshot.exists()) {
              // Still exists, try fallback
              console.warn(`⚠️ Remove() didn't delete metadata for ${memberId}, trying fallback...`);
              await set(metaRef, null);
              
              // Verify again
              try {
                const verifySnapshot2 = await get(metaRef);
                if (verifySnapshot2.exists()) {
                  console.error(`❌ Failed to delete metadata for ${memberId} even with fallback`);
                  return { success: false, memberId, reason: 'deletion_failed' };
                }
              } catch (verifyError) {
                // If we can't verify due to permissions, assume success
                if (verifyError?.code === 'database/permission-denied') {
                  console.warn(`⚠️ Cannot verify deletion for ${memberId} due to permissions, assuming success`);
                  return { success: true, memberId, assumedSuccess: true };
                }
                throw verifyError;
              }
            }
          } catch (verifyError) {
            // If we can't verify due to permissions, assume success
            if (verifyError?.code === 'database/permission-denied') {
              console.warn(`⚠️ Cannot verify deletion for ${memberId} due to permissions, assuming success`);
              return { success: true, memberId, assumedSuccess: true };
            }
            throw verifyError;
          }
          
          return { success: true, memberId };
        } catch (metaError) {
          // Handle permission errors gracefully
          if (metaError?.code === 'database/permission-denied') {
            console.warn(`⚠️ Permission denied when deleting metadata for ${memberId}. User may not have write access.`);
            return { success: false, memberId, reason: 'permission_denied' };
          }
          
          console.error(`❌ Error deleting group metadata for member ${memberId}:`, metaError.message || metaError);
          // Fallback: try setting to null if remove fails
          try {
            const metaRef = ref(appdatabase, `group_meta_data/${memberId}/${groupId}`);
            await set(metaRef, null);
            
            // Verify fallback worked (skip if permission denied)
            try {
              const verifySnapshot = await get(metaRef);
              if (!verifySnapshot.exists()) {
                return { success: true, memberId, usedFallback: true };
              } else {
                return { success: false, memberId, reason: 'fallback_failed' };
              }
            } catch (verifyError) {
              if (verifyError?.code === 'database/permission-denied') {
                console.warn(`⚠️ Cannot verify fallback deletion for ${memberId} due to permissions, assuming success`);
                return { success: true, memberId, usedFallback: true, assumedSuccess: true };
              }
              throw verifyError;
            }
          } catch (fallbackError) {
            if (fallbackError?.code === 'database/permission-denied') {
              console.warn(`⚠️ Permission denied for fallback deletion of ${memberId}`);
              return { success: false, memberId, reason: 'permission_denied' };
            }
            console.error(`❌ Fallback delete also failed for member ${memberId}:`, fallbackError.message || fallbackError);
            return { success: false, memberId, reason: 'fallback_error', error: fallbackError.message };
          }
        }
      });
      
      // Wait for all metadata deletions to complete and track results
      const results = await Promise.all(deleteMetaPromises);
      deletedCount = results.filter(r => r.success).length;
      failedCount = results.filter(r => !r.success).length;
      
      // console.log(`✅ Deleted group metadata: ${deletedCount} successful, ${failedCount} failed out of ${allMemberIds.length} total`);
      
      if (failedCount > 0) {
        const failedMembers = results.filter(r => !r.success).map(r => r.memberId);
        console.error(`❌ Failed to delete metadata for members:`, failedMembers);
        // Don't throw error, but log it for debugging
      }
    } catch (metaError) {
      console.error('❌ Critical error deleting group metadata:', metaError);
      // Don't fail the entire operation, but log the error
    }

    // Delete related invitations
    try {
      const invitationsQuery = query(
        collection(firestoreDB, 'group_invitations'),
        where('groupId', '==', groupId)
      );
      const invitationsSnapshot = await getDocs(invitationsQuery);
      const deleteInvitationPromises = invitationsSnapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deleteInvitationPromises);
    } catch (inviteError) {
      console.warn('Could not delete group invitations:', inviteError);
    }

    // Delete related join requests
    try {
      const joinRequestsQuery = query(
        collection(firestoreDB, 'group_join_requests'),
        where('groupId', '==', groupId)
      );
      const joinRequestsSnapshot = await getDocs(joinRequestsQuery);
      const deleteJoinRequestPromises = joinRequestsSnapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deleteJoinRequestPromises);
    } catch (joinRequestError) {
      console.warn('Could not delete group join requests:', joinRequestError);
    }

    return { success: true };
  } catch (error) {
    console.error('Error deleting group:', error);
    return { success: false, error: error.message || 'Failed to delete group' };
  }
};

export const getAllGroups = async (firestoreDB, filter = 'all', searchQuery = '', limitCount = 100, lastDoc = null) => {
  if (!firestoreDB) {
    return { success: false, error: 'Missing Firestore database' };
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

    // Filter by search query if provided
    if (searchQuery && searchQuery.trim()) {
      const queryLower = searchQuery.toLowerCase().trim();
      groups = groups.filter(group => {
        const groupName = (group.groupName || group.name || '').toLowerCase();
        return groupName.includes(queryLower);
      });
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
    return { success: false, error: error.message || 'Failed to get groups' };
  }
};

