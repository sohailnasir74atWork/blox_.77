import { normalizeTerm, sideMatches, tradeMatchesSearch } from '../Code/Trades/tradeSearch';

// Shapes copied from live trades_new_upgrade docs (2026-11-20).
const starlight = { name: 'Starlight Gravity', type: 'n', value: 1 };
const gravity = { name: 'Gravity', type: 'n', value: 1 };
const permGravity = { name: 'Gravity', type: 'p', value: 2 };
const buddha = { name: 'Buddha', type: 'n', value: 1 };
const lightning = { name: 'Lightning', type: 'n', value: 1 };

describe('normalizeTerm', () => {
  it('lowercases, trims and squeezes spaces', () => {
    expect(normalizeTerm('  Starlight   Gravity ')).toBe('starlight gravity');
    expect(normalizeTerm(null)).toBe('');
  });
});

describe('sideMatches', () => {
  it('word match keeps Starlight Gravity for "gravity" (old behaviour)', () => {
    expect(sideMatches([starlight], 'gravity')).toBe(true);
  });
  it('exact match drops Starlight Gravity for "gravity"', () => {
    expect(sideMatches([starlight], 'gravity', { exact: true })).toBe(false);
    expect(sideMatches([starlight, gravity], 'gravity', { exact: true })).toBe(true);
    expect(sideMatches([starlight], 'starlight gravity', { exact: true })).toBe(true);
  });
  it('perm only needs the matching item to be permanent', () => {
    expect(sideMatches([gravity], 'gravity', { exact: true, permOnly: true })).toBe(false);
    expect(sideMatches([gravity, permGravity], 'gravity', { exact: true, permOnly: true })).toBe(true);
  });
  it('only this item rejects sides with anything else', () => {
    expect(sideMatches([buddha, lightning], 'buddha', { exact: true, onlyThis: true })).toBe(false);
    expect(sideMatches([buddha], 'buddha', { exact: true, onlyThis: true })).toBe(true);
    expect(sideMatches([buddha, buddha], 'buddha', { exact: true, onlyThis: true })).toBe(true);
    expect(sideMatches([], 'buddha', { onlyThis: true })).toBe(false);
  });
  it('ignores bad rows', () => {
    expect(sideMatches(undefined, 'buddha')).toBe(false);
    expect(sideMatches([null, { type: 'n' }], 'buddha')).toBe(false);
  });
});

describe('tradeMatchesSearch', () => {
  const trade = { status: 'w', hasItems: [buddha, lightning], wantsItems: [buddha] };
  it('checks only the searched sides', () => {
    const opts = { exact: true, onlyThis: true };
    expect(tradeMatchesSearch(trade, 'buddha', { inHas: true, inWants: false, ...opts })).toBe(false);
    expect(tradeMatchesSearch(trade, 'buddha', { inHas: false, inWants: true, ...opts })).toBe(true);
    expect(tradeMatchesSearch(trade, 'buddha', { inHas: true, inWants: true, ...opts })).toBe(true);
  });
  it('applies the win/lose/fair filter', () => {
    expect(tradeMatchesSearch(trade, 'buddha', { inHas: true, inWants: true, statusValues: ['l'] })).toBe(false);
    expect(tradeMatchesSearch(trade, 'buddha', { inHas: true, inWants: true, statusValues: ['w'] })).toBe(true);
  });
});
