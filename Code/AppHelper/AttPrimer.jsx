import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import config from '../Helper/Environment';

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
  if (!visible) return null;

  const bgColor = isDarkMode ? '#1A1527' : '#FFFFFF';
  const textColor = isDarkMode ? '#F3EEFF' : '#1F1235';
  const subColor = isDarkMode ? '#A89CC8' : '#7C6D9B';
  const appName = config?.appName || 'this app';

  return (
    <View style={styles.overlay}>
      <View style={[styles.card, { backgroundColor: bgColor }]}>
        <Text style={styles.icon}>🎯</Text>
        <Text style={[styles.title, { color: textColor }]}>Keep {appName} free</Text>
        <Text style={[styles.subtitle, { color: subColor }]}>
          We show ads so {appName} can stay free for everyone. With your
          permission we can show ads that are more relevant to you, which
          earns more and helps support the app.
        </Text>
        <Text style={[styles.subtitle, { color: subColor }]}>
          On the next screen iOS will ask whether to allow tracking. You can
          change your choice anytime in Settings → Privacy.
        </Text>

        <TouchableOpacity style={styles.continueBtn} onPress={onContinue} activeOpacity={0.85}>
          <Text style={styles.continueText}>Continue</Text>
        </TouchableOpacity>

        <Text style={[styles.disclaimer, { color: subColor }]}>
          🔒 We never sell your personal data.
        </Text>
      </View>
    </View>
  );
};

const screenHeight = Dimensions.get('window').height;

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
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
