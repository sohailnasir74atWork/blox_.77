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

  // ✅ Memoize handleOpenServer
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

    openLink();
  }, [tradingServerLink, localState?.isPro]);

  // ✅ Memoize handleOpenRating
  const handleOpenRating = useCallback(() => {
    if (setShowRatingModal && typeof setShowRatingModal === 'function') {
      setShowRatingModal(true);
    }
  }, [setShowRatingModal]);

  return (
    <View style={styles.box}>
      {/* LEFT: safety tips as a "pill" */}
      <View style={styles.leftColumn}>
        <View style={styles.warningBox}>
          <Text style={styles.title}>⚠️ Trade Safety</Text>
          <Text style={styles.item}>• Too good = scam.</Text>
          <Text style={styles.item}>• Don't share login.</Text>
          <Text style={styles.item}>• Use trusted servers.</Text>
        </View>
      </View>

      {/* RIGHT: actions */}
      {canRate && (
        <View style={styles.rightColumn}>
          {/* Safe server button */}
          <TouchableOpacity
            style={[styles.buttonBase, styles.serverButton]}
            onPress={handleOpenServer}
          >
            <Text style={[styles.buttonTitle, styles.serverButtonTitle]}>
              Join Server
            </Text>
            <Text style={[styles.buttonSub, styles.serverButtonSub]}>
              Trade using a trusted link
            </Text>
          </TouchableOpacity>

          {/* Rating button */}
          <TouchableOpacity
            style={[styles.buttonBase, styles.rateButton]}
            onPress={handleOpenRating}
          >
            <Text style={[styles.buttonTitle, styles.rateButtonTitle]}>
              {hasRated ? 'Edit Rating' : 'Rate Trader'}
            </Text>
            <Text style={[styles.buttonSub, styles.rateButtonSub]}>
              {hasRated
                ? 'Update your review'
                : 'Help other players stay safe'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const getStyles = (isDark) =>
  StyleSheet.create({
    box: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 5,
      paddingHorizontal: 5,
      marginHorizontal: 4,
      marginTop: 3,
      marginBottom: 3,
      borderBottomWidth: 1,
      borderBottomColor: isDark ? '#1f2933' : '#E2E8F0',
      backgroundColor: 'transparent',
    },
    leftColumn: {
      flex: 1,
      paddingRight: 5,
    },
    // 🔹 Safety warnings styled like a soft "button" / pill
    warningBox: {
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: isDark ? '#4B5563' : '#FBBF77',
      backgroundColor: isDark ? 'rgba(15,23,42,0.7)' : '#FFF7ED',
    },
    rightColumn: {
      flexShrink: 0,
      justifyContent: 'center',
      alignItems: 'flex-end',
      gap: 6, // if not supported use marginBottom on buttons
    },
    title: {
      fontSize: 11,
      color: isDark ? '#FCD34D' : '#92400E',
      marginBottom: 6,
      fontWeight: 'bold',
    },
    item: {
      fontSize: 9,
      color: isDark ? '#E5E7EB' : '#4B5563',
      marginBottom: 5,

    },

    // shared button base (same size)
    buttonBase: {
      width: 170,
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 8,
      justifyContent: 'center',
    },

    // server (outlined) button
    serverButton: {
      borderWidth: 1,
      borderColor: config.colors.primary,
      backgroundColor: isDark ? 'transparent' : '#ffffff',
    },
    // rating (filled) button
    rateButton: {
      backgroundColor: config.colors.primary,
    },

    buttonTitle: {
      fontSize: 11,
      fontWeight: 'bold',
    },
    buttonSub: {
      fontSize: 8,
      marginTop: 2,
    },

    // color overrides
    serverButtonTitle: {
      color: config.colors.primary,
      fontWeight: 'bold',
    },
    serverButtonSub: {
      color: isDark ? '#CBD5F5' : '#6B7280',
    },
    rateButtonTitle: {
      color: '#ffffff',

    },
    rateButtonSub: {
      color: 'rgba(255,255,255,0.9)',

    },
  });
