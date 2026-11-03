// On-device slot recogniser for the Trade Scanner (2026-11-03, as Adopt Me):
// modules/trade-ocr classifyTiles (Android LiteRT, iOS TensorFlow Lite) runs
// the model trained in RunningApps/_scanner_ml/blox on every catalogue item,
// on the slot picture between the green name bar and the pink price bar.
// From build 192 the model is not in the app: it is the one the user
// downloaded (scannerUpdate.js). A downloaded model that does not match its
// names list is dropped, and the sheet offers the download again.
// Returns, per tile, candidates in the matcher's shape ({ name, d }, d = 1 -
// score) or null when the model is not available (an older iOS build, any error):
// the scanner then keeps its picture matcher.
import { NativeModules } from 'react-native';
import { activeScanner, dropActiveScanner } from './scannerUpdate';

async function run(mod, uri, frame, boxes, modelPath, list) {
  const res = await mod.classifyTiles(uri, frame, boxes, modelPath);
  if (!res || res.classes !== list.length || !Array.isArray(res.tiles) || res.tiles.length !== boxes.length) {
    throw new Error('model output');
  }
  return res.tiles.map((top) => top
    .filter((c) => list[c.i])
    .map((c) => ({ name: list[c.i], d: Math.round((1 - c.s) * 1000) / 1000, score: c.s })));
}

export async function classifyTiles(uri, frame, slots) {
  const mod = NativeModules.TradeOcr;
  if (!mod?.classifyTiles || !uri || !slots?.length) return null;
  const remote = activeScanner();
  if (!remote?.modelPath || !remote.names?.length) return null;
  const boxes = slots.map((s) => [s.x0, s.nameBottom, s.x1, s.priceTop]);
  try {
    return await run(mod, uri, frame, boxes, remote.modelPath, remote.names);
  } catch (e) {
    // A model that does not match its names list: never again. Anything
    // else (a picture that does not decode) leaves the scanner alone.
    if (e?.message === 'model output') dropActiveScanner();
    return null;
  }
}
