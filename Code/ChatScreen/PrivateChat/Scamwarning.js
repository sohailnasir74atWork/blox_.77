import React, { useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Alert } from 'react-native';
import { useGlobalState } from '../../GlobelStats';
import config from '../../Helper/Environment';
import { useLocalState } from '../../LocalGlobelStats';
import InterstitialAdManager from '../../Ads/IntAd';

export default function ScamSafetyBox({
  setShowRatingModal,
  canRate,
  hasRated,
}) {
  const { theme, tradingServerLink } = useGlobalState();
  const { localState } = useLocalState();
  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  const handleOpenServer = useCallback(() => {
    if (!tradingServerLink || typeof tradingServerLink !== 'string' || tradingServerLink.trim().length === 0) {
      Alert.alert('Error', 'Server link not available');
      return;
    }
    const openLink = () => {
      Linking.openURL(tradingServerLink).catch(err => {
        console.warn('Failed to open server link:', err);
        Alert.alert('Error', 'Failed to open server link');
      });
    };
    // Show interstitial ad for non-Pro users before opening link
    if (!localState?.isPro) {
      InterstitialAdManager.showAd(openLink);
    } else {
      openLink();
    }
  }, [tradingServerLink, localState?.isPro]);

  const handleOpenRating = useCallback(() => {
    if (setShowRatingModal && typeof setShowRatingModal === 'function') {
      setShowRatingModal(true);
    }
  }, [setShowRatingModal]);

  return (
    <View style={styles.container}>
      {/* Top row: Warning icon + safety tips inline */}
      <View style={styles.safetyRow}>
        <Text style={styles.warningIcon}>⚠️</Text>
        <Text style={styles.safetyText} numberOfLines={2}>
          {'Too good? It\'s a scam.'} · {'Never share login.'} · {'Use trusted servers.'}
        </Text>
      </View>

      {/* Bottom row: Action chips */}
      {canRate && (
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.serverChip}
            onPress={handleOpenServer}
            activeOpacity={0.7}
          >
            <Text style={styles.serverChipIcon}>🔗</Text>
            <Text style={styles.serverChipText}>Join Server</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.rateChip}
            onPress={handleOpenRating}
            activeOpacity={0.7}
          >
            <Text style={styles.rateChipIcon}>⭐</Text>
            <Text style={styles.rateChipText}>
              {hasRated ? 'Edit Rating' : 'Rate Trader'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const getStyles = (isDark) =>
  StyleSheet.create({
    container: {
      marginHorizontal: 6,
      marginVertical: 4,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 12,
      backgroundColor: isDark ? 'rgba(30,41,59,0.85)' : 'rgba(255,251,235,0.9)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(71,85,105,0.5)' : 'rgba(251,191,119,0.4)',
    },

    /* ── Safety row ── */
    safetyRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    warningIcon: {
      fontSize: 13,
      marginRight: 6,
    },
    safetyText: {
      flex: 1,
      fontSize: 10,
      lineHeight: 14,
      color: isDark ? '#CBD5E1' : '#78716C',
      letterSpacing: 0.1,
    },

    /* ── Actions row ── */
    actionsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: 7,
      gap: 6,
    },

    /* Server chip */
    serverChip: {
      flex: 1,
      minWidth: 100,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(99,102,241,0.5)' : 'rgba(99,102,241,0.3)',
      backgroundColor: isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.06)',
    },
    serverChipIcon: {
      fontSize: 11,
      marginRight: 4,
    },
    serverChipText: {
      fontSize: 11,
      fontWeight: '600',
      color: isDark ? '#A5B4FC' : '#4F46E5',
    },

    /* Rate chip */
    rateChip: {
      flex: 1,
      minWidth: 100,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 20,
      backgroundColor: isDark ? 'rgba(251,191,36,0.15)' : 'rgba(251,191,36,0.12)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(251,191,36,0.35)' : 'rgba(251,191,36,0.3)',
    },
    rateChipIcon: {
      fontSize: 11,
      marginRight: 4,
    },
    rateChipText: {
      fontSize: 11,
      fontWeight: '600',
      color: isDark ? '#FCD34D' : '#B45309',
    },
  });
