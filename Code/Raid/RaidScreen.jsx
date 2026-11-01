/**
 * RaidScreen.jsx — Sea Beast Raid, an original mini game (2026-10-31).
 *
 * The game is an HTML5 canvas page (Code/Raid/game/raid.html, packed into
 * raidGameHtml.js by `npm run raid:build`) running in react-native-webview.
 * It ships inside the app: no download, no remote code. This screen is the
 * frame around it (same pattern as MM2's Lights Out Manor):
 *   - writes the language strings, the player's saved loadout/settings and
 *     today's server state into the page (window.__RAID_INIT, see withInit);
 *   - every raid gets a server ticket (raidStart); the end of a raid asks the
 *     server to score it (raidFinish) — bounty, chest, PRO time and the boss
 *     crate are decided there and worded by the game. No ticket = no pay;
 *   - saves only preferences the game reports (MMKV id 'raid': loadout,
 *     sound, how-to seen) — never progress;
 *   - haptics, Android Back, background pause (__raid.pause / resume);
 *   - ads only at natural breaks: an interstitial after the 2nd raid and
 *     every 2nd after, a rewarded ad only when the player taps "+3 raids",
 *     a plain bottom banner under the game's Home / Results / Ranks screens
 *     (never during a raid). Nothing for Pro (useIsAdFree).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StatusBar, StyleSheet, AppState, BackHandler, I18nManager, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { useHaptic } from '../Helper/HepticFeedBack';
import { trackGrowthEvent } from '../Helper/growthAnalytics';
import { showErrorMessage, showSuccessMessage } from '../Helper/MessageHelper';
import InterstitialAdManager from '../Ads/IntAd';
import RewardedAdManager from '../Ads/RewardedAdManager';
import ScreenBottomBanner from '../Ads/ScreenBottomBanner';
import useIsAdFree from '../Ads/useIsAdFree';
import SignInDrawer from '../Firebase/SigninDrawer';
import { MyDarkTheme, MyLightTheme } from '../AppHelper/AppHelperFunction';
import RAID_HTML from './raidGameHtml';
import { RAID_KEYS, HAPTIC_TYPES, cleanSave, parseMessage, withInit, shouldShowInterstitial } from './raidBridge';
import { getState, startRaid, finishRaid, rewarded as rewardedApi, leaderboard as leaderboardApi } from './raidApi';

const BG = '#061423';
const PREFS_KEY = 'prefs';
const STATE_WAIT_MS = 2500;
const BANNER_SCREENS = new Set(['home', 'res', 'lb']);

let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'raid' });
} catch (e) {
  const mem = new Map();
  storage = { getString: (k) => mem.get(k), set: (k, v) => mem.set(k, v) };
}
const readJSON = (key, fallback) => {
  try {
    const raw = storage.getString(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
};
const writeJSON = (key, v) => { try { storage.set(key, JSON.stringify(v)); } catch (e) { /* next write retries */ } };
// The last server state per account, so the game opens at once next time.
const stateKey = (uid) => `state:${uid}`;

const RaidScreen = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const { user, theme } = useGlobalState();
  const { localState } = useLocalState();
  const isAdFree = useIsAdFree();
  const { triggerHapticFeedback } = useHaptic();
  const web = useRef(null);
  const raidsRef = useRef(0);
  const ticketRef = useRef(null);
  const readyRef = useRef(false);
  const uid = user?.id || null;
  const isPro = !!localState?.isPro;
  const selectedTheme = theme === 'dark' ? MyDarkTheme : MyLightTheme;
  // null = not known yet (first open while the server answers); the cached copy opens the game at once.
  const [serverState, setServerState] = useState(() => (uid ? readJSON(stateKey(uid), null) : {}));
  const [signinVis, setSigninVis] = useState(false);
  const [bannerVis, setBannerVis] = useState(true);

  const call = useCallback((js) => web.current?.injectJavaScript(`try{${js}}catch(e){}; true;`), []);
  const send = useCallback((fn, ...args) => call(`window.__raid && window.__raid.${fn}(${args.map((a) => JSON.stringify(a ?? null)).join(', ')})`), [call]);

  const announceCrate = useCallback((loot) => {
    if (!Array.isArray(loot) || !loot.length) return;
    const pro = loot.find((l) => l.kind === 'boss_pro');
    showSuccessMessage(
      t('raid_app.crate_title', { defaultValue: '🎁 Boss crate opened!' }),
      pro
        ? t('raid_app.crate_body_pro', { defaultValue: 'The crew sank the boss. Your frame, the Raider title and 24h of PRO (no ads) are yours.' })
        : t('raid_app.crate_body', { defaultValue: 'The crew sank the boss. Your frame and the Raider title are yours.' }),
    );
    trackGrowthEvent('raid_boss_crate', { pro: pro ? 1 : 0 });
  }, [t]);

  // Today's boss + this player from the server; the cached state (if any) opens the game meanwhile.
  const refreshState = useCallback(async () => {
    if (!uid) return;
    const r = await getState(isPro);
    if (!r || r.error || !r.state) return;
    writeJSON(stateKey(uid), r.state);
    setServerState(r.state);
    if (readyRef.current) send('setState', r.state);
    if (r.crate) announceCrate(r.crate);
  }, [uid, isPro, send, announceCrate]);

  useEffect(() => {
    if (!uid) return undefined;
    let alive = true;
    const timer = setTimeout(() => { if (alive) setServerState((s) => s || {}); }, STATE_WAIT_MS);
    refreshState();
    return () => { alive = false; clearTimeout(timer); };
  }, [uid, refreshState]);

  useEffect(() => { trackGrowthEvent('raid_open', { signed_in: uid ? 1 : 0 }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Built once, when a state is known: settings go into the page ahead of the
  // game script (withInit, not injectedJavaScriptBeforeContentLoaded).
  const html = useMemo(() => {
    if (!serverState) return null;
    const strings = {};
    for (const k of RAID_KEYS) {
      const v = t(`raid.${k}`, { defaultValue: '' });
      if (v) strings[k] = v;
    }
    const prefs = cleanSave(readJSON(PREFS_KEY, {}));
    // insetsHandled: this View pads the system bars, so the page must not pad them again.
    return withInit(RAID_HTML, {
      lang: i18n.language, rtl: I18nManager.isRTL, insetsHandled: true, debug: __DEV__, strings,
      signedIn: !!uid, isPro, sound: prefs.sound, howSeen: prefs.howSeen, loadout: prefs.loadout, state: serverState,
    });
    // Only the first known state builds the page; later states go in through setState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!serverState]);

  useEffect(() => {
    if (!isAdFree) RewardedAdManager.prepare?.();
    // Background: pause the raid and silence sound; back: resume.
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') call('window.__raid && window.__raid.pause()');
      else call('window.__raid && window.__raid.resume()');
    });
    return () => sub.remove();
  }, [call, isAdFree]);

  // Signed in from the drawer: tell the game and load the account's state.
  useEffect(() => {
    if (!uid) return;
    send('setAccount', { signedIn: true });
  }, [uid, send]);

  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (signinVis) return false;
      call('window.__raid && window.__raid.back()');
      return true; // the game posts 'exit' when Back is pressed on its home screen
    });
    return () => sub.remove();
  }, [call, signinVis]));

  const onMessage = useCallback(async (e) => {
    const msg = parseMessage(e.nativeEvent.data);
    if (!msg) return;
    switch (msg.type) {
      case 'ready':
        readyRef.current = true;
        break;
      case 'screen':
        setBannerVis(BANNER_SCREENS.has(String(msg.name)));
        break;
      case 'save':
        writeJSON(PREFS_KEY, cleanSave(msg));
        break;
      case 'haptic':
        if (HAPTIC_TYPES[msg.kind]) triggerHapticFeedback(HAPTIC_TYPES[msg.kind]);
        break;
      case 'raid_start': {
        ticketRef.current = null;
        const lo = msg.loadout || {};
        trackGrowthEvent('raid_start', { fruit: String(lo.fruit || ''), sword: String(lo.sword || ''), style: String(lo.style || '') });
        if (!uid) break;
        const r = await startRaid(lo, isPro);
        if (r.ticket) { ticketRef.current = r.ticket; send('ticket', r.ticket); }
        else if (r.error === 'capped') showErrorMessage(t('raid_app.title', { defaultValue: 'Sea Beast Raid' }), t('raid_app.capped', { defaultValue: 'No raids left today. Come back after the reset.' }));
        break;
      }
      case 'raid_end': {
        raidsRef.current += 1;
        trackGrowthEvent('raid_end', { dmg_k: Math.round((Number(msg.dmg) || 0) / 1000), hits: Number(msg.hits) || 0, dodged: Number(msg.dodged) || 0, best: Number(msg.best) || 0, ulted: Number(msg.ulted) || 0, secs: Number(msg.secs) || 0 });
        const ticket = ticketRef.current;
        ticketRef.current = null;
        if (!uid || !ticket) break; // the game shows "could not be saved" by itself
        const r = await finishRaid({ ticket, dmg: msg.dmg, hits: msg.hits, dodged: msg.dodged, best: msg.best, ulted: msg.ulted, secs: msg.secs }, isPro);
        send('result', r);
        if (r && !r.error) {
          writeJSON(stateKey(uid), r);
          trackGrowthEvent('raid_scored', { chest: String(r.chest || ''), valid: r.valid ? 1 : 0, rank_up: r.rankUp ? 1 : 0, killed: r.killedNow ? 1 : 0 });
          const proMs = (r.loot || []).filter((l) => l.ms && l.kind !== 'pro_paid').reduce((s, l) => s + l.ms, 0);
          if (proMs) trackGrowthEvent('raid_pro_granted', { hours: Math.round(proMs / 3600e3) });
          if (r.killedNow) trackGrowthEvent('raid_boss_killed', {});
        }
        break;
      }
      case 'request_results': {
        const go = () => call('window.__raid && window.__raid.proceed()');
        if (shouldShowInterstitial(raidsRef.current, isAdFree)) { trackGrowthEvent('raid_interstitial', {}); InterstitialAdManager.showAd(go, go, 'raid_round'); }
        else go();
        break;
      }
      case 'rewarded_request': {
        let ok = false;
        if (isAdFree) ok = true;
        else {
          const r = await RewardedAdManager.showForResult('raid_round');
          ok = r === 'earned';
          trackGrowthEvent('raid_rewarded', { result: String(r) });
          if (r === 'unavailable') showErrorMessage(t('raid_app.ad_title', { defaultValue: 'No ad right now' }), t('raid_app.ad_unavailable', { defaultValue: 'Try again in a moment.' }));
        }
        if (ok && uid) await rewardedApi();
        send('rewarded', ok);
        break;
      }
      case 'leaderboard': {
        const tab = msg.tab === 'all' ? 'all' : 'today';
        if (!uid) { send('setLeaderboard', tab, [], null); break; }
        const r = await leaderboardApi(tab);
        send('setLeaderboard', tab, r && !r.error ? r.rows : [], r && !r.error ? r.me : null);
        break;
      }
      case 'signin':
        setSigninVis(true);
        break;
      case 'exit':
        navigation.goBack();
        break;
      default:
        break;
    }
  }, [call, send, uid, isPro, isAdFree, navigation, t, triggerHapticFeedback]);

  return (
    <View style={[styles.flex1, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      {html ? (
        <WebView
          ref={web}
          style={styles.web}
          source={{ html }}
          originWhitelist={['*']}
          onMessage={onMessage}
          javaScriptEnabled
          domStorageEnabled={false}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          setSupportMultipleWindows={false}
          allowFileAccess={false}
          textZoom={100}
          // The game has no links; anything that tries to navigate away stays put.
          onShouldStartLoadWithRequest={(req) => req.url === 'about:blank' || req.url.startsWith('data:')}
          androidLayerType="hardware"
          webviewDebuggingEnabled={__DEV__}
          accessibilityLabel={t('raid_app.title', { defaultValue: 'Sea Beast Raid' })}
        />
      ) : (
        <ActivityIndicator style={styles.flex1} color="#ffc542" />
      )}
      {/* Banner only under the game's menu screens, never during a raid; nothing for Pro. */}
      <ScreenBottomBanner background={BG} ad={bannerVis && !isAdFree} />
      {/* Raids need an account (tickets, bounty, PRO). When this closes signed in, the effect above tells the game. */}
      <SignInDrawer visible={signinVis} onClose={() => setSigninVis(false)} selectedTheme={selectedTheme} screen="Raid" message={t('raid_app.signin', { defaultValue: 'Sign in to save raids, earn bounty and PRO time.' })} />
    </View>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1, backgroundColor: BG },
  web: { flex: 1, backgroundColor: BG },
});

export default RaidScreen;
