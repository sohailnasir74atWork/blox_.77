/**
 * CardShareSheet — turns one card into a 9:16 share picture (stories, TikTok,
 * WhatsApp status) and opens the share sheet. The picture is laid out at
 * 360×640 and captured at 1080×1920. Background: SH-PULL-* art when it is
 * uploaded, painted rays until then.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, Image, StyleSheet, ActivityIndicator } from 'react-native';
import ViewShot from 'react-native-view-shot';
import Share from 'react-native-share';
import { useTranslation } from 'react-i18next';
import config from '../Helper/Environment';
import FruitCard from './FruitCard';
import { assetUri } from './cardArt';
import { RARITY_STYLE, themeIdFor, themeOf } from './cardConfig';

const SITE = 'bloxfruitscalc.com';

export default function CardShareSheet({ card, total, onClose }) {
  const { t } = useTranslation();
  const shot = useRef(null);
  const [busy, setBusy] = useState(false);
  const visible = !!card;

  const share = async () => {
    if (!shot.current || busy) return;
    setBusy(true);
    try {
      const uri = await shot.current.capture();
      // The share sheet is our own trip out of the app: coming back must not
      // trigger an app-open ad (same hook the purchase sheet uses).
      try { require('../Ads/openApp').default.skipNextForeground(); } catch (e) { /* ads optional */ }
      await Share.open({
        url: uri,
        type: 'image/png',
        message: t('fruit_cards.share_message', { pet: card.name, url: `https://${SITE}` }),
        failOnCancel: false,
      });
    } catch (e) {
      if (e?.message !== 'User did not share') console.warn('[FruitCards] share failed:', e?.message);
    } finally {
      setBusy(false);
    }
  };

  // Open the share sheet as soon as the picture has rendered.
  useEffect(() => {
    if (!visible) return undefined;
    const id = setTimeout(share, 450);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!card) return null;
  const themeId = themeIdFor(card);
  const th = themeOf(themeId);
  const rs = RARITY_STYLE[card.rarity] || RARITY_STYLE.common;
  const bg = assetUri(`SH-PULL-${String(themeId).toUpperCase()}`);
  const headline = card.finish && card.finish !== 'classic'
    ? t('fruit_cards.share_headline_finish', { finish: t(`fruit_cards.finish.${card.finish}`), rarity: t(`fruit_cards.rarity.${card.rarity}`) })
    : t('fruit_cards.share_headline', { rarity: t(`fruit_cards.rarity.${card.rarity}`) });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.previewBox}>
          <ViewShot ref={shot} options={{ format: 'png', quality: 1, width: 1080, height: 1920 }} style={styles.canvas}>
            <View style={[StyleSheet.absoluteFill, { backgroundImage: `radial-gradient(ellipse 70% 45% at 50% 48%, ${rs.glow} 0%, ${th.stage[1]} 45%, ${th.stage[0]} 100%)` }]} />
            {bg ? <Image resizeMethod="resize" source={{ uri: bg }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : (
              <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <View key={i} style={{ position: 'absolute', width: 26, height: 900, opacity: 0.18, backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0) 0%, ${rs.glow} 50%, rgba(0,0,0,0) 100%)`, transform: [{ rotate: `${i * 15}deg` }] }} />
                ))}
              </View>
            )}
            <Text style={styles.kicker}>{t('fruit_cards.title').toUpperCase()}</Text>
            <Text style={styles.headline} numberOfLines={2}>{headline}</Text>
            <View style={styles.cardSlot}>
              <FruitCard card={card} finish={card.finish} serial={card.serial} width={250} total={total} />
            </View>
            <View style={styles.footer}>
              <Text style={styles.app}>{config.appName}</Text>
              <Text style={styles.site}>{SITE}</Text>
              <Text style={styles.fan}>{t('fruit_cards.disclaimer_short')}</Text>
            </View>
          </ViewShot>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.btn, { backgroundColor: th.accent }]} onPress={share} disabled={busy}>
            {busy ? <ActivityIndicator color="#1A0E00" /> : <Text style={styles.btnText}>{t('fruit_cards.share')}</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.ghost]} onPress={onClose}>
            <Text style={[styles.btnText, { color: '#F4ECFF' }]}>{t('fruit_cards.close')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.82)', alignItems: 'center', justifyContent: 'center' },
  previewBox: { width: 360 * 0.82, height: 640 * 0.82, overflow: 'hidden', borderRadius: 18 },
  // Laid out at 360x640 (the capture size / 3), shown scaled down.
  canvas: { width: 360, height: 640, transform: [{ scale: 0.82 }], left: -(360 * 0.09), top: -(640 * 0.09), backgroundColor: '#07040F', alignItems: 'center' },
  kicker: { marginTop: 54, color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '900', letterSpacing: 3 },
  headline: { marginTop: 6, color: '#FFFFFF', fontSize: 26, fontWeight: '900', textAlign: 'center', paddingHorizontal: 24, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 8 },
  cardSlot: { marginTop: 26 },
  footer: { position: 'absolute', bottom: 34, alignItems: 'center' },
  app: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  site: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '700', marginTop: 2 },
  fan: { color: 'rgba(255,255,255,0.45)', fontSize: 9, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 18 },
  btn: { height: 48, paddingHorizontal: 28, borderRadius: 24, alignItems: 'center', justifyContent: 'center', minWidth: 120 },
  ghost: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  btnText: { color: '#1A0E00', fontWeight: '900', fontSize: 15 },
});
