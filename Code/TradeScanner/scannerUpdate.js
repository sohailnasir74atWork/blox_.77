// Trade Scanner updates without an app release (2026-11-03, as in Adopt Me).
//
// The scanner page (slot finder + fruit picture signatures, the WebView in
// TradeScannerModal) can be replaced from the CDN. RTDB testing/scanner_page
// (public read, no client writes) says what is current:
//
//   { version: 2, audience: 'mods' | 'all', minBuild: 191,
//     html: { url, sha256, bytes } }
//
// The file lives on Bunny (fetch-images.b-cdn.net/scanner-blox/v<N>/, a zone
// whose write key is not in any app), is downloaded when the scanner is
// opened (once per app session), checked against the sha256 in RTDB and kept
// in the app's files. No manifest, not for this user, a bad download: the
// bundled page is used. Published by RunningApps/_scanner_ml/publish_scanner.py --app blox.
import RNFS from 'react-native-fs';
import DeviceInfo from 'react-native-device-info';
import { getDatabase, ref, get } from '@react-native-firebase/database';

const STATE_KEY = 'scanner_page_remote_v1';
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
    // Storage unavailable: the bundled page keeps working.
  }
}

let active; // { version, htmlPath, sha256 } | null, cached

function current() {
  if (active === undefined) active = readState();
  return active;
}

/** Version of the downloaded page in use, 0 for the bundled one. */
export function activeScannerVersion() {
  return current()?.version || 0;
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
let checkedThisSession = false;

/**
 * Look for a newer scanner page and download it in the background (one RTDB
 * read per app session). tester: staff, who get 'mods' releases first.
 * Never throws; the new page is used from the next scanner open.
 */
export function checkScannerUpdate({ tester }) {
  if (checking) return checking;
  if (checkedThisSession) return Promise.resolve();
  checkedThisSession = true;
  checking = (async () => {
    try {
      const m = (await get(ref(getDatabase(), 'testing/scanner_page'))).val();
      const build = Number(DeviceInfo.getBuildNumber()) || 0;
      const forMe = m && m.version && m.html?.url
        && (m.audience === 'all' || (m.audience === 'mods' && tester))
        && build >= (Number(m.minBuild) || 0);
      const cur = current();
      if (!forMe) {
        if (cur) { writeState(null); active = null; }
        return;
      }
      if (cur && cur.version === m.version) return;
      const dir = `${DIR}/v${m.version}`;
      await RNFS.mkdir(dir);
      let htmlPath = `${dir}/scanner.html`;
      if (cur?.sha256 === m.html.sha256 && cur.htmlPath && await RNFS.exists(cur.htmlPath)) {
        await RNFS.copyFile(cur.htmlPath, htmlPath); // same page, new version number: no download
      } else {
        htmlPath = await fetchChecked(m.html, htmlPath);
      }
      active = { version: m.version, htmlPath, sha256: m.html.sha256 };
      writeState(active);
      const entries = await RNFS.readDir(DIR).catch(() => []);
      await Promise.all(entries.filter((e) => e.isDirectory() && e.name !== `v${m.version}`).map((e) => RNFS.unlink(e.path).catch(() => {})));
    } catch {
      // Offline, bad file: try again next session, bundled page meanwhile.
    } finally {
      checking = null;
    }
  })();
  return checking;
}

/** The downloaded scanner page, or null for the bundled one. */
export async function activeScannerHtml() {
  const cur = current();
  if (!cur?.htmlPath) return null;
  try {
    return await RNFS.readFile(cur.htmlPath, 'utf8');
  } catch {
    return null;
  }
}
