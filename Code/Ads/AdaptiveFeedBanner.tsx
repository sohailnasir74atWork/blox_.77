import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, LayoutChangeEvent, ActivityIndicator } from 'react-native';
import {
  BannerAd,
  BannerAdSize,
  TestIds,
} from 'react-native-google-mobile-ads';
import getAdUnitId from '../Ads/ads'; // make sure this returns your banner unit id for key 'banner'
import { useGlobalState } from '../GlobelStats';

type Props = {
  /**
   * Inline Adaptive is best for banners inside scrollable feeds.
   * Anchored Adaptive sticks to the screen width (common & simple).
   */
  mode?: 'inline' | 'anchored';
  /**
   * Optional fixed width for inline mode (dp). If not provided,
   * we measure available width via onLayout.
   */
  inlineWidthDp?: number;
  /**
   * While integrating, set this true to use Google test unit.
   */
  useTestUnit?: boolean;
};

const PROD_UNIT_ID = getAdUnitId('banner'); // e.g. 'ca-app-pub-xxx/yyy'

export default function AdaptiveFeedBanner({
  mode = 'inline',
  inlineWidthDp,
  useTestUnit = false,
}: Props) {
  const unitId = useMemo(() => (useTestUnit ? TestIds.BANNER : PROD_UNIT_ID), [useTestUnit]);
  const { theme } = useGlobalState();
  const isDark = theme === 'dark';

  const [measuredWidth, setMeasuredWidth] = useState<number | null>(inlineWidthDp ?? null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<View>(null);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    if (inlineWidthDp) return; // user provided width
    const w = Math.round(e.nativeEvent.layout.width);
    if (!measuredWidth || Math.abs(measuredWidth - w) > 2) {
      setMeasuredWidth(w);
      // console.log('[AdaptiveFeedBanner] measured inline width:', w);
    }
  }, [inlineWidthDp, measuredWidth]);

  // Pick banner size by mode
  const size = mode === 'inline'
    ? BannerAdSize.INLINE_ADAPTIVE_BANNER
    : BannerAdSize.ANCHORED_ADAPTIVE_BANNER;

  // For Inline Adaptive, we (optionally) constrain width using a wrapping View and onLayout.
  // Anchored Adaptive ignores container width and uses full screen width automatically.
  return (
    <View
      ref={containerRef}
      onLayout={mode === 'inline' ? onLayout : undefined}
      style={[
        styles.wrapper,
        isDark && styles.wrapperDark,
      ]}
    >
      {mode === 'inline' && !measuredWidth ? (
        <View style={[styles.placeholder, isDark && styles.placeholderDark]}>
          <ActivityIndicator />
        </View>
      ) : (
        <BannerAd
          unitId={unitId}
          size={size}
          // For INLINE_ADAPTIVE_BANNER, react-native-google-mobile-ads uses the container width.
          // So ensuring the wrapper has a concrete width (via onLayout) is enough.
          requestOptions={{
            requestNonPersonalizedAdsOnly: false,
          }}
          onAdLoaded={() => {
            setLoading(false);
            // console.log('[AdaptiveFeedBanner] onAdLoaded');
          }}
          onAdFailedToLoad={(e) => {
            setLoading(false);
            console.warn('[AdaptiveFeedBanner] onAdFailedToLoad', e);
          }}
        />
      )}

      {loading && (
        <View style={[styles.loadingOverlay, isDark && styles.loadingOverlayDark]}>
          <ActivityIndicator />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 10,
    marginVertical: 8,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
    minHeight: 50,
  },
  wrapperDark: {
    backgroundColor: '#1e2d25',
  },
  placeholder: {
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderDark: {
    backgroundColor: '#25362e',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.0, // set to 0.15 if you want a dim overlay while loading
  },
  loadingOverlayDark: {
    // optional styling
  },
});
