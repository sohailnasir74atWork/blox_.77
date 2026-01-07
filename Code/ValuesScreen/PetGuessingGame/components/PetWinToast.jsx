// PetWinToast.jsx - Toast notification for pet wins (slides from right)
import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Image,
  Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../../GlobelStats';

const { width } = Dimensions.get('window');
const MAX_TOAST_WIDTH = 280;

const PetWinToast = ({ visible, petName, petValue, petImage, onDismiss }) => {
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const slideAnim = useRef(new Animated.Value(MAX_TOAST_WIDTH)).current; // Start off-screen right
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    if (visible) {
      // Slide in from right, fade in, and scale up
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 40,
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
          tension: 40,
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
          transform: [{ translateX: slideAnim }, { scale: scaleAnim }],
        },
      ]}
    >
      <TouchableOpacity
        style={[
          styles.toast,
          {
            backgroundColor: isDarkMode ? '#1a1a1a' : '#fff',
            shadowColor: isDarkMode ? '#10B981' : '#000',
          },
        ]}
        onPress={handleDismiss}
        activeOpacity={0.8}
      >
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Icon name="trophy" size={18} color="#fff" />
          </View>
          <View style={styles.textContainer}>
            <Text
              style={[styles.title, { color: isDarkMode ? '#fff' : '#000' }]}
              numberOfLines={1}
            >
              You got {petName}!
            </Text>
            <Text
              style={[styles.message, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}
              numberOfLines={1}
            >
              +{Number(petValue || 0).toLocaleString()} points
            </Text>
          </View>
          {petImage && (
            <Image
              source={{ uri: petImage }}
              style={styles.petImage}
              resizeMode="contain"
            />
          )}
          <TouchableOpacity
            style={[styles.closeButton, { backgroundColor: isDarkMode ? 'rgba(16, 185, 129, 0.2)' : 'rgba(0,0,0,0.1)' }]}
            onPress={handleDismiss}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon name="close" size={14} color={isDarkMode ? '#fff' : '#6b7280'} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    right: 12,
    zIndex: 9999,
    maxWidth: MAX_TOAST_WIDTH,
  },
  toast: {
    borderRadius: 14,
    padding: 10,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 10,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    borderLeftWidth: 4,
    borderLeftColor: '#10B981',
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
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10B981',
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
    fontSize: 14,
    fontFamily: 'Lato-Bold',
    marginBottom: 2,
  },
  message: {
    fontSize: 12,
    fontFamily: 'Lato-Regular',
    color: '#10B981',
  },
  petImage: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#10B981',
  },
  closeButton: {
    padding: 4,
    borderRadius: 10,
  },
});

export default PetWinToast;

