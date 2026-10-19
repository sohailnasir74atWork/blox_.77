// Code/Helper/imageUpload.js: the app's only image-upload path. It must talk
// to the uploadImage function (never to Bunny storage) and keep the error
// shape the callers rely on.
const mockAuth = { currentUser: { uid: 'u1' } };
const mockFiles = {};
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => mockAuth,
  getIdToken: jest.fn(async (user, force) => (force ? 'fresh-token' : 'cached-token')),
}));
jest.mock('react-native-fs', () => ({
  readFile: jest.fn(async (path) => {
    if (!(path in mockFiles)) throw new Error(`ENOENT: ${path}`);
    return mockFiles[path];
  }),
}));
jest.mock('../Code/Helper/safeCompressImage', () => ({
  safeCompressImage: jest.fn(async () => ({ uri: 'file:///cache/small.jpg', compressed: true })),
}));

import { getIdToken } from '@react-native-firebase/auth';
import { safeCompressImage } from '../Code/Helper/safeCompressImage';
import { uploadImage, UPLOAD_KIND } from '../Code/Helper/imageUpload';

const JPEG_B64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(30, 1)]).toString('base64');
const WEBP_B64 = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4, 1), Buffer.from('WEBPVP8 '), Buffer.alloc(30, 1)]).toString('base64');
const HEIC_B64 = Buffer.concat([Buffer.alloc(4, 0), Buffer.from('ftypheic'), Buffer.alloc(30, 1)]).toString('base64');
const URL = 'https://us-central1-fruiteblocks.cloudfunctions.net/uploadImage';

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const originalFetch = global.fetch;
beforeEach(() => {
  mockAuth.currentUser = { uid: 'u1' };
  for (const k of Object.keys(mockFiles)) delete mockFiles[k];
  mockFiles['/tmp/a.jpg'] = JPEG_B64;
  mockFiles['/cache/small.jpg'] = JPEG_B64;
  jest.clearAllMocks();
});
afterEach(() => { global.fetch = originalFetch; });

test('posts { kind, data } with the ID token to uploadImage and returns the URL', async () => {
  global.fetch = jest.fn().mockResolvedValue(reply(200, { url: 'https://pull-gag.b-cdn.net/statuses/status_1_abc.jpg' }));
  await expect(uploadImage('file:///tmp/a.jpg', UPLOAD_KIND.status)).resolves.toBe('https://pull-gag.b-cdn.net/statuses/status_1_abc.jpg');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [url, init] = global.fetch.mock.calls[0];
  expect(url).toBe(URL);
  expect(init.method).toBe('POST');
  expect(init.headers.Authorization).toBe('Bearer cached-token');
  expect(JSON.parse(init.body)).toEqual({ kind: 'status', data: JPEG_B64 });
  expect(safeCompressImage).not.toHaveBeenCalled();
});

test('never talks to Bunny storage and sends no storage key', async () => {
  global.fetch = jest.fn().mockResolvedValue(reply(200, { url: 'https://pull-gag.b-cdn.net/chat/chat_1_abc.jpg' }));
  await uploadImage('/tmp/a.jpg', UPLOAD_KIND.chat);
  const [url, init] = global.fetch.mock.calls[0];
  expect(url).not.toMatch(/bunnycdn/);
  expect(Object.keys(init.headers).map((h) => h.toLowerCase())).not.toContain('accesskey');
});

test('every kind the app uses is one the server knows', () => {
  expect(Object.values(UPLOAD_KIND).sort()).toEqual(
    ['avatar', 'chat', 'dm', 'group', 'poll', 'post', 'report', 'scammer', 'status'],
  );
});

test('a HEIC or oversized original gets one JPEG pass first; webp goes as is', async () => {
  global.fetch = jest.fn().mockResolvedValue(reply(200, { url: 'https://pull-gag.b-cdn.net/x.jpg' }));
  mockFiles['/tmp/b.heic'] = HEIC_B64;
  await uploadImage('file:///tmp/b.heic', UPLOAD_KIND.post);
  expect(safeCompressImage).toHaveBeenCalledWith('file:///tmp/b.heic', expect.objectContaining({ output: 'jpg' }));
  expect(JSON.parse(global.fetch.mock.calls[0][1].body).data).toBe(JPEG_B64);

  safeCompressImage.mockClear();
  mockFiles['/tmp/big.jpg'] = JPEG_B64 + 'A'.repeat(3 * 1024 * 1024);
  await uploadImage('/tmp/big.jpg', UPLOAD_KIND.group);
  expect(safeCompressImage).toHaveBeenCalledWith('file:///tmp/big.jpg', expect.any(Object));

  safeCompressImage.mockClear();
  mockFiles['/tmp/c.webp'] = WEBP_B64;
  await uploadImage('/tmp/c.webp', UPLOAD_KIND.post);
  expect(safeCompressImage).not.toHaveBeenCalled();
});

test('one retry with a fresh token on 401', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(reply(401, { error: 'unauthenticated' }))
    .mockResolvedValueOnce(reply(200, { url: 'https://pull-gag.b-cdn.net/x.jpg' }));
  await expect(uploadImage('/tmp/a.jpg', UPLOAD_KIND.dm)).resolves.toBe('https://pull-gag.b-cdn.net/x.jpg');
  expect(getIdToken).toHaveBeenLastCalledWith(mockAuth.currentUser, true);
  expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh-token');
});

test('server errors surface as error.code, with the message ReportScreen matches', async () => {
  for (const code of ['banned', 'rate_limited', 'too_large', 'bad_image', 'upload_failed']) {
    global.fetch = jest.fn().mockResolvedValue(reply(code === 'rate_limited' ? 429 : 400, { error: code }));
    const err = await uploadImage('/tmp/a.jpg', UPLOAD_KIND.report).catch((e) => e);
    expect(err.code).toBe(code);
    expect(err.message).toMatch(/Bunny upload/);
  }
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => { throw new Error('html'); } });
  expect((await uploadImage('/tmp/a.jpg', UPLOAD_KIND.post).catch((e) => e)).code).toBe('http_503');
  global.fetch = jest.fn().mockResolvedValue(reply(200, {}));
  expect((await uploadImage('/tmp/a.jpg', UPLOAD_KIND.post).catch((e) => e)).code).toBe('http_200');
  global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
  expect((await uploadImage('/tmp/a.jpg', UPLOAD_KIND.post).catch((e) => e)).code).toBe('network');
});

test('signed out or no uri: refused before any network call', async () => {
  global.fetch = jest.fn();
  mockAuth.currentUser = null;
  expect((await uploadImage('/tmp/a.jpg', UPLOAD_KIND.post).catch((e) => e)).code).toBe('unauthenticated');
  mockAuth.currentUser = { uid: 'u1' };
  expect((await uploadImage('', UPLOAD_KIND.post).catch((e) => e)).code).toBe('bad_image');
  expect(global.fetch).not.toHaveBeenCalled();
});
