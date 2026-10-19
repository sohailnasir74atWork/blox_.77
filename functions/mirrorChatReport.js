/**
 * mirrorChatReport — copies each Firestore chat_reports doc into Supabase
 * public.reported_chats (039), the list that decides which private chats a
 * non-admin mod may read through mod_read_private_chat. Admins can read any
 * chat; mods only reported ones, enforced in the database.
 *
 *   onWrite chat_reports/{reportId}
 *     created/updated → upsert { report_id, chat_id, reporter_uid, reported_uid }
 *     deleted         → delete the row (the chat leaves mods' reach)
 *
 * Works for every app build, old ones too: they all write the same
 * chat_reports doc (Scamwarning.js). Firestore rules already require the
 * reporter to be one of the two uids in chatKey; checked again here.
 *
 *   reconcileReportedChats (every 6 h) makes reported_chats equal the valid
 *     chat_reports docs: mirrors reports older than the trigger and any write
 *     it missed, and drops rows whose report is gone.
 *
 * 2026-10-11: 039 was live but these functions were never deployed, so
 * reported_chats stayed empty and every non-admin mod got "chat not
 * reported" in Chat Viewer. Deploy both, then run the reconcile once by hand
 * so existing reports are readable at once:
 *   firebase deploy --only functions:mirrorChatReport,functions:reconcileReportedChats --project fruiteblocks
 *   gcloud scheduler jobs run firebase-schedule-reconcileReportedChats-us-central1 --location us-central1 --project fruiteblocks
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

const SECRETS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

// Returns the row to store, or null when the doc isn't a valid DM report.
function toRow(reportId, data) {
  const chatKey = typeof data?.chatKey === 'string' ? data.chatKey : '';
  const reporter = typeof data?.reportedBy === 'string' ? data.reportedBy : '';
  const parts = chatKey.split('_');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!reporter || !parts.includes(reporter)) return null;
  const other = parts[0] === reporter ? parts[1] : parts[0];
  return {
    report_id: reportId,
    chat_id: chatKey,
    reporter_uid: reporter,
    reported_uid: other,
    created_at: data.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
  };
}

// reportAudience.js stamps `audience` on every new report; that write
// changes nothing mirrored here, so it is skipped.
function onlyAudienceChanged(before, after) {
  if (!before || !after) return false;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  let changed = false;
  for (const k of keys) {
    const same = JSON.stringify(before[k]) === JSON.stringify(after[k]);
    if (same) continue;
    if (k !== 'audience') return false;
    changed = true;
  }
  return changed;
}

const mirrorChatReport = functions
  .runWith({ secrets: SECRETS, memory: '256MB', timeoutSeconds: 60 })
  .firestore.document('chat_reports/{reportId}')
  .onWrite(async (change, context) => {
    const { reportId } = context.params;
    if (change.before.exists && change.after.exists
        && onlyAudienceChanged(change.before.data(), change.after.data())) {
      return null;
    }
    const sb = getSupabaseAdmin();
    try {
      if (!change.after.exists) {
        const { error } = await sb.from('reported_chats').delete().eq('report_id', reportId);
        if (error) throw error;
        return null;
      }
      const row = toRow(reportId, change.after.data());
      if (!row) return null;
      const { error } = await sb.from('reported_chats').upsert(row, { onConflict: 'report_id' });
      if (error) throw error;
    } catch (e) {
      console.error('[mirrorChatReport]', reportId, e.message);
      throw e; // let Functions retry policy / logs surface it
    }
    return null;
  });

// reported_chats := the valid chat_reports docs. `firestore` and `sb` are
// passed in so the test can use fakes. Upserts every valid report (cheap: a
// few hundred rows, 500 per request) so a row that drifted is rewritten too.
async function reconcile(firestore, sb) {
  const snap = await firestore.collection('chat_reports')
    .select('chatKey', 'reportedBy', 'createdAt').get();
  const rows = [];
  snap.forEach((d) => {
    const row = toRow(d.id, d.data());
    if (row) rows.push(row);
  });
  const keep = new Set(rows.map((r) => r.report_id));

  // Ids already mirrored. PostgREST returns at most 1000 rows per select.
  const have = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('reported_chats')
      .select('report_id').order('report_id').range(from, from + 999);
    if (error) throw error;
    have.push(...(data || []).map((r) => r.report_id));
    if (!data || data.length < 1000) break;
  }
  const stale = have.filter((id) => !keep.has(id));

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from('reported_chats')
      .upsert(rows.slice(i, i + 500), { onConflict: 'report_id' });
    if (error) throw error;
  }
  for (let i = 0; i < stale.length; i += 200) {
    const { error } = await sb.from('reported_chats').delete().in('report_id', stale.slice(i, i + 200));
    if (error) throw error;
  }
  return { reports: snap.size, mirrored: rows.length, removed: stale.length };
}

const reconcileReportedChats = functions
  .runWith({ secrets: SECRETS, memory: '256MB', timeoutSeconds: 300 })
  .pubsub.schedule('every 6 hours')
  .onRun(async () => {
    const r = await reconcile(admin.firestore(), getSupabaseAdmin());
    console.log(`[reconcileReportedChats] ${r.reports} reports, ${r.mirrored} mirrored, ${r.removed} stale rows removed`);
    return null;
  });

module.exports = { mirrorChatReport, reconcileReportedChats, _internal: { toRow, reconcile, onlyAudienceChanged } };
