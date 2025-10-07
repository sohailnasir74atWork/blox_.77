// ads/NativeFeedAd.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  NativeAdView,
  NativeAsset,
  NativeAssetType,
  NativeAd,
  NativeMediaView,
  NativeAdEventType,
} from 'react-native-google-mobile-ads';
import { View, Text, Image, StyleSheet } from 'react-native';
import { nativeAdPool } from './NativeAdPool';
import { useGlobalState } from '../GlobelStats';

type Props = {
  mediaHeight?: number;
  onImpression?: () => void;
  onClick?: () => void;
};

export default function NativeFeedAd({ mediaHeight = 220, onImpression, onClick }: Props) {
  const { theme } = useGlobalState();
  const isDark = theme === 'dark';
  const styles = getStyles(isDark);

  const [ad, setAd] = useState<NativeAd | undefined>();
  const unsubRef = useRef<() => void>();

  useEffect(() => {
    console.log('[NativeFeedAd] mount → ask pool');
    nativeAdPool.fillIfNeeded();

    const next = nativeAdPool.take();
    if (next) {
      console.log('[NativeFeedAd] got ad immediately');
      setAd(next);
    } else {
      console.log('[NativeFeedAd] no ad yet → subscribe');
      unsubRef.current = nativeAdPool.addListener(() => {
        const n = nativeAdPool.take();
        if (n) {
          console.log('[NativeFeedAd] received ad via listener');
          setAd(n);
          unsubRef.current?.();
        }
      });
    }

  return () => {
      unsubRef.current?.();
      if (ad) { try { ad.destroy(); } catch {} }
      console.log('[NativeFeedAd] unmount → destroyed ad');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ad lifecycle logs (doc: listen on the NativeAd object)
  useEffect(() => {
    if (!ad) return;
    console.log('[NativeFeedAd] subscribe ad events');
    const subs = [
      ad.addAdEventListener(NativeAdEventType.LOADED,   () => console.log('[NativeFeedAd] LOADED (rendered ad)')),
      ad.addAdEventListener(NativeAdEventType.ERROR,    (e: any) => console.warn('[NativeFeedAd] ERROR (rendered ad)', e)),
      ad.addAdEventListener(NativeAdEventType.IMPRESSION, () => { console.log('[NativeFeedAd] IMPRESSION'); onImpression?.(); }),
      ad.addAdEventListener(NativeAdEventType.CLICKED,  () => { console.log('[NativeFeedAd] CLICKED'); onClick?.(); }),
    ];
    return () => subs.forEach(s => s.remove());
  }, [ad, onImpression, onClick]);

  if (!ad) {
    console.log('[NativeFeedAd] show placeholder (no ad)');
    return (
      <View style={[styles.card, { opacity: 0.6 }]}>
        <View style={styles.header}>
          <View style={[styles.icon, { backgroundColor: '#e5e7eb' }]} />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={{ height: 12, backgroundColor: '#e5e7eb', borderRadius: 4, width: '60%' }} />
            <View style={{ height: 10, backgroundColor: '#f1f5f9', borderRadius: 4, width: '40%' }} />
          </View>
          <View style={[styles.cta, { backgroundColor: '#e5e7eb' }]} />
        </View>
        <View style={{ height: mediaHeight, backgroundColor: '#e5e7eb', borderRadius: 12, marginTop: 10 }} />
        <View style={{ height: 10, backgroundColor: '#f1f5f9', borderRadius: 4, marginTop: 10, width: '96%' }} />
        <Text style={[styles.sponsored, { color: '#94a3b8' }]}>Sponsored</Text>
      </View>
    );
  }

  // Per docs: pass the NativeAd object to NativeAdView; register each asset with NativeAsset.
  return (
    <NativeAdView nativeAd={ad} style={styles.card}>
      <View style={styles.header}>
        {!!ad.icon?.url && (
          <NativeAsset assetType={NativeAssetType.ICON}>
            <Image source={{ uri: ad.icon.url }} style={styles.icon} />
          </NativeAsset>
        )}

        <View style={{ flex: 1 }}>
          <NativeAsset assetType={NativeAssetType.HEADLINE}>
            <Text style={styles.title} numberOfLines={1}>{ad.headline}</Text>
          </NativeAsset>

          {!!ad.advertiser && (
            <NativeAsset assetType={NativeAssetType.ADVERTISER}>
              <Text style={styles.meta} numberOfLines={1}>{ad.advertiser}</Text>
            </NativeAsset>
          )}
        </View>

        {!!ad.cta && (
          <NativeAsset assetType={NativeAssetType.CTA}>
            <Text style={styles.cta} numberOfLines={1}>{ad.cta}</Text>
          </NativeAsset>
        )}
      </View>

      {/* Media (image or video); contents auto-populated by the SDK */}
      <NativeMediaView style={[styles.media, { height: mediaHeight }]} />

      {!!ad.body && (
        <NativeAsset assetType={NativeAssetType.BODY}>
          <Text style={styles.body} numberOfLines={3}>{ad.body}</Text>
        </NativeAsset>
      )}

      {/* Required disclosure */}
      <Text style={styles.sponsored}>Sponsored</Text>
    </NativeAdView>
  );
}

const getStyles = (isDark: boolean) => StyleSheet.create({
  card: {
    backgroundColor: isDark ? '#1e2d25' : '#fff',
    borderRadius: 16,
    padding: 12,
    marginHorizontal: 10,
    marginVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    elevation: 2,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#f1f5f9' },
  title: { fontSize: 16, fontWeight: '700', color: isDark ? '#fff' : '#0f172a' },
  meta: { fontSize: 12, color: isDark ? '#bbb' : '#64748b', marginTop: 2 },
  cta: {
    fontWeight: '700',
    paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: isDark ? '#3d4d45' : '#dbeafe',
    color: isDark ? '#e2e8f0' : '#1e293b',
  },
  media: { borderRadius: 12, marginTop: 10, overflow: 'hidden' },
  body: { fontSize: 14, color: isDark ? '#d1d5db' : '#334155', marginTop: 8 },
  sponsored: { fontSize: 11, color: '#888', marginTop: 6 },
});
