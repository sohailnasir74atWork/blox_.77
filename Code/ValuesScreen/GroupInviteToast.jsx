// GroupInviteToast.jsx - Modern colorful toast notification for group invitations
import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../GlobelStats';
import { Dimensions } from 'react-native';

const { width } = Dimensions.get('window');
const MAX_TOAST_WIDTH = 280;

const GroupInviteToast = ({ visible, fromUserName, fromUserAvatar, groupName, inviteType = 'group', onPress, onDismiss }) => {
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const slideAnim = useRef(new Animated.Value(MAX_TOAST_WIDTH)).current; // Start off-screen right
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  const isGameInvite = inviteType === 'game';

  useEffect(() => {
    if (visible) {
      // Slide in from right, fade in, and scale in with bounce
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 60,
          friction: 7,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 60,
          friction: 7,
        }),
      ]).start();

      // Auto dismiss after 5 seconds
      const timer = setTimeout(() => {
        handleDismiss();
      }, 5000);

      return () => clearTimeout(timer);
    } else {
      handleDismiss();
    }
  }, [visible]);

  const handleDismiss = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: MAX_TOAST_WIDTH, // Slide out to the right
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.8,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss?.();
    });
  };

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: opacityAnim,
          transform: [
            { translateX: slideAnim },
            { scale: scaleAnim },
          ],
        },
      ]}
    >
      <TouchableOpacity
        style={[
          styles.toast,
          {
            backgroundColor: isDarkMode ? '#1a1a1a' : '#fff',
            borderLeftColor: '#8B5CF6',
          },
        ]}
        onPress={() => {
          handleDismiss();
          onPress?.();
        }}
        activeOpacity={0.9}
      >
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Icon name={isGameInvite ? "game-controller" : "people"} size={18} color="#fff" />
          </View>
          <View style={styles.textContainer}>
            <Text
              style={[styles.title, { color: isDarkMode ? '#fff' : '#000' }]}
              numberOfLines={1}
            >
              {isGameInvite ? '🎮 Game Invite!' : '👥 Group Invitation!'}
            </Text>
            <Text
              style={[styles.message, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}
              numberOfLines={2}
            >
              {isGameInvite
                ? `${fromUserName || 'Someone'} invites you to play now`
                : `${fromUserName || 'Someone'} invited you to join "${groupName || 'Group'}"`
              }
            </Text>
          </View>
          {fromUserAvatar && (
            <Image
              source={{ uri: fromUserAvatar }}
              style={styles.avatar}
            />
          )}
          <TouchableOpacity
            style={styles.closeButton}
            onPress={handleDismiss}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="close" size={14} color={isDarkMode ? '#9ca3af' : '#6b7280'} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    right: 10,
    zIndex: 9999,
    maxWidth: MAX_TOAST_WIDTH,
  },
  toast: {
    borderRadius: 14,
    padding: 10,
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 10,
    borderLeftWidth: 4,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: 'rgba(139, 92, 246, 0.1)',
    borderRightColor: 'rgba(139, 92, 246, 0.1)',
    borderBottomColor: 'rgba(139, 92, 246, 0.1)',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#8B5CF6',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  textContainer: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 3,
  },
  message: {
    fontSize: 10,

    lineHeight: 14,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#8B5CF6',
  },
  closeButton: {
    padding: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
  },
});

export default GroupInviteToast;

