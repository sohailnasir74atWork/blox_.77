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
const PICTURE_SURE = 0.3;

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
  const divider = title ? center(title).x : width / 2;

  const mine = [];
  const theirs = [];
  let skippedInventory = 0;

  for (const s of slots) {
    if (s.inventory) { skippedInventory++; continue; }
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
      pick = { name: byPicture ? byPicture.name : fromText[0], sure: Boolean(byPicture && byPicture.d < PICTURE_SURE) };
    } else if (pictures.length) {
      pick = { name: pictures[0].name, sure: pictures[0].d < PICTURE_SURE };
    }
    if (!pick) continue;
    pick.alternatives = [...new Set([...fromText, ...pictures.map((c) => c.name)])]
      .filter((n) => n !== pick.name)
      .slice(0, 4);
    ((s.x0 + s.x1) / 2 < divider ? mine : theirs).push(pick);
  }
  return { mine, theirs, skippedInventory, foundWindow: Boolean(title) || slots.length > 0 };
}
