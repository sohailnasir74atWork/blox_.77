import {fetchCatalog, refreshCatalog, usableCatalog, withDeadline} from '../Code/Helper/catalogNetwork';

const saved = [{name: 'Frost Dragon', value: 1}];
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });

test('a timeout includes a stalled JSON body and aborts the request', async () => {
  jest.useFakeTimers();
  let signal;
  global.fetch = jest.fn((url, options) => {
    signal = options.signal;
    return Promise.resolve({ok: true, json: () => new Promise(() => {})});
  });
  const request = fetchCatalog('https://example.test/catalog', {}, 100);
  const rejected = expect(request).rejects.toMatchObject({code: 'catalog/timeout'});
  await jest.advanceTimersByTimeAsync(100);
  await rejected;
  expect(signal.aborted).toBe(true);
});

test('404 and empty responses cannot replace saved data', async () => {
  const save = jest.fn();
  const fallback = jest.fn();
  global.fetch = jest.fn().mockResolvedValue({ok: false, status: 404});
  expect(await refreshCatalog({load: () => fetchCatalog('https://example.test/catalog'), cached: saved, save, fallback}))
    .toEqual({fresh: false, available: true});
  expect(save).not.toHaveBeenCalled();
  expect(fallback).not.toHaveBeenCalled();
  expect(await refreshCatalog({load: async () => ({}), cached: saved, save}))
    .toEqual({fresh: false, available: true});
  expect(save).not.toHaveBeenCalled();
});

test('fresh installs use valid fallback, and failed fallback remains unavailable', async () => {
  const save = jest.fn();
  const load = async () => { throw new Error('offline'); };
  expect(await refreshCatalog({load, cached: {}, save, fallback: async () => saved}))
    .toEqual({fresh: true, available: true});
  expect(save).toHaveBeenCalledWith(saved);
  save.mockClear();
  expect(await refreshCatalog({load, cached: '{broken', save, fallback: async () => {throw new Error('offline');}}))
    .toEqual({fresh: false, available: false});
  expect(save).not.toHaveBeenCalled();
});

test('a fast feed commits while the other feed is still pending', async () => {
  let finishSlow;
  const fastSave = jest.fn();
  const slowSave = jest.fn();
  const slow = refreshCatalog({load: () => new Promise(resolve => {finishSlow = resolve;}), save: slowSave});
  await refreshCatalog({load: async () => saved, save: fastSave});
  expect(fastSave).toHaveBeenCalledWith(saved);
  expect(slowSave).not.toHaveBeenCalled();
  finishSlow(saved);
  await slow;
});

test('a stalled fallback finishes without saving a late response', async () => {
  jest.useFakeTimers();
  let resolveFallback;
  const save = jest.fn();
  const result = refreshCatalog({load: async () => {throw new Error('offline');}, save,
    fallback: () => new Promise(resolve => {resolveFallback = resolve;})});
  await jest.advanceTimersByTimeAsync(12000);
  expect(await result).toEqual({fresh: false, available: false});
  resolveFallback(saved);
  await Promise.resolve();
  expect(save).not.toHaveBeenCalled();
});

test('malformed persisted values are rejected safely', () => {
  for (const value of [null, '{}', '[]', '{broken', '"text"', {error: 'no data'}]) {
    expect(usableCatalog(value)).toBeNull();
  }
  expect(usableCatalog(JSON.stringify(saved))).toEqual(saved);
});

test('successful operations clear their deadline', async () => {
  jest.useFakeTimers();
  await expect(withDeadline(async () => 'ready')).resolves.toBe('ready');
  expect(jest.getTimerCount()).toBe(0);
});
