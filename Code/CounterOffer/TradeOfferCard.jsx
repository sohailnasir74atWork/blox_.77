// TradeOfferCard — a `trade_offer` DM message (2026-11-05, features LOG
// "Counter offer"). Two compact rows of item art, both totals, the RECEIVER's
// win/fair/lose, a status chip and the viewer's actions.
//
// Shared file: identical in Adopt Me, Blox and MM2. Game specifics come in as
// props (image resolver, value formatter, variant badges, verdict function,
// source line), never from imports. Visual language follows
// Homescreen/SlotActionSheet.jsx: 14px radius, neutral chips, primary colour
// only on the main action.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Image, ActivityIndicator, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import {
  OFFER_ACTION,
  OFFER_STATUS,
  offerActionsFor,
  receiverVerdict,
  groupOfferItems,
  adoptMeVariantText,
} from './counterOffer';

const TILE = 32;
const MAX_TILES = 6; // one row at the bubble's width; the 6th becomes "+N"

const VERDICT_COLOR = { win: '#16a34a', fair: '#d97706', lose: '#dc2626' };

const STATUS_STYLE = {
  [OFFER_STATUS.PENDING]: { key: 'status_pending', fallback: 'Pending', tone: 'neutral' },
  [OFFER_STATUS.ACCEPTED]: { key: 'status_trading', fallback: 'Trading', tone: 'blue' },
  [OFFER_STATUS.DECLINED]: { key: 'status_declined', fallback: 'Declined', tone: 'neutral' },
  [OFFER_STATUS.CANCELLED]: { key: 'status_cancelled', fallback: 'Cancelled', tone: 'neutral' },
  [OFFER_STATUS.COMPLETED]: { key: 'status_completed', fallback: 'Completed', tone: 'green' },
  [OFFER_STATUS.FAILED]: { key: 'status_failed', fallback: 'Failed', tone: 'red' },
};

const TONES = {
  neutral: { light: ['#f1f5f9', '#334155'], dark: ['#334155', '#e2e8f0'] },
  blue: { light: ['#dbeafe', '#1d4ed8'], dark: ['#1e3a8a', '#bfdbfe'] },
  green: { light: ['#dcfce7', '#15803d'], dark: ['#14532d', '#bbf7d0'] },
  red: { light: ['#fee2e2', '#b91c1c'], dark: ['#7f1d1d', '#fecaca'] },
};

const ACTION_LABEL = {
  [OFFER_ACTION.ACCEPT]: ['accept', 'Accept'],
  [OFFER_ACTION.DECLINE]: ['decline', 'Decline'],
  [OFFER_ACTION.CANCEL]: ['cancel_offer', 'Cancel'],
  [OFFER_ACTION.COMPLETE]: ['mark_completed', 'Mark completed'],
  [OFFER_ACTION.FAIL]: ['didnt_happen', "Didn't happen"],
};
const PRIMARY_ACTIONS = [OFFER_ACTION.ACCEPT, OFFER_ACTION.COMPLETE];

const ItemRow = ({ label, total, items, getImageUrl, variantBadges, variantText, colors }) => {
  const groups = groupOfferItems(items, variantText);
  const overflow = groups.length > MAX_TILES ? groups.length - (MAX_TILES - 1) : 0;
  const shown = overflow ? groups.slice(0, MAX_TILES - 1) : groups;
  return (
    <View style={styles.side}>
      <View style={styles.sideHead}>
        <Text style={[styles.sideLabel, { color: colors.sub }]}>{label}</Text>
        <Text style={[styles.sideTotal, { color: colors.text }]} numberOfLines={1}>{total}</Text>
      </View>
      <View style={styles.tiles}>
        {groups.length === 0 && (
          <Text style={[styles.empty, { color: colors.sub }]}>—</Text>
        )}
        {shown.map(({ item, count, key }) => {
          const badge = variantBadges(item);
          const uri = getImageUrl(item);
          return (
            <View key={key} style={[styles.tile, { backgroundColor: colors.chip }]}>
              {!!uri && <Image source={{ uri }} style={styles.tileImage} resizeMode="contain" resizeMethod="resize" />}
              {!!badge && (
                <View style={[styles.variant, { backgroundColor: badge.color }]} pointerEvents="none">
                  <Text style={styles.variantText}>{badge.label}</Text>
                </View>
              )}
              {count > 1 && (
                <View style={[styles.count, { backgroundColor: colors.countBg }]} pointerEvents="none">
                  <Text style={styles.countText}>{`x${count}`}</Text>
                </View>
              )}
            </View>
          );
        })}
        {overflow > 0 && (
          <View style={[styles.tile, { backgroundColor: colors.chip }]}>
            <Text style={[styles.more, { color: colors.neutral }]}>{`+${overflow}`}</Text>
          </View>
        )}
      </View>
    </View>
  );
};

/**
 * @param {object} props
 * @param {object} props.offer            the trade_offer payload
 * @param {boolean} props.isMine          viewer sent it
 * @param {boolean} props.isDarkMode
 * @param {string} props.primaryColor     colour of the main action only
 * @param {(item)=>string} props.getImageUrl
 * @param {(n:number)=>string} props.formatValue
 * @param {(give:number,get:number)=>'win'|'fair'|'lose'} props.statusFn
 * @param {(item)=>({label:string,color:string}|null)} [props.variantBadges]
 * @param {(item)=>string} [props.variantText]   groups duplicates
 * @param {string} [props.footerText]     e.g. "Based on Elvebredd values"
 * @param {boolean} [props.disabled]      hide actions (banned, chat closed)
 * @param {(action:string)=>Promise<any>} props.onAction
 */
const TradeOfferCard = ({
  offer, isMine, isDarkMode, primaryColor, getImageUrl, formatValue, statusFn,
  variantBadges = () => null, variantText = adoptMeVariantText, footerText, disabled, onAction,
}) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const colors = {
    surface: isDarkMode ? '#1f2937' : '#ffffff',
    border: isDarkMode ? '#334155' : '#e2e8f0',
    text: isDarkMode ? '#f1f5f9' : '#0f172a',
    sub: isDarkMode ? '#94a3b8' : '#64748b',
    chip: isDarkMode ? '#334155' : '#f1f5f9',
    neutral: isDarkMode ? '#e2e8f0' : '#334155',
    countBg: isDarkMode ? '#0f172acc' : '#0f172aaa',
  };

  const press = useCallback(async (action) => {
    if (busy || !onAction) return;
    setBusy(action);
    try { await onAction(action); } finally { if (mounted.current) setBusy(null); }
  }, [busy, onAction]);

  // Rows from the viewer's side: the sender gives `give`, the receiver gets it.
  const youGive = isMine ? offer.give : offer.get;
  const youGet = isMine ? offer.get : offer.give;
  const youGiveTotal = isMine ? offer.giveTotal : offer.getTotal;
  const youGetTotal = isMine ? offer.getTotal : offer.giveTotal;

  const verdict = receiverVerdict(offer, statusFn);
  const vColor = VERDICT_COLOR[verdict.status] || VERDICT_COLOR.fair;
  const verdictWord = t(`home.${verdict.status}`, { defaultValue: verdict.status }).toUpperCase();
  const shownDiff = formatValue(Math.abs(verdict.diff));
  const showDiff = verdict.diff !== 0 && !/^0([.,]0*)?$/.test(String(shownDiff));

  const st = STATUS_STYLE[offer.status] || STATUS_STYLE[OFFER_STATUS.PENDING];
  const [chipBg, chipFg] = TONES[st.tone][isDarkMode ? 'dark' : 'light'];
  const actions = disabled ? [] : offerActionsFor(offer, isMine);
  const waiting = isMine && offer.status === OFFER_STATUS.PENDING;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.head}>
        <Icon name="swap-horizontal" size={16} color={colors.neutral} />
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {t('counter_offer.card_title', { defaultValue: 'Counter offer' })}
        </Text>
        <View style={[styles.status, { backgroundColor: chipBg }]}>
          <Text style={[styles.statusText, { color: chipFg }]} numberOfLines={1}>
            {t(`counter_offer.${st.key}`, { defaultValue: st.fallback })}
          </Text>
        </View>
      </View>

      <ItemRow
        label={t('counter_offer.you_give', { defaultValue: 'You give' })}
        total={formatValue(youGiveTotal)}
        items={youGive}
        getImageUrl={getImageUrl}
        variantBadges={variantBadges}
        variantText={variantText}
        colors={colors}
      />
      <ItemRow
        label={t('counter_offer.you_get', { defaultValue: 'You get' })}
        total={formatValue(youGetTotal)}
        items={youGet}
        getImageUrl={getImageUrl}
        variantBadges={variantBadges}
        variantText={variantText}
        colors={colors}
      />

      <View style={styles.meta}>
        <View style={[styles.verdict, { backgroundColor: vColor + '1F' }]}>
          <Text style={[styles.verdictText, { color: vColor }]} numberOfLines={1}>
            {isMine ? t('counter_offer.verdict_them', { verdict: verdictWord, defaultValue: 'Them: {{verdict}}' }) : verdictWord}
            {showDiff ? ` ${verdict.diff > 0 ? '+' : '-'}${shownDiff}` : ''}
          </Text>
        </View>
        {!!footerText && (
          <Text style={[styles.footer, { color: colors.sub }]} numberOfLines={1}>{footerText}</Text>
        )}
      </View>

      {(actions.length > 0 || waiting) && (
        <View style={styles.actions}>
          {waiting && (
            <Text style={[styles.waiting, { color: colors.sub }]} numberOfLines={1}>
              {t('counter_offer.waiting', { defaultValue: 'Waiting…' })}
            </Text>
          )}
          {actions.map((a) => {
            const primary = PRIMARY_ACTIONS.includes(a);
            const [key, fallback] = ACTION_LABEL[a];
            const fg = primary ? '#ffffff' : colors.neutral;
            return (
              <TouchableOpacity
                key={a}
                style={[
                  styles.action,
                  waiting ? styles.actionCompact : styles.actionFlex,
                  { backgroundColor: primary ? primaryColor : colors.chip },
                  !!busy && busy !== a && styles.dim,
                ]}
                onPress={() => press(a)}
                disabled={!!busy}
                activeOpacity={0.75}
                accessibilityRole="button"
              >
                {busy === a
                  ? <ActivityIndicator size="small" color={fg} />
                  : <Text style={[styles.actionText, { color: fg }]} numberOfLines={1}>{t(`counter_offer.${key}`, { defaultValue: fallback })}</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { width: 256, borderRadius: 14, borderWidth: 1, padding: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  title: { flex: 1, fontSize: 14, fontWeight: '700' },
  status: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 11, fontWeight: '700' },
  side: { marginBottom: 8 },
  sideHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sideLabel: { fontSize: 11, fontWeight: '600' },
  sideTotal: { fontSize: 12, fontWeight: '700', marginLeft: 8, flexShrink: 1 },
  tiles: { flexDirection: 'row', gap: 4, minHeight: TILE, alignItems: 'center' },
  tile: { width: TILE, height: TILE, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tileImage: { width: TILE - 6, height: TILE - 6 },
  variant: { position: 'absolute', left: 1, bottom: 1, borderRadius: 4, paddingHorizontal: 2 },
  variantText: { color: '#ffffff', fontSize: 7, fontWeight: '800' },
  count: { position: 'absolute', right: 1, top: 1, borderRadius: 4, paddingHorizontal: 2 },
  countText: { color: '#ffffff', fontSize: 7, fontWeight: '800' },
  more: { fontSize: 11, fontWeight: '700' },
  empty: { fontSize: 12 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verdict: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  verdictText: { fontSize: 11, fontWeight: '800' },
  footer: { flex: 1, fontSize: 11, textAlign: 'right' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  waiting: { flex: 1, fontSize: 12, fontWeight: '600' },
  action: { minHeight: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  actionFlex: { flex: 1 },
  actionCompact: {},
  actionText: { fontSize: 12, fontWeight: '700' },
  dim: { opacity: 0.5 },
});

export default TradeOfferCard;
