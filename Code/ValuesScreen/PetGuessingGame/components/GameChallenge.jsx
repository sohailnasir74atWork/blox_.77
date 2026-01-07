// GameChallenge.jsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../../GlobelStats';
import { useLocalState } from '../../../LocalGlobelStats';
import { generateChallengeForRound } from '../utils/gameInviteSystem';

const GameChallenge = ({ roomData, currentUser, onAnswer, roomId }) => {
  const { theme, firestoreDB } = useGlobalState();
  const { localState } = useLocalState();
  const isDarkMode = theme === 'dark';

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

  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [challenge, setChallenge] = useState(null);

  // Generate or get current challenge from room data
  useEffect(() => {
    if (!roomData?.gameData || !petData.length) {
      setChallenge(null);
      setHasAnswered(false);
      setSelectedAnswer(null);
      return;
    }

    const currentRound = roomData.gameData.currentRound || 1;
    const challengeData = roomData.gameData.challenges?.[currentRound];

    // Reset state for new round first
    setHasAnswered(false);
    setSelectedAnswer(null);
    setChallenge(null);

    if (challengeData) {
      setChallenge(challengeData);
      // Check if user already answered this round
      const userAnswer = roomData.gameData.answers?.[currentRound]?.[currentUser?.id];
      if (userAnswer) {
        setHasAnswered(true);
        setSelectedAnswer(userAnswer.selectedAnswer);
      }
    } else {
      // Generate a new challenge if host
      if (roomData.hostId === currentUser?.id) {
        const newChallenge = generateChallenge(currentRound);
        if (newChallenge && firestoreDB) {
          setChallenge(newChallenge);
          // Save challenge to Firestore
          generateChallengeForRound(
            firestoreDB,
            roomId,
            currentUser.id,
            currentRound,
            newChallenge
          ).catch((error) => {
            console.error('Error saving challenge:', error);
          });
        }
      }
    }
  }, [roomData?.gameData?.currentRound, roomData?.gameData?.challenges, roomData?.gameData?.answers, roomData?.hostId, petData, currentUser?.id, firestoreDB, roomId, getImageUrl]);

  const generateChallenge = (round) => {
    if (!petData.length) return null;

    // Filter pets that have required fields
    const validPets = petData.filter(
      (pet) => pet.name && (pet.rarity || pet.type || pet.value)
    );

    if (validPets.length === 0) return null;

    // Pick a random pet
    const randomPet = validPets[Math.floor(Math.random() * validPets.length)];

    // Challenge types
    const challengeTypes = [
      {
        type: 'name',
        question: `What is the name of this pet?`,
        correctAnswer: randomPet.name,
        options: generateNameOptions(randomPet, validPets),
      },
      {
        type: 'rarity',
        question: `What is the rarity of ${randomPet.name}?`,
        correctAnswer: randomPet.rarity || 'Common',
        options: generateRarityOptions(randomPet.rarity),
      },
      {
        type: 'type',
        question: `What type is ${randomPet.name}?`,
        correctAnswer: randomPet.type || 'Pet',
        options: generateTypeOptions(randomPet.type, validPets),
      },
    ];

    // Pick random challenge type
    const selectedChallenge = challengeTypes[Math.floor(Math.random() * challengeTypes.length)];

    const challengeObj = {
      round,
      pet: randomPet,
      question: selectedChallenge.question,
      type: selectedChallenge.type,
      correctAnswer: selectedChallenge.correctAnswer,
      options: shuffleArray(selectedChallenge.options),
      imageUrl: getImageUrl(randomPet),
    };

    setChallenge(challengeObj);
    return challengeObj;
  };

  const generateNameOptions = (correctPet, allPets) => {
    const options = [correctPet.name];
    const otherPets = allPets.filter((p) => p.name !== correctPet.name);
    
    // Add 3 random wrong answers
    for (let i = 0; i < 3 && otherPets.length > 0; i++) {
      const randomIndex = Math.floor(Math.random() * otherPets.length);
      options.push(otherPets[randomIndex].name);
      otherPets.splice(randomIndex, 1);
    }
    
    return options;
  };

  const generateRarityOptions = (correctRarity) => {
    const rarities = ['Common', 'Uncommon', 'Rare', 'Ultra-Rare', 'Legendary', 'Mythic'];
    const options = [correctRarity || 'Common'];
    
    rarities.forEach((rarity) => {
      if (rarity !== correctRarity && options.length < 4) {
        options.push(rarity);
      }
    });
    
    return options;
  };

  const generateTypeOptions = (correctType, allPets) => {
    const types = [...new Set(allPets.map((p) => p.type).filter(Boolean))];
    const options = [correctType || 'Pet'];
    
    types.forEach((type) => {
      if (type !== correctType && options.length < 4) {
        options.push(type);
      }
    });
    
    return options;
  };

  const shuffleArray = (array) => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  const handleAnswer = (answer) => {
    if (hasAnswered || !challenge) return;

    setSelectedAnswer(answer);
    setHasAnswered(true);

    if (onAnswer) {
      onAnswer({
        round: challenge.round,
        answer,
        isCorrect: answer === challenge.correctAnswer,
        timestamp: Date.now(),
      });
    }
  };

  if (!challenge) {
    return (
      <View style={[styles.container, { backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff' }]}>
        <ActivityIndicator size="large" color="#8B5CF6" />
        <Text style={[styles.loadingText, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
          Loading challenge...
        </Text>
      </View>
    );
  }

  const isCorrect = selectedAnswer === challenge.correctAnswer;

  return (
    <View style={[styles.container, { backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff' }]}>
      <View style={styles.header}>
        <Text style={[styles.roundText, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
          Round {challenge.round} of {roomData?.gameData?.totalRounds || 5}
        </Text>
        {hasAnswered && (
          <View style={[styles.resultBadge, isCorrect ? styles.correctBadge : styles.wrongBadge]}>
            <Icon
              name={isCorrect ? 'checkmark-circle' : 'close-circle'}
              size={20}
              color="#fff"
            />
            <Text style={styles.resultText}>
              {isCorrect ? 'Correct!' : 'Wrong'}
            </Text>
          </View>
        )}
      </View>

      {challenge.type === 'name' && challenge.imageUrl && (
        <View style={styles.imageContainer}>
          <Image
            source={{ uri: challenge.imageUrl }}
            style={styles.petImage}
            resizeMode="contain"
          />
        </View>
      )}

      <Text style={[styles.question, { color: isDarkMode ? '#fff' : '#000' }]}>
        {challenge.question}
      </Text>

      <View style={styles.optionsContainer}>
        {challenge.options.map((option, index) => {
          const isSelected = selectedAnswer === option;
          const isCorrectOption = option === challenge.correctAnswer;
          const showResult = hasAnswered;

          let buttonStyle = styles.optionButton;
          let textStyle = { color: isDarkMode ? '#fff' : '#000' };

          if (showResult) {
            if (isSelected && isCorrectOption) {
              buttonStyle = [styles.optionButton, styles.correctOption];
              textStyle = { color: '#fff' };
            } else if (isSelected && !isCorrectOption) {
              buttonStyle = [styles.optionButton, styles.wrongOption];
              textStyle = { color: '#fff' };
            } else if (isCorrectOption) {
              buttonStyle = [styles.optionButton, styles.correctOption];
              textStyle = { color: '#fff' };
            }
          } else if (isSelected) {
            buttonStyle = [styles.optionButton, styles.selectedOption];
          }

          return (
            <TouchableOpacity
              key={index}
              style={buttonStyle}
              onPress={() => handleAnswer(option)}
              disabled={hasAnswered}
            >
              <Text style={[styles.optionText, textStyle]}>{option}</Text>
              {showResult && isCorrectOption && (
                <Icon name="checkmark-circle" size={20} color="#fff" style={styles.optionIcon} />
              )}
              {showResult && isSelected && !isCorrectOption && (
                <Icon name="close-circle" size={20} color="#fff" style={styles.optionIcon} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {hasAnswered && (
        <View style={styles.feedbackContainer}>
          <Text style={[styles.feedbackText, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
            {isCorrect
              ? '🎉 Great job! You got it right!'
              : `The correct answer is: ${challenge.correctAnswer}`}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  roundText: {
    fontSize: 14,
    fontFamily: 'Lato-Regular',
  },
  resultBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  correctBadge: {
    backgroundColor: '#10B981',
  },
  wrongBadge: {
    backgroundColor: '#EF4444',
  },
  resultText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'Lato-Bold',
    marginLeft: 4,
  },
  imageContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  petImage: {
    width: 150,
    height: 150,
    borderRadius: 12,
  },
  question: {
    fontSize: 18,
    fontFamily: 'Lato-Bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  optionsContainer: {
    gap: 12,
  },
  optionButton: {
    backgroundColor: '#f3f4f6',
    padding: 16,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectedOption: {
    backgroundColor: '#8B5CF6',
    borderColor: '#8B5CF6',
  },
  correctOption: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  wrongOption: {
    backgroundColor: '#EF4444',
    borderColor: '#EF4444',
  },
  optionText: {
    fontSize: 16,
    fontFamily: 'Lato-Regular',
    flex: 1,
  },
  optionIcon: {
    marginLeft: 8,
  },
  feedbackContainer: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
  },
  feedbackText: {
    fontSize: 14,
    fontFamily: 'Lato-Regular',
    textAlign: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    fontFamily: 'Lato-Regular',
    textAlign: 'center',
  },
});

export default GameChallenge;

