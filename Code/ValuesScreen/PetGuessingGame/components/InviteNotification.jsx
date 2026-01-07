// InviteNotification.jsx
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Animated,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../../GlobelStats';
import { acceptGameInvite, declineGameInvite, listenToUserInvites } from '../utils/gameInviteSystem';
import { showSuccessMessage, showErrorMessage } from '../../../Helper/MessageHelper';

const InviteNotification = ({ currentUser, onAccept, isInActiveGame = false }) => {
  const { appdatabase, firestoreDB, theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const [pendingInvites, setPendingInvites] = useState([]);
  const [currentInvite, setCurrentInvite] = useState(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const slideY = useRef(new Animated.Value(200)).current;

  useEffect(() => {
    // ✅ Don't listen to Firebase if user is in active game (saves Firebase reads)
    if (!firestoreDB || !currentUser?.id || isInActiveGame) {
      // Clear current invite if game becomes active
      if (isInActiveGame && currentInvite) {
        setCurrentInvite(null);
      }
      return;
    }

    // Only listen to invites when NOT in active game
    const unsubscribe = listenToUserInvites(firestoreDB, currentUser.id, (invites) => {
      setPendingInvites(invites);
      
      // ✅ Hide notification if no invites (all expired or declined)
      if (invites.length === 0) {
        setCurrentInvite(null);
        Animated.timing(slideY, {
          toValue: 200,
          duration: 200,
          useNativeDriver: true,
        }).start();
        return;
      }

      // ✅ Check if current invite has expired
      const latestInvite = invites[0];
      const now = Date.now();
      const expiresAt = latestInvite.expiresAt || (latestInvite.timestamp + 60000);
      if (now > expiresAt) {
        // Invite expired - hide notification
        setCurrentInvite(null);
        Animated.timing(slideY, {
          toValue: 200,
          duration: 200,
          useNativeDriver: true,
        }).start();
        return;
      }

      // Show invite if available
      if (!currentInvite) {
        setCurrentInvite(latestInvite);
        Animated.spring(slideY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 50,
          friction: 7,
        }).start();
      } else if (currentInvite.roomId !== latestInvite.roomId) {
        // New invite received - update current invite
        setCurrentInvite(latestInvite);
      }
    });

    return () => unsubscribe();
  }, [firestoreDB, currentUser?.id, isInActiveGame]);

  // ✅ Single timeout to hide notification exactly when invite expires (efficient - no periodic checks)
  useEffect(() => {
    if (!currentInvite || isInActiveGame) return;

    const now = Date.now();
    const expiresAt = currentInvite.expiresAt || (currentInvite.timestamp + 60000);
    const timeUntilExpiry = expiresAt - now;

    // If already expired, hide immediately
    if (timeUntilExpiry <= 0) {
      setCurrentInvite(null);
      Animated.timing(slideY, {
        toValue: 200,
        duration: 200,
        useNativeDriver: true,
      }).start();
      return;
    }

    // Set a single timeout to hide notification exactly when it expires (much more efficient than interval)
    const timeout = setTimeout(() => {
      setCurrentInvite(null);
      Animated.timing(slideY, {
        toValue: 200,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }, timeUntilExpiry);

    return () => clearTimeout(timeout);
  }, [currentInvite, isInActiveGame]);

  useEffect(() => {
    // ✅ Hide notification if user enters active game
    if (isInActiveGame && currentInvite) {
      setCurrentInvite(null);
      Animated.timing(slideY, {
        toValue: 200,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else if (currentInvite && !isInActiveGame) {
      Animated.spring(slideY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 50,
        friction: 7,
      }).start();
    } else if (!currentInvite) {
      Animated.timing(slideY, {
        toValue: 200,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [currentInvite, isInActiveGame]);

  const handleAccept = async () => {
    if (!currentInvite || isAccepting) return;

    setIsAccepting(true);
    
    try {
      const result = await acceptGameInvite(
        firestoreDB,
        currentInvite.roomId,
        currentUser.id,
        {
          displayName: currentUser.displayName,
          avatar: currentUser.avatar,
        }
      );

      if (result.success) {
        showSuccessMessage('Joined!', 'You joined the game room!');
        setCurrentInvite(null);
        if (onAccept) {
          onAccept(currentInvite.roomId);
        }
      } else {
        // Show error message
        const errorMsg = result.error || 'Failed to join game';
        showErrorMessage('Cannot Join', errorMsg);
        setCurrentInvite(null);
      }
    } catch (error) {
      console.error('Error accepting invite:', error);
      showErrorMessage('Error', 'Failed to join game. Please try again.');
    } finally {
      setIsAccepting(false);
    }
  };

  const handleDecline = async () => {
    if (!currentInvite || isDeclining) return;

    setIsDeclining(true);
    
    try {
      await declineGameInvite(firestoreDB, currentInvite.roomId, currentUser.id);
      setCurrentInvite(null);

      // Show next invite if available
      if (pendingInvites.length > 1) {
        setCurrentInvite(pendingInvites[1]);
      }
    } catch (error) {
      console.error('Error declining invite:', error);
    } finally {
      setIsDeclining(false);
    }
  };

  // ✅ Don't show notification if in active game (invites still received, just not displayed)
  if (!currentInvite || isInActiveGame) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateY: slideY }],
        },
      ]}
    >
      <View
        style={[
          styles.notification,
          { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' },
        ]}
      >
        <Image
          source={{
            uri:
              currentInvite.fromUserAvatar ||
              'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
          }}
          style={styles.avatar}
        />
        <View style={styles.content}>
          <Text
            style={[styles.title, { color: isDarkMode ? '#fff' : '#000' }]}
          >
            Game Invite! 🎮
          </Text>
          <Text
            style={[styles.message, { color: isDarkMode ? '#999' : '#666' }]}
          >
            {currentInvite.fromUserName} invited you to play Pet Guessing!
          </Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity
            style={[
              styles.acceptButton,
              { backgroundColor: '#10B981' },
              isAccepting && styles.buttonDisabled,
            ]}
            onPress={handleAccept}
            disabled={isAccepting}
          >
            {isAccepting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Icon name="checkmark" size={20} color="#fff" />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.declineButton,
              { backgroundColor: '#EF4444' },
              (isAccepting || isDeclining) && styles.buttonDisabled,
            ]}
            onPress={handleDecline}
            disabled={isAccepting || isDeclining}
          >
            {isDeclining ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Icon name="close" size={20} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    zIndex: 1000,
    paddingHorizontal: 16,
  },
  notification: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontFamily: 'Lato-Bold',
    marginBottom: 4,
  },
  message: {
    fontSize: 12,
    fontFamily: 'Lato-Regular',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  acceptButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  declineButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});

export default InviteNotification;
