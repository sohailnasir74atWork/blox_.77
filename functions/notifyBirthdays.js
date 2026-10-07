/**
 * notifyBirthdays — the birthday push (supabase/036_birthdays.sql; ported from
 * Adopt Me 2026-10-07).
 *
 * Once a day it claims today's birthdays from Supabase (birthday_push_batch:
 * birthday is today in UTC, account at least 30 days old, not pushed yet this
 * year; claiming marks them, so a retried or crashed run never pushes anyone
 * twice) and sends each player "Happy birthday! Your 15 ⭐ birthday gift is
 * waiting". Every player gets it, whether or not
 * they show their birthday to others: it is a private message to them.
 *
 * English only: Blox keeps no per-player language on the server, and looking
 * one up would cost a read per push. Tokens come from RTDB
 * users/{uid}/fcmToken; dead tokens are removed. Blox's app has no push-tap
 * routing, so a tap opens the app on Home, where the birthday card offers the
 * gift.
 *
 * 14:00 UTC: morning in the Americas, afternoon in Europe, evening in Asia.
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

const BATCH = 500;
const MAX_BATCHES = 20;   // 10,000 a day is far above the real count (~1 in 365 accounts)

const COPY = { title: 'Happy birthday! 🎂', body: 'Your birthday gift is waiting: 15 ⭐ stars. Open the app to claim it today!' };

async function sendOne(db, uid) {
  const token = (await db.ref(`users/${uid}/fcmToken`).once('value')).val();
  if (!token || typeof token !== 'string') return false;
  const tag = 'birthday';
  try {
    await admin.messaging().send({
      token,
      notification: COPY,
      data: { type: 'birthday', route: 'Birthdays' },
      android: { priority: 'high', notification: { channelId: 'default', sound: 'default', tag } },
      apns: { headers: { 'apns-collapse-id': tag }, payload: { aps: { sound: 'default' } } },
    });
    return true;
  } catch (error) {
    if (error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered') {
      await db.ref(`users/${uid}/fcmToken`).remove();
    } else {
      console.error('[notifyBirthdays] push failed:', error.code || error.message);
    }
    return false;
  }
}

async function run(db, supabase) {
  let claimed = 0;
  let sent = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const { data, error } = await supabase.rpc('birthday_push_batch', { p_limit: BATCH });
    if (error) throw new Error(`birthday_push_batch: ${error.message}`);
    const uids = (data || []).map((r) => (typeof r === 'string' ? r : r.birthday_push_batch || r.uid)).filter(Boolean);
    if (!uids.length) break;
    claimed += uids.length;
    const results = await Promise.all(uids.map((uid) => sendOne(db, uid).catch(() => false)));
    sent += results.filter(Boolean).length;
    if (uids.length < BATCH) break;
  }
  console.log(`[notifyBirthdays] claimed ${claimed}, pushed ${sent}`);
  return { claimed, sent };
}

exports.notifyBirthdays = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '256MB',
    timeoutSeconds: 300,
  })
  .pubsub.schedule('every day 14:00')
  .timeZone('UTC')
  .onRun(() => run(admin.database(), getSupabaseAdmin()));

// Exposed for tests.
exports._internals = { run, COPY };
