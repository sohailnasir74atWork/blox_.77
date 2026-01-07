// GlobalInviteToast.jsx - Global toast notification for game invites
import React, { useState, useEffect, useRef } from 'react';
import { useGlobalState } from '../../../GlobelStats';
import { listenToUserInvites } from '../utils/gameInviteSystem';
import InviteToast from './InviteToast';

const INVITE_EXPIRY_MS = 60000; // 1 minute (same as gameInviteSystem.js)

const GlobalInviteToast = () => {
  const { firestoreDB, user, isInActiveGame = false } = useGlobalState();
  const [toastVisible, setToastVisible] = useState(false);
  const [toastData, setToastData] = useState(null);
  const lastInviteIdRef = useRef(null);
  const expiryTimerRef = useRef(null); // Ref for the expiry timeout

  useEffect(() => {
    // ✅ Don't listen to Firebase if user is in active game (saves Firebase reads)
    if (!firestoreDB || !user?.id || isInActiveGame) {
      setToastVisible(false);
      if (expiryTimerRef.current) {
        clearTimeout(expiryTimerRef.current);
        expiryTimerRef.current = null;
      }
      return;
    }

    // Only listen to invites when NOT in active game
    const unsubscribe = listenToUserInvites(firestoreDB, user.id, (invites) => {
      // ✅ Hide toast if no invites (all expired or declined)
      if (invites.length === 0) {
        setToastVisible(false);
        setToastData(null);
        lastInviteIdRef.current = null;
        if (expiryTimerRef.current) {
          clearTimeout(expiryTimerRef.current);
          expiryTimerRef.current = null;
        }
        return;
      }

      // ✅ Filter to only show valid (non-expired) invites
      const now = Date.now();
      const validInvites = invites.filter((invite) => {
        const timestamp = invite.timestamp?.toMillis?.() || invite.timestamp || Date.now();
        const expiresAt = invite.expiresAt || (timestamp + INVITE_EXPIRY_MS);
        return now <= expiresAt && invite.status === 'pending';
      });

      // If no valid invites after filtering, hide toast
      if (validInvites.length === 0) {
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
      const latestInvite = validInvites[0];
      const inviteId = `${latestInvite.roomId}-${latestInvite.timestamp}`;
      
      // Calculate expiry time (same pattern as InviteUsersModal.jsx)
      const timestamp = latestInvite.timestamp?.toMillis?.() || latestInvite.timestamp || Date.now();
      const expiresAt = latestInvite.expiresAt || (timestamp + INVITE_EXPIRY_MS);
      
      // ✅ Double-check expiry (safety check)
      if (now > expiresAt) {
        setToastVisible(false);
        setToastData(null);
        lastInviteIdRef.current = null;
        if (expiryTimerRef.current) {
          clearTimeout(expiryTimerRef.current);
          expiryTimerRef.current = null;
        }
        return;
      }
      
      // Only show if it's a new invite (not the same one)
      if (inviteId !== lastInviteIdRef.current) {
        lastInviteIdRef.current = inviteId;
        setToastData({
          fromUserName: latestInvite.fromUserName || 'Someone',
          fromUserAvatar: latestInvite.fromUserAvatar || null,
          roomId: latestInvite.roomId,
          expiresAt: expiresAt,
        });
        setToastVisible(true);

        // ✅ Set timeout to hide toast exactly when invite expires
        if (expiryTimerRef.current) {
          clearTimeout(expiryTimerRef.current);
        }
        const timeUntilExpiry = expiresAt - now;
        if (timeUntilExpiry > 0) {
          expiryTimerRef.current = setTimeout(() => {
            setToastVisible(false);
            setToastData(null);
            lastInviteIdRef.current = null;
            expiryTimerRef.current = null;
          }, timeUntilExpiry);
        }
      }
    });

    return () => {
      unsubscribe();
      if (expiryTimerRef.current) {
        clearTimeout(expiryTimerRef.current);
        expiryTimerRef.current = null;
      }
    };
  }, [firestoreDB, user?.id, isInActiveGame]);

  const handleToastPress = () => {
    setToastVisible(false);
    // Note: Navigation will be handled by the existing InviteNotification component
  };

  const handleToastDismiss = () => {
    setToastVisible(false);
  };

  return (
    <InviteToast
      visible={toastVisible}
      fromUserName={toastData?.fromUserName}
      fromUserAvatar={toastData?.fromUserAvatar}
      onPress={handleToastPress}
      onDismiss={handleToastDismiss}
    />
  );
};

export default GlobalInviteToast;

