/**
 * Trade Scanner (Code/TradeScanner): slot finding, name reading, side split,
 * and the packed WebView page staying in sync with its sources.
 */
import scannerHtml from '../Code/TradeScanner/scannerHtml';
import { buildTrade, namesForText, isPermanentText } from '../Code/TradeScanner/tradeMatch';
import { pickRelease, downloadBytes, scannerState } from '../Code/TradeScanner/scannerRelease';

const matcher = require('../Code/TradeScanner/matcher');
const { build } = require('../scripts/trade-scanner/build-html');

const CATALOG = ['Dough', 'Mammoth', 'West Dragon', 'East Dragon', 'Lightning', 'Portal', 'Tiger', 'Light', '+1 Fruit Storage'];

// A w x h RGBA image filled with grey, with trade slots drawn on it.
function canvas(w, h) {
  const px = new Uint8Array(w * h * 4).fill(60);
  const rect = (x0, y0, x1, y1, [r, g, b]) => {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = (y * w + x) * 4;
        px[p] = r; px[p + 1] = g; px[p + 2] = b; px[p + 3] = 255;
      }
    }
  };
  const slot = (x, y, size, { plus = false } = {}) => {
    rect(x, y, x + size, y + 16, [40, 200, 40]);                  // green name bar
    rect(x, y + 16, x + size, y + 16 + size * 0.6, [228, 228, 228]); // light panel
    rect(x + size * 0.3, y + 30, x + size * 0.7, y + 60, [120, 40, 160]); // a "fruit"
    if (plus) {
      const cx = x + size / 2, cy = y + 16 + (size * 0.6) / 2;
      rect(cx - 2, cy - size * 0.2, cx + 2, cy + size * 0.2, [230, 210, 40]);
      rect(cx - size * 0.2, cy - 2, cx + size * 0.2, cy + 2, [230, 210, 40]);
    }
    rect(x, y + 16 + size * 0.6, x + size, y + 32 + size * 0.6, [255, 0, 255]); // pink price bar
  };
  return { px, slot };
}

describe('trade scanner page', () => {
  it('scannerHtml.js is the packed scanner.html + matcher.js + signatures (run npm run scanner:build)', () => {
    expect(scannerHtml).toBe(build());
  });

  it('ships a signature for most catalogue fruits', () => {
    const sigs = require('../Code/TradeScanner/fruitSignatures.json');
    expect(sigs.N).toBe(matcher.N);
    expect(sigs.items.length).toBeGreaterThan(80);
    expect(matcher.loadTemplates(sigs)[0].a.length).toBe(matcher.N * matcher.N);
  });
});

describe('matcher.findSlots', () => {
  it('finds each green-bar / pink-bar slot and flags inventory "+" slots', () => {
    const w = 600, h = 300;
    const { px, slot } = canvas(w, h);
    slot(50, 40, 100);
    slot(160, 40, 100, { plus: true });
    slot(350, 40, 100);
    const slots = matcher.findSlots(px, w, h);
    expect(slots.map((s) => s.x0)).toEqual([50, 160, 350]);
    expect(slots[0]).toMatchObject({ x1: 150, nameTop: 40, nameBottom: 56, priceTop: 116, inventory: false });
    expect(slots[1].inventory).toBe(true);
    expect(slots[2].inventory).toBe(false);
  });

  it('finds slots in a dim, colour-cast camera photo of the screen', () => {
    const w = 600, h = 300;
    const { px, slot } = canvas(w, h);
    slot(50, 40, 100);
    slot(160, 42, 100);
    // Darker, lower-contrast and blue-tinted, as a phone photo of a monitor.
    for (let p = 0; p < px.length; p += 4) {
      px[p] = px[p] * 0.6 + 20; px[p + 1] = px[p + 1] * 0.6 + 20; px[p + 2] = Math.min(255, px[p + 2] * 0.6 + 45);
    }
    const sigs = matcher.loadTemplates(require('../Code/TradeScanner/fruitSignatures.json'));
    expect(matcher.findSlots(px, w, h)).toEqual([]);
    const slots = matcher.scan(px, w, h, sigs);
    expect(slots.map((s) => [s.x0, s.photo])).toEqual([[50, true], [160, true]]);
  });

  it('finds slots in a window darkened by the "Ready!" countdown (2026-11-04 report)', () => {
    const w = 600, h = 300;
    const { px, slot } = canvas(w, h);
    slot(50, 40, 100);
    slot(160, 40, 100);
    // Window at ~21 % brightness, the game world around it stays bright.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4, inside = x >= 40 && x < 270 && y >= 30 && y < 140;
        for (let c = 0; c < 3; c++) px[p + c] = inside ? Math.round(px[p + c] * 0.21) : 200 + ((x + y) % 50);
      }
    }
    const sigs = matcher.loadTemplates(require('../Code/TradeScanner/fruitSignatures.json'));
    expect(matcher.findSlots(px, w, h)).toEqual([]);
    const slots = matcher.scan(px, w, h, sigs);
    expect(slots.map((s) => [s.x0, s.x1, s.photo])).toEqual([[50, 150, false], [160, 260, false]]);
  });

  it('finds the other player\'s side dimmed until they are ready (2026-11-10 report 16b8dba1)', () => {
    const w = 600, h = 300;
    const { px, slot } = canvas(w, h);
    slot(50, 40, 100);
    slot(160, 40, 100);
    slot(330, 40, 100);
    slot(440, 40, 100);
    // Right half (their offer) at ~45 % brightness.
    for (let y = 0; y < h; y++) {
      for (let x = 300; x < w; x++) {
        const p = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) px[p + c] = Math.round(px[p + c] * 0.45);
      }
    }
    const sigs = matcher.loadTemplates(require('../Code/TradeScanner/fruitSignatures.json'));
    expect(matcher.findSlots(px, w, h).map((s) => s.x0)).toEqual([50, 160]);
    const slots = matcher.scan(px, w, h, sigs);
    expect(slots.map((s) => s.x0)).toEqual([50, 160, 330, 440]);
    expect(slots[2].candidates.length).toBeGreaterThan(0);
  });

  it('splits touching slots that give one long bar (blurry video, 2026-11-03 report)', () => {
    const w = 600, h = 300;
    const { px, slot } = canvas(w, h);
    slot(50, 40, 100);
    slot(150, 40, 100);
    slot(250, 40, 100);
    slot(420, 40, 100);
    const slots = matcher.findSlots(px, w, h);
    expect(slots.map((s) => [s.x0, s.x1])).toEqual([[50, 150], [150, 250], [250, 350], [420, 520]]);
  });

  it('ignores pink without a green name bar above it', () => {
    const w = 300, h = 200;
    const { px } = canvas(w, h);
    for (let y = 100; y < 116; y++) for (let x = 20; x < 120; x++) { const p = (y * w + x) * 4; px[p] = 255; px[p + 1] = 0; px[p + 2] = 255; }
    expect(matcher.findSlots(px, w, h)).toEqual([]);
  });
});

// The in-game Items inventory: red / purple square tiles with a lighter rim
// and fruit art, on a dark grid (2026-11-08: 15 of 46 user reports).
function inventory(w, h) {
  const px = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h * 4; p += 4) { px[p] = 40; px[p + 1] = 22; px[p + 2] = 22; px[p + 3] = 255; } // dark panel / gaps
  const rect = (x0, y0, x1, y1, [r, g, b]) => {
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
        const p = (y * w + x) * 4;
        px[p] = r; px[p + 1] = g; px[p + 2] = b;
      }
    }
  };
  const tile = (x, y, size, color) => {
    rect(x, y, x + size, y + size, [234, 80, 80]);                   // rim
    rect(x + 3, y + 3, x + size - 3, y + size - 3, color);           // tile colour
    rect(x + size * 0.25, y + size * 0.25, x + size * 0.75, y + size * 0.7, [240, 240, 250]); // white fruit art
    rect(x + size * 0.4, y + size * 0.35, x + size * 0.6, y + size * 0.6, [30, 30, 40]);      // its dark face
  };
  return { px, tile, rect };
}

describe('matcher.findInventoryTiles', () => {
  const RED = [170, 30, 32];
  const PURPLE = [168, 28, 170];
  const sigs = () => matcher.loadTemplates(require('../Code/TradeScanner/fruitSignatures.json'));

  it('finds every tile of the grid, a tile cut at the list top as a full square', () => {
    const w = 640, h = 420, size = 120, pitch = 126, top = 30;
    const { px, tile, rect } = inventory(w, h);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) tile(60 + c * pitch, top + r * pitch, size, r === 2 ? PURPLE : RED);
    }
    // The list is scrolled: its top edge (the window header) hides the top
    // 50 px of the first row.
    rect(0, 0, w, top + 50, [30, 30, 34]);
    const tiles = matcher.findInventoryTiles(px, w, h);
    expect(tiles).toHaveLength(12);
    tiles.forEach((t) => expect(t).toMatchObject({ inventory: true, tile: true }));
    // Left to right, top to bottom; boxes within a few px of the tiles.
    tiles.forEach((t, i) => {
      const r = Math.floor(i / 4), c = i % 4;
      expect(Math.abs(t.x0 - (60 + c * pitch))).toBeLessThanOrEqual(4);
      expect(Math.abs(t.x1 - (60 + c * pitch + size))).toBeLessThanOrEqual(4);
      expect(Math.abs(t.priceTop - (top + r * pitch + size))).toBeLessThanOrEqual(4);
      // The model box (nameBottom..priceTop) is the whole tile, cut ones too.
      expect(t.nameBottom).toBe(t.nameTop);
      expect(Math.abs(t.priceTop - t.nameBottom - size)).toBeLessThanOrEqual(6);
    });
  });

  it('finds tiles that fruit art joins over the gap (Hellfire\'s slashes, a blurry photo)', () => {
    const w = 640, h = 300, size = 120, pitch = 126;
    const { px, tile, rect } = inventory(w, h);
    for (let c = 0; c < 4; c++) { tile(60 + c * pitch, 20, size, RED); tile(60 + c * pitch, 20 + pitch, size, RED); }
    rect(60 + size - 10, 70, 60 + pitch + 10, 76, [200, 40, 40]); // a red slash across the first gap
    rect(60 + 2 * pitch + size - 10, 70 + pitch, 60 + 3 * pitch + 10, 76 + pitch, [200, 40, 40]);
    expect(matcher.findInventoryTiles(px, w, h)).toHaveLength(8);
  });

  it('scan() reads an inventory only when there is no trade window', () => {
    const w = 640, h = 300;
    const inv = inventory(w, h);
    for (let c = 0; c < 4; c++) inv.tile(60 + c * 126, 40, 120, RED);
    const found = matcher.scan(inv.px, w, h, sigs());
    expect(found).toHaveLength(4);
    expect(found.every((s) => s.tile && s.inventory && s.candidates.length)).toBe(true);
    // A trade window with red in it stays a trade window.
    const trade = canvas(600, 300);
    trade.slot(50, 40, 100);
    trade.slot(350, 40, 100);
    const slots = matcher.scan(trade.px, 600, 300, sigs());
    expect(slots).toHaveLength(2);
    expect(slots.some((s) => s.tile)).toBe(false);
  });

  it('ignores scattered red badges (another app\'s list) and plain screens', () => {
    const w = 520, h = 1100;
    const { px, rect } = inventory(w, h);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) rect(138 + c * 170, 630 + r * 162, 170 + c * 170, 664 + r * 162, [200, 40, 40]);
    expect(matcher.findInventoryTiles(px, w, h)).toEqual([]);
    expect(matcher.findInventoryTiles(canvas(600, 300).px, 600, 300)).toEqual([]);
  });
});

describe('namesForText', () => {
  it('reads exact, cut-off, misread and old names', () => {
    expect(namesForText('Dough', CATALOG)).toEqual(['Dough']);
    expect(namesForText('Mammot', CATALOG)).toEqual(['Mammoth']);
    expect(namesForText('Portai', CATALOG)).toEqual(['Portal']);
    expect(namesForText('Rumble', CATALOG)).toEqual(['Lightning']);
    expect(namesForText('Leopard', CATALOG)).toEqual(['Tiger']);
    expect(namesForText('Dragon', CATALOG)).toEqual(['West Dragon', 'East Dragon']);
    expect(namesForText('+1 Fruit Storage', CATALOG)).toEqual(['+1 Fruit Storage']);
  });

  it('reads "Permanent X" as X and a skin "Name (Base)" as the skin', () => {
    const cat = [...CATALOG, 'Werewolf', 'Hellfire Gas', 'Gas'];
    expect(namesForText('Permanent Tiger', cat)).toEqual(['Tiger']);
    expect(isPermanentText('Permanent Tiger')).toBe(true);
    expect(isPermanentText('Tiger')).toBe(false);
    expect(namesForText('Werewolf (Tiger)', cat)).toEqual(['Werewolf']);
    expect(namesForText('Werewolf (Tige', cat)).toEqual(['Werewolf']);
    expect(namesForText('HellFire (Gas)', cat)).toEqual(['Hellfire Gas']);
  });

  it('gives nothing for unrelated text', () => {
    expect(namesForText('$2,800,000', CATALOG)).toEqual([]);
    expect(namesForText('Accept', CATALOG)).toEqual([]);
    expect(namesForText('', CATALOG)).toEqual([]);
  });
});

describe('buildTrade', () => {
  const slot = (x0, y, candidates, extra = {}) => ({ x0, x1: x0 + 100, nameTop: y, nameBottom: y + 20, priceTop: y + 90, inventory: false, candidates, ...extra });
  const line = (text, x, y) => ({ text, x, y, w: 60, h: 14 });

  it('splits sides on the window title and prefers the printed name', () => {
    const slots = [
      slot(300, 200, [{ name: 'Light', d: 0.4 }]),
      slot(410, 200, [{ name: 'Mammoth', d: 0.1 }]),
      slot(560, 200, [{ name: 'Portal', d: 0.2 }]),
    ];
    const lines = [
      line('TREASURE TRADE', 470, 120),
      line('Dough', 320, 203),
      line('Mammot', 420, 203),
    ];
    const trade = buildTrade({ slots, lines, width: 2000, catalog: CATALOG });
    expect(trade.mine.map((p) => [p.name, p.sure])).toEqual([['Dough', true], ['Mammoth', true]]);
    expect(trade.theirs.map((p) => [p.name, p.sure])).toEqual([['Portal', true]]);
    expect(trade.mine[0].alternatives).toContain('Light');
  });

  it('splits sides on a title in another language (Portuguese report, 2026-11-05)', () => {
    // Two offers 2 + 2 slots with only a slot-wide gap: the gap rule alone
    // would put all four on the user's side.
    const slots = [
      slot(300, 200, [{ name: 'Light', d: 0.1 }]),
      slot(400, 200, [{ name: 'Dough', d: 0.1 }]),
      slot(530, 200, [{ name: 'Portal', d: 0.1 }]),
      slot(630, 200, [{ name: 'Mammoth', d: 0.1 }]),
    ];
    const heading = (text) => ({ text, x: 365, y: 150, w: 300, h: 20 });
    const player = { text: 'MRLONELY', x: 560, y: 180, w: 70, h: 11 };
    for (const title of ['TROCA DE TESOUROS', 'ÉCHANGE DE TRÉSORS']) {
      const trade = buildTrade({ slots, lines: [heading(title), player], width: 2000, catalog: CATALOG });
      expect(trade.mine.map((p) => p.name)).toEqual(['Light', 'Dough']);
      expect(trade.theirs.map((p) => p.name)).toEqual(['Portal', 'Mammoth']);
    }
  });

  it('lets the picture choose between old-name targets and skips inventory slots', () => {
    const slots = [
      slot(100, 200, [{ name: 'East Dragon', d: 0.2 }, { name: 'West Dragon', d: 0.5 }]),
      slot(210, 200, [{ name: 'Dough', d: 0.1 }], { inventory: true }),
    ];
    const trade = buildTrade({ slots, lines: [line('Dragon', 120, 203)], width: 1000, catalog: CATALOG });
    expect(trade.mine.map((p) => p.name)).toEqual(['East Dragon']);
    expect(trade.mine[0].sure).toBe(true);
    expect(trade.skippedInventory).toBe(1);
  });

  it('falls back to the picture (and the gap between the offers) without a text reader', () => {
    const slots = [slot(100, 200, [{ name: 'Dough', d: 0.12 }]), slot(700, 200, [{ name: 'Light', d: 0.45 }])];
    const trade = buildTrade({ slots, lines: [], width: 1000, catalog: CATALOG });
    expect(trade.mine).toEqual([{ name: 'Dough', sure: true, alternatives: [] }]);
    expect(trade.theirs[0]).toMatchObject({ name: 'Light', sure: false });
  });

  it('puts one block of slots without the title on the user side (one offer)', () => {
    const slots = [slot(100, 200, [{ name: 'Dough', d: 0.1 }]), slot(210, 200, [{ name: 'Light', d: 0.1 }]), slot(320, 200, [{ name: 'Portal', d: 0.1 }])];
    const trade = buildTrade({ slots, lines: [line('Dough', 120, 203)], width: 2000, catalog: CATALOG });
    expect(trade.mine.map((p) => p.name)).toEqual(['Dough', 'Light', 'Portal']);
    expect(trade.theirs).toEqual([]);
  });

  it('reads an inventory-only screenshot as the user side instead of skipping it', () => {
    const slots = [slot(100, 200, [{ name: 'Dough', d: 0.1 }], { inventory: true }), slot(210, 200, [{ name: 'Light', d: 0.1 }], { inventory: true })];
    const trade = buildTrade({ slots, lines: [], width: 1000, catalog: CATALOG });
    expect(trade.mine.map((p) => p.name)).toEqual(['Dough', 'Light']);
    expect(trade.skippedInventory).toBe(0);
  });

  it('puts every in-game inventory tile on the user side and flags the screen', () => {
    const tile = (x0, y, name) => ({ x0, x1: x0 + 120, nameTop: y, nameBottom: y, priceTop: y + 120, inventory: true, tile: true, model: true, candidates: [{ name, d: 0.15 }] });
    const slots = [tile(60, 20, 'Dough'), tile(186, 20, 'Mammoth'), tile(312, 20, 'Tiger'), tile(60, 146, 'Portal'), tile(186, 146, 'Lightning')];
    // The text reader's lines ("Blox Fruit", the names) do not move sides.
    const lines = [line('Blox Fruit', 70, 24), line('Items', 300, 0), line('Dough', 120, 120)];
    const trade = buildTrade({ slots, lines, width: 640, catalog: CATALOG });
    expect(trade.mine.map((p) => p.name)).toEqual(['Dough', 'Mammoth', 'Tiger', 'Portal', 'Lightning']);
    expect(trade.mine.every((p) => p.sure)).toBe(true);
    expect(trade.theirs).toEqual([]);
    expect(trade).toMatchObject({ skippedInventory: 0, inventoryScreen: true });
    // A trade window is never an inventory screen.
    expect(buildTrade({ slots: [slot(100, 200, [{ name: 'Dough', d: 0.1 }])], width: 1000, catalog: CATALOG }).inventoryScreen).toBe(false);
  });

  it('marks "Permanent X" picks perm (the calculator\'s permanent record)', () => {
    const slots = [slot(100, 200, [{ name: 'Tiger', d: 0.7 }], { model: true })];
    const trade = buildTrade({ slots, lines: [line('Permanent Tiger', 105, 203)], width: 1000, catalog: CATALOG });
    expect(trade.mine.map((p) => [p.name, p.sure, p.perm])).toEqual([['Tiger', true, true]]);
  });

  it('a name line read across two touching slots is only a hint; the model decides', () => {
    const slots = [
      slot(100, 200, [{ name: 'Light', d: 0.17 }], { model: true }),
      slot(200, 200, [{ name: 'Portal', d: 0.11 }], { model: true }),
    ];
    const lines = [{ text: 'Dough Portal', x: 105, y: 203, w: 190, h: 14 }];
    const trade = buildTrade({ slots, lines, width: 1000, catalog: CATALOG });
    expect(trade.mine.map((p) => [p.name, p.sure])).toEqual([['Light', true], ['Portal', true]]);
  });

  it('trusts a slot model pick from score 0.5 when no name is read', () => {
    const slots = [slot(100, 200, [{ name: 'Dough', d: 0.3, score: 0.7 }], { model: true }), slot(210, 200, [{ name: 'Light', d: 0.6, score: 0.4 }], { model: true })];
    const trade = buildTrade({ slots, lines: [], width: 1000, catalog: CATALOG });
    expect(trade.mine.map((p) => [p.name, p.sure])).toEqual([['Dough', true], ['Light', false]]);
  });

  it('needs a closer picture match before a photo pick skips the "?"', () => {
    const slots = [slot(100, 200, [{ name: 'Dough', d: 0.2 }], { photo: true }), slot(210, 200, [{ name: 'Light', d: 0.2 }])];
    const trade = buildTrade({ slots, lines: [], width: 1000, catalog: CATALOG });
    expect(trade.mine.map((p) => [p.name, p.sure])).toEqual([['Dough', false], ['Light', true]]);
  });
});

describe('scanner download and updates (build 192)', () => {
  const file = (n, gz) => ({ url: `https://cdn/v${n}/f`, sha256: `sha${n}`, bytes: 1000, ...(gz ? { gz } : {}) });
  const release = (version, minBuild = 192) => ({ version, minBuild, model: file(version), names: file(version), html: file(version, 400) });
  const manifest = { version: 9, audience: 'mods', releases: { all: release(3), mods: release(4) } };

  it('everyone gets releases.all, staff the newer mods release', () => {
    expect(pickRelease(manifest, { tester: false, build: 192, needsModel: true }).version).toBe(3);
    expect(pickRelease(manifest, { tester: true, build: 192, needsModel: true }).version).toBe(4);
    const promoted = { releases: { all: release(5), mods: release(4) } };
    expect(pickRelease(promoted, { tester: true, build: 192, needsModel: true }).version).toBe(5);
  });

  it('ignores 191-only fields, builds below minBuild and incomplete releases', () => {
    expect(pickRelease({ version: 2, audience: 'all', model: file(2), names: file(2), html: file(2) }, { tester: false, build: 192, needsModel: true })).toBeNull();
    expect(pickRelease(manifest, { tester: false, build: 191, needsModel: true })).toBeNull();
    const noModel = { releases: { all: { version: 3, minBuild: 192, html: file(3) } } };
    expect(pickRelease(noModel, { tester: false, build: 192, needsModel: true })).toBeNull();
    // An iOS build without the slot model needs the page only.
    expect(pickRelease(noModel, { tester: false, build: 192, needsModel: false }).version).toBe(3);
    expect(pickRelease(null, { tester: true, build: 192, needsModel: true })).toBeNull();
  });

  it('iOS checks minBuildIos, not the Android versionCode', () => {
    // iOS build numbers (101, 122) are far below Android versionCodes.
    expect(pickRelease(manifest, { tester: false, build: 101, needsModel: true, ios: true }).version).toBe(3);
    const gated = { releases: { all: { ...release(3), minBuildIos: 130 } } };
    expect(pickRelease(gated, { tester: false, build: 129, needsModel: true, ios: true })).toBeNull();
    expect(pickRelease(gated, { tester: false, build: 130, needsModel: true, ios: true }).version).toBe(3);
    expect(pickRelease(gated, { tester: false, build: 192, needsModel: true }).version).toBe(3);
  });

  it('download size counts only new files, the page gzipped', () => {
    expect(downloadBytes(release(3), true, null)).toBe(2400);
    expect(downloadBytes(release(3), false, null)).toBe(400);
    expect(downloadBytes(release(3), true, { model: { sha256: 'SHA3' }, names: { sha256: 'sha1' } })).toBe(1400);
  });

  it('states: missing, unavailable, old, current, installed', () => {
    expect(scannerState(null, release(3))).toBe('missing');
    expect(scannerState(null, null)).toBe('unavailable');
    expect(scannerState({ version: 2 }, release(3))).toBe('old');
    expect(scannerState({ version: 3 }, release(3))).toBe('current');
    // Offline or nothing published: what is installed keeps working.
    expect(scannerState({ version: 3 }, null)).toBe('installed');
  });
});
