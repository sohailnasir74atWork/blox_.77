// PetGuessingGameScreen.jsx - Turn-based wheel spin game
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  AppState,
  Platform,
  Image,
  StatusBar,
  SafeAreaView,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { useLocalState } from '../../LocalGlobelStats';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { showSuccessMessage, showErrorMessage } from '../../Helper/MessageHelper';
import { useBackgroundMusic } from '../../Helper/useBackgroundMusic';
import { mixpanel } from '../../AppHelper/MixPenel';
import InterstitialAdManager from '../../Ads/IntAd';
import OnlineUsersList from '../../ChatScreen/GroupChat/OnlineUsersList';
import InviteNotification from './components/InviteNotification';
import PlayerCards from './components/PlayerCards';
import FortuneWheel from './components/FortuneWheel';
import GameResults from './components/GameResults';
import {
  createGameRoom,
  listenToGameRoom,
  leaveGameRoom,
  startGame,
  selectRandomFruits,
  recordSpinResult,
  setSpinningState,
  startWheelSpin,
  awardGameWin,
  endGameDueToTimeout,
  setTurnStartTime,
} from './utils/gameInviteSystem';

const PetGuessingGameScreen = () => {
  const { appdatabase, firestoreDB, theme, user, setIsInActiveGame } = useGlobalState();
  const { localState, updateLocalState } = useLocalState();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';

  const [currentRoomId, setCurrentRoomId] = useState(null);
  const [roomData, setRoomData] = useState(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [loading, setLoading] = useState(false);
  // ✅ Use persisted state from LocalGlobelStats.js (defaults to true)
  const musicEnabled = localState?.gameMusicEnabled ?? true;
  // ✅ Track pending invitations (temporary UI state, not in database)
  const [pendingInvites, setPendingInvites] = useState([]);
  const processedGameFinishRef = useRef(new Set()); // Track processed game finishes
  const gameEndAdShownRef = useRef(new Set()); // ✅ Track which games already showed an ad per player
  const timeoutCheckIntervalRef = useRef(null); // For timeout checking
  const TURN_TIMEOUT_MS = 60000; // 60 seconds timeout per turn

  // Play background music when game is active (room exists and game is in progress)
  const shouldPlayMusic = useMemo(() => {
    return currentRoomId && roomData && roomData.status !== 'finished';
  }, [currentRoomId, roomData]);

  // Background music - plays in loop when game is active
  // For react-native-sound on Android: use filename without extension (file is in res/raw/)
  // For iOS: use string filename with extension (file must be added to Xcode project bundle)
  useBackgroundMusic(
    Platform.OS === 'android' ? 'audio' : 'audio.mp3', // Android: no extension, iOS: with extension
    shouldPlayMusic && musicEnabled, // ✅ Respect sound toggle
    0.5 // Volume (0.0 to 1.0)
  );

  // Get fruit data from localState (all items are fruits)
  const fruitData = useMemo(() => {
    try {
      const rawData = localState.data;
      if (!rawData) return [];

      const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      const allItems = typeof parsed === 'object' && parsed !== null ? Object.values(parsed) : [];

      // All items are fruits in bloxfruitevalues
      return allItems;
    } catch (error) {
      console.error('Error parsing fruit data:', error);
      return [];
    }
  }, [localState.data]);

  // Get image URL helper for fruits
  const getImageUrl = useCallback((item) => {
    if (!item || !item.name) return '';

    const formatName = (name) => name.replace(/^\+/, '').replace(/\s+/g, '-');
    const fruitType = item.type === 'n' ? '09' : '08'; // 'n' for neon (09), 'd' or 'm' for default (08)
    return `https://bloxfruitscalc.com/wp-content/uploads/2024/${fruitType}/${formatName(item.name)}_Icon.webp`;
  }, []);

  // Listen to room updates
  useEffect(() => {
    if (!currentRoomId || !firestoreDB) return;

    const unsubscribe = listenToGameRoom(firestoreDB, currentRoomId, (data) => {
      setRoomData(data);

      // ✅ Clear pending invites when someone joins (player count increases)
      if (data && data.currentPlayers >= 2 && pendingInvites.length > 0) {
        setPendingInvites([]);
      }

      // ✅ Update global game state (for GlobalInviteToast)
      if (data && setIsInActiveGame) {
        setIsInActiveGame(data.status === 'playing');
      } else if (!data && setIsInActiveGame) {
        setIsInActiveGame(false);
      }

      if (!data) {
        // Room was deleted
        setCurrentRoomId(null);
        setRoomData(null);
        setPendingInvites([]); // ✅ Clear pending invites when room is deleted
        if (setIsInActiveGame) {
          setIsInActiveGame(false);
        }
        return;
      }

      // ✅ Show interstitial ad at the end of every game for this player (both winner & loser),
      //    as long as they're not Pro. Uses in‑memory ref only (no local storage).
      //    Delay ad by 2 seconds so user can see the result screen first
      // Game end ad removed

      // Handle game finished due to timeout or player leaving
      if (data.status === 'finished' && data.gameData?.timeoutReason) {
        const gameId = data.id || currentRoomId;

        // Only process once per timeout finish
        if (!processedGameFinishRef.current.has(`timeout-${gameId}`)) {
          processedGameFinishRef.current.add(`timeout-${gameId}`);

          // Show timeout message
          const timeoutReason = data.gameData.timeoutReason;
          showErrorMessage(
            'Game Ended',
            timeoutReason || 'A player timed out or left the game'
          );

          // Clear room and return to create game screen after 2 seconds
          setTimeout(() => {
            setCurrentRoomId(null);
            setRoomData(null);
            if (setIsInActiveGame) {
              setIsInActiveGame(false);
            }
          }, 2000);
        }
        return;
      }

      // Award points when game finishes normally and user is winner
      if (data.status === 'finished' && data.gameData?.winner && user?.id && appdatabase) {
        const winnerId = data.gameData.winner.playerId;
        const gameId = data.id || currentRoomId;

        // Only process once per game finish
        if (winnerId === user.id && !processedGameFinishRef.current.has(gameId)) {
          processedGameFinishRef.current.add(gameId);

          awardGameWin(appdatabase, firestoreDB, user.id)
            .then((result) => {
              if (result) {
                // Track game win in Mixpanel
                mixpanel.track('Game Won', {
                  gameType: 'Fruit Guessing Game',
                  roomId: gameId,
                  pointsAwarded: 100,
                  totalPoints: result.points,
                  totalWins: result.wins,
                  winnerScore: data.gameData?.winner?.score || 0,
                });
                // ✅ Simple victory toast (ad is handled separately for all players)
                showSuccessMessage(
                  'Victory! 🎉',
                  `You won! +100 points! Total: ${result.points} points, Wins: ${result.wins}`
                );
              }
            })
            .catch((error) => {
              console.error('Error awarding game win:', error);
            });
        }
      }
    });

    return () => {
      unsubscribe();
      // ✅ Reset game state when unmounting
      if (setIsInActiveGame) {
        setIsInActiveGame(false);
      }
    };
  }, [currentRoomId, firestoreDB, user?.id, appdatabase, setIsInActiveGame, pendingInvites.length]);

  // Handle creating a new room with 8 random fruits
  const handleCreateRoom = useCallback(async () => {
    if (!user?.id) {
      showErrorMessage('Error', 'Please login to create a game room');
      return;
    }

    if (fruitData.length < 10) {
      showErrorMessage('Error', 'Not enough fruits available. Need at least 10 fruits.');
      return;
    }

    setLoading(true);
    triggerHapticFeedback('impactLight');

    try {
      // Select 8 random fruits with images from the same value slab
      const selectedFruits = selectRandomFruits(fruitData, 8).map(fruit => ({
        ...fruit,
        image: getImageUrl(fruit),
      }));

      if (selectedFruits.length < 8) {
        showErrorMessage('Error', 'Could not select enough fruits');
        setLoading(false);
        return;
      }

      const roomId = await createGameRoom(
        firestoreDB,
        {
          id: user.id,
          displayName: user.displayName || 'Anonymous',
          avatar: user.avatar || null,
        },
        selectedFruits,
        2 // max 2 players
      );

      if (roomId) {
        setCurrentRoomId(roomId);
        // showSuccessMessage('Room Created!', '8 random fruits selected. Invite a friend to play!');
        setShowInviteModal(true);
      } else {
        showErrorMessage('Error', 'Failed to create room');
      }
    } catch (error) {
      console.error('Error creating room:', error);
      showErrorMessage('Error', 'Failed to create room');
    } finally {
      setLoading(false);
    }
  }, [user, firestoreDB, fruitData, getImageUrl, triggerHapticFeedback]);

  // Handle leaving room
  const handleLeaveRoom = useCallback(async () => {
    if (!currentRoomId || !user?.id) return;

    triggerHapticFeedback('impactLight');
    const success = await leaveGameRoom(firestoreDB, currentRoomId, user.id);

    if (success) {
      setCurrentRoomId(null);
      setRoomData(null);
      setPendingInvites([]); // ✅ Clear pending invites when leaving
      if (setIsInActiveGame) {
        setIsInActiveGame(false);
      }
      // showSuccessMessage('Left Room', 'You left the game room');
    }
  }, [currentRoomId, user?.id, firestoreDB, triggerHapticFeedback]);

  // Handle joining room from invite
  const handleJoinRoom = useCallback((roomId) => {
    setCurrentRoomId(roomId);
    setShowInviteModal(false);
    setPendingInvites([]); // ✅ Clear pending invites when joining
  }, []);

  // ✅ Handle when an invite is sent (callback from InviteUsersModal)
  const handleInviteSent = useCallback((invitedUser) => {
    if (!invitedUser || !invitedUser.id) {
      return;
    }

    const now = Date.now();
    const expiresAt = now + 60000; // 1 minute expiry

    setPendingInvites((prev) => {
      // Check if this user is already in the list (avoid duplicates)
      const exists = prev.some(inv => inv.userId === invitedUser.id);
      if (exists) {
        return prev;
      }

      return [
        ...prev,
        {
          userId: invitedUser.id,
          displayName: invitedUser.displayName || 'Anonymous',
          avatar: invitedUser.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
          sentAt: now,
          expiresAt: expiresAt,
        },
      ];
    });
  }, []);

  // ✅ Clean up expired invites and update progress
  useEffect(() => {
    if (pendingInvites.length === 0) return;

    const interval = setInterval(() => {
      const now = Date.now();
      setPendingInvites((prev) => {
        // Remove expired invites
        const active = prev.filter((invite) => now < invite.expiresAt);
        return active;
      });
    }, 1000); // Update every second

    return () => clearInterval(interval);
  }, [pendingInvites.length]);

  // Handle starting the game
  const handleStartGame = useCallback(async () => {
    if (!currentRoomId || !user?.id || !roomData) return;

    if (roomData.hostId !== user.id) {
      showErrorMessage('Error', 'Only the host can start the game');
      return;
    }

    if (roomData.currentPlayers < 2) {
      showErrorMessage('Error', 'Need 2 players to start');
      return;
    }

    setLoading(true);
    triggerHapticFeedback('impactMedium');

    try {
      const success = await startGame(firestoreDB, currentRoomId, user.id);

      if (success) {
        // Track game start in Mixpanel
        mixpanel.track('Game Started', {
          gameType: 'Fruit Guessing Game',
          roomId: currentRoomId,
          playerCount: roomData?.currentPlayers || 0,
        });
        showSuccessMessage('Game Started!', 'Take turns spinning the wheel!');
      } else {
        showErrorMessage('Error', 'Failed to start game');
      }
    } catch (error) {
      console.error('Error starting game:', error);
      showErrorMessage('Error', 'Failed to start game');
    } finally {
      setLoading(false);
    }
  }, [currentRoomId, user?.id, roomData, firestoreDB, triggerHapticFeedback]);

  // Handle wheel spin start - reset timeout
  const handleSpinStart = useCallback(async () => {
    if (!currentRoomId || !firestoreDB) return;

    try {
      // Reset the turn start time when spin begins
      await setTurnStartTime(firestoreDB, currentRoomId);
    } catch (error) {
      console.error('Error resetting turn start time:', error);
    }
  }, [currentRoomId, firestoreDB]);

  // Handle wheel spin completion
  const handleSpinEnd = useCallback(async (result) => {
    if (!currentRoomId || !user?.id) return;

    triggerHapticFeedback('notificationSuccess');

    try {
      const success = await recordSpinResult(firestoreDB, currentRoomId, user.id, result);

      if (!success) {
        showErrorMessage('Error', 'Failed to record spin result');
      }
    } catch (error) {
      console.error('Error recording spin:', error);
    }
  }, [currentRoomId, user?.id, firestoreDB, triggerHapticFeedback]);

  // Check if it's current user's turn
  const isMyTurn = useMemo(() => {
    if (!roomData || roomData.status !== 'playing' || !user?.id) return false;

    const playerOrder = roomData.gameData?.playerOrder || [];
    const currentTurnIndex = roomData.gameData?.currentTurnIndex || 0;

    return playerOrder[currentTurnIndex] === user.id;
  }, [roomData, user?.id]);

  // Get current player name for display
  const currentPlayerName = useMemo(() => {
    if (!roomData || roomData.status !== 'playing') return '';

    const playerOrder = roomData.gameData?.playerOrder || [];
    const currentTurnIndex = roomData.gameData?.currentTurnIndex || 0;
    const currentPlayerId = playerOrder[currentTurnIndex];

    return roomData.players?.[currentPlayerId]?.displayName || 'Player';
  }, [roomData]);

  // Check for turn timeout and skip if needed
  const checkTurnTimeout = useCallback(async () => {
    if (!roomData || roomData.status !== 'playing' || !firestoreDB || !currentRoomId) return;

    const gameData = roomData.gameData || {};
    const playerOrder = gameData.playerOrder || [];
    const currentTurnIndex = gameData.currentTurnIndex || 0;
    const currentPlayerId = playerOrder[currentTurnIndex];
    const turnStartTime = gameData.turnStartTime;

    if (!currentPlayerId || !turnStartTime) return;

    // Convert Firestore timestamp to milliseconds
    let turnStartMs = 0;
    if (turnStartTime?.toDate) {
      turnStartMs = turnStartTime.toDate().getTime();
    } else if (turnStartTime?.seconds) {
      turnStartMs = turnStartTime.seconds * 1000 + Math.floor((turnStartTime.nanoseconds || 0) / 1e6);
    } else if (typeof turnStartTime === 'number') {
      turnStartMs = turnStartTime;
    }

    if (turnStartMs === 0) return;

    const now = Date.now();
    const elapsed = now - turnStartMs;

    // If timeout exceeded, end the game
    if (elapsed > TURN_TIMEOUT_MS) {
      // console.log(`Turn timeout exceeded for player ${currentPlayerId}, ending game...`);
      await endGameDueToTimeout(firestoreDB, currentRoomId, currentPlayerId, 'timeout');
    }
  }, [roomData, firestoreDB, currentRoomId]);

  // Set up timeout checking interval
  useEffect(() => {
    if (roomData?.status === 'playing' && !roomData.gameData?.isSpinning) {
      // Check timeout every 5 seconds
      timeoutCheckIntervalRef.current = setInterval(() => {
        checkTurnTimeout();
      }, 5000);

      return () => {
        if (timeoutCheckIntervalRef.current) {
          clearInterval(timeoutCheckIntervalRef.current);
          timeoutCheckIntervalRef.current = null;
        }
      };
    } else {
      if (timeoutCheckIntervalRef.current) {
        clearInterval(timeoutCheckIntervalRef.current);
        timeoutCheckIntervalRef.current = null;
      }
    }
  }, [roomData?.status, roomData?.gameData?.isSpinning, checkTurnTimeout]);

  // Handle app state changes (background/foreground)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      // If app goes to background and it's the user's turn, end the game
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        if (isMyTurn && roomData?.status === 'playing' && firestoreDB && currentRoomId && user?.id) {
          // console.log('App went to background during user turn, ending game...');
          await endGameDueToTimeout(firestoreDB, currentRoomId, user.id, 'left');
        }
      }
    });

    return () => {
      subscription?.remove();
    };
  }, [isMyTurn, roomData?.status, firestoreDB, currentRoomId, user?.id]);

  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  const containerBgColor = isDarkMode ? '#0f172a' : '#f2f2f7';

  return (
    <>
      <StatusBar
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
        backgroundColor={containerBgColor}
        translucent={false}
      />
      <SafeAreaView style={{ flex: 1, backgroundColor: containerBgColor }}>
        <View style={[styles.container, { backgroundColor: containerBgColor }]}>
          <ScrollView
            style={[styles.container, { backgroundColor: containerBgColor }]}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            {!currentRoomId && <View style={styles.header}>
              <Text style={styles.title}>🎡 Fruit Wheel Spin</Text>
              <Text style={styles.subtitle}>
                Spin the wheel and collect fruit values! 3 rounds, highest score wins!
              </Text>
            </View>}

            {!currentRoomId ? (
              // No room - Show create button and instructions
              <View style={styles.section}>
                <TouchableOpacity
                  style={styles.button}
                  onPress={handleCreateRoom}
                  disabled={loading || !user?.id}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Icon name="add-circle-outline" size={24} color="#fff" />
                      <Text style={styles.buttonText}>
                        {user?.id ? 'Create Game' : 'Login to Play'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                <View style={styles.card}>
                  <Text style={styles.cardTitle}>🎮 How to Play</Text>
                  {/* Roulette illustration */}
                  <View style={styles.rouletteImageWrapper}>
                    <Image
                      source={require('../../../assets/roulette.png')}
                      style={styles.rouletteImage}
                      resizeMode="contain"
                    />
                  </View>
                  <Text style={styles.cardText}>
                    • Create a room (8 random fruits are selected){'\n'}
                    • Invite 1 friend to join{'\n'}
                    • Take turns spinning the wheel{'\n'}
                    • The fruit's value = your points{'\n'}
                    • 3 rounds each, highest total wins!{'\n'}
                    {'\n'}
                  </Text>
                  <Text style={[styles.cardText, { fontWeight: 'bold', color: isDarkMode ? '#10B981' : '#059669', marginTop: 8 }]}>
                    🏆 Win the game and earn 100 points!
                  </Text>
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardTitle}>🏆 Game Rules</Text>
                  <Text style={styles.cardText}>
                    • 2 players only{'\n'}
                    • Each player spins once per round{'\n'}
                    • Fruit value is added to your score{'\n'}
                    • After 3 rounds, highest score wins!
                  </Text>
                </View>
              </View>
            ) : roomData ? (
              // In a room
              <View style={styles.section}>
                {/* Action buttons - Top Right */}
                <View style={styles.actionRow}>
                  {/* Music toggle */}
                  <TouchableOpacity
                    style={styles.iconButton}
                    onPress={() => {
                      const newValue = !musicEnabled;
                      updateLocalState('gameMusicEnabled', newValue);
                      triggerHapticFeedback('impactLight');
                    }}
                  >
                    <Icon
                      name={musicEnabled ? 'volume-high-outline' : 'volume-mute-outline'}
                      size={16}
                      color="#fff"
                    />
                  </TouchableOpacity>

                  {/* Hide invite button when 2 players have joined */}
                  {roomData.status === 'waiting' && roomData.currentPlayers < 2 && (
                    <TouchableOpacity
                      style={styles.iconButton}
                      onPress={() => setShowInviteModal(true)}
                    >
                      <Icon name="person-add-outline" size={16} color="#fff" />
                    </TouchableOpacity>
                  )}
                  {roomData.status !== 'playing' && (
                    <TouchableOpacity
                      style={[styles.iconButton, styles.leaveButton]}
                      onPress={handleLeaveRoom}
                    >
                      <Icon name="exit-outline" size={16} color="#fff" />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Player Cards - Always show */}
                <PlayerCards
                  roomData={roomData}
                  currentUserId={user?.id}
                />

                {/* Game states */}
                {roomData.status === 'waiting' && (
                  <View style={styles.waitingCard}>
                    {roomData.currentPlayers < 2 ? (
                      <>
                        <Text style={styles.waitingText}>
                          ⏳ Waiting for 1 more player...
                        </Text>
                        <Text style={styles.waitingSubtext}>
                          Players: {roomData.currentPlayers}/2
                        </Text>
                      </>
                    ) : roomData.hostId === user?.id ? (
                      <>
                        <Text style={styles.waitingText}>
                          ✅ Ready to start!
                        </Text>
                        <Text style={styles.waitingSubtext}>
                          Players: {roomData.currentPlayers}/2
                        </Text>
                        <TouchableOpacity
                          style={styles.startGameButton}
                          onPress={handleStartGame}
                          disabled={loading}
                        >
                          {loading ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <>
                              <Icon name="play-circle" size={24} color="#fff" />
                              <Text style={styles.startGameButtonText}>
                                Start
                              </Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </>
                    ) : (
                      <>
                        <Text style={styles.waitingText}>
                          ⏳ Waiting for host to start...
                        </Text>
                        <Text style={styles.waitingSubtext}>
                          Players: {roomData.currentPlayers}/2
                        </Text>
                      </>
                    )}
                  </View>
                )}

                {/* ✅ Pending Invitations List - Show below waiting card */}
                {roomData.status === 'waiting' && pendingInvites.length > 0 && (
                  <View style={styles.pendingInvitesContainer}>
                    <Text style={styles.pendingInvitesTitle}>
                      Pending Invitations ({pendingInvites.length})
                    </Text>
                    {pendingInvites.map((invite, index) => {
                      const now = Date.now();
                      const timeRemaining = Math.max(0, invite.expiresAt - now);
                      const progress = Math.max(0, Math.min(1, timeRemaining / 60000)); // 0 to 1 (1 minute)
                      const secondsRemaining = Math.ceil(timeRemaining / 1000);
                      const isLastItem = index === pendingInvites.length - 1;

                      return (
                        <View
                          key={invite.userId}
                          style={[
                            styles.pendingInviteItem,
                            isLastItem && styles.pendingInviteItemLast,
                          ]}
                        >
                          <Image
                            source={{
                              uri: invite.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                            }}
                            style={styles.pendingInviteAvatar}
                          />
                          <View style={styles.pendingInviteInfo}>
                            <Text style={styles.pendingInviteName} numberOfLines={1}>
                              {invite.displayName}
                            </Text>
                            <View style={styles.progressBarContainer}>
                              <View
                                style={[
                                  styles.progressBar,
                                  {
                                    width: `${progress * 100}%`,
                                    backgroundColor: progress > 0.3 ? '#10B981' : progress > 0.1 ? '#F59E0B' : '#EF4444',
                                  },
                                ]}
                              />
                            </View>
                            <Text style={styles.progressBarText}>
                              {secondsRemaining > 0 ? `${secondsRemaining}s remaining` : 'Expired'}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}

                {roomData.status === 'playing' && roomData.wheelPets && (
                  <FortuneWheel
                    wheelPets={roomData.wheelPets}
                    onSpinEnd={handleSpinEnd}
                    onSpinStart={handleSpinStart}
                    isMyTurn={isMyTurn}
                    isSpinning={roomData.gameData?.isSpinning || false}
                    currentPlayerName={currentPlayerName}
                    disabled={false}
                  />
                )}

                {roomData.status === 'finished' && (
                  <View style={styles.finishedCard}>
                    <Text style={styles.finishedTitle}>🏆 Game Over!</Text>
                    <GameResults
                      roomData={roomData}
                      currentUser={{
                        id: user?.id,
                        displayName: user?.displayName || 'Anonymous',
                      }}
                    />
                    <TouchableOpacity
                      style={[styles.button, { marginTop: 16 }]}
                      onPress={handleLeaveRoom}
                    >
                      <Icon name="refresh-outline" size={20} color="#fff" />
                      <Text style={styles.buttonText}>Play Again</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#8B5CF6" />
                <Text style={styles.loadingText}>Loading room...</Text>
              </View>
            )}
          </ScrollView>

          {/* Invite Modal - Using shared OnlineUsersList component */}
          {currentRoomId && (
            <OnlineUsersList
              visible={showInviteModal}
              onClose={() => {
                setShowInviteModal(false);
                // ✅ Don't clear pending invites when modal closes - keep them visible
              }}
              mode="gameInvite"
              roomId={currentRoomId}
              onInviteSent={handleInviteSent} // ✅ Callback when invite is sent
            />
          )}

          {/* Incoming Invite Notifications */}
          {user?.id && (
            <InviteNotification
              currentUser={{
                id: user.id,
                displayName: user.displayName || 'Anonymous',
                avatar: user.avatar || null,
              }}
              onAccept={handleJoinRoom}
              isInActiveGame={roomData?.status === 'playing'}
            />
          )}
        </View>
      </SafeAreaView>
    </>
  );
};

const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? '#0f172a' : '#f2f2f7',
    },
    scrollContent: {
      padding: 8,
    },
    header: {
      marginTop: 40,
      marginBottom: 20,
    },
    title: {
      fontSize: 28,
      fontWeight: 'bold',
      color: isDarkMode ? '#fff' : '#000',
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 14,

      color: isDarkMode ? '#9ca3af' : '#6b7280',
    },
    section: {
      marginBottom: 20,
      justifyContent: 'center'
    },
    button: {
      backgroundColor: '#8B5CF6',
      paddingVertical: 14,
      paddingHorizontal: 24,
      borderRadius: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    buttonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: 'bold',
      marginLeft: 8,
    },
    card: {
      backgroundColor: isDarkMode ? '#1e1e1e' : '#fff',
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: isDarkMode ? '#333' : '#e5e7eb',
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: 'bold',
      color: isDarkMode ? '#fff' : '#000',
      marginBottom: 8,
    },
    cardText: {
      fontSize: 14,

      color: isDarkMode ? '#9ca3af' : '#6b7280',
      lineHeight: 22,
    },
    rouletteImageWrapper: {
      alignItems: 'center',
      marginBottom: 12,
    },
    rouletteImage: {
      width: '100%',
      height: 140,
      borderRadius: 12,
    },
    actionRow: {
      // position: 'absolute',
      // top: 8,
      // right: 8,
      flexDirection: 'row',
      gap: 8,
      // zIndex: 10,
      justifyContent: 'flex-end'
    },
    iconButton: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: '#8B5CF6',
      alignItems: 'center',
      justifyContent: 'center',
    },
    leaveButton: {
      backgroundColor: '#EF4444',
    },
    startButton: {
      backgroundColor: '#10B981',
    },
    waitingCard: {
      backgroundColor: isDarkMode ? '#1e1e1e' : '#fff',
      borderRadius: 12,
      padding: 24,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: isDarkMode ? '#333' : '#e5e7eb',
      marginTop: 8,
    },
    waitingText: {
      fontSize: 16,
      fontWeight: 'bold',
      color: isDarkMode ? '#fff' : '#000',
      textAlign: 'center',
      marginBottom: 8,
    },
    waitingSubtext: {
      fontSize: 14,

      color: isDarkMode ? '#9ca3af' : '#6b7280',
      marginBottom: 12,
    },
    startGameButton: {
      backgroundColor: '#10B981',
      paddingVertical: 12,
      paddingHorizontal: 32,
      borderRadius: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 8,
    },
    startGameButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: 'bold',
      marginLeft: 8,
    },
    finishedCard: {
      backgroundColor: isDarkMode ? '#1e1e1e' : '#fff',
      borderRadius: 12,
      padding: 24,
      alignItems: 'center',
      borderWidth: 2,
      borderColor: '#F59E0B',
      marginTop: 8,
    },
    finishedTitle: {
      fontSize: 24,
      fontWeight: 'bold',
      color: '#F59E0B',
      marginBottom: 16,
    },
    loadingContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 60,
    },
    loadingText: {
      marginTop: 12,
      fontSize: 14,

      color: isDarkMode ? '#9ca3af' : '#6b7280',
    },
    pendingInvitesContainer: {
      backgroundColor: isDarkMode ? '#1e1e1e' : '#fff',
      borderRadius: 12,
      padding: 16,
      marginTop: 12,
      borderWidth: 1,
      borderColor: isDarkMode ? '#333' : '#e5e7eb',
    },
    pendingInvitesTitle: {
      fontSize: 14,
      fontWeight: 'bold',
      color: isDarkMode ? '#fff' : '#000',
      marginBottom: 12,
    },
    pendingInviteItem: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: isDarkMode ? '#333' : '#e5e7eb',
    },
    pendingInviteItemLast: {
      marginBottom: 0,
      paddingBottom: 0,
      borderBottomWidth: 0,
    },
    pendingInviteAvatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      marginRight: 12,
      backgroundColor: isDarkMode ? '#333' : '#e5e7eb',
    },
    pendingInviteInfo: {
      flex: 1,
    },
    pendingInviteName: {
      fontSize: 14,
      fontWeight: 'bold',
      color: isDarkMode ? '#fff' : '#000',
      marginBottom: 6,
    },
    progressBarContainer: {
      height: 6,
      backgroundColor: isDarkMode ? '#333' : '#e5e7eb',
      borderRadius: 3,
      overflow: 'hidden',
      marginBottom: 4,
    },
    progressBar: {
      height: '100%',
      borderRadius: 3,
      transition: 'width 0.3s ease',
    },
    progressBarText: {
      fontSize: 11,

      color: isDarkMode ? '#9ca3af' : '#6b7280',
    },
  });

export default PetGuessingGameScreen;
