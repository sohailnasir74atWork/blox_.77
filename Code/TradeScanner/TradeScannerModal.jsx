/**
 * Trade Scanner (2026-11-01): pick a screenshot of the in-game Treasure Trade
 * window, recognise the fruits on both sides on the device, let the user fix
 * anything, then fill the calculator (HomeScreen) with them.
 *
 * Pixels: hidden WebView running matcher.js (scannerHtml.js). Names: the
 * native text reader (textReader.js). Joined in tradeMatch.js. The screenshot
 * never leaves the phone.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Image, ActivityIndicator, ScrollView } from 'react-native';
import { WebView } from 'react-native-webview';
import { launchImageLibrary } from 'react-native-image-picker';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import config from '../Helper/Environment';
import { trackGrowthEvent } from '../Helper/growthAnalytics';
import scannerHtml from './scannerHtml';
import { readTextLines } from './textReader';
import { buildTrade } from './tradeMatch';

const SCAN_TIMEOUT_MS = 20000;

const formatValue = (value) => {
  const v = Number(value) || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString();
};

export default function TradeScannerModal({ visible, onClose, onApply, records, maxPerSide, isDarkMode, imageFor }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const web = useRef(null);
  const ready = useRef(false);
  const pending = useRef(null); // { id, resolve, reject, timer }
  const queued = useRef(null);
  const [stage, setStage] = useState('intro'); // intro | working | review | none
  const [result, setResult] = useState(null); // { mine: [pick], theirs: [pick], skippedInventory }
  const [openPick, setOpenPick] = useState(null); // 'mine:0'

  const byName = useMemo(() => {
    const map = new Map();
    (records || []).forEach((r) => { if (r?.Type === 'n') map.set(r.Name, r); });
    return map;
  }, [records]);
  const catalog = useMemo(() => [...byName.keys()], [byName]);

  useEffect(() => {
    if (!visible) {
      setStage('intro');
      setResult(null);
      setOpenPick(null);
      ready.current = false;
    }
  }, [visible]);

  const send = useCallback((id, dataUrl) => {
    web.current?.injectJavaScript(`window.tradeScan(${JSON.stringify(id)}, ${JSON.stringify(dataUrl)}); true;`);
  }, []);

  const scanPixels = useCallback((dataUrl) => new Promise((resolve, reject) => {
    const id = String(Date.now());
    const timer = setTimeout(() => { pending.current = null; reject(new Error('timeout')); }, SCAN_TIMEOUT_MS);
    pending.current = { id, resolve, reject, timer };
    if (ready.current) send(id, dataUrl);
    else queued.current = { id, dataUrl };
  }), [send]);

  const onMessage = useCallback((e) => {
    let msg;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.type === 'ready') {
      ready.current = true;
      if (queued.current) { send(queued.current.id, queued.current.dataUrl); queued.current = null; }
      return;
    }
    const p = pending.current;
    if (!p || msg.id !== p.id) return;
    clearTimeout(p.timer);
    pending.current = null;
    if (msg.type === 'result') p.resolve(msg);
    else p.reject(new Error(msg.message || 'scan'));
  }, [send]);

  const pickAndScan = useCallback(async () => {
    let asset;
    try {
      const res = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: 1,
        includeBase64: true,
        maxWidth: 2000,
        maxHeight: 2000,
        quality: 0.9,
      });
      if (res.didCancel || res.errorCode) return;
      asset = res.assets?.[0];
    } catch {
      return;
    }
    if (!asset?.base64 || !asset?.uri) return;
    setStage('working');
    setOpenPick(null);
    try {
      const dataUrl = `data:${asset.type || 'image/jpeg'};base64,${asset.base64}`;
      const [pixels, text] = await Promise.all([scanPixels(dataUrl), readTextLines(asset.uri)]);
      const trade = buildTrade({ slots: pixels.slots, lines: text.lines, width: pixels.width, catalog });
      const found = trade.mine.length + trade.theirs.length;
      trackGrowthEvent('trade_scan', {
        slots: pixels.slots.length,
        found,
        unsure: [...trade.mine, ...trade.theirs].filter((p) => !p.sure).length,
        text_reader: text.ok ? 1 : 0,
      });
      if (!found) { setStage('none'); return; }
      setResult({
        mine: trade.mine.slice(0, maxPerSide),
        theirs: trade.theirs.slice(0, maxPerSide),
        skippedInventory: trade.skippedInventory,
        cut: trade.mine.length > maxPerSide || trade.theirs.length > maxPerSide,
      });
      setStage('review');
    } catch (err) {
      trackGrowthEvent('trade_scan', { slots: -1, found: 0, unsure: 0, text_reader: 0 });
      setStage('none');
    }
  }, [scanPixels, catalog, maxPerSide]);

  const totals = useMemo(() => {
    const sum = (list) => (list || []).reduce((acc, p) => acc + (Number(byName.get(p.name)?.Value) || 0), 0);
    return { mine: sum(result?.mine), theirs: sum(result?.theirs) };
  }, [result, byName]);

  const verdict = useMemo(() => {
    if (!result || !totals.mine) return null;
    const diff = (totals.theirs - totals.mine) / totals.mine;
    if (diff > 0.1) return { key: 'win', label: t('trade_scanner.win', { defaultValue: 'Win' }), color: config.colors.hasBlockGreen };
    if (diff < -0.1) return { key: 'lose', label: t('trade_scanner.lose', { defaultValue: 'Lose' }), color: config.colors.wantBlockRed };
    return { key: 'fair', label: t('trade_scanner.fair', { defaultValue: 'Fair' }), color: '#F5A623' };
  }, [result, totals, t]);

  const replacePick = (side, index, name) => {
    setResult((prev) => {
      const list = [...prev[side]];
      const old = list[index];
      list[index] = { name, sure: true, alternatives: [old.name, ...old.alternatives.filter((n) => n !== name)].slice(0, 4) };
      return { ...prev, [side]: list };
    });
    setOpenPick(null);
  };

  const removePick = (side, index) => {
    setResult((prev) => ({ ...prev, [side]: prev[side].filter((_, i) => i !== index) }));
    setOpenPick(null);
  };

  const swapSides = () => setResult((prev) => ({ ...prev, mine: prev.theirs, theirs: prev.mine }));

  const apply = () => {
    const toRecords = (list) => list.map((p) => byName.get(p.name)).filter(Boolean);
    trackGrowthEvent('trade_scan_apply', { mine: result.mine.length, theirs: result.theirs.length });
    onApply({ mine: toRecords(result.mine), theirs: toRecords(result.theirs) });
  };

  const fg = isDarkMode ? '#fff' : '#1a1a2e';
  const sub = isDarkMode ? '#a0aec0' : '#5a6474';
  const card = isDarkMode ? config.colors.surfaceDark : '#fff';

  const renderSide = (side, title, color) => (
    <View style={styles.side}>
      <View style={styles.sideHeader}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={[styles.sideTitle, { color }]}>{title}</Text>
        <View style={{ flex: 1 }} />
        <Text style={[styles.sideTotal, { color: fg }]}>{formatValue(totals[side])}</Text>
      </View>
      {result[side].length === 0 && (
        <Text style={[styles.empty, { color: sub }]}>{t('trade_scanner.side_empty', { defaultValue: 'Nothing found on this side' })}</Text>
      )}
      {result[side].map((p, i) => {
        const key = `${side}:${i}`;
        const rec = byName.get(p.name);
        return (
          <View key={key} style={[styles.pick, { backgroundColor: card }]}>
            <TouchableOpacity style={styles.pickRow} onPress={() => setOpenPick(openPick === key ? null : key)} activeOpacity={0.7}>
              <Image source={{ uri: imageFor(p.name) }} style={styles.pickImage} resizeMethod="resize" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.pickName, { color: fg }]} numberOfLines={1}>{p.name}</Text>
                <Text style={[styles.pickValue, { color: config.colors.secondary }]}>{rec && Number(rec.Value) ? formatValue(rec.Value) : 'N/A'}</Text>
              </View>
              {!p.sure && (
                <View style={styles.checkBadge}>
                  <Text style={styles.checkText}>{t('trade_scanner.check', { defaultValue: 'Check' })}</Text>
                </View>
              )}
              <Icon name={openPick === key ? 'chevron-up' : 'swap-horizontal'} size={18} color={sub} />
              <TouchableOpacity onPress={() => removePick(side, i)} hitSlop={10} style={styles.remove}>
                <Icon name="close-circle" size={20} color={sub} />
              </TouchableOpacity>
            </TouchableOpacity>
            {openPick === key && (
              <View style={styles.altRow}>
                <Text style={[styles.altLabel, { color: sub }]}>{t('trade_scanner.not_right', { defaultValue: 'Not right? Pick:' })}</Text>
                <View style={styles.altChips}>
                  {p.alternatives.map((n) => (
                    <TouchableOpacity key={n} style={[styles.altChip, { borderColor: sub }]} onPress={() => replacePick(side, i, n)}>
                      <Image source={{ uri: imageFor(n) }} style={styles.altImage} resizeMethod="resize" />
                      <Text style={[styles.altText, { color: fg }]} numberOfLines={1}>{n}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={[styles.root, { backgroundColor: isDarkMode ? config.colors.backgroundDark : config.colors.backgroundLight, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: fg }]}>{t('trade_scanner.title', { defaultValue: 'Scan a trade' })}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Icon name="close" size={26} color={fg} />
          </TouchableOpacity>
        </View>

        {visible && (
          <WebView
            ref={web}
            // The library wraps the WebView in a flex:1 View; hide that too or
            // it takes half the sheet.
            containerStyle={styles.hiddenWeb}
            style={styles.hiddenWebInner}
            source={{ html: scannerHtml }}
            originWhitelist={['*']}
            onMessage={onMessage}
            javaScriptEnabled
            domStorageEnabled={false}
            allowFileAccess={false}
            setSupportMultipleWindows={false}
            onShouldStartLoadWithRequest={(req) => req.url === 'about:blank' || req.url.startsWith('data:')}
            webviewDebuggingEnabled={__DEV__}
          />
        )}

        {stage === 'intro' && (
          <View style={styles.center}>
            <View style={[styles.bigIcon, { backgroundColor: config.colors.secondary }]}>
              <Icon name="scan" size={44} color="#fff" />
            </View>
            <Text style={[styles.lead, { color: fg }]}>{t('trade_scanner.intro', { defaultValue: 'Take a screenshot of the Treasure Trade window in Blox Fruits, then pick it here. We find the fruits on both sides and check the trade for you.' })}</Text>
            <Text style={[styles.note, { color: sub }]}>{t('trade_scanner.privacy', { defaultValue: 'Your screenshot is read on your phone and never uploaded.' })}</Text>
            <TouchableOpacity style={[styles.primary, { backgroundColor: config.colors.secondary }]} onPress={pickAndScan} activeOpacity={0.8}>
              <Icon name="image" size={18} color="#fff" />
              <Text style={styles.primaryText}>{t('trade_scanner.pick', { defaultValue: 'Pick screenshot' })}</Text>
            </TouchableOpacity>
          </View>
        )}

        {stage === 'working' && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={config.colors.secondary} />
            <Text style={[styles.lead, { color: fg }]}>{t('trade_scanner.working', { defaultValue: 'Reading your trade…' })}</Text>
          </View>
        )}

        {stage === 'none' && (
          <View style={styles.center}>
            <Icon name="help-circle" size={56} color={sub} />
            <Text style={[styles.lead, { color: fg }]}>{t('trade_scanner.none', { defaultValue: 'No trade window found. Make sure the whole Treasure Trade window is in the screenshot.' })}</Text>
            <TouchableOpacity style={[styles.primary, { backgroundColor: config.colors.secondary }]} onPress={pickAndScan} activeOpacity={0.8}>
              <Icon name="image" size={18} color="#fff" />
              <Text style={styles.primaryText}>{t('trade_scanner.try_another', { defaultValue: 'Try another screenshot' })}</Text>
            </TouchableOpacity>
          </View>
        )}

        {stage === 'review' && result && (
          <>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.reviewBody}>
              {verdict && (
                <View style={[styles.verdict, { backgroundColor: verdict.color }]}>
                  <Text style={styles.verdictText}>{verdict.label}</Text>
                  <Text style={styles.verdictSub}>{formatValue(totals.mine)} → {formatValue(totals.theirs)}</Text>
                </View>
              )}
              <Text style={[styles.note, { color: sub, marginBottom: 8 }]}>{t('trade_scanner.review_tip', { defaultValue: 'Left side of the trade window = you give. Tap a fruit to fix it.' })}</Text>
              {renderSide('mine', t('trade_scanner.you_give', { defaultValue: 'You give' }), config.colors.hasBlockGreen)}
              {renderSide('theirs', t('trade_scanner.you_get', { defaultValue: 'You get' }), config.colors.wantBlockRed)}
              {result.skippedInventory > 0 && (
                <Text style={[styles.note, { color: sub }]}>{t('trade_scanner.inventory_skipped', { defaultValue: 'Fruits in your open inventory list were skipped. Close it before the screenshot to scan your side.' })}</Text>
              )}
              {result.cut && (
                <Text style={[styles.note, { color: sub }]}>{t('trade_scanner.max_side', { defaultValue: 'Only the first {{max}} fruits per side fit in the calculator.', max: maxPerSide })}</Text>
              )}
            </ScrollView>
            <View style={styles.footer}>
              <TouchableOpacity style={[styles.secondary, { borderColor: sub }]} onPress={swapSides} activeOpacity={0.7}>
                <Icon name="swap-vertical" size={18} color={fg} />
                <Text style={[styles.secondaryText, { color: fg }]}>{t('trade_scanner.swap', { defaultValue: 'Swap sides' })}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primary, styles.footerPrimary, { backgroundColor: config.colors.secondary }]} onPress={apply} activeOpacity={0.8}>
                <Text style={styles.primaryText}>{t('trade_scanner.use', { defaultValue: 'Use in calculator' })}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={pickAndScan} style={styles.again}>
              <Text style={[styles.againText, { color: config.colors.secondary }]}>{t('trade_scanner.scan_another', { defaultValue: 'Scan another screenshot' })}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: 20, fontFamily: 'Montserrat-Bold', fontWeight: '700' },
  hiddenWeb: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10, flex: 0 },
  hiddenWebInner: { width: 1, height: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  bigIcon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  lead: { fontSize: 16, textAlign: 'center', lineHeight: 22, marginTop: 14 },
  note: { fontSize: 13, textAlign: 'center', lineHeight: 18, marginTop: 10 },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 22, marginTop: 22 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  reviewBody: { paddingBottom: 16 },
  verdict: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 6 },
  verdictText: { color: '#fff', fontSize: 26, fontWeight: '800' },
  verdictSub: { color: '#fff', fontSize: 14, marginTop: 2, fontWeight: '600' },
  side: { marginTop: 10 },
  sideHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  sideTitle: { fontSize: 15, fontWeight: '700' },
  sideTotal: { fontSize: 15, fontWeight: '700' },
  empty: { fontSize: 13, paddingVertical: 8 },
  pick: { borderRadius: 12, marginBottom: 8, paddingHorizontal: 10, paddingVertical: 8 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pickImage: { width: 44, height: 44 },
  pickName: { fontSize: 15, fontWeight: '700' },
  pickValue: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  checkBadge: { backgroundColor: '#F5A623', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  checkText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  remove: { marginLeft: 2 },
  altRow: { marginTop: 8 },
  altLabel: { fontSize: 12, marginBottom: 6 },
  altChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  altChip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 16, paddingVertical: 4, paddingHorizontal: 8, gap: 4, maxWidth: '48%' },
  altImage: { width: 22, height: 22 },
  altText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  footer: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  secondary: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14 },
  secondaryText: { fontSize: 14, fontWeight: '700' },
  footerPrimary: { flex: 1, marginTop: 0 },
  again: { alignItems: 'center', paddingVertical: 10 },
  againText: { fontSize: 14, fontWeight: '600' },
});
