import React from 'react';
import {View, Text, TouchableOpacity} from 'react-native';
import {useTranslation} from 'react-i18next';
import {useGlobalState} from '../GlobelStats';
import {useLocalState} from '../LocalGlobelStats';

export default function CatalogStatus() {
  const {catalogStatus, loading, reload, theme} = useGlobalState();
  const {localState} = useLocalState();
  const {t} = useTranslation();
  const raw = localState.valuesFetchedAt || localState.fetchDataTime;
  const date = raw ? new Date(Number(raw) || raw) : null;
  const updated = date && Number.isFinite(date.getTime()) ? date.toLocaleString() : null;
  if (catalogStatus === 'ready' && !updated) return null;
  const dark = theme === 'dark';
  return (
    <View style={{padding: 12, backgroundColor: dark ? '#1e293b' : '#eff6ff'}}>
      <Text accessibilityLiveRegion="polite" style={{color: dark ? '#e2e8f0' : '#1e3a5f'}}>
        {catalogStatus === 'ready' ? t('catalog.updated', {date: updated}) :
          t(`catalog.${catalogStatus}`)}
      </Text>
      {catalogStatus !== 'ready' && updated && (
        <Text style={{color: dark ? '#cbd5e1' : '#475569', marginTop: 4}}>
          {t('catalog.updated', {date: updated})}
        </Text>
      )}
      {catalogStatus !== 'ready' && (
        <TouchableOpacity accessibilityRole="button" disabled={loading}
          onPress={() => reload()} style={{paddingVertical: 12, minHeight: 44}}>
          <Text style={{color: dark ? '#93c5fd' : '#1d4ed8', fontWeight: '700'}}>
            {t(loading ? 'catalog.loading' : 'catalog.retry')}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
