/**
 * NativeAdCard — advanced native ad rendered to match a content/feed card.
 *
 * Implements the full Google "system-defined format" surface: icon, headline,
 * advertiser, media (image/video via NativeMediaView), body, star rating and a
 * call-to-action button — every visible asset wrapped in <NativeAsset> so the
 * SDK records clicks/impressions and overlays AdChoices itself.
 *
 * Policy notes baked in:
 *   • A "Sponsored" attribution is always shown (required for programmatic
 *     native ads — missing it risks an account strike).
 *   • The top-right corner is left clear for the SDK's AdChoices icon
 *     (request uses adChoicesPlacement: TOP_RIGHT).
 *
 * The ad object itself is owned/cached by NativeAdManager keyed on `adKey`, so
 * this component just borrows it for its lifetime and never destroys it.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import {
  NativeAdView,
  NativeAsset,
  NativeAssetType,
  NativeMediaView,
} from 'react-native-google-mobile-ads';
import { getNativeAd } from './NativeAdManager';
import config from '../Helper/Environment';

// Bounded no-fill retry so a transient failure doesn't kill the slot for the
// whole session (mirrors the backoff the other ad formats use). Delays: 4s,
// 8s, 16s — then give up and collapse the row.
const MAX_RETRIES = 3;

const NativeAdCard = ({ adKey, isDarkMode = false }) => {
  const [ad, setAd] = useState(null);
  const [failed, setFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const mountedRef = useRef(true);
  const attemptsRef = useRef(0);
  const retryTimerRef = useRef(null);

  // New slot → reset the retry counter (declared before the load effect so it
  // runs first when adKey changes; a reloadTick bump leaves it untouched).
  useEffect(() => {
    attemptsRef.current = 0;
  }, [adKey]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    setAd(null);
    setFailed(false);

    const onNoAd = () => {
      if (cancelled || !mountedRef.current) return;
      if (attemptsRef.current < MAX_RETRIES) {
        const delay = Math.pow(2, attemptsRef.current) * 4000; // 4s, 8s, 16s
        attemptsRef.current += 1;
        retryTimerRef.current = setTimeout(() => {
          if (mountedRef.current) setReloadTick((t) => t + 1);
        }, delay);
      } else {
        setFailed(true);
      }
    };

    getNativeAd(adKey)
      .then((result) => {
        if (cancelled || !mountedRef.current) return;
        if (result) setAd(result);
        else onNoAd();
      })
      .catch(() => onNoAd());

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [adKey, reloadTick]);

  // Take ZERO space until a real ad is ready. Native fill is low (and brand-new
  // units fill poorly for a day or two), so a reserved skeleton would leave a
  // blank box on every slot Google doesn't fill. Collapsing while loading /
  // failed (matches the banner) means unfilled slots just vanish and the feed
  // stays clean; the card pops in only when an ad actually arrives.
  if (failed || !ad) return null;

  const C = isDarkMode
    ? config.darkColors
    : {
        surface: '#ffffff',
        border: '#e5e7eb',
        textPrimary: '#0f172a',
        textSecondary: '#64748b',
      };

  return (
    <NativeAdView
      nativeAd={ad}
      style={[styles.card, { backgroundColor: C.surface, borderColor: C.border }]}
    >
      {/* Top row: Sponsored badge (left) — AdChoices is overlaid by the SDK
          on the right, so we keep that corner padded/clear. */}
      <View style={styles.topRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>Sponsored</Text>
        </View>
        <View style={styles.adChoicesSpace} />
      </View>

      {/* Header: icon + headline + advertiser */}
      <View style={styles.header}>
        {ad.icon && ad.icon.url ? (
          <NativeAsset assetType={NativeAssetType.ICON}>
            <Image source={{ uri: ad.icon.url }} style={styles.icon} />
          </NativeAsset>
        ) : null}
        <View style={styles.headerText}>
          <NativeAsset assetType={NativeAssetType.HEADLINE}>
            <Text numberOfLines={1} style={[styles.headline, { color: C.textPrimary }]}>
              {ad.headline}
            </Text>
          </NativeAsset>
          {ad.advertiser ? (
            <NativeAsset assetType={NativeAssetType.ADVERTISER}>
              <Text numberOfLines={1} style={[styles.advertiser, { color: C.textSecondary }]}>
                {ad.advertiser}
              </Text>
            </NativeAsset>
          ) : null}
        </View>
      </View>

      {/* Media (image or video) */}
      {ad.mediaContent ? (
        <NativeMediaView style={styles.media} resizeMode="cover" />
      ) : null}

      {/* Body */}
      {ad.body ? (
        <NativeAsset assetType={NativeAssetType.BODY}>
          <Text numberOfLines={2} style={[styles.body, { color: C.textSecondary }]}>
            {ad.body}
          </Text>
        </NativeAsset>
      ) : null}

      {/* Footer: star rating + CTA */}
      <View style={styles.footer}>
        {typeof ad.starRating === 'number' && ad.starRating > 0 ? (
          <NativeAsset assetType={NativeAssetType.STAR_RATING}>
            <Text style={styles.stars}>
              {'★'.repeat(Math.round(ad.starRating))}
              <Text style={{ color: C.textSecondary }}>
                {'★'.repeat(Math.max(0, 5 - Math.round(ad.starRating)))}
              </Text>
            </Text>
          </NativeAsset>
        ) : (
          <View />
        )}
        {ad.callToAction ? (
          <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
            <View style={[styles.cta, { backgroundColor: config.colors.secondary }]}>
              <Text style={styles.ctaText}>{ad.callToAction}</Text>
            </View>
          </NativeAsset>
        ) : null}
      </View>
    </NativeAdView>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginHorizontal: 12,
    marginVertical: 6,
  },
  skeleton: {
    height: 220,
    opacity: 0.5,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  badge: {
    backgroundColor: 'rgba(120,120,128,0.16)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9ca3af',
    letterSpacing: 0.3,
  },
  // Reserve room so the SDK's AdChoices overlay (top-right) never covers content.
  adChoicesSpace: {
    width: 24,
    height: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    marginRight: 10,
    backgroundColor: 'rgba(120,120,128,0.12)',
  },
  headerText: {
    flex: 1,
  },
  headline: {
    fontSize: 15,
    fontWeight: '700',
  },
  advertiser: {
    fontSize: 12,
    marginTop: 1,
  },
  media: {
    width: '100%',
    height: 160,
    borderRadius: 10,
    marginTop: 10,
    backgroundColor: 'rgba(120,120,128,0.08)',
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  stars: {
    fontSize: 14,
    color: '#f5a623',
  },
  cta: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 9,
  },
  ctaText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
});

export default React.memo(NativeAdCard);
