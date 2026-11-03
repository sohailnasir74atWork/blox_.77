/**
 * Trade Scanner: turn the pixel matcher's slots + the on-device text reader's
 * lines into "your side" / "their side" fruit picks (2026-11-01).
 *
 * The game prints each fruit's name on the slot's green bar, so a readable
 * name wins. The picture match decides when the name is unreadable, cut off,
 * or ambiguous (old names such as "Dragon").
 */

// Names the trade window used before fruits were renamed. Several targets =
// the picture decides between them.
const OLD_NAMES = {
  rumble: ['Lightning'],
  leopard: ['Tiger'],
  barrier: ['Creation'],
  falcon: ['Eagle'],
  birdfalcon: ['Eagle'],
  birdphoenix: ['Phoenix'],
  paw: ['Pain'],
  chop: ['Blade'],
  revive: ['Ghost'],
  dragon: ['West Dragon', 'East Dragon'],
  humanbuddha: ['Buddha'],
};

// Picture distance below which a slot counts as recognised without a name.
// A camera photo of a screen blurs and tints the fruit, so a picture-only
// pick from a photo needs a much closer match (half) before it skips the "?".
const PICTURE_SURE = 0.3;
const PHOTO_SURE = 0.15;
// Slot model candidates (tileModel.js) carry d = 1 - score: sure from score 0.5.
export const MODEL_SURE = 0.5;
const sureAt = (s) => (s.model ? MODEL_SURE : s.photo ? PHOTO_SURE : PICTURE_SURE);

export const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function editDistance(a, b) {
  if (a === b) return 0;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Catalogue names a piece of slot text can mean. [] = unreadable.
 * catalog: array of display names ("West Dragon", "+1 Fruit Storage", ...).
 */
export function namesForText(text, catalog) {
  const q = normalize(text);
  if (q.length < 3) return [];
  const byNorm = new Map(catalog.map((n) => [normalize(n), n]));
  if (byNorm.has(q)) return [byNorm.get(q)];
  if (OLD_NAMES[q]) return OLD_NAMES[q].filter((n) => byNorm.has(normalize(n)));
  // Cut off by the ready dot ("Mammot") or a misread letter.
  const prefix = [...byNorm.keys()].filter((k) => q.length >= 4 && k.startsWith(q));
  if (prefix.length) return prefix.map((k) => byNorm.get(k));
  let best = null;
  let bestD = Infinity;
  for (const [k, n] of byNorm) {
    const d = editDistance(q, k);
    if (d < bestD) { bestD = d; best = n; }
  }
  return bestD <= Math.max(1, Math.floor(q.length / 5)) ? [best] : [];
}

const center = (l) => ({ x: l.x + l.w / 2, y: l.y + l.h / 2 });

// x where the widest gap between slot columns is, when it is wide enough to
// be the space between the two offers; Infinity (all left = the user's) else.
export function gapDivider(slots) {
  const xs = [...new Set(slots.map((s) => Math.round((s.x0 + s.x1) / 2)))].sort((a, b) => a - b);
  if (xs.length < 2) return Infinity;
  const side = slots.reduce((acc, s) => acc + (s.x1 - s.x0), 0) / slots.length;
  let best = 0;
  let at = Infinity;
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - xs[i - 1] > best) { best = xs[i] - xs[i - 1]; at = (xs[i] + xs[i - 1]) / 2; }
  }
  return best > side * 1.6 ? at : Infinity;
}

/**
 * slots: from the WebView matcher (image pixels). lines: [{ text, x, y, w, h }]
 * from the text reader in the same pixel space, or [] when it is unavailable.
 * Returns { mine: [pick], theirs: [pick], skippedInventory, foundWindow }
 * where pick = { name, sure, alternatives: [name] }.
 */
export function buildTrade({ slots, lines = [], width, catalog }) {
  const known = new Set(catalog.map(normalize));
  // The window is centred on the title; Roblox centres it on screen otherwise.
  const title = lines.find((l) => /treasure\s*trade/i.test(l.text));
  // Without the title (an inventory, one offer, the text reader missed it):
  // two groups of slots with a wide gap between them are the two offers;
  // one group is all the user's (2026-11-03, as in Adopt Me).
  const tradeSlots = slots.filter((s) => !s.inventory);
  const divider = title ? center(title).x : gapDivider(tradeSlots.length ? tradeSlots : slots);
  // Only inventory slots in the picture (a backpack screenshot): those are
  // the user's items, not something to skip.
  const onlyInventory = !title && !tradeSlots.length;

  const mine = [];
  const theirs = [];
  let skippedInventory = 0;

  for (const s of slots) {
    if (s.inventory && !onlyInventory) { skippedInventory++; continue; }
    const barH = s.nameBottom - s.nameTop;
    const text = lines
      .filter((l) => {
        const c = center(l);
        return c.x > s.x0 && c.x < s.x1 && c.y > s.nameTop - barH * 0.3 && c.y < s.nameBottom + barH * 0.3;
      })
      .sort((a, b) => a.x - b.x)
      .map((l) => l.text)
      .join(' ');
    const fromText = namesForText(text, catalog);
    const pictures = (s.candidates || []).filter((c) => known.has(normalize(c.name)));

    let pick = null;
    if (fromText.length === 1) {
      pick = { name: fromText[0], sure: true };
    } else if (fromText.length > 1) {
      const set = new Set(fromText.map(normalize));
      const byPicture = pictures.find((c) => set.has(normalize(c.name)));
      pick = { name: byPicture ? byPicture.name : fromText[0], sure: Boolean(byPicture && byPicture.d < sureAt(s)) };
    } else if (pictures.length) {
      pick = { name: pictures[0].name, sure: pictures[0].d < sureAt(s) };
    }
    if (!pick) continue;
    pick.alternatives = [...new Set([...fromText, ...pictures.map((c) => c.name)])]
      .filter((n) => n !== pick.name)
      .slice(0, 4);
    ((s.x0 + s.x1) / 2 < divider ? mine : theirs).push(pick);
  }
  return { mine, theirs, skippedInventory, foundWindow: Boolean(title) || slots.length > 0 };
}
