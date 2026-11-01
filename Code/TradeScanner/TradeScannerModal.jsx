/**
 * Trade Scanner (2026-11-01): photograph the in-game Treasure Trade window on
 * a PC screen with the camera, or pick a screenshot; recognise the fruits on
 * both sides on the device, let the user fix anything, then fill the
 * calculator (HomeScreen) with them. Compact bottom sheet, calculator-style
 * review (two 2x2 sides + one result bar).
 *
 * Pixels: hidden WebView running matcher.js (scannerHtml.js). Names: the
 * native text reader (textReader.js). Joined in tradeMatch.js. The screenshot
 * never leaves the phone.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Image, ActivityIndicator, ScrollView, Platform, PermissionsAndroid, Pressable } from 'react-native';
import { WebView } from 'react-native-webview';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import config from '../Helper/Environment';
import { trackGrowthEvent } from '../Helper/growthAnalytics';
import scannerHtml from './scannerHtml';
import { readTextLines } from './textReader';
import { buildTrade } from './tradeMatch';

const SCAN_TIMEOUT_MS = 20000;
const PICK_OPTIONS = { mediaType: 'photo', includeBase64: true, maxWidth: 2000, maxHeight: 2000, quality: 0.9 };
// A photo of a monitor needs more pixels: the trade window fills less of it.
const CAMERA_OPTIONS = { ...PICK_OPTIONS, maxWidth: 2600, maxHeight: 2600, saveToPhotos: false, cameraType: 'back' };

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
  const [cameraDenied, setCameraDenied] = useState(false);

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
      setCameraDenied(false);
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

  const askCamera = async () => {
    if (Platform.OS !== 'android') return true;
    try {
      const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
      return res === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  };

  // source: 'camera' | 'gallery'
  const captureAndScan = useCallback(async (source) => {
    let asset;
    try {
      if (source === 'camera') {
        if (!(await askCamera())) { setCameraDenied(true); return; }
        setCameraDenied(false);
      }
      const res = source === 'camera' ? await launchCamera(CAMERA_OPTIONS) : await launchImageLibrary({ ...PICK_OPTIONS, selectionLimit: 1 });
      if (res.didCancel) return;
      if (res.errorCode === 'permission') { setCameraDenied(true); return; }
      if (res.errorCode) return;
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
        source,
        photo_mode: pixels.slots.some((sl) => sl.photo) ? 1 : 0,
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
      trackGrowthEvent('trade_scan', { source, photo_mode: 0, slots: -1, found: 0, unsure: 0, text_reader: 0 });
      setStage('none');
    }
  }, [scanPixels, catalog, maxPerSide]);

  const totals = useMemo(() => {
    const sum = (list) => (list || []).reduce((acc, p) => acc + (Number(byName.get(p.name)?.Value) || 0), 0);
    return { mine: sum(result?.mine), theirs: sum(result?.theirs) };
  }, [result, byName]);

  const verdict = useMemo(() => {
    if (!result || !totals.mine) return null;
    // An unchecked guess can swing the total either way: no verdict until
    // every "?" pick is confirmed (tapping a pick and choosing marks it sure).
    const unsure = [...result.mine, ...result.theirs].filter((x) => !x.sure).length;
    if (unsure) return { pct: '', label: `${t('trade_scanner.check', { defaultValue: 'Check' })} ${unsure} ?`, color: '#F5A623' };
    const diff = (totals.theirs - totals.mine) / totals.mine;
    const pct = `${diff >= 0 ? '+' : ''}${Math.round(diff * 100)}%`;
    if (diff > 0.1) return { key: 'win', pct, label: t('trade_scanner.win', { defaultValue: 'Win' }), color: config.colors.hasBlockGreen };
    if (diff < -0.1) return { key: 'lose', pct, label: t('trade_scanner.lose', { defaultValue: 'Lose' }), color: config.colors.wantBlockRed };
    return { key: 'fair', pct, label: t('trade_scanner.fair', { defaultValue: 'Fair' }), color: '#F5A623' };
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

  const confirmPick = (side, index) => {
    setResult((prev) => {
      const list = [...prev[side]];
      list[index] = { ...list[index], sure: true };
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
  const sheet = isDarkMode ? config.colors.backgroundDark : config.colors.backgroundLight;
  const card = isDarkMode ? config.colors.surfaceDark : '#fff';
  const accent = config.colors.secondary;

  const open = openPick ? { side: openPick.split(':')[0], index: Number(openPick.split(':')[1]) } : null;
  const openItem = open ? result?.[open.side]?.[open.index] : null;

  const sourceButtons = (cameraLabel, galleryLabel) => (
    <View style={styles.sourceRow}>
      <TouchableOpacity style={[styles.btn, styles.grow, { backgroundColor: accent }]} onPress={() => captureAndScan('camera')} activeOpacity={0.8}>
        <Icon name="camera" size={17} color="#fff" />
        <Text style={styles.btnText}>{cameraLabel}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.btn, styles.grow, styles.outline, { borderColor: accent }]} onPress={() => captureAndScan('gallery')} activeOpacity={0.8}>
        <Icon name="image" size={17} color={accent} />
        <Text style={[styles.btnText, { color: accent }]}>{galleryLabel}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderTile = (side, i) => {
    const p = result[side][i];
    const key = `${side}:${i}`;
    if (!p) return <View key={key} style={[styles.tile, styles.tileEmpty, { borderColor: isDarkMode ? '#334155' : '#e2e8f0' }]} />;
    const rec = byName.get(p.name);
    const selected = openPick === key;
    return (
      <TouchableOpacity
        key={key}
        style={[styles.tile, { backgroundColor: isDarkMode ? '#0f172a' : '#f4f6fa', borderColor: selected ? accent : p.sure ? 'transparent' : '#F5A623' }]}
        onPress={() => setOpenPick(selected ? null : key)}
        activeOpacity={0.7}
      >
        <Image source={{ uri: imageFor(p.name) }} style={styles.tileImage} resizeMethod="resize" />
        <Text style={[styles.tileName, { color: fg }]} numberOfLines={1}>{p.name}</Text>
        <Text style={[styles.tileValue, { color: accent }]} numberOfLines={1}>{rec && Number(rec.Value) ? formatValue(rec.Value) : 'N/A'}</Text>
        {!p.sure && (
          <View style={styles.unsure}>
            <Text style={styles.unsureText}>?</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderSide = (side, title, color) => (
    <View style={[styles.side, { backgroundColor: card }]}>
      <View style={styles.sideHeader}>
        <Text style={[styles.sideTitle, { color }]} numberOfLines={1}>{title}</Text>
        <Text style={[styles.sideTotal, { color: fg }]}>{formatValue(totals[side])}</Text>
      </View>
      <View style={styles.grid}>
        {Array.from({ length: Math.max(maxPerSide, result[side].length) }, (_, i) => renderTile(side, i))}
      </View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: sheet, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.header}>
          <Icon name="scan" size={18} color={accent} />
          <Text style={[styles.title, { color: fg }]}>{t('trade_scanner.title', { defaultValue: 'Scan a trade' })}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Icon name="close" size={22} color={sub} />
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

        {(stage === 'intro' || stage === 'none') && (
          <View>
            <View style={[styles.infoRow, { backgroundColor: card }]}>
              <Icon name={stage === 'none' ? 'help-circle' : 'desktop-outline'} size={26} color={stage === 'none' ? '#F5A623' : accent} />
              <Text style={[styles.infoText, { color: fg }]}>
                {stage === 'none'
                  ? t('trade_scanner.none', { defaultValue: 'No trade window found. Fit the whole Treasure Trade window in the photo and try again.' })
                  : t('trade_scanner.intro', { defaultValue: 'Point your camera at the Treasure Trade window on your PC, or pick a screenshot. We find the fruits and check the trade.' })}
              </Text>
            </View>
            <Text style={[styles.note, { color: sub }]}>{t('trade_scanner.camera_tip', { defaultValue: 'Hold steady, fill the photo with the trade window, avoid glare.' })}</Text>
            {cameraDenied && (
              <Text style={[styles.note, { color: config.colors.wantBlockRed }]}>{t('trade_scanner.camera_denied', { defaultValue: 'Camera access is off. Allow it in Settings, or pick a screenshot.' })}</Text>
            )}
            {sourceButtons(t('trade_scanner.camera', { defaultValue: 'Camera' }), t('trade_scanner.pick', { defaultValue: 'Screenshot' }))}
            <Text style={[styles.note, styles.center, { color: sub }]}>{t('trade_scanner.privacy', { defaultValue: 'Photos are read on your phone and never uploaded.' })}</Text>
          </View>
        )}

        {stage === 'working' && (
          <View style={styles.working}>
            <ActivityIndicator size="small" color={accent} />
            <Text style={[styles.infoText, styles.noGrow, { color: fg }]}>{t('trade_scanner.working', { defaultValue: 'Reading your trade…' })}</Text>
          </View>
        )}

        {stage === 'review' && result && (
          <View>
            <View style={styles.sides}>
              {renderSide('mine', t('trade_scanner.you_give', { defaultValue: 'You give' }), config.colors.hasBlockGreen)}
              <TouchableOpacity onPress={swapSides} style={[styles.swap, { backgroundColor: accent }]} hitSlop={8} accessibilityLabel={t('trade_scanner.swap', { defaultValue: 'Swap sides' })}>
                <Icon name="swap-horizontal" size={14} color="#fff" />
              </TouchableOpacity>
              {renderSide('theirs', t('trade_scanner.you_get', { defaultValue: 'You get' }), config.colors.wantBlockRed)}
            </View>

            {openItem && (
              <View style={[styles.fixRow, { backgroundColor: card }]}>
                <Text style={[styles.fixLabel, { color: sub }]} numberOfLines={1}>{t('trade_scanner.not_right', { defaultValue: 'Not right? Pick:' })}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  {!openItem.sure && (
                    <TouchableOpacity style={[styles.chip, { borderColor: '#29AB87' }]} onPress={() => confirmPick(open.side, open.index)}>
                      <Icon name="checkmark" size={14} color="#29AB87" />
                      <Text style={[styles.chipText, { color: '#29AB87' }]}>{t('trade_scanner.correct', { defaultValue: 'Correct' })}</Text>
                    </TouchableOpacity>
                  )}
                  {openItem.alternatives.map((n) => (
                    <TouchableOpacity key={n} style={[styles.chip, { borderColor: sub }]} onPress={() => replacePick(open.side, open.index, n)}>
                      <Image source={{ uri: imageFor(n) }} style={styles.chipImage} resizeMethod="resize" />
                      <Text style={[styles.chipText, { color: fg }]} numberOfLines={1}>{n}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={[styles.chip, { borderColor: config.colors.wantBlockRed }]} onPress={() => removePick(open.side, open.index)}>
                    <Icon name="trash-outline" size={14} color={config.colors.wantBlockRed} />
                    <Text style={[styles.chipText, { color: config.colors.wantBlockRed }]}>{t('trade_scanner.remove', { defaultValue: 'Remove' })}</Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            )}

            {verdict && (
              <View style={[styles.result, { backgroundColor: verdict.color }]}>
                <Text style={styles.resultValues} numberOfLines={1}>{formatValue(totals.mine)}  →  {formatValue(totals.theirs)}</Text>
                <Text style={styles.resultVerdict}>{verdict.label} {verdict.pct}</Text>
              </View>
            )}

            {(result.skippedInventory > 0 || result.cut || !openItem) && (
              <Text style={[styles.note, { color: sub }]} numberOfLines={2}>
                {result.skippedInventory > 0
                  ? t('trade_scanner.inventory_skipped', { defaultValue: 'Fruits in your open inventory list were skipped. Close it before the screenshot to scan your side.' })
                  : result.cut
                    ? t('trade_scanner.max_side', { defaultValue: 'Only the first {{max}} fruits per side fit in the calculator.', max: maxPerSide })
                    : t('trade_scanner.review_tip', { defaultValue: 'Left side = you give. Tap a fruit to fix it.' })}
              </Text>
            )}

            <View style={styles.footer}>
              <TouchableOpacity style={[styles.iconBtn, { borderColor: sub }]} onPress={() => captureAndScan('camera')} accessibilityLabel={t('trade_scanner.camera', { defaultValue: 'Camera' })}>
                <Icon name="camera-outline" size={20} color={fg} />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.iconBtn, { borderColor: sub }]} onPress={() => captureAndScan('gallery')} accessibilityLabel={t('trade_scanner.pick', { defaultValue: 'Screenshot' })}>
                <Icon name="image-outline" size={20} color={fg} />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.grow, { backgroundColor: accent }]} onPress={apply} activeOpacity={0.8}>
                <Icon name="calculator" size={17} color="#fff" />
                <Text style={styles.btnText}>{t('trade_scanner.use', { defaultValue: 'Use in calculator' })}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 14, paddingTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  title: { flex: 1, fontSize: 16, fontFamily: 'Montserrat-Bold', fontWeight: '700' },
  hiddenWeb: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10, flex: 0 },
  hiddenWebInner: { width: 1, height: 1 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, padding: 12 },
  infoText: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: '600' },
  note: { fontSize: 12, lineHeight: 16, marginTop: 8 },
  center: { textAlign: 'center' },
  noGrow: { flex: 0 },
  sourceRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14 },
  grow: { flex: 1 },
  outline: { borderWidth: 1.5 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  working: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 36 },
  sides: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  side: { flex: 1, borderRadius: 12, padding: 6 },
  sideHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2, marginBottom: 4 },
  sideTitle: { fontSize: 12, fontWeight: '800', flexShrink: 1 },
  sideTotal: { fontSize: 12, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  tile: { width: '48.5%', height: 76, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  tileEmpty: { borderStyle: 'dashed' },
  tileImage: { width: 30, height: 30 },
  tileName: { fontSize: 10, fontWeight: '700', marginTop: 1 },
  tileValue: { fontSize: 9, fontWeight: '700' },
  unsure: { position: 'absolute', top: 2, right: 2, width: 14, height: 14, borderRadius: 7, backgroundColor: '#F5A623', alignItems: 'center', justifyContent: 'center' },
  unsureText: { color: '#fff', fontSize: 10, fontWeight: '900', lineHeight: 12 },
  swap: { position: 'absolute', left: '50%', top: '50%', marginLeft: -13, marginTop: -13, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', zIndex: 2, elevation: 3 },
  fixRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, marginTop: 8, paddingVertical: 6, paddingLeft: 8 },
  fixLabel: { fontSize: 11, fontWeight: '600', marginRight: 6, maxWidth: 90 },
  chips: { gap: 6, paddingRight: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 14, paddingVertical: 3, paddingHorizontal: 7, gap: 4 },
  chipImage: { width: 18, height: 18 },
  chipText: { fontSize: 11, fontWeight: '600' },
  result: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, marginTop: 8 },
  resultValues: { color: '#fff', fontSize: 14, fontWeight: '700', flexShrink: 1 },
  resultVerdict: { color: '#fff', fontSize: 17, fontWeight: '900', marginLeft: 8 },
  footer: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 10 },
  iconBtn: { width: 46, height: 46, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
