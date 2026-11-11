/**
 * Trade Scanner "Share result" card (2026-11-11).
 * The same file lives in all three apps (mm2values, adoptme-jan7, Blox_Fruit);
 * only BRAND differs. Keep them in step.
 *
 * A branded picture of a scanned trade (verdict, both sides, totals, app name
 * and site address) that the user can post where people ask "W or L?".
 * Plan + mockups: Ops/proposals/scanner-share-card-2026-11-11.md and
 * Ops/proposals/scanner-share-card-mockups/ (light design, owner-approved).
 *
 * The card is rebuilt from the recognised items only. It never contains the
 * user's own photo or screenshot (Roblox usernames, often kids).
 * No interstitial before this share (owner decision 2026-11-11).
 *
 * Laid out at 540 x 675 (half the 1080 x 1350 mockup), captured at 1080 x 1350
 * (4:5, a Facebook / Instagram portrait post). The preview shows it scaled
 * down to fit the screen; the capture is of the unscaled card.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, Modal, TouchableOpacity, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native';
import ViewShot from 'react-native-view-shot';
import Share from 'react-native-share';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { trackGrowthEvent } from '../Helper/growthAnalytics';

// Per-app branding (store name, site, colours).
const BRAND = {
  app: 'Blox Fruit Values',
  site: 'bloxfruitscalc.com/trade-scanner',
  link: 'https://bloxfruitscalc.com/trade-scanner?utm_source=app_share&utm_medium=scan_card&utm_campaign=blox',
  accent: '#1E88E5',
  icon: require('../../assets/share-card-icon.png'), // the launcher icon
  iconBg: 'transparent',
  fanKey: 'trade_scanner.card_fan',
  fanDefault: 'Fan-made. Not affiliated with Roblox.',
};

const CARD_W = 540;
const CARD_H = 675;
const OUT = { width: 1080, height: 1350 };
const MAX_TILES = 9; // more than this: 8 tiles + "+N more"
const LOAD_WAIT_MS = 3000; // share anyway if an item picture never loads

// Tile size follows the item count on that side (mockup rule).
const sizeFor = (n) => (n <= 2 ? 'l' : n <= 4 ? 'm' : 's');
// Heights checked on a captured card (2026-11-11): the tiles area is ~245 dp
// tall, so 2 rows of m and 3 rows of s must stay under that with their labels.
const TILE = {
  l: { w: 100, box: 100, img: 85, name: 12.5, value: 12.5, gapX: 7, gapY: 7 },
  m: { w: 84, box: 72, img: 62, name: 11, value: 11, gapX: 7, gapY: 5 },
  s: { w: 64, box: 46, img: 40, name: 8.5, value: 9.5, gapX: 5, gapY: 3 },
};

function Side({ title, items, total, formatValue, onImage, totalLabel, moreLabel }) {
  const size = sizeFor(items.length);
  const tile = TILE[size];
  const shown = items.length > MAX_TILES ? items.slice(0, MAX_TILES - 1) : items;
  const extra = items.length - shown.length;
  return (
    <View style={styles.side}>
      <Text style={styles.sideTitle}>{title}</Text>
      <View style={[styles.tiles, { columnGap: tile.gapX, rowGap: tile.gapY }]}>
        {shown.map((it, i) => (
          <View key={`${it.name}-${i}`} style={{ width: tile.w, alignItems: 'center' }}>
            <View style={[styles.tileBox, { width: tile.w, height: tile.box, borderRadius: size === 's' ? 9 : 12 }]}>
              {it.badges && it.badges.length ? (
                <View style={styles.badges}>
                  {it.badges.map(([k, color]) => (
                    <View key={k} style={[styles.badge, { backgroundColor: color }, size === 's' && styles.badgeSmall]}>
                      <Text style={[styles.badgeText, size === 's' && styles.badgeTextSmall]}>{k}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {it.image ? (
                <Image
                  source={{ uri: it.image }}
                  style={{ width: tile.img, height: tile.img }}
                  resizeMode="contain"
                  onLoadEnd={onImage}
                />
              ) : null}
            </View>
            <Text style={[styles.tileName, { fontSize: tile.name, marginTop: size === 's' ? 2.5 : 5 }]} numberOfLines={1}>{it.name}</Text>
            <Text style={[styles.tileValue, { fontSize: tile.value }]} numberOfLines={1}>{formatValue(it.value)}</Text>
          </View>
        ))}
        {extra > 0 && (
          <View style={{ width: tile.w, alignItems: 'center' }}>
            <View style={[styles.tileBox, { width: tile.w, height: tile.box, borderRadius: 9 }]}>
              <Text style={styles.moreText}>+{extra}</Text>
            </View>
            <Text style={[styles.tileName, { fontSize: tile.name, marginTop: 2.5 }]} numberOfLines={1}>{moreLabel}</Text>
          </View>
        )}
      </View>
      <View style={styles.total}>
        <Text style={styles.totalLabel}>{totalLabel}</Text>
        <Text style={styles.totalValue} numberOfLines={1} adjustsFontSizeToFit>{formatValue(total)}</Text>
      </View>
    </View>
  );
}

export default function ShareResultCard({ visible, onClose, verdict, mine, theirs, totalMine, totalTheirs, formatValue, source }) {
  const { t } = useTranslation();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const shotRef = useRef(null);
  const [loaded, setLoaded] = useState(0);
  const [waited, setWaited] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [failed, setFailed] = useState(false);

  // Only pictures that are actually shown count (the 9th+ hide behind "+N").
  const shownWithImage = useMemo(() => {
    const shown = (list) => (list.length > MAX_TILES ? list.slice(0, MAX_TILES - 1) : list);
    return [...shown(mine), ...shown(theirs)].filter((it) => it.image).length;
  }, [mine, theirs]);

  useEffect(() => {
    if (!visible) return undefined;
    setLoaded(0);
    setWaited(false);
    setFailed(false);
    trackGrowthEvent('trade_scan_share_open', { verdict: verdict?.status || '', items: mine.length + theirs.length });
    const timer = setTimeout(() => setWaited(true), LOAD_WAIT_MS);
    return () => clearTimeout(timer);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const onImage = useCallback(() => setLoaded((n) => n + 1), []);
  const ready = waited || loaded >= shownWithImage;

  const share = async () => {
    if (!shotRef.current || sharing) return;
    setSharing(true);
    setFailed(false);
    try {
      const uri = await shotRef.current.capture();
      const message = t('trade_scanner.share_message', {
        defaultValue: 'Is this a W? I checked it with the {{app}} Trade Scanner: {{url}}',
        app: BRAND.app,
        url: BRAND.link,
      });
      const res = await Share.open({ url: uri, type: 'image/png', message, failOnCancel: false });
      trackGrowthEvent('trade_scan_share', {
        verdict: verdict?.status || '',
        items: mine.length + theirs.length,
        source: source || '',
        // Android often reports the chosen app; iOS usually does not.
        target: String(res?.message || res?.app || (res?.dismissedAction ? 'dismissed' : '')).slice(0, 80),
        done: res?.success ? 1 : 0,
      });
      onClose();
    } catch (err) {
      setFailed(true);
    } finally {
      setSharing(false);
    }
  };

  // Preview: as big as the screen allows, never bigger than the card itself.
  const scale = Math.min(1, (screenW - 32) / CARD_W, (screenH * 0.68) / CARD_H);
  const big = (verdict?.label || '').toUpperCase();
  const scanned = source === 'camera'
    ? t('trade_scanner.card_from_photo', { defaultValue: 'Scanned from a photo' })
    : t('trade_scanner.card_from_screenshot', { defaultValue: 'Scanned from a screenshot' });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={{ width: CARD_W * scale, height: CARD_H * scale }}>
          <View style={{ width: CARD_W, height: CARD_H, transform: [{ scale }], transformOrigin: 'top left' }}>
            <ViewShot ref={shotRef} options={{ format: 'png', quality: 1, result: 'tmpfile', ...OUT }} style={styles.card}>
              <View style={styles.top}>
                <Text style={styles.kicker}>{t('trade_scanner.card_kicker', { defaultValue: 'Trade check' })}</Text>
                <View style={styles.scanRow}>
                  <View style={[styles.dot, { backgroundColor: BRAND.accent }]} />
                  <Text style={styles.scanText} numberOfLines={1}>{scanned}</Text>
                </View>
              </View>

              <View style={[styles.verdict, { backgroundColor: verdict?.color || '#F5A623' }]}>
                <Text style={styles.verdictBig} numberOfLines={1} adjustsFontSizeToFit>{big} {verdict?.pct}</Text>
                <Text style={styles.verdictSub} numberOfLines={1}>
                  {t('trade_scanner.card_get_for', { defaultValue: 'You get {{get}} for {{give}}', get: formatValue(totalTheirs), give: formatValue(totalMine) })}
                </Text>
              </View>

              <View style={styles.sides}>
                <Side
                  title={t('trade_scanner.you_give', { defaultValue: 'You give' })}
                  items={mine}
                  total={totalMine}
                  formatValue={formatValue}
                  onImage={onImage}
                  totalLabel={t('trade_scanner.card_total', { defaultValue: 'Total' })}
                  moreLabel={t('trade_scanner.card_more', { defaultValue: 'more' })}
                />
                <Side
                  title={t('trade_scanner.you_get', { defaultValue: 'You get' })}
                  items={theirs}
                  total={totalTheirs}
                  formatValue={formatValue}
                  onImage={onImage}
                  totalLabel={t('trade_scanner.card_total', { defaultValue: 'Total' })}
                  moreLabel={t('trade_scanner.card_more', { defaultValue: 'more' })}
                />
              </View>

              <View style={styles.foot}>
                <View style={[styles.iconWrap, { backgroundColor: BRAND.iconBg }]}>
                  <Image source={BRAND.icon} style={BRAND.iconBg === 'transparent' ? styles.iconFull : styles.icon} resizeMode="contain" />
                </View>
                <View style={styles.footText}>
                  <Text style={styles.appName} numberOfLines={1}>{BRAND.app}</Text>
                  <Text style={styles.tagline} numberOfLines={1} adjustsFontSizeToFit>
                    {t('trade_scanner.card_tagline', { defaultValue: 'Free Trade Scanner: is your trade a W or L?' })}
                  </Text>
                  <View style={[styles.urlPill, { backgroundColor: BRAND.accent }]}>
                    <Text style={styles.urlText} numberOfLines={1}>{BRAND.site}</Text>
                  </View>
                </View>
              </View>
              <Text style={styles.fan} numberOfLines={1}>{t(BRAND.fanKey, { defaultValue: BRAND.fanDefault })}</Text>
            </ViewShot>
          </View>
        </View>

        {failed && (
          <Text style={styles.failed}>{t('share_trade.share_failed', { defaultValue: 'Could not share. Please try again.' })}</Text>
        )}
        <View style={[styles.actions, { width: Math.max(260, CARD_W * scale) }]}>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} accessibilityLabel={t('trade_scanner.close', { defaultValue: 'Close' })}>
            <Icon name="close" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.shareBtn, { backgroundColor: BRAND.accent, opacity: ready && !sharing ? 1 : 0.6 }]}
            onPress={share}
            disabled={!ready || sharing}
            activeOpacity={0.85}
          >
            {sharing || !ready ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="share-social" size={18} color="#fff" />}
            <Text style={styles.shareText}>{t('trade_scanner.share_result', { defaultValue: 'Share result' })}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: CARD_W, height: CARD_H, backgroundColor: '#F4F5F8', paddingTop: 24, paddingHorizontal: 28, paddingBottom: 18, borderRadius: 0 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 },
  kicker: { fontSize: 15, fontWeight: '700', color: '#6B7280', letterSpacing: 0.5, textTransform: 'uppercase' },
  scanRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, marginLeft: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  scanText: { fontSize: 14, fontWeight: '600', color: '#6B7280', flexShrink: 1 },
  verdict: { borderRadius: 18, alignItems: 'center', paddingTop: 12, paddingBottom: 12, paddingHorizontal: 10 },
  verdictBig: { color: '#fff', fontSize: 62, fontWeight: '900', letterSpacing: 1, includeFontPadding: false },
  verdictSub: { color: '#fff', fontSize: 17, fontWeight: '600', marginTop: 4 },
  sides: { flex: 1, flexDirection: 'row', gap: 11, marginTop: 13 },
  side: { flex: 1, minWidth: 0, backgroundColor: '#fff', borderRadius: 15, paddingTop: 10, paddingHorizontal: 9, paddingBottom: 9 },
  sideTitle: { fontSize: 15, fontWeight: '800', color: '#374151', textAlign: 'center', marginBottom: 6 },
  tiles: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignContent: 'center' },
  tileBox: { backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  tileName: { fontWeight: '700', color: '#111827', textAlign: 'center' },
  tileValue: { fontWeight: '600', color: '#6B7280', textAlign: 'center', marginTop: 1 },
  moreText: { fontSize: 22, fontWeight: '900', color: '#6B7280' },
  badges: { position: 'absolute', top: 3, left: 3, flexDirection: 'row', gap: 2, zIndex: 1 },
  badge: { minWidth: 15, height: 15, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeSmall: { minWidth: 11, height: 11, borderRadius: 6, paddingHorizontal: 2 },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  badgeTextSmall: { fontSize: 7 },
  total: { borderTopWidth: 1, borderTopColor: '#EEF0F3', marginTop: 6, paddingTop: 6, alignItems: 'center' },
  totalLabel: { fontSize: 14, fontWeight: '600', color: '#6B7280' },
  totalValue: { fontSize: 21, fontWeight: '900', color: '#111827', marginTop: 1 },
  foot: { marginTop: 12, backgroundColor: '#fff', borderRadius: 15, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 54, height: 54, borderRadius: 13, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  icon: { width: 46, height: 46 },
  iconFull: { width: 54, height: 54 },
  footText: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  appName: { fontSize: 18, fontWeight: '900', color: '#111827' },
  tagline: { fontSize: 13, fontWeight: '600', color: '#6B7280', marginTop: 1 },
  urlPill: { marginTop: 6, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  urlText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  fan: { textAlign: 'center', fontSize: 10.5, color: '#9CA3AF', marginTop: 7 },
  failed: { color: '#fff', fontSize: 13, fontWeight: '600', marginTop: 10, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  closeBtn: { width: 48, height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)', alignItems: 'center', justifyContent: 'center' },
  shareBtn: { flex: 1, height: 48, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  shareText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
