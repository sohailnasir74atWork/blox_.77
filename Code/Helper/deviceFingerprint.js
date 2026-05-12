import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import * as Keychain from 'react-native-keychain';

// Returns a stable, RTDB-key-safe identifier for the current device.
//
// iOS: stored in Keychain under a Team-ID-scoped service. Keychain items
//   survive app uninstall by Apple's design, so reinstalling — even after
//   uninstalling EVERY app from this vendor (the IDFV reset trick) —
//   returns the same fingerprint. Wiped only by full "Erase All Content
//   and Settings" or moving to a different physical device. On first
//   launch we seed the Keychain with the current IDFV so users already
//   recorded under their IDFV in `banned_devices` carry their ban
//   forward without any RTDB migration.
//
// Android: getUniqueId() => ANDROID_ID (16 hex chars). Survives reinstall;
//   resets on factory reset / clearing per-app data on Android 8+.

const KEYCHAIN_SERVICE = 'com.bloxfruitevalues.deviceFingerprint';

let _cached = null;
let _inflight = null;

function sanitizeForRtdbKey(s) {
  // RTDB keys disallow . # $ [ ] / and control chars.
  return String(s).replace(/[.#$\[\]\/\x00-\x1f\x7f]/g, '_');
}

function generateUuidV4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function getStableIosFingerprint() {
  try {
    const creds = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
    if (creds && creds.password) return creds.password;
  } catch (_) { /* read can fail on first install / locked device — fall through */ }

  let value = null;
  try { value = await DeviceInfo.getUniqueId(); } catch (_) {}
  if (!value || typeof value !== 'string') value = generateUuidV4();

  try {
    await Keychain.setGenericPassword('device', value, {
      service: KEYCHAIN_SERVICE,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  } catch (_) { /* if write fails we still return value; ban listener will work, persistence is just not boosted this run */ }

  return value;
}

export async function getDeviceFingerprint() {
  if (_cached) return _cached;
  if (_inflight) return _inflight;

  _inflight = (async () => {
    try {
      let raw = null;
      if (Platform.OS === 'ios') {
        raw = await getStableIosFingerprint();
      }
      if (!raw) {
        raw = await DeviceInfo.getUniqueId();
      }
      if (!raw || typeof raw !== 'string') return null;
      _cached = sanitizeForRtdbKey(raw);
      return _cached;
    } catch (e) {
      return null;
    } finally {
      _inflight = null;
    }
  })();

  return _inflight;
}
