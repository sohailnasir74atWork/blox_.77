/**
 * GameRoundActions.js
 * The "start / play again" block shared by every mini game. It is the one
 * place the daily round limit (see GameScreen) is enforced:
 *   - rounds left        → play button + "N rounds left today"
 *   - free round used    → watch-ad button (spinner while the ad loads)
 *   - all rounds used    → come-back-tomorrow note
 */

import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

const GameRoundActions = ({
  roundInfo,
  onPlay,
  onWatchAd,
  adLoading = false,
  color,
  playLabel,
  playIcon = 'refresh',
  textColor = '#94a3b8',
  style,
}) => {
  const { t } = useTranslation();
  if (roundInfo?.maxedOut) {
    return (
      <View style={[styles.wrap, style]}>
        <Text style={styles.doneEmoji}>🌙</Text>
        <Text style={[styles.note, { color: textColor }]}>
          {t('engagement.game_rounds.maxed_out', { count: roundInfo.maxRounds })}
        </Text>
      </View>
    );
  }

  if (roundInfo?.needsUnlock) {
    return (
      <View style={[styles.wrap, style]}>
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: '#F59E0B', opacity: adLoading ? 0.75 : 1 }]}
          onPress={onWatchAd}
          disabled={adLoading}
          activeOpacity={0.8}
        >
          {adLoading
            ? <ActivityIndicator color="#fff" />
            : <Icon name="play-circle" size={22} color="#fff" />}
          <Text style={styles.btnText} numberOfLines={1} adjustsFontSizeToFit>
            {adLoading ? t('engagement.game_rounds.loading_ad') : t('engagement.game_rounds.watch_ad')}
          </Text>
        </TouchableOpacity>
        <Text style={[styles.hint, { color: textColor }]}>{t('engagement.game_rounds.free_used')}</Text>
      </View>
    );
  }

  const left = roundInfo?.roundsLeft;
  return (
    <View style={[styles.wrap, style]}>
      <TouchableOpacity style={[styles.btn, { backgroundColor: color }]} onPress={onPlay} activeOpacity={0.8}>
        <Icon name={playIcon} size={22} color="#fff" />
        <Text style={styles.btnText} numberOfLines={1} adjustsFontSizeToFit>{playLabel}</Text>
      </TouchableOpacity>
      {left > 0 && (
        <Text style={[styles.hint, { color: textColor }]}>
          {!roundInfo.unlocked ? t('engagement.game_rounds.free_daily') : t('engagement.game_rounds.rounds_left', { count: left })}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { width: '100%', alignItems: 'center', marginTop: 24 },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, paddingHorizontal: 24, borderRadius: 100, width: '100%',
  },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '800', flexShrink: 1 },
  hint: { fontSize: 12, fontWeight: '700', marginTop: 8 },
  doneEmoji: { fontSize: 32 },
  note: { fontSize: 14, fontWeight: '600', textAlign: 'center', marginTop: 6, lineHeight: 20 },
});

export default GameRoundActions;
