/**
 * functions/reviewSignals.js — the pure tally code shared by the trigger
 * (reviewIntegrity.js), the backfill and the recount scripts.
 */
const S = require('../functions/reviewSignals');

const score = (rating, extra = {}) => ({ rating, counted: true, hard: [], soft: [], scamReport: false, ...extra });

describe('review tallies', () => {
  test('an empty tally has every contribution key at 0', () => {
    const t = S.emptyTally();
    expect(Object.keys(t).sort()).toEqual(Object.keys(S.contribution(score(5))).sort());
    expect(Object.values(t).every((v) => v === 0)).toBe(true);
  });

  test('backfill-style accumulation over a fixture has no NaN and the right totals', () => {
    const fixture = [
      score(5),
      score(4, { soft: ['newAccount'] }),
      score(1, { counted: false, hard: ['noChat'] }),                // never chatted: out everywhere
      score(2, { counted: false, hard: ['sameDeviceAsReviewee'] }),  // Top Rated only
      score(1, { scamReport: true }),
    ];
    const byUser = new Map();
    for (const s of fixture) byUser.set('u1', S.addScore(byUser.get('u1') || S.emptyTally(), s));
    const t = byUser.get('u1');
    expect(Object.values(t).every(Number.isFinite)).toBe(true);
    expect(t).toEqual({ count: 3, sum: 10, scamReports: 1, excludedCount: 2, flaggedCount: 1, shownCount: 4, shownSum: 12 });
    expect(S.tallyScores(fixture)).toEqual(t);
    expect(S.profileSummary(t)).toEqual({ count: 4, averageRating: 3 });
  });

  test('a summary without usable profile tallies is not treated as migrated', () => {
    expect(S.hasShownTallies(null)).toBe(false);
    expect(S.hasShownTallies({ count: 3, sum: 12 })).toBe(false);
    expect(S.hasShownTallies({ shownCount: NaN, shownSum: 4 })).toBe(false);
    expect(S.hasShownTallies({ shownCount: 0, shownSum: 0 })).toBe(true);
  });

  test('removing a score undoes adding it', () => {
    const t = S.addScore(S.addScore(S.emptyTally(), score(5)), score(3));
    expect(S.addScore(t, score(3), -1)).toEqual(S.addScore(S.emptyTally(), score(5)));
  });
});

describe('chat verdict of a stored score', () => {
  const H = 60 * 60 * 1000;
  test('version 2 stores it', () => {
    expect(S.storedChat({ chat: true })).toBe(true);
    expect(S.storedChat({ chat: false })).toBe(false);
    expect(S.storedChat({ chat: null })).toBe(null);
    expect(S.storedChat(undefined)).toBe(undefined);
  });
  test('version 1 noChat is trusted only when set on creation', () => {
    const created = Date.now() - 30 * 24 * H;
    expect(S.storedChat({ soft: ['noChat'], reviewCreatedAt: created, scoredAt: created + 5000 })).toBe(false);
    expect(S.storedChat({ soft: ['noChat'], reviewCreatedAt: created, scoredAt: created + 40 * 24 * H })).toBe(null);
    expect(S.storedChat({ soft: [], reviewCreatedAt: created, scoredAt: created })).toBe(null);
  });
  test('a no-chat review is HARD-excluded and hidden from the profile', () => {
    const v = S.evaluateReview({ reviewId: 'b_a', review: { fromUserId: 'a', toUserId: 'b', rating: 5 }, createdAtMs: Date.now(), reviewerExists: true, hasChat: false });
    expect(v.counted).toBe(false);
    expect(v.hard).toEqual(['noChat']);
    expect(S.shownOnProfile({ rating: 5, ...v })).toBe(false);
  });
});

test('the stamp follows the written values', () => {
  expect(S.profileStamp({ count: 2, averageRating: 4.5 })).toBe('2|4.5');
  expect(S.profileStamp({ count: 3, averageRating: 4.5 })).not.toBe(S.profileStamp({ count: 2, averageRating: 4.5 }));
});
