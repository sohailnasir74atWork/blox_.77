/**
 * GameActivityBanner.js
 * Top-level notification banner shown on any screen when daily games are available.
 * Checks Firestore games/{uid} for last play timestamps and shows a slide-in banner
 * for the first available game: Quiz → Spin.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Platform,
} from 'react-native';
import { useGlobalState } from '../GlobelStats';
import { doc, getDoc } from '@react-native-firebase/firestore';

// ── Game config ──
const GAMES = [
  { key: 'quiz',   emoji: '🧠', label: 'Daily Blox Quiz ready!',   color: '#8B5CF6', field: 'lastQuizAt' },
  { key: 'spin',   emoji: '🎡', label: 'Free spin available!',     color: '#F59E0B', field: 'lastSpinAt' },
];

const isSameDay = (timestamp) => {
  if (!timestamp) return false;
  const d = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
};

const GameActivityBanner = () => {
  const { firestoreDB, user, theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const [bannerData, setBannerData] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const slideAnim = useRef(new Animated.Value(-100)).current;
  const hasShownRef = useRef(false);

  const checkGames = useCallback(async () => {
    if (!firestoreDB || !user?.id || hasShownRef.current) return;

    try {
      const snap = await getDoc(doc(firestoreDB, 'games', user.id));
      const data = snap.exists ? snap.data() : {};

      for (const game of GAMES) {
        const lastPlay = data[game.field];
        if (!isSameDay(lastPlay)) {
          setBannerData(game);
          hasShownRef.current = true;
          return;
        }
      }
    } catch (err) {
      console.warn('[GameBanner] check failed:', err?.message);
    }
  }, [firestoreDB, user?.id]);

  useEffect(() => {
    if (!firestoreDB || !user?.id) return;
    const timer = setTimeout(checkGames, 3000);
    return () => clearTimeout(timer);
  }, [firestoreDB, user?.id, checkGames]);

  useEffect(() => {
    if (bannerData && !dismissed) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 60,
        friction: 10,
      }).start();

      const timer = setTimeout(() => dismiss(), 8000);
      return () => clearTimeout(timer);
    }
  }, [bannerData, dismissed]);

  const dismiss = () => {
    Animated.timing(slideAnim, {
      toValue: -100,
      duration: 250,
      useNativeDriver: true,
    }).start(() => setDismissed(true));
  };

  if (!bannerData || dismissed) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        { transform: [{ translateY: slideAnim }], backgroundColor: bannerData.color },
      ]}
    >
      <TouchableOpacity style={styles.inner} onPress={dismiss} activeOpacity={0.8}>
        <Text style={styles.emoji}>{bannerData.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>{bannerData.label}</Text>
          <Text style={styles.sub}>Tap to play & earn XP!</Text>
        </View>
        <TouchableOpacity onPress={dismiss} style={styles.closeBtn}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 30,
    left: 16, right: 16,
    borderRadius: 16, zIndex: 9999, elevation: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 12,
  },
  inner: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, gap: 12 },
  emoji: { fontSize: 28 },
  label: { color: '#fff', fontSize: 14, fontWeight: '800' },
  sub: { color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 1 },
  closeBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});

export default GameActivityBanner;
