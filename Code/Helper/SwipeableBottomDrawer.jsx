/**
 * SwipeableBottomDrawer.jsx
 * Reusable wrapper that adds:
 *  – drag pill indicator at top
 *  – swipe-down-to-close gesture (PanResponder)
 *  – rounded top corners
 */

import React, { useRef } from 'react';
import { View, Animated, PanResponder, StyleSheet } from 'react-native';

const SWIPE_THRESHOLD = 80;

const SwipeableBottomDrawer = ({
  children,
  onClose,
  isDarkMode = false,
  style,
  borderRadius = 20,
  pillColor,
  showPill = true,
}) => {
  const translateY = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return (
          gestureState.dy > 15 &&
          gestureState.vy > 0.3 &&
          Math.abs(gestureState.dy) > Math.abs(gestureState.dx * 2)
        );
      },
      onPanResponderGrant: () => {
        translateY.setOffset(0);
        translateY.setValue(0);
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        translateY.flattenOffset();
        if (gestureState.dy > SWIPE_THRESHOLD || gestureState.vy > 0.8) {
          Animated.timing(translateY, {
            toValue: 500,
            duration: 200,
            useNativeDriver: true,
          }).start(() => {
            translateY.setValue(0);
            if (onClose) onClose();
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            tension: 120,
            friction: 14,
          }).start();
        }
      },
    })
  ).current;

  const resolvedPillColor =
    pillColor || (isDarkMode ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.15)');

  return (
    <Animated.View
      style={[
        styles.container,
        {
          borderTopLeftRadius: borderRadius,
          borderTopRightRadius: borderRadius,
          transform: [{ translateY }],
        },
        style,
      ]}
      {...panResponder.panHandlers}
    >
      {showPill && (
        <View style={styles.pillContainer}>
          <View style={[styles.pill, { backgroundColor: resolvedPillColor }]} />
        </View>
      )}
      {children}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  pillContainer: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 4,
  },
  pill: {
    width: 40,
    height: 5,
    borderRadius: 3,
  },
});

export default React.memo(SwipeableBottomDrawer);
