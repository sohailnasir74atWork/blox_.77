import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../../GlobelStats';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 60) / 2;

const PlayerCards = ({ roomData, currentUserId }) => {
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';

  const players = useMemo(() => {
    if (!roomData?.players) return [];
    
    const playerOrder = roomData.gameData?.playerOrder || Object.keys(roomData.players);
    const scores = roomData.gameData?.scores || {};
    const spinHistory = roomData.gameData?.spinHistory || [];
    
    let playersList = playerOrder.map(playerId => {
      // Get player data - preserve even if player left (use stored data)
      const playerData = roomData.players[playerId] || {};
      
      // Get winning fruits for this player from spin history
      const winningFruits = spinHistory
        .filter(spin => spin.playerId === playerId && spin.petImage)
        .map(spin => ({
          name: spin.petName,
          image: spin.petImage,
          value: spin.petValue,
        }));
      
      return {
        id: playerId,
        displayName: playerData.displayName || 'Anonymous',
        avatar: playerData.avatar || null,
        score: scores[playerId] || 0,
        isHost: playerId === roomData.hostId,
        winningPets: winningFruits, // Keep prop name for compatibility
      };
    });
    
    // Always show current user's card on the left
    // Sort so current user is first
    const currentUserIndex = playersList.findIndex(p => p.id === currentUserId);
    if (currentUserIndex > 0) {
      const currentUser = playersList[currentUserIndex];
      playersList.splice(currentUserIndex, 1);
      playersList.unshift(currentUser);
    }
    
    return playersList;
  }, [roomData, currentUserId]);

  const currentTurnPlayerId = useMemo(() => {
    const playerOrder = roomData?.gameData?.playerOrder || [];
    const currentTurnIndex = roomData?.gameData?.currentTurnIndex || 0;
    return playerOrder[currentTurnIndex];
  }, [roomData]);

  const currentRound = roomData?.gameData?.currentRound || 1;
  const totalRounds = roomData?.gameData?.totalRounds || 3;

  // Determine winner if game is finished
  const winner = useMemo(() => {
    if (roomData?.status !== 'finished') return null;
    
    let maxScore = -1;
    let winnerId = null;
    
    players.forEach(player => {
      if (player.score > maxScore) {
        maxScore = player.score;
        winnerId = player.id;
      }
    });
    
    return winnerId;
  }, [roomData?.status, players]);

  return (
    <View style={styles.container}>
      {/* Round indicator */}
      <View style={[styles.roundIndicator, { backgroundColor: isDarkMode ? '#2a2a2a' : '#f3f4f6' }]}>
        <Text style={[styles.roundText, { color: isDarkMode ? '#fff' : '#000' }]}>
          Round {currentRound} of {totalRounds}
        </Text>
      </View>

      {/* Player cards */}
      <View style={styles.cardsContainer}>
        {players.map((player, index) => {
          const isCurrentTurn = player.id === currentTurnPlayerId && roomData?.status === 'playing';
          const isWinner = player.id === winner;
          const isMe = player.id === currentUserId;

          return (
            <View
              key={player.id}
              style={[
                styles.card,
                { backgroundColor: isDarkMode ? '#1e1e1e' : '#fff' },
                isCurrentTurn && styles.cardActive,
                isWinner && styles.cardWinner,
              ]}
            >
              {/* Turn/Winner indicator */}
              {isCurrentTurn && (
                <View style={styles.turnBadge}>
                  <Icon name="arrow-forward-circle" size={10} color="#fff" />
                  <Text style={styles.turnBadgeText}>Turn</Text>
                </View>
              )}
              {isWinner && (
                <View style={[styles.turnBadge, styles.winnerBadge]}>
                  <Icon name="trophy" size={10} color="#fff" />
                  <Text style={styles.turnBadgeText}>Winner!</Text>
                </View>
              )}

              {/* Left: Avatar with Host Badge */}
              <View style={styles.avatarContainer}>
                <Image
                  source={{
                    uri: player.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                  }}
                  style={styles.avatar}
                />
                {player.isHost && (
                  <View style={styles.hostBadge}>
                    <Text style={styles.hostBadgeText}>👑</Text>
                  </View>
                )}
              </View>

              {/* Center: Player Info */}
              <View style={styles.playerInfoContainer}>
                {/* Player Name */}
                <Text 
                  style={[styles.playerName, { color: isDarkMode ? '#fff' : '#000' }]}
                  numberOfLines={1}
                >
                  {player.displayName || 'Anonymous'}
                </Text>

                {/* Score */}
                <Text style={[styles.score, isWinner && styles.scoreWinner]}>
                  {Number(player.score || 0).toLocaleString()}
                </Text>

                {/* Winning Fruit Images */}
                {player.winningPets && player.winningPets.length > 0 && (
                  <View style={styles.petsContainer}>
                    {player.winningPets.map((fruit, fruitIndex) => (
                      <View key={fruitIndex} style={styles.petImageWrapper}>
                        <Image
                          source={{ uri: fruit.image }}
                          style={styles.petImage}
                          resizeMode="contain"
                        />
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 2,
  },
  roundIndicator: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 8,
  },
  roundText: {
    fontSize: 12,
    fontFamily: 'Lato-Bold',
  },
  cardsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    gap: 8,
  },
  card: {
    width: CARD_WIDTH,
    minHeight: 50,
    padding: 6,
    borderRadius: 14,
    // shadowColor: '#000',
    // shadowOffset: { width: 0, height: 2 },
    // shadowOpacity: 0.1,
    // shadowRadius: 4,
    // elevation: 3,
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  cardActive: {
    borderWidth: 1.5,
    borderColor: '#8B5CF6',
    shadowColor: '#8B5CF6',
    shadowOpacity: 0.25,
  },
  cardWinner: {
    borderWidth: 1.5,
    borderColor: '#F59E0B',
    shadowColor: '#F59E0B',
    shadowOpacity: 0.25,
  },
  turnBadge: {
    position: 'absolute',
    top: -6,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    zIndex: 10,
  },
  winnerBadge: {
    backgroundColor: '#F59E0B',
  },
  turnBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontFamily: 'Lato-Bold',
    marginLeft: 2,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 17.5,
    borderWidth: 2,
    borderColor: '#e5e7eb',
  },
  hostBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 8,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  hostBadgeText: {
    fontSize: 9,
    fontFamily: 'Lato-Regular',
  },
  playerInfoContainer: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  playerName: {
    fontSize: 11,
    fontFamily: 'Lato-Bold',
    textAlign: 'left',
    marginBottom: 2,
  },
  score: {
    fontSize: 14,
    fontFamily: 'Lato-Bold',
    color: '#10B981',
    marginBottom: 4,
  },
  scoreWinner: {
    color: '#F59E0B',
  },
  petsContainer: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    justifyContent: 'flex-start',
    alignItems: 'center',
    gap: 2,
    marginTop: 2,
  },
  petImageWrapper: {
    width: 16,
    height: 16,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#f3f4f6',
    borderWidth: 0.5,
    borderColor: '#e5e7eb',
  },
  petImage: {
    width: '100%',
    height: '100%',
  },
});

export default PlayerCards;
