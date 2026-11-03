// Trade Scanner updates without an app release (2026-11-03, same as the
// Adopt Me app's Code/TradeScanner/scannerUpdate.js).
//
// The slot model and/or the scanner page (slot finder + fruit signatures)
// can be replaced from the CDN. RTDB testing/scanner_page (public read, no
// client writes) says what is current:
//
//   { version: 2, audience: 'mods' | 'all', minBuild: 191,
//     model: { url, sha256, bytes }, names: { url, sha256 },   // optional pair
//     html: { url, sha256 } }                                   // optional
//
// Files live on Bunny (fetch-images.b-cdn.net/scanner-blox/v<N>/, a zone
// whose write key is in no app), are downloaded when the scanner is opened
// (once per app session), checked against the sha256 in RTDB and kept in the
// app's files; unchanged files are copied, not downloaded again. Anything
// wrong means the bundled model / page. Published by
// RunningApps/_scanner_ml/publish_scanner.py --app blox.
import RNFS from 'react-native-fs';
import DeviceInfo from 'react-native-device-info';
import { getDatabase, ref, get } from '@react-native-firebase/database';

const STATE_KEY = 'scanner_remote_v1';
const DIR = `${RNFS.DocumentDirectoryPath}/scanner`;

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
    // Storage full or unavailable: the bundled scanner keeps working.
  }
}

let active = undefined; // cached { version, modelPath, names, htmlPath } | null

/** The downloaded scanner in use, or null for the bundled one. */
export function activeScanner() {
  if (active === undefined) active = readState();
  return active;
}

/** A downloaded version that failed to run: never use it again. */
export function dropActiveScanner() {
  const cur = activeScanner();
  writeState(cur ? { bad: cur.version } : null);
  active = null;
}

// A file this phone already has with the same sha256 (unchanged since the
// last version) is copied, not downloaded again: CDN traffic is paid per GB.
async function reuseOrFetch(file, target, have) {
  if (have?.sha256 && have.path && String(have.sha256).toLowerCase() === String(file.sha256).toLowerCase()
    && await RNFS.exists(have.path)) {
    if (have.path !== target) {
      await RNFS.unlink(target).catch(() => {});
      await RNFS.copyFile(have.path, target);
    }
    return target;
  }
  return fetchChecked(file, target);
}

async function fetchChecked(file, target) {
  const tmp = `${target}.part`;
  await RNFS.unlink(tmp).catch(() => {});
  const res = await RNFS.downloadFile({ fromUrl: file.url, toFile: tmp }).promise;
  if (res.statusCode !== 200) throw new Error(`download ${res.statusCode}`);
  const hash = await RNFS.hash(tmp, 'sha256');
  if (hash.toLowerCase() !== String(file.sha256).toLowerCase()) throw new Error('sha256');
  await RNFS.unlink(target).catch(() => {});
  await RNFS.moveFile(tmp, target);
  return target;
}

let checking = null;
// One look at RTDB per app session (cost: the scanner may be opened often).
let checkedThisSession = false;

/**
 * Look for a newer scanner and download it in the background. tester: the
 * user is staff (admin / mod), who get 'mods' releases first. Never throws;
 * what it downloads is used from the next scan on.
 */
export function checkScannerUpdate({ tester }) {
  if (checking) return checking;
  if (checkedThisSession) return Promise.resolve();
  checkedThisSession = true;
  checking = (async () => {
    try {
      const snap = await get(ref(getDatabase(), 'testing/scanner_page'));
      const m = snap.val();
      const build = Number(DeviceInfo.getBuildNumber()) || 0;
      const forMe = m && m.version && ((m.model?.url && m.names?.url) || m.html?.url)
        && (m.audience === 'all' || (m.audience === 'mods' && tester))
        && build >= (Number(m.minBuild) || 0);
      const cur = activeScanner();
      if (!forMe) {
        // Rolled back, switched off or not for this user: bundled scanner.
        if (cur) { writeState(null); active = null; }
        return;
      }
      if (cur && cur.version === m.version) return;
      const prev = readState();
      if (prev?.bad === m.version) return;
      const dir = `${DIR}/v${m.version}`;
      await RNFS.mkdir(dir);
      const had = cur?.files || {};
      let modelPath = null;
      let namesPath = null;
      let names = null;
      if (m.model?.url && m.names?.url) {
        modelPath = await reuseOrFetch(m.model, `${dir}/model.tflite`, had.model);
        namesPath = await reuseOrFetch(m.names, `${dir}/names.json`, had.names);
        names = JSON.parse(await RNFS.readFile(namesPath, 'utf8'));
        if (!Array.isArray(names) || !names.length) throw new Error('names');
      }
      const htmlPath = m.html?.url ? await reuseOrFetch(m.html, `${dir}/scanner.html`, had.html) : null;
      active = {
        version: m.version,
        modelPath,
        names,
        htmlPath,
        files: {
          model: modelPath ? { sha256: m.model.sha256, path: modelPath } : null,
          names: namesPath ? { sha256: m.names.sha256, path: namesPath } : null,
          html: htmlPath ? { sha256: m.html.sha256, path: htmlPath } : null,
        },
      };
      writeState(active);
      // Old versions: keep only this one.
      const entries = await RNFS.readDir(DIR).catch(() => []);
      await Promise.all(entries.filter((e) => e.isDirectory() && e.name !== `v${m.version}`).map((e) => RNFS.unlink(e.path).catch(() => {})));
    } catch {
      // Offline, bad file: try again next time, bundled scanner meanwhile.
    } finally {
      checking = null;
    }
  })();
  return checking;
}

/** Version of the downloaded scanner in use, 0 for the bundled one. */
export function activeScannerVersion() {
  return activeScanner()?.version || 0;
}

/** The downloaded scanner page (slot finder), or null for the bundled one. */
export async function activeScannerHtml() {
  const cur = activeScanner();
  if (!cur?.htmlPath) return null;
  try {
    return await RNFS.readFile(cur.htmlPath, 'utf8');
  } catch {
    return null;
  }
}
