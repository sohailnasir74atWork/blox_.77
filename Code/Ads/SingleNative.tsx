// AdaptiveBannerAd.tsx
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, useWindowDimensions, ActivityIndicator } from 'react-native';
import {
  BannerAd,
  BannerAdSize,
  AdEventType,
  TestIds,
} from 'react-native-google-mobile-ads';
import getAdUnitId from './ads';

// Use Google test unit in dev to guarantee fill.
// Your prod banner unit should be configured for adaptive banners in AdMob.
const PROD_BANNER_UNIT = getAdUnitId('banner')
const AD_UNIT_ID = PROD_BANNER_UNIT;

export default function AdaptiveBannerAd() {
  const { width: screenWidth } = useWindowDimensions();

  // We keep a local width to avoid rendering before we know the layout width
  const [containerWidth, setContainerWidth] = useState<number>(Math.floor(screenWidth));
  const [loadedSize, setLoadedSize] = useState<{ width?: number; height?: number } | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [lastError, setLastError] = useState<any>(null);

  // Re-render BannerAd when width changes (key trick recommended for adaptive)
  const bannerKey = useMemo(() => `adaptive-${Math.floor(containerWidth)}`, [containerWidth]);

  const onLayout = useCallback((e: any) => {
    const w = Math.floor(e?.nativeEvent?.layout?.width || screenWidth);
    if (w && w !== containerWidth) {
    //   console.log('[AdaptiveBanner] onLayout width=', w);
      setContainerWidth(w);
      setIsLoaded(false);
      setLoadedSize(null);
      setLastError(null);
    }
  }, [containerWidth, screenWidth]);

  const onAdLoaded = useCallback((size?: { width: number; height: number }) => {
    // console.log('[AdaptiveBanner] EVENT → LOADED. Returned size:', size);
    setLoadedSize(size ?? null);
    setIsLoaded(true);
  }, []);

  const onAdFailedToLoad = useCallback((error: any) => {
    console.warn('[AdaptiveBanner] EVENT → ERROR', error);
    setLastError(error);
    setIsLoaded(false);
  }, []);

  const onAdOpened = useCallback(() => {
    // console.log('[AdaptiveBanner] EVENT → OPENED');
  }, []);
  const onAdClosed = useCallback(() => {
    // console.log('[AdaptiveBanner] EVENT → CLOSED');
  }, []);
  const onAdImpression = useCallback(() => {
    // console.log('[AdaptiveBanner] EVENT → IMPRESSION');
  }, []);

  const styles = useMemo(() => getStyles(), []);

  return (
    <View onLayout={onLayout} style={styles.container}>
      {/* Placeholder while loading / sizing */}
      {!isLoaded && !lastError && (
        <View style={[styles.placeholder, { width: containerWidth }]}>
          <ActivityIndicator />
          <Text style={styles.placeholderText}>Loading ad…</Text>
        </View>
      )}

      {/* Error state */}
      {/* {!!lastError && (
        <View style={[styles.placeholder, { width: containerWidth }]}>
          <Text style={{ color: 'tomato', fontWeight: 'bold' }}>Banner failed to load</Text>
          <Text style={styles.errorText}>
            {String(lastError?.message || lastError?.toString?.() || 'Unknown error')}
          </Text>
        </View>
      )} */}

      {/* The actual banner. 
          Keyed by width so AdMob recalculates the adaptive height for the current width. */}
      <BannerAd
        key={bannerKey}
        unitId={AD_UNIT_ID}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{
          // requestNonPersonalizedAdsOnly: true,
          // keywords: ['design', 'games'],
        }}
        onAdLoaded={onAdLoaded}
        onAdFailedToLoad={onAdFailedToLoad}
        onAdOpened={onAdOpened}
        onAdClosed={onAdClosed}
        onAdImpression={onAdImpression}
      />

      {/* Debug footer (optional): shows what size we actually got */}
      {/* {isLoaded && (
        <Text style={styles.sizeNote}>
          Banner size: {loadedSize?.width ?? '—'}×{loadedSize?.height ?? '—'}
        </Text>
      )} */}
    </View>
  );
}

function getStyles() {
  return StyleSheet.create({
    container: {
      width: '100%',
      alignItems: 'center',
    },
    placeholder: {
      height: 60,
      borderRadius: 8,
      backgroundColor: '#f1f5f9',
      marginVertical: 6,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    placeholderText: {
      fontSize: 12,
      color: '#64748b',
      marginTop: 4,
    },
    errorText: {
      fontSize: 12,
      color: '#444',
      marginTop: 6,
      textAlign: 'center',
      paddingHorizontal: 8,
    },
    sizeNote: {
      fontSize: 10,
      color: '#94a3b8',
      marginTop: 4,
    },
  });
}
