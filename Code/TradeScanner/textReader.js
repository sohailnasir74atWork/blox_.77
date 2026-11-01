// On-device text reader for the Trade Scanner (modules/trade-ocr: ML Kit on
// Android, Apple Vision on iOS). Never throws: no module, a model still
// downloading, or a read error all give [] and the scanner falls back to
// picture matching.
import { NativeModules } from 'react-native';

export async function readTextLines(uri) {
  const mod = NativeModules.TradeOcr;
  if (!mod?.recognize || !uri) return { lines: [], ok: false };
  try {
    const res = await mod.recognize(uri);
    return { lines: Array.isArray(res?.lines) ? res.lines : [], ok: true };
  } catch (e) {
    return { lines: [], ok: false, error: e?.code || e?.message };
  }
}
