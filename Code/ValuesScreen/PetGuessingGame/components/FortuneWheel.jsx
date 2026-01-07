// FortuneWheel.jsx - Clean wheel using SVG for proper pie slices (UPDATED)
import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Animated,
  Image,
  Platform,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../../GlobelStats';
import { useHaptic } from '../../../Helper/HepticFeedBack';
import PetWinToast from './PetWinToast';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ✅ Force EVEN size to avoid half-pixel CENTER on Android
const RAW_SIZE = Math.min(SCREEN_WIDTH - 10, 350);
const WHEEL_SIZE = Math.floor(RAW_SIZE / 2) * 2;

// ✅ Format value with short suffixes (k, M, B, T, Q, etc.)
const formatValue = (value) => {
  const num = Number(value || 0);
  if (num >= 1_000_000_000_000_000) {
    return `${(num / 1_000_000_000_000_000).toFixed(1)}Q`; // Quadrillions
  } else if (num >= 1_000_000_000_000) {
    return `${(num / 1_000_000_000_000).toFixed(1)}T`; // Trillions
  } else if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(1)}B`; // Billions
  } else if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`; // Millions
  } else if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`; // Thousands
  } else {
    return num.toFixed(2); // Show 2 decimal places for values < 1000
  }
};

const CENTER = WHEEL_SIZE / 2;
const PADDING = 12; // inner padding for ring look
const RADIUS = CENTER - PADDING;

// Pointer + layout constants
const POINTER_W = 30;
const POINTER_H = 36;

// Center button
const CENTER_BTN_SIZE = 60;
const CENTER_BTN_R = CENTER_BTN_SIZE / 2;

// Fruit image box (even sizes => no 27.5px)
const PET_BOX = 56;
const PET_IMG = 52;

// Value pill size (even)
const PILL_W = 66;
const PILL_H = 26;

const FortuneWheel = ({
  wheelPets = [],
  onSpinEnd,
  onSpinStart,
  isMyTurn,
  isSpinning,
  currentPlayerName,
  disabled,
}) => {
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const { triggerHapticFeedback } = useHaptic();

  const spinValue = useRef(new Animated.Value(0)).current;

  const [winner, setWinner] = useState(null);
  const [hasSpun, setHasSpun] = useState(false);
  const [isSpinningLocal, setIsSpinningLocal] = useState(false);
  const [showWinToast, setShowWinToast] = useState(false);
  const [winToastData, setWinToastData] = useState(null);
  const previousTurnRef = useRef(false); // Track previous turn state

  // Detect when it becomes user's turn and trigger haptic feedback
  useEffect(() => {
    // Check if turn just changed from false to true (it's now my turn)
    if (isMyTurn && !previousTurnRef.current && !isSpinning && !isSpinningLocal) {
      triggerHapticFeedback('impactLight'); // Haptic when turn becomes active
      setWinner(null);
      setHasSpun(false);
    } else if (isMyTurn && !isSpinning && !isSpinningLocal) {
      setWinner(null);
      setHasSpun(false);
    }
    
    // Update previous turn state
    previousTurnRef.current = isMyTurn;
  }, [isMyTurn, isSpinning, isSpinningLocal, triggerHapticFeedback]);

  const colors = useMemo(() => {
    const baseColors = [
      '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#3B82F6',
      '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
    ];
    return (wheelPets || []).map((_, i) => baseColors[i % baseColors.length]);
  }, [wheelPets]);

  const segmentAngle = useMemo(() => 360 / wheelPets.length, [wheelPets.length]);

  // Helper function to create pie slice path (angles in degrees)
  const createPieSlicePath = (startAngle, endAngle, radius, cx, cy) => {
    const start = {
      x: cx + radius * Math.cos((startAngle * Math.PI) / 180),
      y: cy + radius * Math.sin((startAngle * Math.PI) / 180),
    };
    const end = {
      x: cx + radius * Math.cos((endAngle * Math.PI) / 180),
      y: cy + radius * Math.sin((endAngle * Math.PI) / 180),
    };

    const largeArc = endAngle - startAngle > 180 ? 1 : 0;

    return [
      `M ${cx} ${cy}`,
      `L ${start.x} ${start.y}`,
      `A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`,
      'Z',
    ].join(' ');
  };

  const handleSpinPress = useCallback(() => {
    if (!isMyTurn || isSpinning || disabled || hasSpun || isSpinningLocal || wheelPets.length === 0) return;

    triggerHapticFeedback('impactMedium'); // ✅ Haptic feedback when spin starts
    
    // Call onSpinStart callback if provided (to reset timeout)
    if (onSpinStart) {
      onSpinStart();
    }
    
    setIsSpinningLocal(true);
    setHasSpun(true);
    setWinner(null);

    const fullRotations = 4 + Math.random() * 2; // 4-6 rotations
    const randomExtra = Math.random() * 360;
    const totalRotation = fullRotations * 360 + randomExtra;

    spinValue.setValue(0);

    Animated.timing(spinValue, {
      toValue: totalRotation,
      duration: 3000,
      useNativeDriver: true,
      easing: (t) => 1 - Math.pow(1 - t, 3),
    }).start(() => {
      setIsSpinningLocal(false);

      // ✅ WINNER CALC (pointer at RIGHT side)
      // Our draw math uses: 0° = right, 90° = down, 180° = left, 270° = up.
      // Slice 0 starts at -90° (=270°). Pointer is at right => 0°.
      const normalizedRotation = ((totalRotation % 360) + 360) % 360;
      const pointerAngle = 0;
      const startAngle0 = 270;

      const wheelAngleAtPointer = (pointerAngle - normalizedRotation + 360) % 360;
      const relative = (wheelAngleAtPointer - startAngle0 + 360) % 360;

      const winnerIndex = Math.floor(relative / segmentAngle);
      const selectedPet = wheelPets[winnerIndex];

      setWinner(selectedPet);

      if (onSpinEnd && selectedPet) {
        triggerHapticFeedback('notificationSuccess'); // ✅ Haptic feedback when winner is determined
        // Show toast message with pet name and points (slides from right)
        setWinToastData({
          petName: selectedPet.name,
          petValue: selectedPet.value || 0,
          petImage: selectedPet.image,
        });
        setShowWinToast(true);

        onSpinEnd({
          petName: selectedPet.name,
          petValue: selectedPet.value || 0,
          petImage: selectedPet.image,
          petIndex: winnerIndex,
        });
      }
    });
  }, [
    isMyTurn,
    isSpinning,
    disabled,
    hasSpun,
    isSpinningLocal,
    wheelPets,
    onSpinEnd,
    spinValue,
    segmentAngle,
    triggerHapticFeedback,
  ]);

  const spinRotation = spinValue.interpolate({
    inputRange: [0, 360],
    outputRange: ['0deg', '360deg'],
  });

  if (!wheelPets || wheelPets.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
          No pets available for the wheel
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.turnIndicator, { backgroundColor: isDarkMode ? '#1e1e1e' : '#f3f4f6' }]}>
        <Text style={[styles.turnText, { color: isDarkMode ? '#fff' : '#111827' }]}>
          {isMyTurn ? '🎯 Your Turn!' : `⏳ ${currentPlayerName || 'Player'}'s Turn`}
        </Text>
      </View>

      {/* ✅ wrapper is wheel + pointer space (wheel anchored left, pointer anchored right) */}
      <View style={styles.wheelWrapper}>
        <View style={styles.wheelContainer}>
          {/* ✅ Clip area (rotating content inside) */}
          <View style={styles.wheelClip}>
            <Animated.View
              style={[styles.wheelSpinLayer, { transform: [{ rotate: spinRotation }] }]}
              renderToHardwareTextureAndroid
              shouldRasterizeIOS
            >
              {/* SVG slices */}
              <Svg width={WHEEL_SIZE} height={WHEEL_SIZE} viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}>
                {wheelPets.map((pet, index) => {
                  const startAngle = index * segmentAngle - 90;
                  const endAngle = (index + 1) * segmentAngle - 90;

                  return (
                    <Path
                      key={`slice-${index}`}
                      d={createPieSlicePath(startAngle, endAngle, RADIUS, CENTER, CENTER)}
                      fill={colors[index]}
                      stroke="#fff"
                      strokeWidth={2}
                    />
                  );
                })}
              </Svg>

              {/* Fruit images + value pills (aligned on slice center line) */}
              {wheelPets.map((pet, index) => {
                const startAngle = index * segmentAngle - 90;
                const midAngle = startAngle + segmentAngle / 2;
                const rad = (midAngle * Math.PI) / 180;

                const centerBlockR = CENTER_BTN_R + 10;

                const valueRadius = centerBlockR + (RADIUS - centerBlockR) * 0.48;
                const imageRadius = centerBlockR + (RADIUS - centerBlockR) * 0.78;

                const valueX = CENTER + valueRadius * Math.cos(rad);
                const valueY = CENTER + valueRadius * Math.sin(rad);

                const imageX = CENTER + imageRadius * Math.cos(rad);
                const imageY = CENTER + imageRadius * Math.sin(rad);

                // rotate pill along the radial direction, but keep readable
                const pillRotate = ((midAngle % 360) + 360) % 360;
                const pillRotateUpright = pillRotate > 90 && pillRotate < 270 ? pillRotate + 180 : pillRotate;

                return (
                  <React.Fragment key={`pet-${index}`}>
                    {/* Pet Image near outer edge */}
                    <View
                      style={[
                        styles.petImageContainer,
                        {
                          left: Math.round(imageX - PET_BOX / 2),
                          top: Math.round(imageY - PET_BOX / 2),
                        },
                      ]}
                    >
                      {pet.image ? (
                        <Image source={{ uri: pet.image }} style={styles.petImage} resizeMode="contain" />
                      ) : (
                        <View style={styles.petImagePlaceholder} />
                      )}
                    </View>

                    {/* Value pill mid slice */}
                    <View
                      style={[
                        styles.petValueContainer,
                        {
                          left: Math.round(valueX - PILL_W / 2),
                          top: Math.round(valueY - PILL_H / 2),
                          transform: [{ rotate: `${pillRotateUpright}deg` }],
                        },
                      ]}
                    >
                      <Text style={styles.petValue}>{formatValue(pet.value || 0)}</Text>
                    </View>
                  </React.Fragment>
                );
              })}
            </Animated.View>
          </View>

          {/* ✅ static outer ring (prevents Android uneven border while rotating) */}
          <View pointerEvents="none" style={styles.outerRing} />

          {/* ✅ center circle perfectly centered (no half-pixel) */}
          <View style={styles.centerCircle}>
            <Icon name="trophy" size={28} color="#F59E0B" />
          </View>
        </View>

        {/* Pointer (RIGHT side, points LEFT into wheel) */}
        <View style={styles.pointerContainer} pointerEvents="none">
          <View style={styles.pointerTriangle} />
        </View>
      </View>

      <TouchableOpacity
        style={[
          styles.spinButton,
          (!isMyTurn || disabled || hasSpun || isSpinningLocal) && styles.spinButtonDisabled,
          (isSpinning || isSpinningLocal) && styles.spinButtonSpinning,
        ]}
        onPress={handleSpinPress}
        onPressIn={() => {
          // Haptic feedback when button is pressed (becomes active)
          if (isMyTurn && !isSpinning && !disabled && !hasSpun && !isSpinningLocal) {
            triggerHapticFeedback('impactLight');
          }
        }}
        disabled={!isMyTurn || isSpinning || disabled || hasSpun || isSpinningLocal}
      >
        <Icon name={(isSpinning || isSpinningLocal) ? 'sync' : 'play-circle'} size={24} color="#fff" />
        <Text style={styles.spinButtonText}>
          {(isSpinning || isSpinningLocal)
            ? 'Spinning...'
            : isMyTurn
              ? (hasSpun ? 'Already Spun' : 'SPIN!')
              : 'Wait for your turn'}
        </Text>
      </TouchableOpacity>

      {/* Pet Win Toast */}
      <PetWinToast
        visible={showWinToast}
        petName={winToastData?.petName}
        petValue={winToastData?.petValue}
        petImage={winToastData?.petImage}
        onDismiss={() => {
          setShowWinToast(false);
          setWinToastData(null);
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: 8 },

  emptyContainer: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 16, fontFamily: 'Lato-Regular' },

  turnIndicator: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, marginBottom: 8 },
  turnText: { fontSize: 16, fontFamily: 'Lato-Bold', textAlign: 'center' },

  // wheel + pointer
  wheelWrapper: {
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
    position: 'relative',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  
  wheelContainer: {
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
    position: 'relative',
    backgroundColor: 'transparent',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8 },
      android: { elevation: 8 },
    }),
  },

  // clip area for rotating content
  wheelClip: {
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
    borderRadius: WHEEL_SIZE / 2,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },

  wheelSpinLayer: {
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
  },

  // static ring overlay (does not rotate)
  outerRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
    borderRadius: WHEEL_SIZE / 2,
    borderWidth: 6,
    borderColor: '#fff',
  },

  petImageContainer: {
    position: 'absolute',
    width: PET_BOX,
    height: PET_BOX,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  petImage: {
    width: PET_IMG,
    height: PET_IMG,
    borderRadius: 8,
  },
  petImagePlaceholder: {
    width: PET_IMG,
    height: PET_IMG,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },

  petValueContainer: {
    position: 'absolute',
    width: PILL_W,
    height: PILL_H,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 11,
  },
  petValue: {
    fontSize: 12,
    fontFamily: 'Lato-Bold',
    color: '#fff',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
    // backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
    minWidth: 58,
  },

  // perfect center (translate avoids half-pixel)
  centerCircle: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: CENTER_BTN_SIZE,
    height: CENTER_BTN_SIZE,
    borderRadius: CENTER_BTN_R,
    transform: [{ translateX: -CENTER_BTN_R }, { translateY: -CENTER_BTN_R }],
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#8B5CF6',
    zIndex: 20,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 },
      android: { elevation: 5 },
    }),
  },

  // pointer on the right edge of the wheel
  pointerContainer: {
    position: 'absolute',
    right: -POINTER_W + 2,   // ✅ stick outside the wheel without shifting it
    top: CENTER - POINTER_H / 2,
    width: POINTER_W,
    height: POINTER_H,
    alignItems: 'flex-start',
    justifyContent: 'center',
    zIndex: 100,
  },
  

  // ✅ LEFT-pointing triangle (color on borderRight)
  pointerTriangle: {
    width: 0,
    height: 0,
    borderTopWidth: POINTER_H / 2,
    borderBottomWidth: POINTER_H / 2,
    borderRightWidth: POINTER_W,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderRightColor: '#EF4444', // 🔴 Red pointer color
  },

  spinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8B5CF6',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 25,
    marginTop: 8,
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  spinButtonDisabled: { backgroundColor: '#6b7280', shadowOpacity: 0 },
  spinButtonSpinning: { backgroundColor: '#F59E0B' },
  spinButtonText: { color: '#fff', fontSize: 18, fontFamily: 'Lato-Bold', marginLeft: 8 },

  winnerCard: {
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 2,
    borderColor: '#10B981',
    minWidth: 200,
  },
  winnerLabel: { fontSize: 12, fontFamily: 'Lato-Regular', marginBottom: 4 },
  winnerImage: { width: 60, height: 60, marginBottom: 8, borderRadius: 8 },
  winnerName: { fontSize: 18, fontFamily: 'Lato-Bold', marginBottom: 4, textAlign: 'center' },
  winnerValue: { fontSize: 20, fontFamily: 'Lato-Bold', color: '#10B981' },
});

export default FortuneWheel;
