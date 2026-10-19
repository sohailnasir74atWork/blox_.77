// A message text with a small "Translate" link under it, for the staff tools
// (Admin Dashboard chat viewer, reports queue). Uses the chat translation
// (Helper/chatTranslate: Google v2, fruit names kept) into the device
// language. Staff have no daily limit. Staff-only UI: English.
//
// `translation` (optional) is shown as soon as the parent has it — the chat
// viewer's "Translate all" fills it for every message at once.

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useGlobalState } from '../GlobelStats';
import { getDeviceLanguage } from '../../i18n';
import { translateText } from '../Helper/chatTranslate';

const TranslatableText = ({ text, style, numberOfLines, isDark = false, translation = null }) => {
  const { api } = useGlobalState();
  const [own, setOwn] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hidden, setHidden] = useState(false);
  const shown = own || translation;
  const link = { color: '#007AFF', fontSize: 11, fontWeight: '600' };

  if (!text) return null;

  const run = async () => {
    if (busy) return;
    setHidden(false);
    if (shown) return;
    setBusy(true);
    setFailed(false);
    const r = await translateText(text, { apiKey: api, targetLang: getDeviceLanguage() });
    setBusy(false);
    if (r) setOwn(r);
    else setFailed(true);
  };

  return (
    <View>
      <Text style={style} numberOfLines={numberOfLines}>{text}</Text>
      {shown && !hidden ? (
        <>
          <Text style={[style, { fontStyle: 'italic', marginTop: 3, color: isDark ? '#9FD3FF' : '#1D4ED8' }]}>{shown}</Text>
          <TouchableOpacity onPress={() => setHidden(true)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Text style={[link, { marginTop: 2, color: isDark ? '#888' : '#999' }]}>Hide translation</Text>
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity onPress={run} disabled={busy} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} style={{ marginTop: 3, flexDirection: 'row', alignItems: 'center' }}>
          {busy ? <ActivityIndicator size="small" /> : (
            <Text style={link}>{failed ? 'Translation failed. Tap to retry' : 'Translate'}</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
};

export default TranslatableText;
