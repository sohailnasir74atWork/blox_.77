import {
  isAllowedStickerUrl,
  sanitizeManifest,
  stickerPackName,
  refreshStickerManifest,
  getStickerPacks,
  subscribeStickerPacks,
  BUNDLED_MANIFEST,
  STICKER_MANIFEST_URL,
  __resetStickerManifestForTests,
} from '../Code/ChatScreen/Stickers/stickerManifest';

const CASES = require('../scripts/stickers/url-cases.json');
const DRAGON = 'https://blox-api.b-cdn.net/stickers/fruits/dragon.webp';
const LEGACY = 'https://bloxfruitscalc.com/wp-content/uploads/2025/Emojies/e1.png';

const originalFetch = global.fetch;
const respond = (body, status = 200) =>
  jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => __resetStickerManifestForTests());
afterEach(() => { global.fetch = originalFetch; });

test('URL allowlist matches supabase/050 sticker_url_allowed (shared cases)', () => {
  for (const u of CASES.allowed) expect([u, isAllowedStickerUrl(u)]).toEqual([u, true]);
  for (const u of CASES.refused) expect([u, isAllowedStickerUrl(u)]).toEqual([u, false]);
});

test('bundled fallback is the original 16 stickers, all allowed', () => {
  const [pack] = BUNDLED_MANIFEST.packs;
  expect(pack.id).toBe('classic');
  expect(pack.stickers).toHaveLength(16);
  expect(pack.stickers.every((s) => isAllowedStickerUrl(s.url))).toBe(true);
  expect(getStickerPacks()).toBe(BUNDLED_MANIFEST.packs);
});

test('sanitizeManifest keeps good packs and drops the rest', () => {
  const out = sanitizeManifest({
    version: 3,
    packs: [
      { id: 'Fruits', name: ' Fruits ', names: { ja: 'フルーツ', de: '', ru: 5 },
        stickers: [{ id: 'd', url: DRAGON }, { id: 'dup', url: DRAGON }, { id: 'x', url: 'https://evil.example/x.png' }, null] },
      { id: 'fruits', name: 'Again', stickers: [{ id: 'e1', url: LEGACY }] },   // duplicate id
      { id: 'bad id!', stickers: [{ url: LEGACY }] },
      { id: 'empty', stickers: [{ url: 'http://blox-api.b-cdn.net/stickers/a.png' }] },
      'junk',
    ],
  });
  expect(out).toEqual({
    version: 3,
    packs: [{ id: 'fruits', name: 'Fruits', names: { ja: 'フルーツ' }, stickers: [{ id: 'd', url: DRAGON }] }],
  });
});

test('sanitizeManifest rejects unusable uploads and caps sizes', () => {
  expect(sanitizeManifest(null)).toBeNull();
  expect(sanitizeManifest({ packs: [] })).toBeNull();
  expect(sanitizeManifest({ version: 'x', packs: [{ id: 'a', stickers: [{ url: LEGACY }] }] })).toBeNull();
  expect(sanitizeManifest({ version: 1, packs: [{ id: 'a', stickers: [] }] })).toBeNull();

  const many = Array.from({ length: 80 }, (_, i) => ({ id: `s${i}`, url: `https://blox-api.b-cdn.net/stickers/p/s${i}.png` }));
  const packs = Array.from({ length: 25 }, (_, i) => ({ id: `p${i}`, stickers: many }));
  const out = sanitizeManifest({ version: 1, packs });
  expect(out.packs).toHaveLength(20);
  expect(out.packs[0].stickers).toHaveLength(60);
});

test('pack names: translation key, then manifest language, then English name', () => {
  const t = (key, { defaultValue }) => (key === 'chat.stickers.pack_classic' ? 'Klassisch' : defaultValue);
  expect(stickerPackName({ id: 'classic', name: 'Classic', names: {} }, t, 'de')).toBe('Klassisch');
  const pack = { id: 'fruits', name: 'Fruits', names: { ja: 'フルーツ' } };
  expect(stickerPackName(pack, t, 'ja')).toBe('フルーツ');
  expect(stickerPackName(pack, t, 'pt-BR')).toBe('Fruits');
});

test('refresh swaps packs only when the version changes, and caches the answer', async () => {
  const listener = jest.fn();
  subscribeStickerPacks(listener);
  const manifest = { version: 2, packs: [{ id: 'fruits', name: 'Fruits', stickers: [{ id: 'd', url: DRAGON }] }] };
  global.fetch = respond(manifest);

  await refreshStickerManifest({ now: 1000 });
  expect(global.fetch).toHaveBeenCalledWith(STICKER_MANIFEST_URL, expect.anything());
  expect(getStickerPacks().map((p) => p.id)).toEqual(['fruits']);
  expect(listener).toHaveBeenCalledTimes(1);

  // Within 6 h: no request at all.
  await refreshStickerManifest({ now: 1000 + 60 * 60 * 1000 });
  expect(global.fetch).toHaveBeenCalledTimes(1);

  // Later, same version: fetched, nothing replaced.
  global.fetch = respond({ ...manifest, packs: [{ id: 'other', stickers: [{ url: LEGACY }] }] });
  await refreshStickerManifest({ now: 1000 + 7 * 60 * 60 * 1000 });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(getStickerPacks().map((p) => p.id)).toEqual(['fruits']);
  expect(listener).toHaveBeenCalledTimes(1);
});

test('offline, 404 and broken uploads keep the bundled packs', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  await refreshStickerManifest({ now: 1 });
  expect(getStickerPacks()).toBe(BUNDLED_MANIFEST.packs);

  // A network error is not a check: the next open tries again.
  global.fetch = respond({}, 404);
  await refreshStickerManifest({ now: 2 });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(getStickerPacks()).toBe(BUNDLED_MANIFEST.packs);

  // A 404 is a check: no refetch within 6 h.
  await refreshStickerManifest({ now: 3 });
  expect(global.fetch).toHaveBeenCalledTimes(1);

  global.fetch = respond({ version: 9, packs: [{ id: 'x', stickers: [{ url: 'https://evil.example/a.png' }] }] });
  await refreshStickerManifest({ force: true, now: 4 });
  expect(getStickerPacks()).toBe(BUNDLED_MANIFEST.packs);
});

test('concurrent opens share one request', async () => {
  global.fetch = respond({ version: 5, packs: [{ id: 'a', stickers: [{ url: LEGACY }] }] });
  await Promise.all([refreshStickerManifest({ now: 1 }), refreshStickerManifest({ now: 1 })]);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
