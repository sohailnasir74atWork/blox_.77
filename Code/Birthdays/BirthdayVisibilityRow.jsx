import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Switch } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { showErrorMessage, showSuccessMessage } from '../Helper/MessageHelper';
import { trackGrowthEvent } from '../Helper/growthAnalytics';
import { getThemeColors } from '../Helper/themeColors';
import { useGlobalState } from '../GlobelStats';
import {
  setBirthdayUser, getMyBirthday, peekMyBirthday, setBirthdayVisibility, onBirthdaysChange,
  getKnownDob, loadKnownDob,
} from './birthdayApi';
import { isUnder13Dob } from './birthdayDate';
import EditBirthdaySheet from './EditBirthdaySheet';

// Settings rows, same style as EmailUpdatesRow (ported from Adopt Me):
//   "Show my birthday" (month and day only; on by default) — hidden for
//   under-13s, whose birthday is never public;
//   "Change my birthday" — the one-time correction, while unused.
// The full date of birth comes from the phone (useDobGate's store), or one
// read of users_private while the edit is still unused.
const BirthdayVisibilityRow = ({ uid, styles, onHaptic, iconStyle, iconColor, iconSize }) => {
  const { t } = useTranslation();
  const { theme, appdatabase } = useGlobalState();
  const c = getThemeColors(theme === 'dark');
  const [show, setShow] = useState(peekMyBirthday()?.show ?? true);
  const [canEdit, setCanEdit] = useState(!!peekMyBirthday()?.canEdit);
  const [serverMinor, setServerMinor] = useState(!!peekMyBirthday()?.minor);
  // Blox asks for the date of birth later than Adopt Me (useDobGate): no
  // rows until the server has one on file.
  const [hasBirthday, setHasBirthday] = useState(!!peekMyBirthday()?.month);
  const [dob, setDob] = useState(() => getKnownDob(uid));
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!uid) return undefined;
    let alive = true;
    setBirthdayUser(uid);
    setDob(getKnownDob(uid));
    const apply = (m) => {
      if (alive && m) {
        setShow(!!m.show);
        setCanEdit(!!m.canEdit);
        setServerMinor(!!m.minor);
        setHasBirthday(!!m.month);
      }
    };
    getMyBirthday().then(apply).catch(() => {});
    const off = onBirthdaysChange(() => apply(peekMyBirthday()));
    return () => { alive = false; off(); };
  }, [uid]);

  // The year is needed only for the edit sheet: read it only while the edit is unused.
  useEffect(() => {
    if (!uid || !canEdit || dob) return undefined;
    let alive = true;
    loadKnownDob(appdatabase, uid).then((d) => { if (alive && d) setDob(d); }).catch(() => {});
    return () => { alive = false; };
  }, [uid, canEdit, dob, appdatabase]);

  const onToggle = useCallback(async (next) => {
    if (busy) return;
    if (onHaptic) onHaptic();
    setBusy(true);
    setShow(next);
    try {
      await setBirthdayVisibility(next);
      trackGrowthEvent('birthday_visibility', { show: next ? 1 : 0, where: 'settings' });
    } catch (_) {
      setShow(!next);
      showErrorMessage(t('home.alert.error'), t('birthdays.err.generic'));
    } finally {
      setBusy(false);
    }
  }, [busy, onHaptic, t]);

  const onSaved = useCallback((next) => {
    setEditing(false);
    setCanEdit(false);
    if (next) setDob(next);
    trackGrowthEvent('birthday_edit', { where: 'settings' });
    showSuccessMessage(t('birthdays.edit_saved'), '');
    getMyBirthday({ force: true }).catch(() => {});
  }, [t]);

  if (!uid || !hasBirthday) return null;
  const minor = isUnder13Dob(dob) || serverMinor;

  return (
    <>
      {!minor && (
        <View style={styles.option}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => onToggle(!show)}>
              <Icon name="gift-outline" size={iconSize || 18} color={iconColor || 'white'} style={iconStyle || { backgroundColor: '#EC4899', padding: 5, borderRadius: 5 }} />
              <Text style={styles.optionText}>{t('birthdays.settings_row')}</Text>
            </TouchableOpacity>
            <Switch value={show} disabled={busy} onValueChange={onToggle} />
          </View>
        </View>
      )}
      {canEdit && dob ? (
        <View style={styles.option}>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}
            onPress={() => { if (onHaptic) onHaptic(); setEditing(true); }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Icon name="calendar-outline" size={iconSize || 18} color={iconColor || 'white'} style={iconStyle || { backgroundColor: '#DB2777', padding: 5, borderRadius: 5 }} />
              <Text style={styles.optionText}>{t('birthdays.edit_row')}</Text>
            </View>
            <Icon name="chevron-forward" size={18} color={c.textMuted} />
          </TouchableOpacity>
        </View>
      ) : null}
      <EditBirthdaySheet visible={editing} dob={dob} c={c} onClose={() => setEditing(false)} onSaved={onSaved} />
    </>
  );
};

export default React.memo(BirthdayVisibilityRow);
