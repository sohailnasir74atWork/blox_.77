// PetSelectionRound.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Animated,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../../GlobelStats';
import { useLocalState } from '../../../LocalGlobelStats';
import { useHaptic } from '../../../Helper/HepticFeedBack';

const PetSelectionRound = ({ roomData, currentUser, onSelectPet, roomId }) => {
  const { theme, firestoreDB } = useGlobalState();
  const { localState } = useLocalState();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';

  const [selectedPet, setSelectedPet] = useState(null);
  const [timeLeft, setTimeLeft] = useState(60);
  const [isLocked, setIsLocked] = useState(false);
  const [hypeEmojis, setHypeEmojis] = useState([]);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Get pet data
  const petData = useMemo(() => {
    try {
      const rawData = localState.isGG ? localState.ggData : localState.data;
      if (!rawData) return [];

      const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      return typeof parsed === 'object' && parsed !== null ? Object.values(parsed) : [];
    } catch (error) {
      console.error('Error parsing pet data:', error);
      return [];
    }
  }, [localState.isGG, localState.data, localState.ggData]);

  // Get image URL helper
  const getImageUrl = useMemo(() => {
    const baseImgUrl = localState.isGG ? localState.imgurlGG : localState.imgurl;
    return (item) => {
      if (!item || !item.name) return '';
      
      if (localState.isGG) {
        const encoded = encodeURIComponent(item.name);
        return `${baseImgUrl?.replace(/"/g, '')}/items/${encoded}.webp`;
      }
      
      if (!item.image || !baseImgUrl) return '';
      return `${baseImgUrl.replace(/"/g, '').replace(/\/$/, '')}/${item.image.replace(/^\//, '')}`;
    };
  }, [localState.isGG, localState.imgurl, localState.imgurlGG]);

  // Filter valid pets
  const validPets = useMemo(() => {
    return petData.filter((pet) => pet.name && getImageUrl(pet));
  }, [petData, getImageUrl]);

  // Get current game data (single round)
  const userPick = roomData?.gameData?.picks?.[currentUser?.id];
  const allPicked = roomData?.gameData?.allPicked || false;
  const countdownEnd = roomData?.gameData?.countdownEnd || null;

  // Countdown timer
  useEffect(() => {
    if (!countdownEnd || allPicked) return;

    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((countdownEnd - Date.now()) / 1000));
      setTimeLeft(remaining);

      if (remaining === 0 && !isLocked) {
        setIsLocked(true);
        if (!userPick && selectedPet) {
          // Auto-submit if pet selected
          handleSelectPet(selectedPet);
        } else if (!userPick) {
          // Random pet if no selection
          const randomPet = validPets[Math.floor(Math.random() * validPets.length)];
          handleSelectPet(randomPet, true);
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, [countdownEnd, allPicked, isLocked, userPick, selectedPet, validPets]);

  // Pulse animation for urgent countdown
  useEffect(() => {
    if (timeLeft <= 5 && timeLeft > 0) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [timeLeft, pulseAnim]);

  // Check if user already picked
  useEffect(() => {
    if (userPick) {
      const pet = validPets.find((p) => p.name === userPick.petName);
      if (pet) {
        setSelectedPet(pet);
        setIsLocked(true);
      }
    }
  }, [userPick, validPets]);

  const handleSelectPet = (pet, isRandom = false) => {
    if (isLocked || userPick) return;

    setSelectedPet(pet);
    setIsLocked(true);
    triggerHapticFeedback('impactMedium');

    if (onSelectPet) {
      onSelectPet({
        petName: pet.name,
        petImage: getImageUrl(pet),
        isRandom,
        timestamp: Date.now(),
      });
    }
  };

  const handleHype = () => {
    const emojis = ['🎉', '🔥', '✨', '💫', '⭐', '🎊', '🚀'];
    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
    
    triggerHapticFeedback('impactLight');
    setHypeEmojis((prev) => [
      ...prev,
      {
        id: Date.now(),
        emoji: randomEmoji,
        x: Math.random() * 200,
        y: 0,
      },
    ]);

    // Remove emoji after animation
    setTimeout(() => {
      setHypeEmojis((prev) => prev.slice(1));
    }, 2000);
  };

  const waitingForOthers = allPicked === false && userPick && !isLocked;

  return (
    <View style={styles.container}>
      {/* Countdown Timer */}
      <View style={styles.countdownContainer}>
        <Animated.View
          style={[
            styles.countdownCircle,
            {
              transform: [{ scale: pulseAnim }],
              backgroundColor: timeLeft <= 5 ? '#EF4444' : timeLeft <= 10 ? '#F59E0B' : '#10B981',
            },
          ]}
        >
          <Text style={styles.countdownText}>{timeLeft}</Text>
        </Animated.View>
        <Text style={[styles.countdownLabel, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
          {isLocked ? 'Picks Locked!' : 'Seconds Left'}
        </Text>
      </View>

      {/* Status Message */}
      {waitingForOthers && (
        <View style={styles.waitingContainer}>
          <Text style={[styles.waitingText, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
            Waiting for others to pick...
          </Text>
          <TouchableOpacity style={styles.hypeButton} onPress={handleHype}>
            <Text style={styles.hypeButtonText}>Cheer 🎉</Text>
          </TouchableOpacity>
        </View>
      )}

      {!userPick && !isLocked && (
        <Text style={[styles.instructionText, { color: isDarkMode ? '#fff' : '#000' }]}>
          Choose your pet! {timeLeft <= 5 && '⏰ Hurry!'}
        </Text>
      )}

      {userPick && (
        <View style={styles.selectedContainer}>
          <Text style={[styles.selectedLabel, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
            Your Pick:
          </Text>
          <View style={styles.selectedPetCard}>
            <Image
              source={{ uri: userPick.petImage || getImageUrl(selectedPet) }}
              style={styles.selectedPetImage}
            />
            <Text style={[styles.selectedPetName, { color: isDarkMode ? '#fff' : '#000' }]}>
              {userPick.petName}
              {userPick.isRandom && ' (Random!)'}
            </Text>
          </View>
        </View>
      )}

      {/* Pet Grid - Optimized with limit */}
      {!userPick && !isLocked && (
        <View style={styles.petGridContainer}>
          <View style={styles.petGrid}>
            {validPets.slice(0, 100).map((item, index) => {
              const isSelected = selectedPet?.name === item.name;
              return (
                <TouchableOpacity
                  key={`${item.name}-${index}`}
                  style={[
                    styles.petCard,
                    isSelected && styles.petCardSelected,
                    { backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff' },
                  ]}
                  onPress={() => handleSelectPet(item)}
                  activeOpacity={0.7}
                >
                  <Image
                    source={{ uri: getImageUrl(item) }}
                    style={styles.petImage}
                    resizeMode="contain"
                    defaultSource={{ uri: 'https://bloxfruitscalc.com/wp-content/uploads/2025/placeholder.png' }}
                  />
                  <Text
                    style={[styles.petName, { color: isDarkMode ? '#fff' : '#000' }]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  {isSelected && (
                    <View style={styles.checkmark}>
                      <Icon name="checkmark-circle" size={18} color="#10B981" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* Hype Emojis */}
      {hypeEmojis.map((emoji) => (
        <Animated.View
          key={emoji.id}
          style={[
            styles.floatingEmoji,
            {
              left: emoji.x,
              top: emoji.y,
            },
          ]}
        >
          <Text style={styles.emojiText}>{emoji.emoji}</Text>
        </Animated.View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  countdownContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  countdownCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  countdownText: {
    fontSize: 32,
    fontFamily: 'Lato-Bold',
    color: '#fff',
  },
  countdownLabel: {
    fontSize: 14,
    fontFamily: 'Lato-Regular',
  },
  instructionText: {
    fontSize: 18,
    fontFamily: 'Lato-Bold',
    textAlign: 'center',
    marginBottom: 16,
  },
  waitingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    gap: 12,
  },
  waitingText: {
    fontSize: 14,
    fontFamily: 'Lato-Regular',
  },
  hypeButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#8B5CF6',
  },
  hypeButtonText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'Lato-Bold',
  },
  selectedContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  selectedLabel: {
    fontSize: 14,
    fontFamily: 'Lato-Regular',
    marginBottom: 8,
  },
  selectedPetCard: {
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
  },
  selectedPetImage: {
    width: 100,
    height: 100,
    marginBottom: 8,
  },
  selectedPetName: {
    fontSize: 16,
    fontFamily: 'Lato-Bold',
    textAlign: 'center',
  },
  petGridContainer: {
    flex: 1,
    maxHeight: 500,
  },
  petGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 4,
    justifyContent: 'flex-start',
  },
  petCard: {
    width: '31%',
    margin: '1%',
    padding: 8,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    minHeight: 100,
    position: 'relative',
  },
  petCardSelected: {
    borderColor: '#10B981',
    backgroundColor: '#d1fae5',
  },
  petImage: {
    width: 45,
    height: 45,
    marginBottom: 4,
  },
  petName: {
    fontSize: 9,
    fontFamily: 'Lato-Regular',
    textAlign: 'center',
  },
  checkmark: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: '#fff',
    borderRadius: 10,
  },
  floatingEmoji: {
    position: 'absolute',
  },
  emojiText: {
    fontSize: 24,
  },
});

export default PetSelectionRound;

