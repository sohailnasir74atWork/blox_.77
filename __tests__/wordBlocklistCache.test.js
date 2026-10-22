// Word filter list cache (Code/Helper/wordBlocklistCache.js): same / delta /
// full answers from word_filter_changes (supabase/052), and the fallback to
// word_filter_list when 052 is not applied. The SQL side is tested by
// scripts/word-filter/test052.mjs on PGlite.

const mockRpc = jest.fn();
jest.mock('react-native-mmkv', () => { throw new Error('no MMKV in jest'); });
jest.mock('../Code/Supabase/client', () => ({ supabase: { rpc: (...a) => mockRpc(...a) } }));

const FULL = { v: 10, full: true, terms: [['fuck', 'offensive', 'word'], ['Xyzzy', 'slur', 'auto']], off: ['kys'] };

describe('applyChanges', () => {
  const { applyChanges } = require('../Code/Helper/wordBlocklistCache');
  const base = applyChanges(null, FULL, 1);

  it('takes a full list', () => {
    expect(base).toEqual({ v: 10, terms: FULL.terms, off: ['kys'], at: 1 });
  });

  it('same version only moves the check time', () => {
    expect(applyChanges(base, { v: 10, same: true }, 2)).toEqual({ ...base, at: 2 });
    expect(applyChanges(base, { v: 11, same: true }, 2)).toBeNull();
  });

  it('merges a delta by term key', () => {
    const next = applyChanges(base, {
      v: 12,
      delta: true,
      terms: [['xyzzy', 'offensive', 'word'], ['kys', 'offensive', 'word'], ['plugh', 'spam', 'auto']],
      off: ['FUCK'],
    }, 3);
    expect(next.v).toBe(12);
    expect(next.terms).toEqual([['xyzzy', 'offensive', 'word'], ['kys', 'offensive', 'word'], ['plugh', 'spam', 'auto']]);
    expect(next.off).toEqual(['FUCK']);
  });

  it('never applies a delta without a cached list', () => {
    expect(applyChanges(null, { v: 12, delta: true, terms: [], off: [] })).toBeNull();
  });

  it('drops malformed rows and answers', () => {
    expect(applyChanges(base, null)).toBeNull();
    expect(applyChanges(base, { v: 'x', full: true })).toBeNull();
    const next = applyChanges(base, { v: 13, delta: true, terms: [['ok', 'slur'], [1, 'slur'], 'bad'], off: [2, 'gone'] }, 4);
    expect(next.terms).toContainEqual(['ok', 'slur', 'auto']);
    expect(next.off).toEqual(['kys', 'gone']);
  });
});

describe('refreshWordList', () => {
  beforeEach(() => {
    jest.resetModules();
    mockRpc.mockReset();
  });

  it('asks word_filter_changes with the cached version, then merges the delta', async () => {
    const cache = require('../Code/Helper/wordBlocklistCache');
    mockRpc.mockResolvedValueOnce({ data: FULL, error: null });
    await cache.refreshWordList({ force: true });
    expect(mockRpc).toHaveBeenLastCalledWith('word_filter_changes', { p_version: null });
    mockRpc.mockResolvedValueOnce({ data: { v: 11, delta: true, terms: [['plugh', 'offensive', 'auto']], off: [] }, error: null });
    await cache.refreshWordList({ force: true });
    expect(mockRpc).toHaveBeenLastCalledWith('word_filter_changes', { p_version: 10 });
    expect(cache.getRemoteWordList().v).toBe(11);
    expect(cache.getRemoteWordList().terms).toHaveLength(3);
  });

  it('falls back to word_filter_list when 052 is not applied', async () => {
    const cache = require('../Code/Helper/wordBlocklistCache');
    mockRpc.mockImplementation(async (name) => (name === 'word_filter_changes'
      ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
      : { data: { v: 9, terms: [['fuck', 'offensive', 'word']], off: [] }, error: null }));
    await cache.refreshWordList({ force: true });
    expect(cache.getRemoteWordList().v).toBe(9);
    await cache.refreshWordList({ force: true });
    expect(mockRpc.mock.calls.map((c) => c[0])).toEqual(['word_filter_changes', 'word_filter_list', 'word_filter_list']);
  });

  it('does not refetch within 12 hours unless forced', async () => {
    const cache = require('../Code/Helper/wordBlocklistCache');
    mockRpc.mockResolvedValue({ data: FULL, error: null });
    await cache.refreshWordList({ force: true });
    await cache.refreshWordList();
    await cache.refreshWordList();
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});
