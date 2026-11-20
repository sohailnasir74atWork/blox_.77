/**
 * Trade Scanner (2026-11-01): photograph the in-game Treasure Trade window on
 * a PC screen with the camera, or pick a screenshot;
 * crop it to the trade window (CropBox, required); recognise the fruits on
 * both sides on the device, let the user fix anything, then fill the
 * calculator (HomeScreen) with them. Compact bottom sheet, calculator-style
 * review (two 2x2 sides + one result bar).
 *
 * Pixels: hidden WebView running matcher.js (the scanner page, downloaded
 * with the slot model from the CDN on first use, scannerUpdate.js; the sheet
 * shows the version, an Update alert and the download progress). Names: the
 * native text reader (textReader.js). Joined in tradeMatch.js. The screenshot
 * never leaves the phone.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Image, ActivityIndicator, ScrollView, Platform, PermissionsAndroid, Pressable, useWindowDimensions } from 'react-native';
import { WebView } from 'react-native-webview';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import config from '../Helper/Environment';
import { trackGrowthEvent } from '../Helper/growthAnalytics';
import { readTextLines } from './textReader';
import CropBox, { FULL_CROP } from './CropBox';
import { buildTrade } from './tradeMatch';
import DeviceInfo from 'react-native-device-info';
import { uploadScanReport } from '../Helper/scanReportUpload';
import { activeScanner, activeScannerHtml, activeScannerVersion, fetchLatestScanner, installScanner, loadInstalledScanner, NEEDS_MODEL } from './scannerUpdate';
import { downloadBytes, scannerState } from './scannerRelease';
import { classifyTiles } from './tileModel';
import ShareResultCard from './ShareResultCard';

const SCAN_TIMEOUT_MS = 20000;
// First wait for the scanner page; no answer by then = restart the page and try once more.
const FIRST_TRY_MS = 12000;
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

// Accuracy feedback (2026-11-01). Every pick keeps what the scan said
// (scanned); at "Use in calculator" the picks the user changed or removed
// give an item-level accuracy, and the Yes / No question gives a per-scan
// one. Separate event names (trade_scan_right / trade_scan_wrong) so the
// GA4 event counts alone give the score: right / (right + wrong).
const FEEDBACK_REASONS = [
  ['wrong_item', 'Wrong fruit'],
  ['missed', 'Missed fruits'],
  ['extra', 'Extra fruits'],
  ['sides', 'Wrong sides'],
];
const pickKey = (p) => [p.name, p.perm ? 1 : 0, p.variant || '', p.fly ? 1 : 0, p.ride ? 1 : 0].join('|');
const withScan = (list) => list.map((p) => ({ ...p, scanned: pickKey(p) }));
const scanStats = (r) => {
  const now = [...r.mine, ...r.theirs];
  const fixed = now.filter((p) => p.scanned !== pickKey(p)).length;
  const removed = Math.max(0, r.found - now.length);
  const kept = now.length - fixed;
  return {
    source: r.source,
    found: r.found,
    fixed,
    removed,
    swapped: r.swapped ? 1 : 0,
    accuracy: r.found ? Math.round((100 * kept) / r.found) : 0,
  };
};

export default function TradeScannerModal({ visible, onClose, onApply, records, maxPerSide, isDarkMode, imageFor, tester }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const web = useRef(null);
  const ready = useRef(false);
  const pending = useRef(null); // { id, resolve, reject, timer }
  const queued = useRef(null);
  const [stage, setStage] = useState('intro'); // intro | crop | working | review | none
  const [picked, setPicked] = useState(null); // { asset, source } waiting in the crop step
  const crop = useRef(FULL_CROP);
  const [result, setResult] = useState(null); // { mine: [pick], theirs: [pick], skippedInventory }
  const [openPick, setOpenPick] = useState(null); // 'mine:0'
  const [feedback, setFeedback] = useState(null); // null | 'wrong' | 'done'
  // Send this scan to us (2026-11-03): the picture + what the scan read.
  const [report, setReport] = useState(null); // null | 'sending' | 'sent' | 'failed'
  const lastScan = useRef(null);
  const wrongReason = useRef(null);
  // The scanner (page + slot model) is downloaded, not in the app (build
  // 192): installed = what this phone has, latest = what it should have.
  const [pageHtml, setPageHtml] = useState(null);
  const [installed, setInstalled] = useState(() => activeScanner());
  const [latest, setLatest] = useState(undefined); // undefined = looking
  const [download, setDownload] = useState(null); // null | { progress } | 'failed' | { done: version }
  const [cameraDenied, setCameraDenied] = useState(false);

  const byName = useMemo(() => {
    const map = new Map();
    (records || []).forEach((r) => { if (r?.Type === 'n') map.set(r.Name, r); });
    return map;
  }, [records]);
  // "Permanent X" on the slot (pick.perm): the calculator's permanent record.
  const permByName = useMemo(() => {
    const map = new Map();
    (records || []).forEach((r) => { if (r?.Type === 'p') map.set(r.Name, r); });
    return map;
  }, [records]);
  const recordOf = useCallback((p) => (p.perm && permByName.get(p.name)) || byName.get(p.name), [byName, permByName]);
  const catalog = useMemo(() => [...byName.keys()], [byName]);

  const loadPage = useCallback(async () => {
    const html = await activeScannerHtml();
    if (html) { ready.current = false; setPageHtml(html); }
  }, []);

  const lookUp = useCallback((force) => {
    setLatest(undefined);
    fetchLatestScanner({ tester: !!tester, force }).then(setLatest);
  }, [tester]);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    loadInstalledScanner().then((cur) => {
      if (!live) return;
      setInstalled(cur);
      if (cur) loadPage();
    });
    lookUp(false);
    return () => { live = false; };
  }, [visible, lookUp, loadPage]);

  const scannerStatus = latest === undefined && !installed ? 'checking' : scannerState(installed, latest || null);
  const downloading = !!download?.progress || download?.progress === 0;

  const getScanner = useCallback(async () => {
    if (!latest || downloading) return;
    const from = installed?.version || 0;
    setDownload({ progress: 0 });
    try {
      const cur = await installScanner(latest, (progress) => setDownload({ progress }));
      setInstalled(cur);
      await loadPage();
      setDownload({ done: cur.version });
      trackGrowthEvent('trade_scanner_download', { from, to: cur.version, ok: 1 });
    } catch {
      setDownload('failed');
      trackGrowthEvent('trade_scanner_download', { from, to: latest.version, ok: 0 });
    }
  }, [latest, installed, downloading, loadPage]);

  useEffect(() => {
    if (!visible) {
      setStage('intro');
      setResult(null);
      setPicked(null);
      setOpenPick(null);
      setCameraDenied(false);
      setReport(null);
      if (!downloading) setDownload(null);
      ready.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const send = useCallback((id, dataUrl, frame) => {
    web.current?.injectJavaScript(`window.tradeScan(${JSON.stringify(id)}, ${JSON.stringify(dataUrl)}, ${JSON.stringify(frame)}); true;`);
  }, []);

  // The hidden scanner page can die while the camera or the photo picker has
  // the app in the background (Android renderer gone, iOS content process
  // ended): nothing answers, and the scan used to end in "timeout" with
  // nothing read (Ops/bugs/LOG.md 2026-11-15; the finder itself answers in
  // about a second on those pictures). A dead page is mounted again, and a
  // scan with no answer gets one more try on a fresh page.
  const [webKey, setWebKey] = useState(0);
  const pageRestarts = useRef(0);
  const restartPage = useCallback(() => {
    ready.current = false;
    pageRestarts.current += 1;
    setWebKey((k) => k + 1);
  }, []);

  const scanOnce = useCallback((dataUrl, frame, ms) => new Promise((resolve, reject) => {
    const id = String(Date.now());
    const timer = setTimeout(() => { pending.current = null; queued.current = null; reject(new Error('timeout')); }, ms);
    pending.current = { id, resolve, reject, timer };
    if (ready.current) send(id, dataUrl, frame);
    else queued.current = { id, dataUrl, frame };
  }), [send]);

  const scanPixels = useCallback(async (dataUrl, frame) => {
    try {
      return await scanOnce(dataUrl, frame, FIRST_TRY_MS);
    } catch (e) {
      if (e?.message !== 'timeout') throw e;
      restartPage();
      return scanOnce(dataUrl, frame, SCAN_TIMEOUT_MS);
    }
  }, [scanOnce, restartPage]);

  const onMessage = useCallback((e) => {
    let msg;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.type === 'ready') {
      ready.current = true;
      if (queued.current) { send(queued.current.id, queued.current.dataUrl, queued.current.frame); queued.current = null; }
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
    // Always through the crop step: extra things around the trade window
    // are what give wrong items.
    crop.current = FULL_CROP;
    setReport(null);
    lastScan.current = null;
    setPicked({ asset, source });
    setOpenPick(null);
    setStage('crop');
  }, []);

  const scanCropped = useCallback(async () => {
    if (!picked) return;
    const { asset, source } = picked;
    const frame = crop.current;
    setStage('working');
    try {
      const dataUrl = `data:${asset.type || 'image/jpeg'};base64,${asset.base64}`;
      const [pixels, text] = await Promise.all([scanPixels(dataUrl, frame), readTextLines(asset.uri, frame)]);
      // The trained slot model names each slot picture; the picture matcher's
      // own ranking stays as the fallback (iOS, any model error).
      const model = await classifyTiles(asset.uri, frame, pixels.slots);
      const named = model?.tiles || null;
      const slots = named ? pixels.slots.map((sl, i) => ({ ...sl, candidates: named[i], model: true })) : pixels.slots;
      const trade = buildTrade({ slots, lines: text.lines, width: pixels.width, catalog });
      const found = trade.mine.length + trade.theirs.length;
      lastScan.current = {
        frame,
        width: pixels.width,
        height: pixels.height,
        scannerVersion: activeScannerVersion(),
        textReader: text.ok ? 1 : 0,
        lines: (text.lines || []).slice(0, 80).map((l) => [l.text, Math.round(l.x), Math.round(l.y), Math.round(l.w), Math.round(l.h)]),
        model: named ? 1 : 0,
        // What the model was given (decoded picture size + its 128x128 input
        // tiles): only sent if the user taps Send picture.
        modelInput: model?.seen || null,
        slots: slots.map((sl) => ({
          box: [sl.x0, sl.nameTop, sl.x1, sl.priceTop].map(Math.round),
          inventory: sl.inventory ? 1 : 0,
          tile: sl.tile ? 1 : 0,
          photo: sl.photo ? 1 : 0,
          top: (sl.candidates || []).slice(0, 3).map((c) => [c.name, Math.round(c.d * 1000) / 1000]),
        })),
      };
      setReport(null);
      wrongReason.current = null;
      trackGrowthEvent('trade_scan', {
        source,
        photo_mode: pixels.slots.some((sl) => sl.photo) ? 1 : 0,
        slots: pixels.slots.length,
        found,
        unsure: [...trade.mine, ...trade.theirs].filter((p) => !p.sure).length,
        text_reader: text.ok ? 1 : 0,
        scanner_v: activeScannerVersion(),
        model: named ? 1 : 0,
        inventory: trade.inventoryScreen ? 1 : 0,
        crop_area: Math.round(frame.w * frame.h * 100),
      });
      if (!found) { setStage('none'); return; }
      setResult({
        mine: withScan(trade.mine.slice(0, maxPerSide)),
        theirs: withScan(trade.theirs.slice(0, maxPerSide)),
        found: Math.min(trade.mine.length, maxPerSide) + Math.min(trade.theirs.length, maxPerSide),
        source,
        skippedInventory: trade.skippedInventory,
        inventoryScreen: trade.inventoryScreen,
        cut: trade.mine.length > maxPerSide || trade.theirs.length > maxPerSide,
      });
      setFeedback(null);
      setStage('review');
    } catch (err) {
      trackGrowthEvent('trade_scan', { source, photo_mode: 0, slots: -1, found: 0, unsure: 0, text_reader: 0 });
      lastScan.current = { frame, error: String(err?.message || err).slice(0, 200), page: ready.current ? 1 : 0, restarts: pageRestarts.current };
      setReport(null);
      setStage('none');
    }
  }, [picked, scanPixels, catalog, maxPerSide]);

  const totals = useMemo(() => {
    const sum = (list) => (list || []).reduce((acc, p) => acc + (Number(recordOf(p)?.Value) || 0), 0);
    return { mine: sum(result?.mine), theirs: sum(result?.theirs) };
  }, [result, recordOf]);

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

  // Share result card (2026-11-11, as MM2): only for a final verdict (every pick checked).
  const [shareOpen, setShareOpen] = useState(false);
  const canShare = !!verdict?.key;
  const cardItems = useCallback((list) => (list || []).map((p) => {
    const rec = recordOf(p);
    const perm = p.perm && rec?.Type === 'p' ? `${t('home.home_screen.perm', { defaultValue: 'Perm' })} ` : '';
    return { name: `${perm}${p.name}`, value: Number(rec?.Value) || 0, image: rec ? imageFor(rec) : '' };
  }), [recordOf, imageFor, t]);

  const replacePick = (side, index, name) => {
    setResult((prev) => {
      const list = [...prev[side]];
      const old = list[index];
      list[index] = { name, sure: true, scanned: old.scanned, alternatives: [old.name, ...old.alternatives.filter((n) => n !== name)].slice(0, 4) };
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

  const swapSides = () => setResult((prev) => ({ ...prev, mine: prev.theirs, theirs: prev.mine, swapped: !prev.swapped }));

  const vote = (right) => {
    trackGrowthEvent(right ? 'trade_scan_right' : 'trade_scan_wrong', scanStats(result));
    setFeedback(right ? 'done' : 'wrong');
  };

  const voteReason = (reason) => {
    trackGrowthEvent('trade_scan_wrong_reason', { reason, ...scanStats(result) });
    wrongReason.current = reason;
    setFeedback('done');
  };

  const sendReport = async () => {
    if (!picked?.asset?.uri || report === 'sending' || report === 'sent') return;
    setReport('sending');
    const strip = (list) => (list || []).map((p) => ({ name: p.name, sure: !!p.sure, scanned: p.scanned }));
    try {
      await uploadScanReport(picked.asset.uri, {
        v: 1,
        app: `${DeviceInfo.getVersion()} (${DeviceInfo.getBuildNumber()})`,
        at: new Date().toISOString(),
        platform: Platform.OS,
        source: picked.source,
        stage,
        reason: wrongReason.current,
        image: { width: picked.asset.width, height: picked.asset.height },
        scan: lastScan.current,
        result: result ? { mine: strip(result.mine), theirs: strip(result.theirs), swapped: !!result.swapped } : null,
      });
      trackGrowthEvent('trade_scan_report', { stage, reason: wrongReason.current || '' });
      setReport('sent');
    } catch {
      setReport('failed');
    }
  };

  const reportBox = () => (
    <View style={[styles.reportBox, { backgroundColor: card }]}>
      {report === 'sent' ? (
        <Text style={[styles.feedbackText, { color: '#29AB87' }]}>{t('trade_scanner.report_sent', { defaultValue: 'Sent. Thank you, we will use it to fix the scanner.' })}</Text>
      ) : (
        <>
          <Text style={[styles.note, styles.reportNote, { color: sub }]}>
            {t('trade_scanner.report_note', { defaultValue: 'Send us this picture and what the scan read, so we can fix it. Only send pictures without private info.' })}
          </Text>
          <TouchableOpacity style={[styles.vote, { borderColor: accent }]} onPress={sendReport} disabled={report === 'sending'} hitSlop={6}>
            {report === 'sending'
              ? <ActivityIndicator size="small" color={accent} />
              : <Icon name="paper-plane-outline" size={14} color={accent} />}
            <Text style={[styles.voteText, { color: accent }]}>
              {report === 'failed'
                ? t('trade_scanner.report_retry', { defaultValue: 'Try again' })
                : t('trade_scanner.report_send', { defaultValue: 'Send picture' })}
            </Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  const apply = () => {
    const toRecords = (list) => list.map(recordOf).filter(Boolean);
    trackGrowthEvent('trade_scan_apply', { mine: result.mine.length, theirs: result.theirs.length, ...scanStats(result) });
    onApply({ mine: toRecords(result.mine), theirs: toRecords(result.theirs) });
  };

  const fg = isDarkMode ? '#fff' : '#1a1a2e';
  const sub = isDarkMode ? '#a0aec0' : '#5a6474';
  const sheet = isDarkMode ? config.colors.backgroundDark : config.colors.backgroundLight;
  const card = isDarkMode ? config.colors.surfaceDark : '#fff';
  const accent = config.colors.secondary;
  const WIN = config.colors.hasBlockGreen;
  const LOSE = config.colors.wantBlockRed;
  const FAIR = '#F5A623';
  const trackBg = isDarkMode ? '#334155' : '#e2e8f0';

  // Scanner download / update (build 192): one card under the testing bar.
  const mb = (bytes) => Math.max(0.1, bytes / 1e6).toFixed(1);
  const scannerBar = () => {
    if (downloading) {
      const pct = Math.round(download.progress * 100);
      return (
        <View style={[styles.scanBox, { backgroundColor: card }]}>
          <View style={styles.scanRow}>
            <ActivityIndicator size="small" color={accent} />
            <Text style={[styles.scanTitle, { color: fg }]}>
              {t('trade_scanner.downloading', { defaultValue: 'Downloading scanner v{{v}}… {{pct}}%', v: latest?.version, pct })}
            </Text>
          </View>
          <View style={[styles.track, { backgroundColor: trackBg }]}>
            <View style={[styles.fill, { width: `${pct}%`, backgroundColor: accent }]} />
          </View>
        </View>
      );
    }
    if (scannerStatus === 'checking') {
      return (
        <View style={[styles.scanBox, styles.scanRow, { backgroundColor: card }]}>
          <ActivityIndicator size="small" color={accent} />
          <Text style={[styles.scanText, { color: sub }]}>{t('trade_scanner.checking', { defaultValue: 'Checking for the scanner…' })}</Text>
        </View>
      );
    }
    const failed = download === 'failed' && (
      <Text style={[styles.scanText, { color: LOSE }]}>{t('trade_scanner.download_failed', { defaultValue: 'Download failed. Check your internet and try again.' })}</Text>
    );
    if (scannerStatus === 'missing') {
      const size = mb(downloadBytes(latest, NEEDS_MODEL, null));
      return (
        <View style={[styles.scanBox, { backgroundColor: card }]}>
          <View style={styles.scanRow}>
            <Icon name="cloud-download-outline" size={26} color={accent} />
            <View style={styles.grow}>
              <Text style={[styles.scanTitle, { color: fg }]}>{t('trade_scanner.ai_missing_title', { defaultValue: 'Scanner AI not downloaded' })}</Text>
              <Text style={[styles.scanText, { color: sub }]}>
                {t('trade_scanner.ai_missing_text', { defaultValue: 'Download it once (about {{mb}} MB) to read trades on your phone.', mb: size })}
              </Text>
            </View>
          </View>
          {failed}
          <TouchableOpacity style={[styles.btn, styles.scanBtn, { backgroundColor: accent }]} onPress={getScanner} activeOpacity={0.8}>
            <Icon name="download" size={17} color="#fff" />
            <Text style={styles.btnText}>{t('trade_scanner.download', { defaultValue: 'Download' })} · {size} MB</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (scannerStatus === 'unavailable') {
      return (
        <View style={[styles.scanBox, { backgroundColor: card }]}>
          <View style={styles.scanRow}>
            <Icon name="cloud-offline-outline" size={26} color={FAIR} />
            <Text style={[styles.scanText, styles.grow, { color: fg }]}>
              {t('trade_scanner.unavailable', { defaultValue: 'The scanner can\'t be downloaded right now. Check your internet and try again.' })}
            </Text>
          </View>
          <TouchableOpacity style={[styles.btn, styles.scanBtn, styles.outline, { borderColor: accent }]} onPress={() => lookUp(true)} activeOpacity={0.8}>
            <Icon name="refresh" size={17} color={accent} />
            <Text style={[styles.btnText, { color: accent }]}>{t('trade_scanner.retry', { defaultValue: 'Try again' })}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (scannerStatus === 'old') {
      return (
        <View style={[styles.scanBox, styles.oldBox, { borderColor: LOSE }]}>
          <View style={styles.scanRow}>
            <Icon name="alert-circle" size={24} color={LOSE} />
            <View style={styles.grow}>
              <Text style={[styles.scanTitle, { color: LOSE }]}>
                {t('trade_scanner.update_title', { defaultValue: 'You are on an older scanner (v{{cur}})', cur: installed.version })}
              </Text>
              <Text style={[styles.scanText, { color: fg }]}>
                {t('trade_scanner.update_text', { defaultValue: 'Version {{v}} is available and reads trades more accurately. Update to get the fixes.', v: latest.version })}
              </Text>
            </View>
          </View>
          {failed}
          <TouchableOpacity style={[styles.btn, styles.scanBtn, { backgroundColor: LOSE }]} onPress={getScanner} activeOpacity={0.8}>
            <Icon name="arrow-up-circle" size={17} color="#fff" />
            <Text style={styles.btnText}>{t('trade_scanner.update', { defaultValue: 'Update' })} · {mb(downloadBytes(latest, NEEDS_MODEL, installed.files))} MB</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (scannerStatus === 'installed') {
      return (
        <View style={[styles.scanBox, styles.scanRow, { backgroundColor: card }]}>
          <Icon name="scan-circle-outline" size={20} color={sub} />
          <Text style={[styles.scanTitle, { color: fg }]}>{t('trade_scanner.version', { defaultValue: 'Scanner v{{v}}', v: installed.version })}</Text>
        </View>
      );
    }
    return (
      <View style={[styles.scanBox, styles.scanRow, styles.okBox]}>
        <Icon name="checkmark-circle" size={20} color={WIN} />
        <Text style={[styles.scanTitle, { color: WIN }]}>
          {download?.done
            ? t('trade_scanner.updated', { defaultValue: 'Updated to scanner v{{v}}', v: installed.version })
            : t('trade_scanner.up_to_date', { defaultValue: 'Scanner v{{v}} · up to date', v: installed.version })}
        </Text>
      </View>
    );
  };

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
    const rec = recordOf(p);
    const selected = openPick === key;
    return (
      <TouchableOpacity
        key={key}
        style={[styles.tile, { backgroundColor: isDarkMode ? '#0f172a' : '#f4f6fa', borderColor: selected ? accent : p.sure ? 'transparent' : '#F5A623' }]}
        onPress={() => setOpenPick(selected ? null : key)}
        activeOpacity={0.7}
      >
        <Image source={{ uri: imageFor(p.name) }} style={styles.tileImage} resizeMethod="resize" />
        <Text style={[styles.tileName, { color: fg }]} numberOfLines={1}>{p.perm && rec?.Type === 'p' ? `${t('home.home_screen.perm', { defaultValue: 'Perm' })} ` : ''}{p.name}</Text>
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
          {installed && (
            <View style={[styles.verPill, { backgroundColor: scannerStatus === 'old' ? LOSE : scannerStatus === 'current' ? WIN : sub }]}>
              <Text style={styles.verPillText}>v{installed.version}</Text>
            </View>
          )}
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Icon name="close" size={22} color={sub} />
          </TouchableOpacity>
        </View>

        <View style={styles.beta}>
          <Icon name="flask" size={14} color="#F5A623" />
          <Text style={[styles.betaText, { color: fg }]}>
            {t('trade_scanner.beta', { defaultValue: 'Testing: this scanner is still being tested and can make mistakes. Check every item before you trade.' })}
          </Text>
        </View>

        {visible && !!pageHtml && (
          <WebView
            key={webKey}
            ref={web}
            onContentProcessDidTerminate={restartPage}
            onRenderProcessGone={() => { restartPage(); return true; }}
            // The library wraps the WebView in a flex:1 View; hide that too or
            // it takes half the sheet.
            containerStyle={styles.hiddenWeb}
            style={styles.hiddenWebInner}
            source={{ html: pageHtml }}
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
            {scannerBar()}
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
            {stage === 'none' && picked && reportBox()}
            {installed && !downloading && sourceButtons(t('trade_scanner.camera', { defaultValue: 'Camera' }), t('trade_scanner.pick', { defaultValue: 'Screenshot' }))}
            <Text style={[styles.note, styles.center, { color: sub }]}>{t('trade_scanner.privacy_send', { defaultValue: 'Photos are read on your phone. Nothing is uploaded unless you tap Send picture.' })}</Text>
          </View>
        )}

        {stage === 'crop' && picked && (
          <View>
            <Text style={[styles.cropTip, { color: fg }]}>
              {t('trade_scanner.crop_tip', { defaultValue: 'Drag the corners around the trade window only: both sides and the TREASURE TRADE title. Cut away everything else.' })}
            </Text>
            <CropBox
              uri={picked.asset.uri}
              imageWidth={picked.asset.width}
              imageHeight={picked.asset.height}
              maxHeight={Math.round(screenHeight * 0.66)}
              color={accent}
              onChange={(frame) => { crop.current = frame; }}
            />
            <View style={styles.footer}>
              <TouchableOpacity style={[styles.iconBtn, { borderColor: sub }]} onPress={() => captureAndScan(picked.source)} accessibilityLabel={t('trade_scanner.retake', { defaultValue: 'Pick again' })}>
                <Icon name={picked.source === 'camera' ? 'camera-outline' : 'image-outline'} size={20} color={fg} />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.grow, { backgroundColor: accent }]} onPress={scanCropped} activeOpacity={0.8}>
                <Icon name="crop" size={17} color="#fff" />
                <Text style={styles.btnText}>{t('trade_scanner.scan_area', { defaultValue: 'Scan this area' })}</Text>
              </TouchableOpacity>
            </View>
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
                {canShare && (
                  <TouchableOpacity style={styles.shareBtn} onPress={() => setShareOpen(true)} hitSlop={6} activeOpacity={0.85}>
                    <Icon name="share-social" size={14} color={verdict.color} />
                    <Text style={[styles.shareText, { color: verdict.color }]}>{t('trade_scanner.share', { defaultValue: 'Share' })}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {shareOpen && canShare && (
              <ShareResultCard
                visible={shareOpen}
                onClose={() => setShareOpen(false)}
                verdict={{ ...verdict, status: verdict.key }}
                mine={cardItems(result.mine)}
                theirs={cardItems(result.theirs)}
                totalMine={totals.mine}
                totalTheirs={totals.theirs}
                formatValue={formatValue}
                source={picked?.source}
              />
            )}

            <View style={styles.feedback}>
              {feedback === null && (
                <>
                  <Text style={[styles.feedbackText, { color: fg }]} numberOfLines={1}>{t('trade_scanner.feedback_q', { defaultValue: 'Did the scan get it right?' })}</Text>
                  <TouchableOpacity style={[styles.vote, { borderColor: '#29AB87' }]} onPress={() => vote(true)} hitSlop={6}>
                    <Icon name="thumbs-up" size={14} color={'#29AB87'} />
                    <Text style={[styles.voteText, { color: '#29AB87' }]}>{t('trade_scanner.yes', { defaultValue: 'Yes' })}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.vote, { borderColor: '#FF3B30' }]} onPress={() => vote(false)} hitSlop={6}>
                    <Icon name="thumbs-down" size={14} color={'#FF3B30'} />
                    <Text style={[styles.voteText, { color: '#FF3B30' }]}>{t('trade_scanner.no', { defaultValue: 'No' })}</Text>
                  </TouchableOpacity>
                </>
              )}
              {feedback === 'wrong' && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  <Text style={[styles.feedbackText, { color: fg }]}>{t('trade_scanner.feedback_what', { defaultValue: 'What was wrong?' })}</Text>
                  {FEEDBACK_REASONS.map(([key, label]) => (
                    <TouchableOpacity key={key} style={[styles.vote, { borderColor: sub }]} onPress={() => voteReason(key)}>
                      <Text style={[styles.voteText, { color: fg }]}>{t(`trade_scanner.reason_${key}`, { defaultValue: label })}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              {feedback === 'done' && (
                <Text style={[styles.feedbackText, { color: sub }]}>{t('trade_scanner.feedback_thanks', { defaultValue: 'Thanks! This helps us make the scanner better.' })}</Text>
              )}
            </View>
            {/* Send picture shows with the result, not only after "No"
                (2026-11-03, owner): one tap for a wrong scan. Gone after "Yes". */}
            {!(feedback === 'done' && !wrongReason.current) && reportBox()}

            {(result.inventoryScreen || result.skippedInventory > 0 || result.cut || !openItem) && (
              <Text style={[styles.note, { color: sub }]} numberOfLines={3}>
                {result.inventoryScreen
                  ? t('trade_scanner.inventory_screen', { defaultValue: 'This is your inventory, so your fruits are on You give (up to {{max}}). To check a trade, scan the Treasure Trade window.', max: maxPerSide })
                  : result.skippedInventory > 0
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
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 14, paddingTop: 12, maxHeight: '97%' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  title: { flex: 1, fontSize: 16, fontFamily: 'Montserrat-Bold', fontWeight: '700' },
  hiddenWeb: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10, flex: 0 },
  hiddenWebInner: { width: 1, height: 1 },
  beta: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 8, marginBottom: 8, backgroundColor: 'rgba(245,166,35,0.15)' },
  betaText: { flex: 1, fontSize: 11, lineHeight: 15, fontWeight: '600' },
  feedback: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, minHeight: 28 },
  feedbackText: { flexShrink: 1, fontSize: 12, fontWeight: '700', alignSelf: 'center' },
  vote: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderRadius: 14, paddingVertical: 4, paddingHorizontal: 10 },
  voteText: { fontSize: 12, fontWeight: '800' },
  cropTip: { fontSize: 13, lineHeight: 18, fontWeight: '600', marginBottom: 8 },
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
  reportBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, padding: 10, marginTop: 8 },
  reportNote: { flex: 1, marginTop: 0 },
  chip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 14, paddingVertical: 3, paddingHorizontal: 7, gap: 4 },
  chipImage: { width: 18, height: 18 },
  chipText: { fontSize: 11, fontWeight: '600' },
  result: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, marginTop: 8 },
  resultValues: { color: '#fff', fontSize: 14, fontWeight: '700', flexShrink: 1 },
  resultVerdict: { color: '#fff', fontSize: 17, fontWeight: '900', marginLeft: 8 },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff', borderRadius: 14, paddingVertical: 5, paddingHorizontal: 10, marginLeft: 10 },
  shareText: { fontSize: 12, fontWeight: '900' },
  footer: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 10 },
  verPill: { borderRadius: 9, paddingHorizontal: 7, paddingVertical: 2 },
  verPillText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  scanBox: { borderRadius: 12, padding: 10, marginBottom: 8, gap: 8 },
  scanRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  scanTitle: { flexShrink: 1, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  scanText: { flexShrink: 1, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  scanBtn: { paddingVertical: 10 },
  oldBox: { backgroundColor: 'rgba(255,59,48,0.10)', borderWidth: 1.5 },
  okBox: { backgroundColor: 'rgba(41,171,135,0.12)', paddingVertical: 7 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  iconBtn: { width: 46, height: 46, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
