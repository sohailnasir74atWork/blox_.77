import React, { useRef, useEffect } from 'react';
import { Animated, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';

const BouncingCartIcon = () => {
  const bounceAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bounceAnim, {
          toValue: 1.2,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(bounceAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.delay(1400) // Pause for 1.4s before next bounce
      ])
    );
    loop.start();

    return () => loop.stop(); // Cleanup on unmount
  }, []);

  return (
    <Animated.View style={[styles.iconWrapper, { transform: [{ scale: bounceAnim }] }]}>
      <Icon name="cart" size={28} color="#8e44ad" />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  iconWrapper: {
    padding: 6,
  },
});

export default BouncingCartIcon;
