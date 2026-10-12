// GlobalGroupInviteToast.jsx - Global toast notification for group and game invitations
import React, { useState, useEffect, useRef } from 'react';
import { useGlobalState } from '../GlobelStats';
import { collection, query, where, getDocs, doc, deleteDoc, onSnapshot } from '@react-native-firebase/firestore';
import { showInfoMessage } from '../Helper/MessageHelper';
import GroupInviteToast from './GroupInviteToast';
import { AppState } from 'react-native';
import i18next from 'i18next';

const INVITE_EXPIRY_MS = 60000; // 1 minute for game invites
// Invites arrive over ONE real-time listener per query, attached only while the
// app is in the foreground (a listener bills reads only when a doc changes; the
// old 45 s poll re-read every pending invite ~80x/hour). The poll below is a
// safety net that only runs if that listener errors (e.g. missing index).
const FALLBACK_POLL_INTERVAL_MS = 5 * 60 * 1000;
// Anything that isn't an explicit 'background' counts as foreground for the
// initial attach: on a cold start RN can report 'unknown'/'inactive' before the
// first 'active' event and we must not miss the first snapshot.
const isForegroundState = (state) => state !== 'background';

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
        ? (latestInvite.fromUserName || i18next.t('values.group_invite_toast.someone'))
        : (latestInvite.invitedByDisplayName || i18next.t('values.group_invite_toast.someone'));
      
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
        isGameInvite ? i18next.t('values.global_group_invite_toast.game_invitation') : i18next.t('values.global_group_invite_toast.group_invitation'),
        isGameInvite
          ? i18next.t('values.group_invite_toast.game_invite_body', { name: fromUserName })
          : i18next.t('values.group_invite_toast.group_invite_body', { name: fromUserName, group: latestInvite.groupName || i18next.t('values.group_invite_toast.group') })
      );
      
      setToastData({
        fromUserName,
        fromUserAvatar: isGameInvite 
          ? (latestInvite.fromUserAvatar || null)
          : (latestInvite.invitedByAvatar || null),
        groupName: latestInvite.groupName || i18next.t('values.group_invite_toast.group'),
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

  // ✅ Group invitations: ONE real-time listener on the same query (was a 45 s
  // poll). Attached while the app is in the foreground, detached in the
  // background, re-attached on foreground and torn down on unmount. If the
  // listener errors it falls back to a 5-minute foreground-only poll so
  // invites still arrive.
  useEffect(() => {
    if (!firestoreDB || !user?.id) {
      groupInvitesRef.current = [];
      updateToast();
      return;
    }

    let isActive = true;
    let unsubscribe = null;
    let fallbackInterval = null;
    let listenerFailed = false;

    const invitationsQuery = query(
      collection(firestoreDB, 'group_invitations'),
      where('invitedUserId', '==', user.id),
      where('status', '==', 'pending')
    );

    // Same handler as before; fed with snapshot.docs from the listener or the poll.
    const handleGroupInviteDocs = (docs) => {
      const now = Date.now();
      const validInvites = [];

      (docs || []).forEach((docSnap) => {
        const data = docSnap.data();
        if (!data) return;
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
            id: docSnap.id,
            ...data,
            expiresAt: expiresAt,
            timestamp: timestamp,
          });
        }
      });

      groupInvitesRef.current = validInvites;
      updateToast();
    };

    const handleGroupInviteError = (error) => {
      console.warn('❌ Error loading group invitations:', error?.message || error);
      if (error?.code === 'failed-precondition') {
        console.warn('⚠️ Firestore index required. Please create index for group_invitations: invitedUserId (Ascending), status (Ascending)');
      }
      groupInvitesRef.current = [];
      updateToast();
    };

    const pollGroupInvites = async () => {
      if (!isActive) return;
      try {
        const snapshot = await getDocs(invitationsQuery);
        if (!isActive) return;
        handleGroupInviteDocs(snapshot?.docs);
      } catch (error) {
        handleGroupInviteError(error);
      }
    };

    const stopFallbackPoll = () => {
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    };

    // Safety net: only used after the listener errored; foreground-only.
    const startFallbackPoll = () => {
      if (!isActive || fallbackInterval) return;
      pollGroupInvites();
      fallbackInterval = setInterval(pollGroupInvites, FALLBACK_POLL_INTERVAL_MS);
    };

    const detach = () => {
      if (unsubscribe) {
        try { unsubscribe(); } catch (_) {}
        unsubscribe = null;
      }
      stopFallbackPoll();
    };

    const attach = () => {
      if (!isActive || unsubscribe || fallbackInterval) return;
      if (listenerFailed) {
        startFallbackPoll();
        return;
      }
      try {
        unsubscribe = onSnapshot(
          invitationsQuery,
          (snapshot) => {
            if (!isActive) return;
            try {
              handleGroupInviteDocs(snapshot?.docs);
            } catch (error) {
              handleGroupInviteError(error);
            }
          },
          (error) => {
            // Firestore tears the listener down on error — switch to the poll.
            unsubscribe = null;
            listenerFailed = true;
            handleGroupInviteError(error);
            if (isActive && isForegroundState(AppState.currentState)) startFallbackPoll();
          }
        );
      } catch (error) {
        unsubscribe = null;
        listenerFailed = true;
        handleGroupInviteError(error);
        startFallbackPoll();
      }
    };

    if (isForegroundState(AppState.currentState)) attach();

    // ✅ Listen only while the app is in the foreground
    const handleAppStateChange = (nextAppState) => {
      if (!isActive) return;
      if (nextAppState === 'active') {
        attach();
      } else if (nextAppState === 'background') {
        detach();
      }
    };

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      isActive = false;
      detach();
      appStateSubscription?.remove();
    };
  }, [firestoreDB, user?.id]);

  // ✅ Game invitations: same listener-with-fallback pattern as above.
  useEffect(() => {
    if (!firestoreDB || !user?.id || isInActiveGame) {
      gameInvitesRef.current = [];
      updateToast();
      return;
    }

    let isActive = true;
    let unsubscribe = null;
    let fallbackInterval = null;
    let listenerFailed = false;

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

    // Same handler as before (incl. expired-invite cleanup); fed with snapshot.docs.
    const handleGameInviteDocs = (docs) => {
      const invites = [];
      const now = Date.now();
      const expiredInviteIds = [];

      if (docs && docs.length > 0) {
        docs.forEach((docSnap) => {
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
    };

    const handleGameInviteError = (error) => {
      console.warn('❌ Error loading game invitations:', error?.message || error);
      gameInvitesRef.current = [];
      updateToast();
    };

    const pollGameInvites = async () => {
      if (!isActive) return;
      try {
        const snapshot = await getDocs(q);
        if (!isActive) return;
        handleGameInviteDocs(snapshot?.docs);
      } catch (error) {
        handleGameInviteError(error);
      }
    };

    const stopFallbackPoll = () => {
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    };

    // Safety net: only used after the listener errored; foreground-only.
    const startFallbackPoll = () => {
      if (!isActive || fallbackInterval) return;
      pollGameInvites();
      fallbackInterval = setInterval(pollGameInvites, FALLBACK_POLL_INTERVAL_MS);
    };

    const detach = () => {
      if (unsubscribe) {
        try { unsubscribe(); } catch (_) {}
        unsubscribe = null;
      }
      stopFallbackPoll();
    };

    const attach = () => {
      if (!isActive || unsubscribe || fallbackInterval) return;
      if (listenerFailed) {
        startFallbackPoll();
        return;
      }
      try {
        unsubscribe = onSnapshot(
          q,
          (snapshot) => {
            if (!isActive) return;
            try {
              handleGameInviteDocs(snapshot?.docs);
            } catch (error) {
              handleGameInviteError(error);
            }
          },
          (error) => {
            // Firestore tears the listener down on error — switch to the poll.
            unsubscribe = null;
            listenerFailed = true;
            handleGameInviteError(error);
            if (isActive && isForegroundState(AppState.currentState)) startFallbackPoll();
          }
        );
      } catch (error) {
        unsubscribe = null;
        listenerFailed = true;
        handleGameInviteError(error);
        startFallbackPoll();
      }
    };

    if (isForegroundState(AppState.currentState)) attach();

    // ✅ Listen only while the app is in the foreground
    const handleAppStateChange = (nextAppState) => {
      if (!isActive) return;
      if (nextAppState === 'active') {
        attach();
      } else if (nextAppState === 'background') {
        detach();
      }
    };

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      isActive = false;
      detach();
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

