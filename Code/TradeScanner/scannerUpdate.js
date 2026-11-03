// Trade Scanner download and updates (2026-11-03, same as the Adopt Me app's
// Code/TradeScanner/scannerUpdate.js).
//
// From build 192 the app ships without the scanner: the slot model (Android)
// and the scanner page (slot finder + fruit signatures, every platform) come
// from the CDN. The scanner sheet shows what this phone has and what is out
// (scannerRelease.js), and the user taps Download / Update; nothing downloads
// on its own.
//
// RTDB testing/scanner_page (public read, no client writes) names the files
// on Bunny (fetch-images.b-cdn.net/scanner-blox/v<N>/, a zone whose write key
// is in no app). They are checked against the sha256 in RTDB and kept in the
// app's files; one version at a time. Published by
// RunningApps/_scanner_ml/publish_scanner.py --app blox.
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import DeviceInfo from 'react-native-device-info';
import { getDatabase, ref, get } from '@react-native-firebase/database';
import { pickRelease, releaseFiles } from './scannerRelease';

// Same key as 191, so a phone updated from it keeps the scanner it has.
const STATE_KEY = 'scanner_remote_v1';
const DIR = `${RNFS.DocumentDirectoryPath}/scanner`;
export const NEEDS_MODEL = Platform.OS === 'android';

let storage = null;
function store() {
  if (!storage) {
    const { createMMKV } = require('react-native-mmkv');
    storage = createMMKV();
  }
  return storage;
}

function readState() {
  try {
    const raw = store().getString(STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeState(state) {
  try {
    if (state) store().set(STATE_KEY, JSON.stringify(state));
    else store().remove(STATE_KEY);
  } catch {
    // Storage full or unavailable: the scanner in memory keeps working.
  }
}

function complete(s) {
  return !!(s && s.version && s.htmlPath && (!NEEDS_MODEL || (s.modelPath && s.names?.length)));
}

let active; // cached { version, modelPath, names, htmlPath, files } | null

/** The downloaded scanner on this phone, or null (none yet, or it failed). */
export function activeScanner() {
  if (active === undefined) {
    const s = readState();
    active = complete(s) ? s : null;
  }
  return active;
}

/** The installed scanner, after checking its files are still on the phone. */
export async function loadInstalledScanner() {
  const cur = activeScanner();
  if (!cur) return null;
  const paths = [cur.htmlPath, NEEDS_MODEL ? cur.modelPath : null].filter(Boolean);
  const there = await Promise.all(paths.map((p) => RNFS.exists(p).catch(() => false)));
  if (there.every(Boolean)) return cur;
  writeState(null);
  active = null;
  return null;
}

/** A downloaded version that failed to run: never use it again. */
export function dropActiveScanner() {
  const cur = activeScanner();
  writeState(cur ? { bad: cur.version } : null);
  active = null;
}

let latest; // undefined = not looked up this session
let looking = null;

/**
 * The release this phone should have, or null (offline, nothing published,
 * or only a release this phone must not take). One RTDB read per app session
 * unless force (the Try again button).
 */
export function fetchLatestScanner({ tester, force } = {}) {
  if (looking) return looking;
  if (latest !== undefined && !force) return Promise.resolve(latest);
  looking = (async () => {
    try {
      const snap = await get(ref(getDatabase(), 'testing/scanner_page'));
      const build = Number(DeviceInfo.getBuildNumber()) || 0;
      const pick = pickRelease(snap.val(), { tester: !!tester, build, needsModel: NEEDS_MODEL });
      latest = pick && readState()?.bad === pick.version ? null : pick;
    } catch {
      latest = null;
    } finally {
      looking = null;
    }
    return latest;
  })();
  return looking;
}

// A file this phone already has with the same sha256 (unchanged since the
// last version) is copied, not downloaded again: CDN traffic is paid per GB.
async function reuseOrFetch(file, target, have, onBytes) {
  if (have?.sha256 && have.path && String(have.sha256).toLowerCase() === String(file.sha256).toLowerCase()
    && await RNFS.exists(have.path)) {
    if (have.path !== target) {
      await RNFS.unlink(target).catch(() => {});
      await RNFS.copyFile(have.path, target);
    }
    return target;
  }
  return fetchChecked(file, target, onBytes);
}

async function fetchChecked(file, target, onBytes) {
  const tmp = `${target}.part`;
  await RNFS.unlink(tmp).catch(() => {});
  const res = await RNFS.downloadFile({
    fromUrl: file.url,
    toFile: tmp,
    progressInterval: 150,
    begin: () => {},
    // Written bytes: the page arrives gzipped and is written unzipped, so
    // this counts against file.bytes (the unzipped size).
    progress: (p) => onBytes(p.bytesWritten),
  }).promise;
  if (res.statusCode !== 200) throw new Error(`download ${res.statusCode}`);
  const hash = await RNFS.hash(tmp, 'sha256');
  if (hash.toLowerCase() !== String(file.sha256).toLowerCase()) throw new Error('sha256');
  await RNFS.unlink(target).catch(() => {});
  await RNFS.moveFile(tmp, target);
  return target;
}

/**
 * Download a release and make it the scanner in use. onProgress(0..1).
 * Throws on any failure; the scanner the phone had stays in use.
 */
export async function installScanner(release, onProgress = () => {}) {
  const keys = releaseFiles(release, NEEDS_MODEL);
  const cur = activeScanner();
  const had = cur?.files || {};
  const total = keys.reduce((s, k) => s + (Number(release[k].bytes) || 1), 0);
  let done = 0;
  onProgress(0);
  const dir = `${DIR}/v${release.version}`;
  await RNFS.mkdir(dir);
  const target = { model: `${dir}/model.tflite`, names: `${dir}/names.json`, html: `${dir}/scanner.html` };
  const paths = {};
  for (const k of keys) {
    const size = Number(release[k].bytes) || 1;
    paths[k] = await reuseOrFetch(release[k], target[k], had[k], (n) => onProgress(Math.min(1, (done + Math.min(n, size)) / total)));
    done += size;
    onProgress(done / total);
  }
  let names = null;
  if (paths.names) {
    names = JSON.parse(await RNFS.readFile(paths.names, 'utf8'));
    if (!Array.isArray(names) || !names.length) throw new Error('names');
  }
  active = {
    version: release.version,
    modelPath: paths.model || null,
    names,
    htmlPath: paths.html,
    files: Object.fromEntries(keys.map((k) => [k, { sha256: release[k].sha256, path: paths[k] }])),
  };
  writeState(active);
  // Old versions: keep only this one.
  const entries = await RNFS.readDir(DIR).catch(() => []);
  await Promise.all(entries.filter((e) => e.isDirectory() && e.name !== `v${release.version}`).map((e) => RNFS.unlink(e.path).catch(() => {})));
  return active;
}

/** Version of the downloaded scanner in use, 0 when there is none. */
export function activeScannerVersion() {
  return activeScanner()?.version || 0;
}

/** The downloaded scanner page (slot finder), or null when there is none. */
export async function activeScannerHtml() {
  const cur = activeScanner();
  if (!cur?.htmlPath) return null;
  try {
    return await RNFS.readFile(cur.htmlPath, 'utf8');
  } catch {
    return null;
  }
}
