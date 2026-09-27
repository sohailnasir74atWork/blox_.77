import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Switch } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { showErrorMessage } from '../Helper/MessageHelper';
import {
  currentAuthEmail,
  getCachedEmailPrefs,
  readEmailPrefs,
  saveEmailPrefs,
  onEmailPrefsChange,
  requestEmailOptIn,
  isOldEnoughForEmail,
} from '../Helper/emailOptIn';

// Settings switch for email news and updates. Turning it on goes through
// EmailOptInGate (App.js), which owns the 13+ check; turning it off is a
// direct write. Hidden for accounts with no email and for known under-13s.
const EmailUpdatesRow = ({ uid, appdatabase, knownDob, styles, onHaptic }) => {
  const { t } = useTranslation();
  const cached = getCachedEmailPrefs(uid);
  const [optIn, setOptIn] = useState(!!cached?.optIn);
  const [dob, setDob] = useState(cached?.dob || null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!uid || !appdatabase) return undefined;
    let alive = true;
    const apply = (p) => { setOptIn(!!p?.optIn); setDob(p?.dob || null); };
    const known = getCachedEmailPrefs(uid);
    if (known !== undefined) {
      apply(known);
    } else {
      readEmailPrefs(appdatabase, uid).then((p) => { if (alive) apply(p); }).catch(() => {});
    }
    const off = onEmailPrefsChange((id, p) => { if (id === uid && alive) apply(p); });
    return () => { alive = false; off(); };
  }, [uid, appdatabase]);

  const onToggle = useCallback(async (next) => {
    if (busy) return;
    if (onHaptic) onHaptic();
    setBusy(true);
    try {
      if (next) {
        setOptIn(await requestEmailOptIn('settings'));
      } else {
        await saveEmailPrefs(appdatabase, uid, { optIn: false, source: 'settings' });
        setOptIn(false);
      }
    } catch (_) {
      showErrorMessage(
        t('home.alert.error'),
        t('emailOptIn.save_failed', { defaultValue: "Couldn't save your email choice. Please try again." }),
      );
    } finally {
      setBusy(false);
    }
  }, [busy, appdatabase, uid, t, onHaptic]);

  if (!uid || !currentAuthEmail()) return null;
  const heldDob = knownDob || dob;
  if (heldDob && !isOldEnoughForEmail(heldDob)) return null;

  return (
    <View style={styles.option}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
        <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center' }} onPress={() => onToggle(!optIn)}>
          <Icon name="mail-outline" size={18} color={'white'} style={{ backgroundColor: '#0EA5E9', padding: 5, borderRadius: 5 }} />
          <Text style={styles.optionText}>{t('settings.email_updates', { defaultValue: 'Email updates' })}</Text>
        </TouchableOpacity>
        <Switch value={optIn} disabled={busy} onValueChange={onToggle} />
      </View>
    </View>
  );
};

export default React.memo(EmailUpdatesRow);
