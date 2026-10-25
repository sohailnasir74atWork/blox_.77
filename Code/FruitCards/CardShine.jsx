/**
 * CardShine — makes a card feel physical. Drag to tilt it in 3D; the shine
 * and holo foil slide the other way; on release it springs back. Rare cards
 * also run a slow idle shimmer, so they look alive in screenshots and screen
 * recordings. Mega cards get the spinning rainbow wheel.
 *
 *   <CardShine width={w} height={w * 1.4} onTap={flip}>
 *     {(shine) => <FruitCard shine={shine} … />}
 *   </CardShine>
 *
 * Everything runs on the native driver (no Reanimated: removed for app size).
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, PanResponder } from 'react-native';

const clamp = (v) => Math.max(-1, Math.min(1, v));

export default function CardShine({
  width, height, interactive = true, idle = true, spin = false, onTap, children, style,
}) {
  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const idleV = useRef(new Animated.Value(-0.6)).current;
  const spinV = useRef(new Animated.Value(0)).current;
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;

  useEffect(() => {
    if (!idle) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(idleV, { toValue: 0.6, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(idleV, { toValue: -0.6, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [idle, idleV]);

  useEffect(() => {
    if (!spin) return undefined;
    const loop = Animated.loop(Animated.timing(spinV, { toValue: 1, duration: 7000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin, spinV]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => interactive || !!onTapRef.current,
    onMoveShouldSetPanResponder: (_, g) => interactive && (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4),
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => {
      if (!interactive) return;
      dragX.setValue(clamp(g.dx / (width * 0.45)));
      dragY.setValue(clamp(g.dy / (height * 0.45)));
    },
    onPanResponderRelease: (_, g) => {
      Animated.parallel([
        Animated.spring(dragX, { toValue: 0, friction: 5, tension: 60, useNativeDriver: true }),
        Animated.spring(dragY, { toValue: 0, friction: 5, tension: 60, useNativeDriver: true }),
      ]).start();
      if (Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6 && onTapRef.current) onTapRef.current();
    },
    onPanResponderTerminate: () => {
      dragX.setValue(0);
      dragY.setValue(0);
    },
  }), [interactive, width, height, dragX, dragY]);

  const shine = useMemo(() => ({
    x: Animated.add(dragX, idleV),
    y: dragY,
    spin: spinV.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }),
    // The finger alone (no idle drift): FruitCard moves its layers by this for depth.
    tilt: { x: dragX, y: dragY },
  }), [dragX, dragY, idleV, spinV]);

  const transform = [
    { perspective: 900 },
    { rotateX: dragY.interpolate({ inputRange: [-1, 1], outputRange: ['11deg', '-11deg'] }) },
    { rotateY: dragX.interpolate({ inputRange: [-1, 1], outputRange: ['-15deg', '15deg'] }) },
  ];

  return (
    <Animated.View {...pan.panHandlers} style={[{ width, height, transform }, style]}>
      {children(shine)}
    </Animated.View>
  );
}
