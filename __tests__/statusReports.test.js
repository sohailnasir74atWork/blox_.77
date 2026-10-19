import { STATUS_HIDE_REPORTS, isReportHidden, hideReportedStatuses } from '../Code/Design/statusReports';

const ME = 'me';
const st = (id, reportCount, viewedBy = []) => ({ id, reportCount, viewedBy });
const group = (userId, statuses, hasUnviewed = true) => ({ userId, userName: userId, statuses, hasUnviewed });

describe('status report auto-hide', () => {
  it('hides at 5 reports, not before; restore (0) and old docs (no field) show', () => {
    expect(STATUS_HIDE_REPORTS).toBe(5);
    expect(isReportHidden(st('a', 4))).toBe(false);
    expect(isReportHidden(st('a', 5))).toBe(true);
    expect(isReportHidden(st('a', 9))).toBe(true);
    expect(isReportHidden(st('a', 0))).toBe(false);
    expect(isReportHidden({ id: 'old' })).toBe(false);
    expect(isReportHidden(null)).toBe(false);
  });

  it('drops hidden statuses and emptied bubbles, keeps untouched groups as-is', () => {
    const clean = group('u1', [st('c1', 0), st('c2', 2)]);
    const allHidden = group('u2', [st('h1', 5)]);
    const mixed = group('u3', [st('m1', 6), st('m2', 1, [ME])], true);
    const out = hideReportedStatuses([clean, allHidden, mixed], ME);

    expect(out.map(g => g.userId)).toEqual(['u1', 'u3']);
    expect(out[0]).toBe(clean);
    expect(out[1].statuses.map(s => s.id)).toEqual(['m2']);
    // The only unviewed story was the hidden one, so the ring goes grey.
    expect(out[1].hasUnviewed).toBe(false);
  });

  it('never hides the viewer\'s own statuses', () => {
    const mine = group(ME, [st('x', 7)]);
    expect(hideReportedStatuses([mine], ME)).toEqual([mine]);
  });
});
