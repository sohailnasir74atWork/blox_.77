import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import config from '../Helper/Environment';
import { useTranslation } from 'react-i18next';

// ATT priming pre-prompt (iOS only).
//
// Apple's tracking dialog is one-shot: if the user taps "Ask App Not to
// Track" we can never ask again. Showing a short, honest primer first —
// explaining WHY we ask — measurably lifts the opt-in rate, and every
// opted-in iOS user monetises far better (IDFA enables personalised ads
// and clean SKAdNetwork attribution, both of which drive eCPM).
//
// Compliance (App Store review guideline 5.1.1): this screen is purely
// informational. It has a single "Continue" CTA that leads into Apple's
// real prompt — it does NOT mimic the system Allow/Deny buttons and offers
// NO reward for allowing, both of which are rejection triggers.
const ACCENT = '#8B5CF6';

const AttPrimer = ({ visible, onContinue, isDarkMode }) => {
  const { t } = useTranslation();
  if (!visible) return null;

  const bgColor = isDarkMode ? '#1A1527' : '#FFFFFF';
  const textColor = isDarkMode ? '#F3EEFF' : '#1F1235';
  const subColor = isDarkMode ? '#A89CC8' : '#7C6D9B';
  const appName = config?.appName || t('app.att_primer.this_app');

  return (
    <View style={styles.overlay}>
      <View style={[styles.card, { backgroundColor: bgColor }]}>
        <Text style={styles.icon}>🎯</Text>
        <Text style={[styles.title, { color: textColor }]}>{t('app.att_primer.title', { appName })}</Text>
        <Text style={[styles.subtitle, { color: subColor }]}>
          {t('app.att_primer.body', { appName })}
        </Text>
        <Text style={[styles.subtitle, { color: subColor }]}>
          {t('app.att_primer.next_screen')}
        </Text>

        <TouchableOpacity style={styles.continueBtn} onPress={onContinue} activeOpacity={0.85}>
          <Text style={styles.continueText}>{t('first.continue')}</Text>
        </TouchableOpacity>

        <Text style={[styles.disclaimer, { color: subColor }]}>
          {t('app.att_primer.disclaimer')}
        </Text>
      </View>
    </View>
  );
};

const screenHeight = Dimensions.get('window').height;

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 10, 30, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 9999,
    elevation: 9999,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    maxHeight: screenHeight * 0.82,
    borderRadius: 28,
    padding: 24,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 10,
  },
  icon: {
    fontSize: 40,
    textAlign: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 14,
    lineHeight: 20,
  },
  continueBtn: {
    backgroundColor: ACCENT,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 12,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  continueText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '800',
  },
  disclaimer: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
  },
});

export default React.memo(AttPrimer);
