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
