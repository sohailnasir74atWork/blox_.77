/**
 * notifyBirthdayWishes — birthday-wish notifications (supabase/036; ported
 * from Adopt Me 2026-10-07), at most
 * TWO per birthday:
 *   1. the first wish:  "🎂 BunnyQueen wished you a happy birthday!"
 *   2. a summary 8 hours later, only if more wishes came in:
 *                       "🎉 You got 12 birthday wishes!"
 * Every 10 minutes it asks Supabase (birthday_wish_push_batch) which pushes
 * are due; claiming marks them, so a retried run never sends twice. English
 * only (no per-player language on Blox's server).
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

const BATCH = 500;

const COPY = {
  first: (n) => ({ title: `🎂 ${n} wished you a happy birthday!`, body: 'Tap to see your birthday wishes.' }),
  summary: (c) => ({ title: `🎉 You got ${c} birthday wishes!`, body: 'See who celebrated you today.' }),
};

const cleanName = (n) => String(n || 'Someone').replace(/[\r\n]+/g, ' ').slice(0, 30);

async function sendOne(db, row) {
  const token = (await db.ref(`users/${row.uid}/fcmToken`).once('value')).val();
  if (!token || typeof token !== 'string') return false;
  const notification = row.kind === 'first' ? COPY.first(cleanName(row.from_name)) : COPY.summary(row.wishes);
  const tag = 'birthday-wish';
  try {
    await admin.messaging().send({
      token,
      notification,
      data: { type: 'birthday_wish', route: 'Birthdays' },
      android: { priority: 'high', notification: { channelId: 'default', sound: 'default', tag } },
      apns: { headers: { 'apns-collapse-id': tag }, payload: { aps: { sound: 'default' } } },
    });
    return true;
  } catch (error) {
    if (error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered') {
      await db.ref(`users/${row.uid}/fcmToken`).remove();
    } else {
      console.error('[notifyBirthdayWishes] push failed:', error.code || error.message);
    }
    return false;
  }
}

async function run(db, supabase) {
  const { data, error } = await supabase.rpc('birthday_wish_push_batch', { p_limit: BATCH });
  if (error) throw new Error(`birthday_wish_push_batch: ${error.message}`);
  const rows = data || [];
  if (!rows.length) return { claimed: 0, sent: 0 };
  const results = await Promise.all(rows.map((r) => sendOne(db, r).catch(() => false)));
  const sent = results.filter(Boolean).length;
  console.log(`[notifyBirthdayWishes] claimed ${rows.length}, pushed ${sent}`);
  return { claimed: rows.length, sent };
}

exports.notifyBirthdayWishes = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '128MB',
    timeoutSeconds: 120,
  })
  .pubsub.schedule('every 10 minutes')
  .onRun(() => run(admin.database(), getSupabaseAdmin()));

// Exposed for tests.
exports._internals = { run, COPY };
