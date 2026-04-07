/**
 * GameHub.js
 * Central navigation screen for all mini games.
 * 4 active games: Fruit Smash, Crack the Chest, Fruit Slash, Memory Match
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../GlobelStats';
import config from '../Helper/Environment';
import { getThemeColors } from '../Helper/themeColors';
import GameLeaderboard from './GameLeaderboard';

const GAMES = [
  { id: 'spot',   emoji: '🍎', name: 'Fruit Smash',      desc: 'Smash the rotten fruits!', color: '#B91C1C' },
  { id: 'safe',   emoji: '🔐', name: 'Crack the Chest',   desc: 'Stop the dial!',           color: '#D97706' },
  { id: 'draw',   emoji: '⚡', name: 'Fruit Slash',       desc: 'Test your reflexes!',      color: '#DC2626' },
  { id: 'memory', emoji: '🃏', name: 'Memory Match',      desc: 'Find all the pairs!',      color: '#6366F1' },
];

const GameHub = ({ navigation }) => {
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  const c = getThemeColors(isDarkMode);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={{ fontSize: 32 }}>🎮</Text>
        <View style={{ marginLeft: 12, flex: 1 }}>
          <Text style={[styles.h1, { color: c.text }]}>Game Hub</Text>
          <Text style={[styles.sub, { color: c.textSecondary }]}>Play games & compete! 🏆</Text>
        </View>
      </View>

      {/* ── GAMES GRID ── */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 }}>
        <View>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Mini Games 🎯</Text>
          <Text style={[styles.sectionSub, { color: c.textSecondary, marginBottom: 0 }]}>Unlimited plays — beat your best!</Text>
        </View>
        <TouchableOpacity
          style={[styles.lbBtn, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#fff', borderColor: '#F59E0B' }]}
          onPress={() => setShowLeaderboard(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.lbBtnEmoji}>🏆</Text>
          <Text style={[styles.lbBtnText, { color: c.text }]}>Ranks</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.gameGrid}>
        {GAMES.map(game => (
          <TouchableOpacity
            key={game.id}
            style={[styles.gameCard, { backgroundColor: game.color }]}
            onPress={() => navigation.navigate('GameScreen', { gameId: game.id, title: `${game.emoji} ${game.name}`, color: game.color })}
            activeOpacity={0.85}
          >
            <Text style={styles.gameEmoji}>{game.emoji}</Text>
            <Text style={styles.gameName}>{game.name}</Text>
            <Text style={styles.gameInfo}>{game.desc}</Text>
            <View style={styles.gameTag}>
              <Text style={styles.gameTagText}>Unlimited</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <View style={[styles.tipCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#EFF6FF' }]}>
        <Icon name="information-circle" size={18} color="#4A7FB5" />
        <Text style={[styles.tipText, { color: c.textSecondary }]}>
          Your best scores are saved! Compete with friends! 🚀
        </Text>
      </View>

      {/* Leaderboard */}
      <GameLeaderboard visible={showLeaderboard} onClose={() => setShowLeaderboard(false)} />

    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollContent: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  h1: { fontSize: 26, fontWeight: '800' },
  sub: { fontSize: 12, marginTop: 2 },
  sectionTitle: { fontSize: 18, fontWeight: '800', marginBottom: 2 },
  sectionSub: { fontSize: 11, marginBottom: 14 },
  gameGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gameCard: {
    width: '47%', borderRadius: 18, padding: 14, alignItems: 'center', minHeight: 120, justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8 },
      android: { elevation: 5 },
    }),
  },
  gameEmoji: { fontSize: 32, marginBottom: 6 },
  gameName: { color: '#fff', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  gameInfo: { color: 'rgba(255,255,255,0.75)', fontSize: 9, marginTop: 2, textAlign: 'center' },
  gameTag: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginTop: 8 },
  gameTagText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  lbBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1, shadowColor: '#F59E0B', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 3 },
  lbBtnEmoji: { fontSize: 16 },
  lbBtnText: { fontSize: 13, fontWeight: '800' },
  tipCard: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderRadius: 14, marginTop: 16 },
  tipText: { fontSize: 11, flex: 1, lineHeight: 16 },
});

export default GameHub;
