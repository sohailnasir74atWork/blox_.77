// Report auto-hide for statuses (2026-10-19).
// ReportModal (kind 'status') adds each reporter to the status's reportedBy
// once and bumps reportCount (firestore.rules statuses: reportsStatusOnce).
// At STATUS_HIDE_REPORTS a status is hidden from everyone but its owner and
// staff (JMD+) until staff restore it (reportCount back to 0) or delete it.
// Builds before this one ignore the field and still show it.

export const STATUS_HIDE_REPORTS = 5;

export const isReportHidden = (status) => (status?.reportCount || 0) >= STATUS_HIDE_REPORTS;

// StatusFeed groups (one per user): drops hidden statuses, and bubbles left
// empty, from other users' groups. hasUnviewed is recomputed so a hidden story
// can't light the ring.
export const hideReportedStatuses = (groups, myId) => groups.reduce((out, g) => {
  if (g.userId === myId) { out.push(g); return out; }
  const kept = g.statuses.filter(s => !isReportHidden(s));
  if (kept.length === g.statuses.length) out.push(g);
  else if (kept.length > 0) out.push({ ...g, statuses: kept, hasUnviewed: kept.some(s => !s.viewedBy?.includes(myId)) });
  return out;
}, []);
