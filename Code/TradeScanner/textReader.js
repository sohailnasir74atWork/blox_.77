// On-device text reader for the Trade Scanner (modules/trade-ocr: ML Kit on
// Android, Apple Vision on iOS). Never throws: no module, a model still
// downloading, or a read error all give [] and the scanner falls back to
// picture matching.
import { NativeModules } from 'react-native';

// crop: the CropBox frame, shares of the picture. Lines whose centre is
// outside it are dropped and the rest move into the frame's own pixels, so
// width / height are the frame's.
export async function readTextLines(uri, crop) {
  const mod = NativeModules.TradeOcr;
  if (!mod?.recognize || !uri) return { lines: [], ok: false };
  try {
    const res = await mod.recognize(uri);
    const lines = Array.isArray(res?.lines) ? res.lines : [];
    return { ...cropLines(lines, res?.width, res?.height, crop), ok: true };
  } catch (e) {
    return { lines: [], ok: false, error: e?.code || e?.message };
  }
}

export function cropLines(lines, width, height, crop) {
  if (!crop || !width || !height) return { lines, width, height };
  const x0 = crop.x * width;
  const y0 = crop.y * height;
  const x1 = x0 + crop.w * width;
  const y1 = y0 + crop.h * height;
  const inside = lines.filter((l) => {
    const cx = l.x + l.w / 2;
    const cy = l.y + l.h / 2;
    return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
  });
  return { lines: inside.map((l) => ({ ...l, x: l.x - x0, y: l.y - y0 })), width: x1 - x0, height: y1 - y0 };
}
