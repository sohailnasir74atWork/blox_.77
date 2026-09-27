import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import DateOfBirthModal from './DateOfBirthModal';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import { handleOpenPrivacy } from '../SettingScreen/settinghelper';
import {
  currentAuthEmail,
  isDecidedLocally,
  isOldEnoughForEmail,
  readEmailPrefs,
  getCachedEmailPrefs,
  saveEmailPrefs,
  takePendingSigninChoice,
  registerEmailOptInHandler,
} from '../Helper/emailOptIn';

// Runs the email opt-in flow for the signed-in user (see Helper/emailOptIn.js):
// applies the sign-in checkbox, shows the one-time prompt to users who haven't
// decided, and handles Settings' "turn on" request. The age check happens
// here: a date of birth is asked once if we don't already have one, and
// under-13s are recorded as opted out.
//
// `knownDob` is a date of birth the app already holds for this user (Adopt Me
// asks every account for one; the other apps don't pass it, so the gate asks
// the first time someone opts in). `blocked` holds everything back while
// another full-screen step (DOB gate, ATT primer) is in front.

// Existing users see the prompt a little after launch, not on top of it.
const PROMPT_DELAY_MS = 20000;
const ACCENT = '#8B5CF6';

const EmailOptInGate = ({ user, appdatabase, isDarkMode, knownDob = null, blocked = false }) => {
  const { t } = useTranslation();
  const uid = user?.id || null;

  // null | 'ask' | 'dob' | 'underage'
  const [phase, setPhase] = useState(null);
  const sourceRef = useRef('prompt');
  const resolverRef = useRef(null);
  const initDoneForRef = useRef(null);
  // The sign-in checkbox, held until it has actually been applied, so a
  // re-run of the init effect (user record refresh, a blocking step) can't
  // lose it.
  const pendingRef = useRef(null);
  // Box left unticked at this sign-in: no prompt for the rest of the session,
  // even if the init effect re-runs (a blocking step coming and going).
  const skipPromptRef = useRef(false);
  // A save in flight: repeated taps (Yes, No thanks, the birthday submit) are
  // ignored until it settles, so two choices can't race each other.
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const setBusy = (v) => { savingRef.current = v; setSaving(v); };
  // Latest props for the stable callbacks below.
  const ctxRef = useRef({});
  ctxRef.current = { uid, appdatabase, knownDob, t };

  const settle = useCallback((optIn) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    if (resolve) resolve(optIn);
  }, []);

  // Signed out or switched account: drop anything in flight.
  useEffect(() => {
    setPhase(null);
    settle(false);
    // Signing out and back into the SAME account must run the first look
    // again (the sign-in checkbox is applied there).
    initDoneForRef.current = null;
    skipPromptRef.current = false;
    if (!uid) pendingRef.current = null;
  }, [uid, settle]);

  const finish = useCallback(async (source, dob, dobIsNew) => {
    const { uid: id, appdatabase: db, t: tr } = ctxRef.current;
    if (!id || !db) { settle(false); return; }
    const ok = isOldEnoughForEmail(dob);
    setBusy(true);
    try {
      await saveEmailPrefs(db, id, { optIn: ok, source, dob: dobIsNew ? dob : undefined });
    } catch (e) {
      setBusy(false);
      setPhase(null);
      showErrorMessage(
        tr('home.alert.error'),
        tr('emailOptIn.save_failed', { defaultValue: "Couldn't save your email choice. Please try again." }),
      );
      settle(false);
      return;
    }
    setBusy(false);
    if (ok) {
      setPhase(null);
      showSuccessMessage(
        tr('emailOptIn.subscribed_title', { defaultValue: "You're subscribed" }),
        tr('emailOptIn.subscribed_body', { defaultValue: "We'll email you news and updates. Turn it off anytime in Settings." }),
      );
    } else {
      setPhase('underage');
    }
    settle(ok);
  }, [settle]);

  const begin = useCallback((source) => {
    const { uid: id, knownDob: held } = ctxRef.current;
    sourceRef.current = source;
    const dob = held || getCachedEmailPrefs(id)?.dob || null;
    if (dob) {
      finish(source, dob, false);
    } else {
      setPhase('dob');
    }
  }, [finish]);

  const decline = useCallback(async (source) => {
    const { uid: id, appdatabase: db } = ctxRef.current;
    if (savingRef.current) return;
    setPhase(null);
    settle(false); // releases a Settings request that was waiting on this screen
    if (!id || !db) return;
    setBusy(true);
    try {
      await saveEmailPrefs(db, id, { optIn: false, source });
    } catch (_) {
      // Not recorded → the prompt comes back next launch, which is fine.
    }
    setBusy(false);
  }, [settle]);

  // First look at this user: sign-in checkbox, or the one-time prompt.
  useEffect(() => {
    if (!uid || !appdatabase || blocked) return undefined;
    if (initDoneForRef.current === uid) return undefined;
    initDoneForRef.current = uid;

    const taken = takePendingSigninChoice();
    if (taken !== null) pendingRef.current = taken;
    if (!currentAuthEmail()) { pendingRef.current = null; return undefined; }
    if (pendingRef.current === null && isDecidedLocally(uid)) return undefined;

    let timer = null;
    let cancelled = false;
    (async () => {
      let prefs;
      try {
        prefs = await readEmailPrefs(appdatabase, uid);
      } catch (_) {
        return;
      }
      if (cancelled) return;
      const pending = pendingRef.current;
      pendingRef.current = null;

      if (pending === true) {
        if (!prefs?.optIn) begin('signin');
        return;
      }
      // Left unticked: record nothing and don't prompt right after sign-in.
      // An undecided user gets the one-time prompt on a later launch.
      if (pending === false) { skipPromptRef.current = true; return; }
      if (prefs) return;
      // Known under-13: never prompt. Nothing is written, so this stays a
      // single read per launch until they're old enough to use Settings.
      const dob = ctxRef.current.knownDob || null;
      if (dob && !isOldEnoughForEmail(dob)) return;
      if (skipPromptRef.current) return;
      timer = setTimeout(() => {
        // Never replace a step already on screen (e.g. Settings opened the
        // birthday screen within these 20 seconds).
        if (!cancelled && !skipPromptRef.current && !isDecidedLocally(uid)) {
          setPhase((p) => { if (p) return p; sourceRef.current = 'prompt'; return 'ask'; });
        }
      }, PROMPT_DELAY_MS);
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      // Interrupted before deciding (blocked / db swap): run again next pass.
      if (initDoneForRef.current === uid) initDoneForRef.current = null;
    };
  }, [uid, appdatabase, blocked, begin]);

  // Settings' "Email updates" switch.
  useEffect(() => {
    if (!uid || !appdatabase) return undefined;
    return registerEmailOptInHandler(async (source) => {
      settle(false);
      try {
        if (getCachedEmailPrefs(uid) === undefined) await readEmailPrefs(appdatabase, uid);
      } catch (_) {}
      return new Promise((resolve) => {
        resolverRef.current = resolve;
        begin(source);
      });
    });
  }, [uid, appdatabase, begin, settle]);

  if (!uid || blocked || !phase) return null;

  if (phase === 'dob') {
    return (
      <DateOfBirthModal
        visible
        isDarkMode={isDarkMode}
        subtitle={t('emailOptIn.dob_subtitle', { defaultValue: 'We ask this once before turning on email updates.' })}
        onSubmit={(dob) => { if (!savingRef.current) finish(sourceRef.current, dob, true); }}
        onCancel={() => { setPhase(null); settle(false); }}
      />
    );
  }

  const bgColor = isDarkMode ? '#1A1527' : '#FFFFFF';
  const textColor = isDarkMode ? '#F3EEFF' : '#1F1235';
  const subColor = isDarkMode ? '#A89CC8' : '#7C6D9B';

  if (phase === 'underage') {
    return (
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: bgColor }]}>
          <Text style={styles.icon}>💌</Text>
          <Text style={[styles.title, { color: textColor }]}>
            {t('emailOptIn.underage_title', { defaultValue: 'Thanks for telling us' })}
          </Text>
          <Text style={[styles.body, { color: subColor }]}>
            {t('emailOptIn.underage_body', { defaultValue: "Email updates are only for players 13 and older, so we won't send you any. You'll still see news right here in the app." })}
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => setPhase(null)} activeOpacity={0.85}>
            <Text style={styles.primaryText}>{t('emailOptIn.ok', { defaultValue: 'OK' })}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // phase === 'ask'
  const email = currentAuthEmail();
  return (
    <View style={styles.overlay}>
      <View style={[styles.card, { backgroundColor: bgColor }]}>
        <Text style={styles.icon}>📬</Text>
        <Text style={[styles.title, { color: textColor }]}>
          {t('emailOptIn.ask_title', { defaultValue: 'Get updates by email?' })}
        </Text>
        <Text style={[styles.body, { color: subColor }]}>
          {t('emailOptIn.ask_body', { defaultValue: 'Hear about new features, value updates and events. No spam, and you can turn it off anytime in Settings.' })}
        </Text>
        {!!email && (
          <Text style={[styles.email, { color: textColor }]} numberOfLines={1}>{email}</Text>
        )}
        <TouchableOpacity style={styles.primaryBtn} onPress={() => { if (!savingRef.current) begin(sourceRef.current); }} disabled={saving} activeOpacity={0.85}>
          <Text style={styles.primaryText}>{t('emailOptIn.ask_yes', { defaultValue: 'Yes, email me' })}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => decline(sourceRef.current)} disabled={saving} activeOpacity={0.6}>
          <Text style={[styles.secondaryText, { color: subColor }]}>{t('emailOptIn.ask_no', { defaultValue: 'No thanks' })}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleOpenPrivacy} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={[styles.link, { color: subColor }]}>{t('emailOptIn.privacy', { defaultValue: 'Privacy Policy' })}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const screenHeight = Dimensions.get('window').height;

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 10, 30, 0.9)',
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
  icon: { fontSize: 40, textAlign: 'center', marginBottom: 8 },
  title: { fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  body: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 12 },
  email: { fontSize: 14, fontWeight: '700', textAlign: 'center', marginBottom: 16 },
  primaryBtn: {
    backgroundColor: ACCENT,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  secondaryBtn: { paddingVertical: 12, alignItems: 'center' },
  secondaryText: { fontSize: 15, fontWeight: '600' },
  link: { fontSize: 12, textAlign: 'center', textDecorationLine: 'underline' },
});

export default React.memo(EmailOptInGate);
