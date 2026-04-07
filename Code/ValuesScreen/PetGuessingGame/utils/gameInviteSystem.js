// gameInviteSystem.js
import { ref, set, update, remove, get, onValue, push, query as dbQuery, orderByKey, limitToFirst, orderByValue, equalTo } from '@react-native-firebase/database';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  increment,
  query,
  where,
  orderBy,
  writeBatch,
} from '@react-native-firebase/firestore';

/**
 * Award points and track win for game winner
 *
 * - Points are still stored in RTDB under `users/{uid}/rewardPoints`
 *   (to keep existing reward system working)
 * - Win count is stored only in Firestore (not RTDB) under `game_stats/{uid}`
 * - Last win timestamp is stored in RTDB (`lastGameWinAt`) for chat badge
 */
export const awardGameWin = async (appdatabase, firestoreDB, userId) => {
  if (!appdatabase || !firestoreDB || !userId) return false;

  try {
    // ✅ Update reward points in RTDB (existing behaviour)
    const userRef = ref(appdatabase, `users/${userId}`);
    const userSnap = await get(userRef);
    const existing = userSnap.exists() ? userSnap.val() || {} : {};
    const currentPoints = existing.rewardPoints ? Number(existing.rewardPoints) : 0;

    const newPoints = currentPoints + 100;
    const now = Date.now();

    await update(userRef, {
      rewardPoints: newPoints,
      lastGameWinAt: now, // ✅ store last win timestamp in RTDB for chat badge
    });

    // ✅ Track total wins only in Firestore (not RTDB)
    const statsRef = doc(firestoreDB, 'game_stats', userId);
    const statsSnap = await getDoc(statsRef);
    const statsData = statsSnap.exists() ? statsSnap.data() || {} : {};
    const currentWins = statsData.fruitGameWins ? Number(statsData.fruitGameWins) : 0;
    const newWins = currentWins + 1;

    await setDoc(
      statsRef,
      { fruitGameWins: newWins },
      { merge: true },
    );

    return { points: newPoints, wins: newWins, lastGameWinAt: now };
  } catch (error) {
    console.error('Error awarding game win:', error);
    return false;
  }
};

/**
 * Select 8 random fruits from fruit data within the same value slab
 * Value slabs: 0-1, 1-20, 20-50, 50-100, 100+
 */
export const selectRandomFruits = (fruitData, count = 8) => {
  if (!fruitData || fruitData.length === 0) return [];
  
  // All items are fruits in bloxfruitevalues (no need to filter by type)
  const fruitsOnly = fruitData;
  
  if (fruitsOnly.length === 0) return [];
  
  // Define value slabs
  const valueSlabs = [
    { min: 0, max: 1, name: '0-1' },
    { min: 1, max: 20, name: '1-20' },
    { min: 20, max: 50, name: '20-50' },
    { min: 50, max: 100, name: '50-100' },
    { min: 100, max: Infinity, name: '100+' },
  ];
  
  // Group fruits by value slabs
  const fruitsBySlab = {};
  fruitsOnly.forEach(fruit => {
    const value = Number(fruit.rvalue || fruit.value || fruit.permValue || 0);
    
    // Find which slab this fruit belongs to
    // Slabs: 0-1, 1-20, 20-50, 50-100, 100+
    // Handle boundaries: 0-1 includes [0, 1], others use (min, max] to avoid overlap
    for (const slab of valueSlabs) {
      let belongsToSlab = false;
      
      if (slab.max === Infinity) {
        // For 100+ slab, include values > 100 (exclude exactly 100, it's in 50-100)
        belongsToSlab = value > 100;
      } else if (slab.min === 0 && slab.max === 1) {
        // For 0-1 slab, include values >= 0 and <= 1
        belongsToSlab = value >= 0 && value <= 1;
      } else {
        // For other slabs (1-20, 20-50, 50-100), use > min and <= max
        // 1-20: (1, 20], 20-50: (20, 50], 50-100: (50, 100]
        belongsToSlab = value > slab.min && value <= slab.max;
      }
      
      if (belongsToSlab) {
        if (!fruitsBySlab[slab.name]) {
          fruitsBySlab[slab.name] = [];
        }
        fruitsBySlab[slab.name].push({
    id: fruit.id || fruit.name,
    name: fruit.name,
    image: fruit.image || null,
          value: value,
    rarity: fruit.rarity || 'Common',
        });
        break;
      }
    }
  });
  
  // Find slabs that have at least 'count' fruits
  const validSlabs = Object.keys(fruitsBySlab).filter(
    slabName => fruitsBySlab[slabName].length >= count
  );
  
  if (validSlabs.length === 0) {
    // If no slab has enough fruits, use the slab with the most fruits
    const slabWithMostFruits = Object.keys(fruitsBySlab).reduce((a, b) => 
      fruitsBySlab[a].length > fruitsBySlab[b].length ? a : b
    );
    const selectedSlab = fruitsBySlab[slabWithMostFruits] || [];
    const shuffled = [...selectedSlab].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, shuffled.length));
  }
  
  // Randomly select one slab that has enough fruits
  const randomSlabName = validSlabs[Math.floor(Math.random() * validSlabs.length)];
  const selectedSlab = fruitsBySlab[randomSlabName];
  
  // Shuffle and pick 'count' fruits from the selected slab
  const shuffled = [...selectedSlab].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
};

/**
 * Create a new game room with 8 random fruits
 */
export const createGameRoom = async (firestoreDB, hostUser, selectedFruits = [], maxPlayers = 2) => {
  if (!firestoreDB || !hostUser?.id) return null;

  try {
    const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const roomRef = doc(firestoreDB, 'fruitGuessingGame_rooms', roomId);

    // Get player order (host is first)
    const playerOrder = [hostUser.id];

    const roomData = {
      hostId: hostUser.id,
      hostName: hostUser.displayName || 'Anonymous',
      hostAvatar: hostUser.avatar || null,
      status: 'waiting',
      maxPlayers,
      currentPlayers: 1,
      createdAt: serverTimestamp(),
      players: {
        [hostUser.id]: {
          displayName: hostUser.displayName || 'Anonymous',
          avatar: hostUser.avatar || null,
          joinedAt: serverTimestamp(),
          score: 0,
        },
      },
      invites: {},
      // Store the 8 random fruits for the wheel
      wheelPets: selectedFruits,
      gameData: {
        currentRound: 1,
        totalRounds: 3,
        scores: {
          [hostUser.id]: 0,
        },
        currentTurnIndex: 0, // Index in playerOrder
        playerOrder: playerOrder,
        roundScores: {}, // { round1: { odyer3gj: 500, user2: 300 }, ... }
        spinHistory: [], // Track all spins
        startedAt: null,
        isSpinning: false,
      },
    };

    await setDoc(roomRef, roomData);
    return roomId;
  } catch (error) {
    console.error('Error creating game room:', error);
    return null;
  }
};

/**
 * Send invite to a user
 */
export const sendGameInvite = async (
  firestoreDB,
  roomId,
  fromUser,
  invitedUserId
) => {
  if (!firestoreDB || !roomId || !fromUser?.id || !invitedUserId) {
    return false;
  }

  try {
    // ✅ Check if invited user is in an active game
    const isInActiveGame = await isUserInActiveGame(firestoreDB, invitedUserId);
    if (isInActiveGame) {
      return false; // User is already playing, don't send invite
    }

    // ✅ Invitation expires after 1 minute if not received (for testing)
    const INVITE_EXPIRY_MS = 60000; // 1 minute (for testing)
    const expiresAt = Date.now() + INVITE_EXPIRY_MS;

    // Add to room invites in Firestore
    const roomRef = doc(firestoreDB, 'fruitGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);
    
    if (!roomSnap.exists) {
      return false; // Room doesn't exist
    }

    const roomData = roomSnap.data();
    const invites = roomData.invites || {};
    
    invites[invitedUserId] = {
      fromUserId: fromUser.id,
      fromUserName: fromUser.displayName || 'Anonymous',
      fromUserAvatar: fromUser.avatar || null,
      status: 'pending',
      timestamp: serverTimestamp(),
      expiresAt: expiresAt, // ✅ Expiration timestamp
    };

    await updateDoc(roomRef, {
      invites,
    });

    // Add to user's invite list in Firestore (for real-time notifications)
    const userInviteRef = doc(
      collection(firestoreDB, 'fruitGuessingGame_userInvites', invitedUserId, 'invites'),
      roomId
    );
    
    await setDoc(userInviteRef, {
      roomId,
      fromUserId: fromUser.id,
      fromUserName: fromUser.displayName || 'Anonymous',
      fromUserAvatar: fromUser.avatar || null,
      status: 'pending',
      timestamp: serverTimestamp(),
      expiresAt: expiresAt, // ✅ Expiration timestamp
    });

    // ✅ Schedule cleanup of expired invite after expiry time
    setTimeout(async () => {
      try {
        // Check if invite is still pending (not accepted/declined)
        const checkRoomSnap = await getDoc(roomRef);
        if (checkRoomSnap.exists) {
          const checkRoomData = checkRoomSnap.data();
          const checkInvites = checkRoomData.invites || {};
          if (checkInvites[invitedUserId]?.status === 'pending') {
            // Invite expired and not received - delete it
            delete checkInvites[invitedUserId];
            await updateDoc(roomRef, { invites: checkInvites });
          }
        }

        // Also delete from user's invite list
        const checkUserInviteRef = doc(
          collection(firestoreDB, 'fruitGuessingGame_userInvites', invitedUserId, 'invites'),
          roomId
        );
        const checkUserInviteSnap = await getDoc(checkUserInviteRef);
        if (checkUserInviteSnap.exists) {
          const checkUserInviteData = checkUserInviteSnap.data();
          if (checkUserInviteData.status === 'pending') {
            await deleteDoc(checkUserInviteRef);
          }
        }
      } catch (error) {
        console.error('Error cleaning up expired invite:', error);
      }
    }, INVITE_EXPIRY_MS);

    return true;
  } catch (error) {
    console.error('Error sending invite:', error);
    return false;
  }
};

/**
 * Remove all pending invitations for a user (when they accept one and join a game)
 * This is cost-optimized using batch operations
 */
const removeAllPendingInvitations = async (firestoreDB, userId, acceptedRoomId) => {
  if (!firestoreDB || !userId) return;

  try {
    // Get all pending invites for this user
    const invitesCollectionRef = collection(
      firestoreDB,
      'fruitGuessingGame_userInvites',
      userId,
      'invites'
    );
    
    const q = query(invitesCollectionRef, where('status', '==', 'pending'));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) return; // No pending invites to remove

    // Collect all invite IDs to delete (excluding the accepted one)
    const invitesToDelete = [];
    snapshot.forEach((docSnap) => {
      const inviteRoomId = docSnap.id;
      
      // Skip the room they just accepted
      if (inviteRoomId !== acceptedRoomId) {
        invitesToDelete.push(inviteRoomId);
      }
    });

    if (invitesToDelete.length === 0) return; // No other invites to remove

    // Use batch to delete all pending invites (Firestore batch limit is 500)
    const MAX_BATCH_SIZE = 500;
    const batches = [];
    let currentBatch = writeBatch(firestoreDB);
    let currentBatchCount = 0;

    for (const inviteRoomId of invitesToDelete) {
      const inviteRef = doc(
        firestoreDB,
        'fruitGuessingGame_userInvites',
        userId,
        'invites',
        inviteRoomId
      );
      
      currentBatch.delete(inviteRef);
      currentBatchCount++;

      // If batch is full, commit it and start a new one
      if (currentBatchCount >= MAX_BATCH_SIZE) {
        batches.push(currentBatch);
        currentBatch = writeBatch(firestoreDB);
        currentBatchCount = 0;
      }
    }

    // Add the last batch if it has operations
    if (currentBatchCount > 0) {
      batches.push(currentBatch);
    }

    // Commit all batches
    await Promise.all(batches.map(batch => batch.commit()));
    
    // console.log(`✅ Removed ${invitesToDelete.length} pending invitation(s) for user ${userId}`);
  } catch (error) {
    // Don't throw - this is a cleanup operation, shouldn't block the accept
    console.error('Error removing pending invitations:', error);
  }
};

/**
 * Accept an invite
 */
export const acceptGameInvite = async (
  firestoreDB,
  roomId,
  userId,
  userData
) => {
  if (!firestoreDB || !roomId || !userId) {
    return { success: false, error: 'Invalid parameters' };
  }

  try {
    const roomRef = doc(firestoreDB, 'fruitGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists) {
      return { success: false, error: 'Room does not exist' };
    }

    const roomData = roomSnap.data();

    // Check if user is already in the room
    if (roomData.players && roomData.players[userId]) {
      return { success: false, error: 'You are already in this game' };
    }

    if (roomData.status !== 'waiting') {
      return { success: false, error: 'This game has already started or finished' };
    }

    if (roomData.currentPlayers >= roomData.maxPlayers) {
      return { success: false, error: 'This game is full. Another player already joined and the game is starting.' };
    }

    // ✅ Check if invite exists and is not expired
    const invites = roomData.invites || {};
    const invite = invites[userId];
    if (invite) {
      const now = Date.now();
      const inviteTimestamp = invite.timestamp?.toMillis?.() || invite.timestamp || Date.now();
      const expiresAt = invite.expiresAt || (inviteTimestamp + 60000); // 1 minute default (for testing)
      
      if (now > expiresAt && invite.status === 'pending') {
        // Invite expired - remove it
        delete invites[userId];
        await updateDoc(roomRef, { invites });
        
        // Also delete from user's invite list
        const userInviteRef = doc(
          firestoreDB,
          'fruitGuessingGame_userInvites',
          userId,
          'invites',
          roomId
        );
        await deleteDoc(userInviteRef).catch(err => 
          console.error('Error deleting expired user invite:', err)
        );
        
        return { success: false, error: 'This invitation has expired. Please ask for a new invite.' };
      }
    }

    // Add player to room
    const players = roomData.players || {};
    // invites already declared above
    const playerOrder = roomData.gameData?.playerOrder || [roomData.hostId];
    const scores = roomData.gameData?.scores || {};
    
    players[userId] = {
      displayName: userData?.displayName || 'Anonymous',
      avatar: userData?.avatar || null,
      joinedAt: serverTimestamp(),
      score: 0,
    };

    // Add to player order
    if (!playerOrder.includes(userId)) {
      playerOrder.push(userId);
    }

    // Initialize score
    scores[userId] = 0;

    if (invites[userId]) {
      invites[userId].status = 'accepted';
    }

    await updateDoc(roomRef, {
      players,
      invites,
      currentPlayers: increment(1),
      'gameData.playerOrder': playerOrder,
      'gameData.scores': scores,
    });

    // Update user invite status in Firestore
    const userInviteRef = doc(
      firestoreDB,
      'fruitGuessingGame_userInvites',
      userId,
      'invites',
      roomId
    );
    await updateDoc(userInviteRef, { status: 'accepted' });

    // ✅ Remove all other pending invitations (user is now in a game)
    // This is done asynchronously to not block the accept operation
    removeAllPendingInvitations(firestoreDB, userId, roomId).catch((error) => {
      console.error('Error removing pending invitations:', error);
      // Don't throw - this is cleanup, shouldn't affect the accept
    });

    // Auto-start game if 2 players have joined
    const newPlayerCount = roomData.currentPlayers + 1;
    if (newPlayerCount >= roomData.maxPlayers && roomData.hostId) {
      // Auto-start the game
      await startGame(firestoreDB, roomId, roomData.hostId);
    }

    return { success: true };
  } catch (error) {
    console.error('Error accepting invite:', error);
    return { success: false, error: 'Failed to join game. Please try again.' };
  }
};

/**
 * Decline an invite
 */
export const declineGameInvite = async (firestoreDB, roomId, userId) => {
  if (!firestoreDB || !roomId || !userId) return false;

  try {
    // Update room invite status in Firestore
    const roomRef = doc(firestoreDB, 'fruitGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);
    
    if (roomSnap.exists) {
      const roomData = roomSnap.data();
      const invites = roomData.invites || {};
      
      if (invites[userId]) {
        invites[userId].status = 'declined';
        await updateDoc(roomRef, { invites });
      }
    }

    // Update user invite status in Firestore
    const userInviteRef = doc(
      firestoreDB,
      'fruitGuessingGame_userInvites',
      userId,
      'invites',
      roomId
    );
    await updateDoc(userInviteRef, { status: 'declined' });

    return true;
  } catch (error) {
    console.error('Error declining invite:', error);
    return false;
  }
};

/**
 * Listen to user's pending invites
 */
export const listenToUserInvites = (firestoreDB, userId, callback) => {
  if (!firestoreDB || !userId) {
    return () => {};
  }

  const invitesCollectionRef = collection(
    firestoreDB,
    'fruitGuessingGame_userInvites',
    userId,
    'invites'
  );
  
  // ✅ Query without orderBy to avoid index requirements (we'll sort client-side if needed)
  const q = query(
    invitesCollectionRef,
    where('status', '==', 'pending')
  );
  
  const unsubscribe = onSnapshot(
    q,
    async (snapshot) => {
      const invites = [];
      const now = Date.now();
      const expiredInviteIds = [];
      
      if (snapshot.empty) {
        callback([]);
        return;
      }
      
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (!data) {
          return;
        }
        
        const timestamp = data.timestamp?.toMillis?.() || data.timestamp || Date.now();
        const expiresAt = data.expiresAt || (timestamp + 60000); // Default 1 minute if not set
        
        // ✅ Filter out expired invites (not received within time limit)
        if (now > expiresAt && data.status === 'pending') {
          // Mark for deletion
          expiredInviteIds.push(docSnap.id);
          return; // Skip this invite
        }
        
        invites.push({
          roomId: docSnap.id,
          ...data,
          timestamp: timestamp,
          expiresAt: expiresAt,
        });
      });

      // ✅ Delete expired invites
      if (expiredInviteIds.length > 0) {
        expiredInviteIds.forEach(async (inviteId) => {
          try {
            const inviteRef = doc(
              collection(firestoreDB, 'fruitGuessingGame_userInvites', userId, 'invites'),
              inviteId
            );
            await deleteDoc(inviteRef);
          } catch (error) {
            console.error('Error deleting expired invite:', error);
          }
        });
      }

      // ✅ Sort by timestamp descending (client-side)
      invites.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      
      callback(invites);
    },
    (error) => {
      console.error('Error listening to invites for user:', userId, error);
      callback([]);
    }
  );

  return unsubscribe;
};

/**
 * Clean up expired invites from a room
 */
export const cleanupExpiredInvites = async (firestoreDB, roomId) => {
  if (!firestoreDB || !roomId) return false;

  try {
    const roomRef = doc(firestoreDB, 'fruitGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);
    
    if (!roomSnap.exists) return false;

    const roomData = roomSnap.data();
    const invites = roomData.invites || {};
    const now = Date.now();
    let hasExpired = false;

    // Check each invite for expiration
    Object.keys(invites).forEach((userId) => {
      const invite = invites[userId];
      if (invite.status === 'pending') {
        const expiresAt = invite.expiresAt || (invite.timestamp?.toMillis?.() || Date.now()) + 60000; // 1 minute (for testing)
        if (now > expiresAt) {
          // Invite expired - remove it
          delete invites[userId];
          hasExpired = true;
          
          // Also delete from user's invite list
          const userInviteRef = doc(
            firestoreDB,
            'fruitGuessingGame_userInvites',
            userId,
            'invites',
            roomId
          );
          deleteDoc(userInviteRef).catch(err => 
            console.error('Error deleting expired user invite:', err)
          );
        }
      }
    });

    // Update room if any invites expired
    if (hasExpired) {
      await updateDoc(roomRef, { invites });
    }

    return hasExpired;
  } catch (error) {
    console.error('Error cleaning up expired invites:', error);
    return false;
  }
};

/**
 * Check if a user is currently in an active game (status 'playing')
 */
export const isUserInActiveGame = async (firestoreDB, userId) => {
  if (!firestoreDB || !userId) return false;

  try {
    const roomsRef = collection(firestoreDB, 'fruitGuessingGame_rooms');
    const q = query(
      roomsRef,
      where('status', '==', 'playing')
    );
    
    const snapshot = await getDocs(q);
    
    if (!snapshot.empty) {
      // Check if user is in any of these active rooms
      for (const docSnap of snapshot.docs) {
        const roomData = docSnap.data();
        if (roomData.players && roomData.players[userId]) {
          return true;
        }
      }
    }
    
    return false;
  } catch (error) {
    console.error('Error checking user game status:', error);
    return false;
  }
};

/**
 * Get ALL online user IDs from RTDB presence node (optimized - only IDs, no details)
 * Returns all user IDs (filtered to exclude current user)
 * Same pattern as OnlineUsersList.jsx - fetch all IDs from presence node
 */
export const getOnlineUserIdsForInvite = async (appdatabase, currentUserId) => {
  if (!appdatabase || !currentUserId) return [];

  try {
    // ✅ Query presence node for online users (value === true)
    const presenceRef = ref(appdatabase, 'presence');
    const onlineQuery = dbQuery(presenceRef, orderByValue(), equalTo(true));
    const snapshot = await get(onlineQuery);

    if (!snapshot.exists()) return [];

    const presenceData = snapshot.val() || {};
    const allUserIds = Object.keys(presenceData)
      .filter((id) => presenceData[id] === true);

    // Filter out current user and return ALL IDs
    const filteredIds = allUserIds.filter((id) => id !== currentUserId);
    return filteredIds;
  } catch (error) {
    console.error('Error getting online user IDs from RTDB:', error);
    return [];
  }
};


/**
 * Fetch user details for specific user IDs from RTDB users node
 * Only fetches relevant fields needed for display
 */
export const fetchUserDetailsForInvite = async (appdatabase, userIds) => {
  if (!appdatabase || !userIds || !Array.isArray(userIds) || userIds.length === 0) return {};

  try {
    // ✅ OPTIMIZED: Fetch only specific fields instead of full user objects
    const userPromises = userIds.map(async (userId) => {
      try {
        // ✅ Fetch only the fields we need (parallel requests to specific child paths)
        const [displayNameSnap, avatarSnap, isPlayingSnap] = await Promise.all([
          get(ref(appdatabase, `users/${userId}/displayName`)).catch(() => null),
          get(ref(appdatabase, `users/${userId}/avatar`)).catch(() => null),
          get(ref(appdatabase, `users/${userId}/isPlaying`)).catch(() => null),
        ]);

        // ✅ Check if user exists (if no displayName and no avatar, user likely doesn't exist)
        if (!displayNameSnap?.exists() && !avatarSnap?.exists()) {
          return null;
        }

        return {
          id: userId,
          displayName: displayNameSnap?.exists() ? displayNameSnap.val() : 'Anonymous',
          avatar: avatarSnap?.exists() ? avatarSnap.val() :
                 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
          isPlaying: isPlayingSnap?.exists() ? isPlayingSnap.val() : false,
        };
      } catch (error) {
        console.error(`Error fetching user ${userId}:`, error);
        return null;
      }
    });

    const users = (await Promise.all(userPromises)).filter((u) => u !== null);
    
    // Convert to object with userId as key
    const userDetails = {};
    users.forEach((user) => {
      userDetails[user.id] = user;
    });

    return userDetails;
  } catch (error) {
    console.error('Error fetching user details:', error);
    return {};
  }
};

/**
 * Listen to room updates
 */
export const listenToGameRoom = (firestoreDB, roomId, callback) => {
  if (!firestoreDB || !roomId) return () => {};

  const roomRef = doc(firestoreDB, 'fruitGuessingGame_rooms', roomId);
  
  const unsubscribe = onSnapshot(
    roomRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }

      const roomData = snapshot.data();
      // Convert Firestore timestamps to numbers for compatibility
      const processedData = {
        ...roomData,
        id: snapshot.id,
        createdAt: roomData.createdAt?.toMillis?.() || roomData.createdAt || Date.now(),
        players: Object.entries(roomData.players || {}).reduce((acc, [key, value]) => {
          acc[key] = {
            ...value,
            joinedAt: value.joinedAt?.toMillis?.() || value.joinedAt || Date.now(),
          };
          return acc;
        }, {}),
        invites: Object.entries(roomData.invites || {}).reduce((acc, [key, value]) => {
          acc[key] = {
            ...value,
            timestamp: value.timestamp?.toMillis?.() || value.timestamp || Date.now(),
          };
          return acc;
        }, {}),
      };
      
      callback(processedData);
    },
    (error) => {
      console.error('Error listening to room:', error);
      callback(null);
    }
  );

  return unsubscribe;
};

/**
 * Leave a game room
 */
export const leaveGameRoom = async (firestoreDB, roomId, userId) => {
  if (!firestoreDB || !roomId || !userId) return false;

  try {
    const roomRef = doc(firestoreDB, 'fruitGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists) return false;

    const roomData = roomSnap.data();
    
    // If game has started or finished, preserve player data (don't delete from players object)
    // Only remove player if game is still waiting
    const players = { ...roomData.players };
    if (roomData.status === 'waiting') {
    delete players[userId];
    }
    // If game is playing or finished, keep player data for display

    // If host leaves and room is empty, delete room
    if (roomData.hostId === userId && roomData.currentPlayers <= 1) {
      await deleteDoc(roomRef);
    } else {
      const updateData = {
        currentPlayers: Math.max(0, roomData.currentPlayers - 1),
      };
      
      // Only update players object if game is waiting (we removed the player)
      if (roomData.status === 'waiting') {
        updateData.players = players;
      }
      
      await updateDoc(roomRef, updateData);
    }

    // Remove user invite from Firestore
    const userInviteRef = doc(
      firestoreDB,
      'fruitGuessingGame_userInvites',
      userId,
      'invites',
      roomId
    );
    await deleteDoc(userInviteRef);

    return true;
  } catch (error) {
    console.error('Error leaving room:', error);
    return false;
  }
};

/**
 * Start the game (host only, requires at least 2 players)
 */
export const startGame = async (firestoreDB, roomId, hostId) => {
  if (!firestoreDB || !roomId || !hostId) return false;

  try {
    const roomRef = doc(firestoreDB, 'fruitGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists) return false;

    const roomData = roomSnap.data();

    // Verify host (allow auto-start when 2 players join)
    if (roomData.hostId !== hostId) {
      // Allow auto-start if 2 players have joined
      if (roomData.currentPlayers >= 2 && roomData.status === 'waiting') {
        // Continue with auto-start
      } else {
        return false; // Only host can start manually
      }
    }

    // Check minimum players (2)
    if (roomData.currentPlayers < 2) {
      return false; // Need at least 2 players
    }

    // Check if already started
    if (roomData.status !== 'waiting') {
      return false; // Game already started
    }

    // Initialize scores for all players
    const scores = {};
    const playerOrder = roomData.gameData?.playerOrder || Object.keys(roomData.players);
    playerOrder.forEach(playerId => {
      scores[playerId] = 0;
    });

    // Start the game - turn based, 3 rounds
    await updateDoc(roomRef, {
      status: 'playing',
      'gameData.startedAt': serverTimestamp(),
      'gameData.currentRound': 1,
      'gameData.totalRounds': 3,
      'gameData.currentTurnIndex': 0, // First player's turn
      'gameData.playerOrder': playerOrder,
      'gameData.scores': scores,
      'gameData.roundScores': {},
      'gameData.spinHistory': [],
      'gameData.isSpinning': false,
      'gameData.lastSpinResult': null,
      'gameData.turnStartTime': serverTimestamp(), // Set initial turn start time
    });

    return true;
  } catch (error) {
    console.error('Error starting game:', error);
    return false;
  }
};

/**
 * Submit an answer for a challenge
 */
export const submitAnswer = async (firestoreDB, roomId, userId, answerData) => {
  if (!firestoreDB || !roomId || !userId || !answerData) return false;

  try {
    const roomRef = doc(firestoreDB, 'fruitGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists) return false;

    const roomData = roomSnap.data();

    // Check if game is playing
    if (roomData.status !== 'playing') {
      return false;
    }

    const round = answerData.round;
    const currentAnswers = roomData.gameData?.answers || {};
    const currentScores = roomData.gameData?.scores || {};

    // Initialize round answers if needed
    if (!currentAnswers[round]) {
      currentAnswers[round] = {};
    }

    // Check if already answered
    if (currentAnswers[round][userId]) {
      return false; // Already answered
    }

    // Save answer
    currentAnswers[round][userId] = {
      selectedAnswer: answerData.answer,
      isCorrect: answerData.isCorrect,
      timestamp: answerData.timestamp || Date.now(),
    };

    // Update score
    if (!currentScores[userId]) {
      currentScores[userId] = 0;
    }
    if (answerData.isCorrect) {
      currentScores[userId] = (currentScores[userId] || 0) + 1;
    }

    await updateDoc(roomRef, {
      'gameData.answers': currentAnswers,
      'gameData.scores': currentScores,
    });

    return true;
  } catch (error) {
    console.error('Error submitting answer:', error);
    return false;
  }
};

/**
 * Generate and save a challenge for a round (host only)
 */
export const generateChallengeForRound = async (
  firestoreDB,
  roomId,
  hostId,
  round,
  challengeData
) => {
  if (!firestoreDB || !roomId || !hostId || !round || !challengeData) return false;

  try {
    const roomRef = doc(firestoreDB, 'fruitGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists) return false;

    const roomData = roomSnap.data();

    // Verify host
    if (roomData.hostId !== hostId) {
      return false;
    }

    const challenges = roomData.gameData?.challenges || {};
    challenges[round] = challengeData;

    await updateDoc(roomRef, {
      'gameData.challenges': challenges,
    });

    return true;
  } catch (error) {
    console.error('Error generating challenge:', error);
    return false;
  }
};

/**
 * Advance to next round (host only, requires all players to have answered)
 */
export const advanceToNextRound = async (firestoreDB, roomId, hostId) => {
  if (!firestoreDB || !roomId || !hostId) return false;

  try {
    const roomRef = doc(firestoreDB, 'fruitGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists) return false;

    const roomData = roomSnap.data();

    // Verify host
    if (roomData.hostId !== hostId) {
      return false;
    }

    // Check if game is playing
    if (roomData.status !== 'playing') {
      return false;
    }

    const currentRound = roomData.gameData?.currentRound || 1;
    const totalRounds = roomData.gameData?.totalRounds || 5;
    const currentAnswers = roomData.gameData?.answers?.[currentRound] || {};
    const playerCount = roomData.currentPlayers || 0;

    // Check if all players have answered
    const answeredCount = Object.keys(currentAnswers).length;
    if (answeredCount < playerCount) {
      return false; // Not all players have answered
    }

    // Check if this is the last round
    if (currentRound >= totalRounds) {
      // End the game
      await updateDoc(roomRef, {
        status: 'finished',
        'gameData.endedAt': serverTimestamp(),
      });
    } else {
      // Advance to next round
      await updateDoc(roomRef, {
        'gameData.currentRound': currentRound + 1,
      });
    }

    return true;
  } catch (error) {
    console.error('Error advancing to next round:', error);
    return false;
  }
};

/**
 * Submit pet pick for current round
 */
export const submitPetPick = async (firestoreDB, roomId, userId, pickData) => {
  if (!firestoreDB || !roomId || !userId || !pickData) return false;

  try {
    const roomRef = doc(firestoreDB, 'fruitGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists) return false;

    const roomData = roomSnap.data();

    // Check if already picked
    if (roomData.gameData?.picks?.[userId]) {
      return false; // Already picked
    }

    // Check if countdown ended
    if (roomData.gameData?.countdownEnd && Date.now() > roomData.gameData.countdownEnd) {
      return false; // Too late
    }

    // Add pick
    const picks = roomData.gameData?.picks || {};
    picks[userId] = {
      ...pickData,
      timestamp: Date.now(),
    };

    // Check if all players picked
    const playerCount = roomData.currentPlayers || 0;
    const allPicked = Object.keys(picks).length >= playerCount;

    await updateDoc(roomRef, {
      'gameData.picks': picks,
      'gameData.allPicked': allPicked,
    });

    return true;
  } catch (error) {
    console.error('Error submitting pet pick:', error);
    return false;
  }
};

/**
 * Set round winner (after wheel spin)
 */
export const setGameWinner = async (firestoreDB, roomId, winnerData) => {
  if (!firestoreDB || !roomId || !winnerData) return false;

  try {
    const roomRef = doc(firestoreDB, 'fruitGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists) return false;

    await updateDoc(roomRef, {
      'gameData.winner': winnerData,
      status: 'finished',
      'gameData.endedAt': serverTimestamp(),
    });

    return true;
  } catch (error) {
    console.error('Error setting game winner:', error);
    return false;
  }
};

/**
 * Record a wheel spin result and advance to next turn
 */
export const recordSpinResult = async (firestoreDB, roomId, userId, spinResult) => {
  if (!firestoreDB || !roomId || !userId || !spinResult) return false;

  try {
    const roomRef = doc(firestoreDB, 'fruitGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists) return false;

    const roomData = roomSnap.data();
    const gameData = roomData.gameData || {};
    const playerOrder = gameData.playerOrder || [];
    const currentTurnIndex = gameData.currentTurnIndex || 0;
    const currentRound = gameData.currentRound || 1;
    const totalRounds = gameData.totalRounds || 3;
    const scores = gameData.scores || {};
    const spinHistory = gameData.spinHistory || [];

    // Verify it's this user's turn
    if (playerOrder[currentTurnIndex] !== userId) {
      return false; // Not your turn
    }

    // Add spin to history
    const spinRecord = {
      playerId: userId,
      round: currentRound,
      petName: spinResult.petName,
      petValue: spinResult.petValue,
      petImage: spinResult.petImage || null,
      timestamp: Date.now(),
    };
    spinHistory.push(spinRecord);

    // Update score
    scores[userId] = (scores[userId] || 0) + spinResult.petValue;

    // Calculate next turn
    let nextTurnIndex = currentTurnIndex + 1;
    let nextRound = currentRound;
    let isGameFinished = false;

    // If we've gone through all players, advance to next round
    if (nextTurnIndex >= playerOrder.length) {
      nextTurnIndex = 0;
      nextRound = currentRound + 1;

      // Check if game is finished
      if (nextRound > totalRounds) {
        isGameFinished = true;
      }
    }

    const updateData = {
      'gameData.scores': scores,
      'gameData.spinHistory': spinHistory,
      'gameData.isSpinning': false,
      'gameData.lastSpinResult': spinResult,
    };

    if (isGameFinished) {
      // Game is finished - determine winner
      let winnerId = null;
      let maxScore = -1;
      Object.entries(scores).forEach(([playerId, score]) => {
        if (score > maxScore) {
          maxScore = score;
          winnerId = playerId;
        }
      });

      updateData['status'] = 'finished';
      updateData['gameData.endedAt'] = serverTimestamp();
      updateData['gameData.winner'] = {
        playerId: winnerId,
        score: maxScore,
      };
      
      // Note: Points and wins will be awarded by the client when they see the game finished
      // This prevents duplicate awards if multiple clients process the finish event
    } else {
      // Advance to next turn
      updateData['gameData.currentTurnIndex'] = nextTurnIndex;
      updateData['gameData.currentRound'] = nextRound;
      updateData['gameData.turnStartTime'] = serverTimestamp(); // Set new turn start time
    }

    await updateDoc(roomRef, updateData);
    return true;
  } catch (error) {
    console.error('Error recording spin result:', error);
    return false;
  }
};

/**
 * Set spinning state
 */
export const setSpinningState = async (firestoreDB, roomId, isSpinning) => {
  if (!firestoreDB || !roomId) return false;

  try {
    const roomRef = doc(firestoreDB, 'fruitGuessingGame_rooms', roomId);
    await updateDoc(roomRef, {
      'gameData.isSpinning': isSpinning,
    });
    return true;
  } catch (error) {
    console.error('Error setting spinning state:', error);
    return false;
  }
};

/**
 * End game due to timeout or player leaving
 * This ends the game immediately and determines winner based on current scores
 */
export const endGameDueToTimeout = async (firestoreDB, roomId, timeoutUserId, reason = 'timeout') => {
  if (!firestoreDB || !roomId || !timeoutUserId) return false;

  try {
    const roomRef = doc(firestoreDB, 'fruitGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists) return false;

    const roomData = roomSnap.data();
    const gameData = roomData.gameData || {};
    const scores = gameData.scores || {};
    const spinHistory = gameData.spinHistory || [];

    // Get player name for the message
    const timeoutPlayerName = roomData.players?.[timeoutUserId]?.displayName || 'Player';

    // Add timeout record to history
    const timeoutRecord = {
      playerId: timeoutUserId,
      round: gameData.currentRound || 1,
      petName: reason === 'timeout' ? 'Game Ended (Timeout)' : 'Game Ended (Player Left)',
      petValue: 0,
      petImage: null,
      timestamp: Date.now(),
      timeout: true,
      reason: reason,
    };
    spinHistory.push(timeoutRecord);

    // Determine winner based on current scores
    let winnerId = null;
    let maxScore = -1;
    Object.entries(scores).forEach(([playerId, score]) => {
      if (score > maxScore) {
        maxScore = score;
        winnerId = playerId;
      }
    });

    // If scores are equal or no winner, set to null
    if (maxScore === 0 || !winnerId) {
      winnerId = null;
    }

    // End the game
    const updateData = {
      status: 'finished',
      'gameData.endedAt': serverTimestamp(),
      'gameData.scores': scores,
      'gameData.spinHistory': spinHistory,
      'gameData.isSpinning': false,
      'gameData.turnStartTime': null,
      'gameData.timeoutReason': reason === 'timeout' 
        ? `${timeoutPlayerName} timed out` 
        : `${timeoutPlayerName} left the game`,
      'gameData.winner': winnerId ? {
        playerId: winnerId,
        score: maxScore,
      } : null,
    };

    await updateDoc(roomRef, updateData);
    return true;
  } catch (error) {
    console.error('Error ending game due to timeout:', error);
    return false;
  }
};

/**
 * Set turn start time when a turn begins
 */
export const setTurnStartTime = async (firestoreDB, roomId) => {
  if (!firestoreDB || !roomId) return false;

  try {
    const roomRef = doc(firestoreDB, 'fruitGuessingGame_rooms', roomId);
    await updateDoc(roomRef, {
      'gameData.turnStartTime': serverTimestamp(),
    });
    return true;
  } catch (error) {
    console.error('Error setting turn start time:', error);
    return false;
  }
};


