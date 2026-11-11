// How many Trade Scanner scans everyone has made in this app (2026-11-11).
// One +1 per finished scan (the trade_scan event), read by the calculator's
// "Scan a trade with camera" button. RTDB trade_scan_count: public read,
// and the rules only let a write add exactly 1.
import { getDatabase, ref, get, set, increment } from '@react-native-firebase/database';

const PATH = 'trade_scan_count';

// Below this the button keeps its NEW badge: a count of 3 sells nothing.
export const SHOW_SCANS_FROM = 100;

export function countScan() {
  try {
    Promise.resolve(set(ref(getDatabase(), PATH), increment(1))).catch(() => {});
  } catch {
    // A count must never break a scan.
  }
}

export async function readScanCount() {
  try {
    const snap = await get(ref(getDatabase(), PATH));
    const n = snap.val();
    return typeof n === 'number' ? n : 0;
  } catch {
    return 0;
  }
}

// 950 -> "950", 1234 -> "1.2K", 45600 -> "45K", 1250000 -> "1.2M"
export function formatScanCount(n) {
  const short = (v, unit) => `${v >= 10 ? Math.floor(v) : Math.floor(v * 10) / 10}${unit}`;
  if (n >= 1e6) return short(n / 1e6, 'M');
  if (n >= 1e3) return short(n / 1e3, 'K');
  return String(Math.max(0, Math.floor(n)));
}
