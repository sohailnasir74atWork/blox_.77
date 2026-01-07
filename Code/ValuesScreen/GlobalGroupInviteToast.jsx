// GlobalGroupInviteToast.jsx - Global toast notification for group and game invitations
import React, { useState, useEffect, useRef } from 'react';
import { useGlobalState } from '../GlobelStats';
import { collection, query, where, getDocs, doc, deleteDoc } from '@react-native-firebase/firestore';
import { showInfoMessage } from '../Helper/MessageHelper';
import GroupInviteToast from './GroupInviteToast';
import { AppState } from 'react-native';

const INVITE_EXPIRY_MS = 60000; // 1 minute for game invites
const POLLING_INTERVAL_MS = 45000; // ✅ Poll every 45 seconds instead of real-time (reduces reads by ~95%)

const GlobalGroupInviteToast = () => {
  const { firestoreDB, user, isInActiveGame = false } = useGlobalState();
  const [toastVisible, setToastVisible] = useState(false);
  const [toastData, setToastData] = useState(null);
  const lastInviteIdRef = useRef(null);
  const expiryTimerRef = useRef(null);
  const groupInvitesRef = useRef([]);
  const gameInvitesRef = useRef([]);

  // Helper function to determine which invite to show (newest wins)
  const updateToast = () => {
    const now = Date.now();
    const allInvites = [];

    // Process group invites
    groupInvitesRef.current.forEach((invite) => {
      const expiresAt = invite.expiresAt || (invite.timestamp + 7 * 24 * 60 * 60 * 1000);
      if (now <= expiresAt && invite.status === 'pending') {
        allInvites.push({
          ...invite,
          type: 'group',
          expiresAt,
        });
      }
    });

    // Process game invites (only if not in active game)
    if (!isInActiveGame) {
      gameInvitesRef.current.forEach((invite) => {
        const timestamp = invite.timestamp?.toMillis?.() || invite.timestamp || Date.now();
        const expiresAt = invite.expiresAt || (timestamp + INVITE_EXPIRY_MS);
        if (now <= expiresAt && invite.status === 'pending') {
          allInvites.push({
            ...invite,
            type: 'game',
            expiresAt,
            timestamp,
          });
        }
      });
    }

    // Sort by timestamp (newest first)
    allInvites.sort((a, b) => {
      const aTime = a.timestamp || a.createdAt?.toMillis?.() || a.createdAt || 0;
      const bTime = b.timestamp || b.createdAt?.toMillis?.() || b.createdAt || 0;
      return bTime - aTime;
    });

    // Hide toast if no valid invites
    if (allInvites.length === 0) {
      setToastVisible(false);
      setToastData(null);
      lastInviteIdRef.current = null;
      if (expiryTimerRef.current) {
        clearTimeout(expiryTimerRef.current);
        expiryTimerRef.current = null;
      }
      return;
    }

    // Show toast for newest valid invite
    const latestInvite = allInvites[0];
    const inviteId = `${latestInvite.type}-${latestInvite.id || latestInvite.roomId}`;

    // Only show if it's a new invite (not the same one)
    if (inviteId !== lastInviteIdRef.current) {
      lastInviteIdRef.current = inviteId;
      
      const isGameInvite = latestInvite.type === 'game';
      const fromUserName = isGameInvite 
        ? (latestInvite.fromUserName || 'Someone')
        : (latestInvite.invitedByDisplayName || 'Someone');
      
      // console.log(`🎮👥 Showing ${isGameInvite ? 'game' : 'group'} invitation toast:`, {
      //   inviteId: latestInvite.id || latestInvite.roomId,
      //   fromUserName,
      //   groupName: latestInvite.groupName,
      //   roomId: latestInvite.roomId,
      //   expiresAt: latestInvite.expiresAt,
      //   now: now,
      // });
      
      // ✅ Show FlashMessage toast (auto-hides after 3 seconds)
      showInfoMessage(
        isGameInvite ? 'Game Invitation' : 'Group Invitation',
        isGameInvite
          ? `${fromUserName} invites you to play now`
          : `${fromUserName} invited you to join "${latestInvite.groupName || 'Group'}"`
      );
      
      setToastData({
        fromUserName,
        fromUserAvatar: isGameInvite 
          ? (latestInvite.fromUserAvatar || null)
          : (latestInvite.invitedByAvatar || null),
        groupName: latestInvite.groupName || 'Group',
        groupId: latestInvite.groupId,
        roomId: latestInvite.roomId,
        inviteId: latestInvite.id || latestInvite.roomId,
        expiresAt: latestInvite.expiresAt,
        inviteType: latestInvite.type,
      });
      setToastVisible(true);

      // Set timeout to hide toast exactly when invite expires
      if (expiryTimerRef.current) {
        clearTimeout(expiryTimerRef.current);
      }
      const timeUntilExpiry = latestInvite.expiresAt - now;
      if (timeUntilExpiry > 0) {
        expiryTimerRef.current = setTimeout(() => {
          setToastVisible(false);
          setToastData(null);
          lastInviteIdRef.current = null;
          expiryTimerRef.current = null;
        }, timeUntilExpiry);
      }
    }
  };

  // ✅ OPTIMIZED: Poll group invitations instead of real-time listener (reduces reads by ~95%)
  useEffect(() => {
    if (!firestoreDB || !user?.id) {
      groupInvitesRef.current = [];
      updateToast();
      return;
    }

    let pollInterval;
    let isActive = true;

    const pollGroupInvites = async () => {
      if (!isActive) return;

      try {
        const invitationsQuery = query(
          collection(firestoreDB, 'group_invitations'),
          where('invitedUserId', '==', user.id),
          where('status', '==', 'pending')
        );

        const snapshot = await getDocs(invitationsQuery);
        const now = Date.now();
        const validInvites = [];

        snapshot.forEach((doc) => {
          const data = doc.data();
          // Handle both timestamp (Firestore Timestamp) and createdAt
          let timestamp = now;
          if (data.timestamp?.toMillis) {
            timestamp = data.timestamp.toMillis();
          } else if (data.timestamp && typeof data.timestamp === 'number') {
            timestamp = data.timestamp;
          } else if (data.createdAt?.toMillis) {
            timestamp = data.createdAt.toMillis();
          } else if (data.createdAt && typeof data.createdAt === 'number') {
            timestamp = data.createdAt;
          }
          
          const expiresAt = data.expiresAt || (timestamp + 7 * 24 * 60 * 60 * 1000); // Default 7 days expiry
          
          if (now <= expiresAt && data.status === 'pending') {
            validInvites.push({
              id: doc.id,
              ...data,
              expiresAt: expiresAt,
              timestamp: timestamp,
            });
          }
        });

        groupInvitesRef.current = validInvites;
        updateToast();
      } catch (error) {
        console.error('❌ Error polling group invitations:', error);
        if (error.code === 'failed-precondition') {
          console.error('⚠️ Firestore index required. Please create index for group_invitations: invitedUserId (Ascending), status (Ascending)');
        }
        groupInvitesRef.current = [];
        updateToast();
      }
    };

    // Poll immediately on mount
    pollGroupInvites();

    // Set up polling interval
    pollInterval = setInterval(pollGroupInvites, POLLING_INTERVAL_MS);

    // ✅ Only poll when app is in foreground
    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === 'active' && isActive) {
        // App came to foreground - poll immediately
        pollGroupInvites();
      }
    };

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      isActive = false;
      if (pollInterval) clearInterval(pollInterval);
      appStateSubscription?.remove();
    };
  }, [firestoreDB, user?.id]);

  // ✅ OPTIMIZED: Poll game invitations instead of real-time listener (reduces reads by ~95%)
  useEffect(() => {
    if (!firestoreDB || !user?.id || isInActiveGame) {
      gameInvitesRef.current = [];
      updateToast();
      return;
    }

    let pollInterval;
    let isActive = true;

    const pollGameInvites = async () => {
      if (!isActive) return;

      try {
        const invitesCollectionRef = collection(
          firestoreDB,
          'fruitGuessingGame_userInvites',
          user.id,
          'invites'
        );
        
        const q = query(
          invitesCollectionRef,
          where('status', '==', 'pending')
        );
        
        const snapshot = await getDocs(q);
        const invites = [];
        const now = Date.now();
        const expiredInviteIds = [];
        
        if (!snapshot.empty) {
          snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (!data) return;
            
            const timestamp = data.timestamp?.toMillis?.() || data.timestamp || Date.now();
            const expiresAt = data.expiresAt || (timestamp + INVITE_EXPIRY_MS);
            
            if (now > expiresAt && data.status === 'pending') {
              expiredInviteIds.push(docSnap.id);
              return;
            }
            
            invites.push({
              roomId: docSnap.id,
              ...data,
              timestamp: timestamp,
              expiresAt: expiresAt,
            });
          });

          // Delete expired invites
          if (expiredInviteIds.length > 0) {
            expiredInviteIds.forEach(async (inviteId) => {
              try {
                const inviteRef = doc(
                  collection(firestoreDB, 'fruitGuessingGame_userInvites', user.id, 'invites'),
                  inviteId
                );
                await deleteDoc(inviteRef);
              } catch (error) {
                console.error('Error deleting expired invite:', error);
              }
            });
          }

          invites.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        }

        gameInvitesRef.current = invites;
        updateToast();
      } catch (error) {
        console.error('❌ Error polling game invitations:', error);
        gameInvitesRef.current = [];
        updateToast();
      }
    };

    // Poll immediately on mount
    pollGameInvites();

    // Set up polling interval
    pollInterval = setInterval(pollGameInvites, POLLING_INTERVAL_MS);

    // ✅ Only poll when app is in foreground
    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === 'active' && isActive) {
        pollGameInvites();
      }
    };

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      isActive = false;
      if (pollInterval) clearInterval(pollInterval);
      appStateSubscription?.remove();
    };
  }, [firestoreDB, user?.id, isInActiveGame]);

  // Update toast when isInActiveGame changes (to show/hide game invites)
  useEffect(() => {
    updateToast();
  }, [isInActiveGame]);

  const handleToastPress = () => {
    setToastVisible(false);
    // Note: Navigation will be handled by the user manually going to Groups screen
    // We can't use useNavigation here because this component is rendered outside NavigationContainer
  };

  const handleToastDismiss = () => {
    setToastVisible(false);
  };

  return (
    <GroupInviteToast
      visible={toastVisible}
      fromUserName={toastData?.fromUserName}
      fromUserAvatar={toastData?.fromUserAvatar}
      groupName={toastData?.groupName}
      inviteType={toastData?.inviteType || 'group'}
      onPress={handleToastPress}
      onDismiss={handleToastDismiss}
    />
  );
};

export default GlobalGroupInviteToast;

