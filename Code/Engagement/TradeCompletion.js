/**
 * TradeCompletion.js
 * Modal for logging completed trades after calculating them.
 *
 * Flow:
 * 1. User finishes calculating a trade in HomeScreen
 * 2. Taps "Log Trade"
 * 3. Modal asks: Rate trade (Win/Fair/Loss) + optional notes
 * 4. Trade saved to RTDB tradeJournal/{uid} → XP awarded
 * 5. Auto-updates owned fruits: removes gave items, adds got items
 *
 * Item shapes — the calculator and the inventory encode variants differently:
 *   calculator (HomeScreen adjustedData): { Name, Value, Type: 'p' | 'n', Price }
 *   inventory  (TradeJournal picker):     { ...catalogRow, type: 'p' | 'f' | 'gamepass' }
 * Both mean the same thing: 'p' = permanent, anything else = physical. normalizeItem()
 * below collapses them to the inventory's convention so matching can't silently miss.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  Modal, View, Text, TouchableOpacity, TextInput,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ref, get, set, push, serverTimestamp } from '@react-native-firebase/database';
import { doc, getDoc, setDoc } from '@react-native-firebase/firestore';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import SwipeableBottomDrawer from '../Helper/SwipeableBottomDrawer';
import { getThemeColors } from '../Helper/themeColors';
import { useLocalState } from '../LocalGlobelStats';
import config from '../Helper/Environment';
import { addXP, XP_ACTIONS } from './xpUtils';
import { checkThresholdBadges, TRADE_BADGE_THRESHOLDS, checkNightOwlTrade } from '../ChatScreen/GroupChat/badgeUtils';
import InterstitialAdManager from '../Ads/IntAd';

const TRADE_RATINGS = [
  { key: 'win', labelKey: 'engagement.trade_completion.rating_win', emoji: '🏆', color: '#10B981', descKey: 'engagement.trade_completion.rating_win_desc' },
  { key: 'fair', labelKey: 'engagement.trade_completion.rating_fair', emoji: '🤝', color: '#F59E0B', descKey: 'engagement.trade_completion.rating_fair_desc' },
  { key: 'loss', labelKey: 'engagement.trade_completion.rating_loss', emoji: '📉', color: '#EF4444', descKey: 'engagement.trade_completion.rating_loss_desc' },
];

// Calculator item or inventory item → the one shape stored in the journal.
const normalizeItem = (item) => ({
  name: item?.Name ?? item?.name ?? 'Unknown',
  // 'p' = permanent, 'f' = physical. Gamepasses have no permanent variant, so
  // they keep their own type and only ever match themselves.
  type: (item?.Type ?? item?.type) === 'p'
    ? 'p'
    : (item?.type === 'gamepass' ? 'gamepass' : 'f'),
  value: Number(item?.Value ?? item?.value) || 0,
});

const TradeCompletion = ({
  visible,
  onClose,
  db,
  uid,
  isDarkMode,
  hasItems = [],
  wantsItems = [],
  tradeResult = 'fair',
  partnerName = '',
  firestoreDB,
}) => {
  const { localState, updateLocalState } = useLocalState();
  const { t } = useTranslation();
  // This app's SwipeableBottomDrawer doesn't apply the bottom safe-area inset
  // (the Adopt Me copy does), so pad here or the Save button sits under the
  // system nav bar.
  const insets = useSafeAreaInsets();
  const [selectedRating, setSelectedRating] = useState(tradeResult);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [didScam, setDidScam] = useState(false);
  const [saved, setSaved] = useState(false);
  const [inventoryMsg, setInventoryMsg] = useState('');

  // Warm the interstitial when the log-trade sheet opens so a non-Pro user
  // gets a filled ad on save instead of a no-fill miss. Idempotent + Pro-gated.
  useEffect(() => {
    if (visible && !localState?.isPro) {
      try { InterstitialAdManager.prepare(); } catch (_) {}
    }
  }, [visible, localState?.isPro]);

  const handleSave = useCallback(async () => {
    if (!db || !uid) return;
    const gave = hasItems.filter(i => i).map(normalizeItem);
    const got = wantsItems.filter(i => i).map(normalizeItem);
    if (gave.length === 0 || got.length === 0) {
      Alert.alert(t('engagement.trade_completion.both_sides_title'), t('engagement.trade_completion.both_sides_msg'));
      return;
    }
    setSaving(true);

    const gaveValue = gave.reduce((s, f) => s + f.value, 0);
    const gotValue = got.reduce((s, f) => s + f.value, 0);

    try {
      // Save to journal
      await push(ref(db, `tradeJournal/${uid}`), {
        gave,
        got,
        result: selectedRating,
        gaveValue,
        gotValue,
        partnerName: partnerName || 'Unknown',
        notes: notes.trim() || '',
        didScam,
        completedAt: serverTimestamp(),
      });

      // Award XP
      addXP(db, uid, XP_ACTIONS.COMPLETE_TRADE, 'COMPLETE_TRADE');

      // Update running trade stats
      try {
        const statsSnap = await get(ref(db, `tradeStats/${uid}`));
        const cur = statsSnap.exists() ? statsSnap.val() : { total: 0, wins: 0, fairs: 0, losses: 0, totalGave: 0, totalGot: 0 };
        const newTotal = (cur.total || 0) + 1;
        await set(ref(db, `tradeStats/${uid}`), {
          total: newTotal,
          wins: (cur.wins || 0) + (selectedRating === 'win' ? 1 : 0),
          fairs: (cur.fairs || 0) + (selectedRating === 'fair' ? 1 : 0),
          losses: (cur.losses || 0) + (selectedRating === 'loss' ? 1 : 0),
          totalGave: (cur.totalGave || 0) + gaveValue,
          totalGot: (cur.totalGot || 0) + gotValue,
        });

        // Trade-count badges (Trade→5, Star Trader→25, Diamond→100, Centurion→250).
        // tradeStats.total is the authoritative running count, so award from it.
        // Night Owl (15 trades 00:00–05:00 UTC) keeps its own dedicated counter.
        checkThresholdBadges(db, uid, newTotal, TRADE_BADGE_THRESHOLDS);
        checkNightOwlTrade(db, uid);
      } catch (e) { console.warn('[TradeCompletion] stats update error:', e?.message); }

      // Auto-update owned fruits inventory
      let addedNames = [];
      let removedNames = [];
      let notOwnedNames = [];

      if (firestoreDB) {
        try {
          const snap = await getDoc(doc(firestoreDB, 'user_profiles', uid));
          let ownedFruits = [];
          if (snap.exists()) {
            const data = snap.data();
            ownedFruits = Array.isArray(data?.ownedFruits) ? [...data.ownedFruits] : [];
          }

          // Remove gave items from owned
          gave.forEach(g => {
            const gName = g.name.toLowerCase();
            // Match exact variant first: same name + permanent/physical. Falls back
            // to name-only when exactly one entry has that name, so trading a
            // physical fruit can never silently remove your permanent one.
            let idx = ownedFruits.findIndex(f =>
              (f.name || '').toLowerCase() === gName &&
              normalizeItem(f).type === g.type
            );
            if (idx === -1) {
              const sameName = ownedFruits.filter(f => (f.name || '').toLowerCase() === gName);
              if (sameName.length === 1) {
                idx = ownedFruits.indexOf(sameName[0]);
              }
            }
            if (idx !== -1) {
              ownedFruits.splice(idx, 1);
              removedNames.push(g.name);
            } else {
              notOwnedNames.push(g.name);
            }
          });

          // Add got items to owned
          got.forEach(g => {
            ownedFruits.push({
              name: g.name,
              type: g.type,
              value: g.value,
              addedAt: new Date().toISOString(),
              addedVia: 'trade',
            });
            addedNames.push(g.name);
          });

          await setDoc(doc(firestoreDB, 'user_profiles', uid), { ownedFruits }, { merge: true });

          // Mirror to MMKV so My Stuff and the Home widget show the post-trade
          // inventory immediately instead of only after the next Firestore fetch.
          updateLocalState('ownedFruits', ownedFruits);
        } catch (e) {
          console.warn('[TradeCompletion] inventory update error:', e?.message);
        }
      }

      // Build success message
      let msg = `${t('engagement.trade_completion.xp_earned', { xp: XP_ACTIONS.COMPLETE_TRADE })}\n`;
      if (addedNames.length > 0) msg += `${t('engagement.trade_completion.added', { names: addedNames.join(', ') })}\n`;
      if (removedNames.length > 0) msg += `${t('engagement.trade_completion.removed', { names: removedNames.join(', ') })}\n`;
      if (notOwnedNames.length > 0) msg += t('engagement.trade_completion.not_in_list', { names: notOwnedNames.join(', ') });
      setInventoryMsg(msg.trim());

      // Warn if items weren't in owned list
      if (notOwnedNames.length > 0) {
        Alert.alert(
          t('engagement.trade_completion.heads_up_title'),
          t('engagement.trade_completion.heads_up_msg', { count: notOwnedNames.length, names: notOwnedNames.join(', ') })
        );
      }

      setSaved(true);

      // Trade is already saved — show an interstitial to non-Pro users. The ad
      // is purely post-hoc, so its callback is a no-op and nothing is gated on
      // it. Deferred a beat so the success state paints first (and so any
      // "not in your list" heads-up Alert isn't hidden behind the ad).
      if (!localState?.isPro) {
        setTimeout(() => {
          try {
            InterstitialAdManager.showAd(() => {});
          } catch (err) {
            console.warn('[TradeCompletion] Failed to show ad:', err?.message);
          }
        }, 500);
      }
    } catch (err) {
      console.warn('[TradeCompletion] save error:', err?.message);
      Alert.alert(t('home.alert.error'), t('engagement.trade_completion.save_error'));
    }
    setSaving(false);
  }, [db, uid, hasItems, wantsItems, selectedRating, notes, partnerName, didScam, firestoreDB, updateLocalState, localState?.isPro, t]);

  const handleClose = useCallback(() => {
    setSelectedRating(tradeResult);
    setNotes('');
    setDidScam(false);
    setSaved(false);
    setInventoryMsg('');
    onClose();
  }, [onClose, tradeResult]);

  if (!visible) return null;

  const c = getThemeColors(isDarkMode);
  const bg = c.bg;
  const cardBg = c.bgAlt;
  const textColor = c.text;
  const subtextColor = c.textSecondary;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <SwipeableBottomDrawer
          onClose={handleClose}
          isDarkMode={isDarkMode}
          style={[styles.container, { backgroundColor: bg, paddingBottom: 20 + insets.bottom }]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.title, { color: textColor }]}>{t('engagement.trade_completion.title')}</Text>
              <TouchableOpacity
                onPress={() => Alert.alert(
                  t('engagement.trade_completion.title'),
                  t('engagement.trade_completion.info_msg')
                )}
              >
                <FontAwesome name="circle-info" size={16} color={config.colors.primary} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={handleClose} style={{ padding: 4 }}>
              <Text style={{ fontSize: 20, color: subtextColor }}>✕</Text>
            </TouchableOpacity>
          </View>

          {saved ? (
            /* Success state */
            <View style={styles.successWrap}>
              <Text style={{ fontSize: 48 }}>🎉</Text>
              <Text style={[styles.successTitle, { color: textColor }]}>{t('engagement.trade_completion.saved_title')}</Text>
              <Text style={[styles.successSub, { color: subtextColor, textAlign: 'center' }]}>
                {inventoryMsg || t('engagement.trade_completion.saved_sub', { xp: XP_ACTIONS.COMPLETE_TRADE })}
              </Text>
              <TouchableOpacity style={styles.doneBtn} onPress={handleClose}>
                <Text style={styles.doneBtnText}>{t('engagement.trade_completion.done')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {/* Trade summary */}
              <View style={[styles.summaryCard, { backgroundColor: cardBg }]}>
                <View style={styles.summaryRow}>
                  <View style={styles.summaryCol}>
                    <Text style={[styles.summaryLabel, { color: subtextColor }]}>{t('engagement.trade_completion.i_gave')}</Text>
                    <Text style={[styles.summaryCount, { color: textColor }]}>
                      {t('engagement.trade_completion.items_count', { count: hasItems.filter(i => i).length })}
                    </Text>
                  </View>
                  <FontAwesome name="arrow-right-arrow-left" size={16} color={subtextColor} />
                  <View style={styles.summaryCol}>
                    <Text style={[styles.summaryLabel, { color: subtextColor }]}>{t('engagement.trade_completion.i_got')}</Text>
                    <Text style={[styles.summaryCount, { color: textColor }]}>
                      {t('engagement.trade_completion.items_count', { count: wantsItems.filter(i => i).length })}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Rate trade */}
              <Text style={[styles.sectionTitle, { color: textColor }]}>{t('engagement.trade_completion.how_did_it_go')}</Text>
              <View style={styles.ratingRow}>
                {TRADE_RATINGS.map((r) => (
                  <TouchableOpacity
                    key={r.key}
                    style={[
                      styles.ratingCard,
                      { backgroundColor: cardBg },
                      selectedRating === r.key && {
                        borderColor: r.color,
                        borderWidth: 2,
                        backgroundColor: r.color + '15',
                      },
                    ]}
                    onPress={() => setSelectedRating(r.key)}
                    activeOpacity={0.7}
                  >
                    <Text style={{ fontSize: 24 }}>{r.emoji}</Text>
                    <Text style={[styles.ratingLabel, { color: textColor }]}>{t(r.labelKey)}</Text>
                    <Text style={[styles.ratingDesc, { color: subtextColor }]}>{t(r.descKey)}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Notes */}
              <TextInput
                style={[styles.notesInput, {
                  color: textColor,
                  backgroundColor: cardBg,
                  borderColor: c.border,
                }]}
                placeholder={t('engagement.trade_completion.notes_placeholder')}
                placeholderTextColor={subtextColor}
                value={notes}
                onChangeText={setNotes}
                maxLength={100}
              />

              {/* Scam flag */}
              <TouchableOpacity
                style={[styles.scamRow, {
                  backgroundColor: didScam ? '#FEE2E2' : cardBg,
                  borderColor: didScam ? '#EF4444' : 'transparent',
                }]}
                onPress={() => setDidScam(!didScam)}
                activeOpacity={0.7}
              >
                <FontAwesome
                  name={didScam ? 'circle-check' : 'circle'}
                  size={18}
                  color={didScam ? '#EF4444' : subtextColor}
                  solid={didScam}
                />
                <Text style={[styles.scamText, { color: didScam ? '#EF4444' : subtextColor }]}>
                  {t('engagement.trade_completion.scammed_me')}
                </Text>
              </TouchableOpacity>

              {/* Save button */}
              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.5 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator size="small" color="#FFF" />
                    <Text style={styles.saveBtnText}>{t('engagement.trade_completion.saving')}</Text>
                  </View>
                ) : (
                  <Text style={styles.saveBtnText}>{t('engagement.trade_completion.save_btn')}</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </SwipeableBottomDrawer>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  container: { padding: 20, maxHeight: '85%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '800' },
  // Summary
  summaryCard: { borderRadius: 12, padding: 14, marginBottom: 16 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  summaryCol: { alignItems: 'center' },
  summaryLabel: { fontSize: 11, fontWeight: '600', marginBottom: 2 },
  summaryCount: { fontSize: 16, fontWeight: '700' },
  // Rating
  sectionTitle: { fontSize: 14, fontWeight: '700', marginBottom: 10 },
  ratingRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  ratingCard: {
    flex: 1, alignItems: 'center', padding: 12, borderRadius: 12,
    borderWidth: 1, borderColor: 'transparent',
  },
  ratingLabel: { fontSize: 13, fontWeight: '700', marginTop: 4 },
  ratingDesc: { fontSize: 9, marginTop: 2, textAlign: 'center' },
  // Notes
  notesInput: {
    borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, marginBottom: 12,
  },
  // Scam
  scamRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 16,
  },
  scamText: { fontSize: 13, fontWeight: '500' },
  // Save
  saveBtn: {
    backgroundColor: config.colors.primary, paddingVertical: 14, borderRadius: 12, alignItems: 'center',
  },
  saveBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  // Success
  successWrap: { alignItems: 'center', paddingVertical: 30 },
  successTitle: { fontSize: 22, fontWeight: '800', marginTop: 8 },
  successSub: { fontSize: 13, marginTop: 4, lineHeight: 20 },
  doneBtn: {
    marginTop: 20, backgroundColor: '#10B981', paddingHorizontal: 30,
    paddingVertical: 12, borderRadius: 12,
  },
  doneBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
});

export default React.memo(TradeCompletion);
