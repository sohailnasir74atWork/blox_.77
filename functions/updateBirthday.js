/**
 * updateBirthday — a player corrects their birth date (day, month and year),
 * once (supabase/036_birthdays.sql, birthday_edits; ported from Adopt Me
 * 2026-10-07). The client can't do this
 * itself: users_private/{uid}/dateOfBirth is write-once in database.rules.json.
 *
 *   POST {cloudFunctionsUrl}/updateBirthday
 *   Authorization: Bearer <Firebase ID token>
 *   { "year": 2010, "month": 10, "day": 7 }      (year optional: keeps the current one)
 *
 * Rules:
 *   - signed in, with a birth date already on file (users_private, or the
 *     legacy users/{uid}/dateOfBirth for accounts not migrated yet);
 *   - a real date, not in the future, at least 4 years ago (as the first-run
 *     birthday screen requires);
 *   - never into an OLDER age group: under 13 / 13-15 / 16-17 / 18+ are the
 *     lines Adopt Me's age protections use (kept the same in Blox), so a
 *     one-time edit must not let anyone out of a protection. Staying in the
 *     same group, or moving to a younger one, is fine;
 *   - once per account: birthday_edits (uid primary key) in Supabase.
 *
 * Writes users_private/{uid}/dateOfBirth (and the legacy copy if there is
 * one) and user_identity_base.date_of_birth directly (the private mirror
 * would copy it a moment later anyway).
 *
 * 200 { dateOfBirth } | 400 { error: bad_request | bad_date | same | age_change | no_birthday }
 * 401 { error: sign_in } | 409 { error: already_edited } | 500 { error: server }
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

const DOB_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const pad = (n) => String(n).padStart(2, '0');

const parseDob = (dob) => {
  const m = typeof dob === 'string' ? DOB_RE.exec(dob.trim()) : null;
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
};

const isRealDate = (y, m, d) => {
  if (!Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
};

// The age groups the app's rules use: under 13, 13-15, 16-17, 18+.
const ageGroup = (age) => (age < 13 ? 0 : age < 16 ? 1 : age < 18 ? 2 : 3);

// Whole years on `today` (UTC calendar), like the server's dob_age_years().
const ageOn = ({ y, m, d }, today) => {
  let age = today.getUTCFullYear() - y;
  const mo = today.getUTCMonth() + 1;
  if (mo < m || (mo === m && today.getUTCDate() < d)) age -= 1;
  return age;
};

async function handle({ uid, body, db, supabase, now = new Date() }) {
  if (!uid) return [401, { error: 'sign_in' }];
  const month = Number(body?.month);
  const day = Number(body?.day);
  const yearIn = body?.year == null ? null : Number(body.year);
  if (!Number.isInteger(month) || !Number.isInteger(day) || (yearIn != null && !Number.isInteger(yearIn))) {
    return [400, { error: 'bad_request' }];
  }

  const privRef = db.ref(`users_private/${uid}/dateOfBirth`);
  const legacyRef = db.ref(`users/${uid}/dateOfBirth`);
  const [privSnap, legacySnap] = await Promise.all([privRef.once('value'), legacyRef.once('value')]);
  const currentDob = privSnap.val() || legacySnap.val() || null;
  const cur = parseDob(currentDob);
  if (!cur) return [400, { error: 'no_birthday' }];

  const year = yearIn == null ? cur.y : yearIn;
  if (year < 1900 || !isRealDate(year, month, day)) return [400, { error: 'bad_date' }];
  const next = { y: year, m: month, d: day };
  const nextDob = `${next.y}-${pad(next.m)}-${pad(next.d)}`;
  if (Date.UTC(next.y, next.m - 1, next.d) > now.getTime() || ageOn(next, now) < 4) return [400, { error: 'bad_date' }];
  if (next.y === cur.y && next.m === cur.m && next.d === cur.d) return [400, { error: 'same' }];
  if (ageGroup(ageOn(next, now)) > ageGroup(ageOn(cur, now))) return [400, { error: 'age_change' }];

  // The once-only lock first: a second request loses here, before any write.
  const { error: lockErr } = await supabase
    .from('birthday_edits')
    .insert({ uid, old_dob: currentDob, new_dob: nextDob });
  if (lockErr) {
    if (lockErr.code === '23505') return [409, { error: 'already_edited' }];
    console.error('[updateBirthday] lock failed:', lockErr.message);
    return [500, { error: 'server' }];
  }

  try {
    const writes = [privRef.set(nextDob)];
    if (legacySnap.exists()) writes.push(legacyRef.set(nextDob));
    await Promise.all(writes);
  } catch (e) {
    // Nothing changed for the player: give the correction back.
    console.error('[updateBirthday] RTDB write failed:', e.message);
    await supabase.from('birthday_edits').delete().eq('uid', uid);
    return [500, { error: 'server' }];
  }

  const { error: idErr } = await supabase
    .from('user_identity_base')
    .update({ date_of_birth: nextDob, updated_at: new Date().toISOString() })
    .eq('uid', uid);
  if (idErr) console.error('[updateBirthday] identity update failed (mirror will retry):', idErr.message);

  return [200, { dateOfBirth: nextDob }];
}

exports.updateBirthday = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '128MB',
    timeoutSeconds: 30,
  })
  .https.onRequest(async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
    let uid = null;
    const m = /^Bearer (.+)$/.exec(req.get('Authorization') || '');
    if (m) {
      try { uid = (await admin.auth().verifyIdToken(m[1])).uid; } catch (_) { uid = null; }
    }
    try {
      const [status, json] = await handle({ uid, body: req.body, db: admin.database(), supabase: getSupabaseAdmin() });
      res.status(status).json(json);
    } catch (e) {
      console.error('[updateBirthday]', e.message);
      res.status(500).json({ error: 'server' });
    }
  });

// Exposed for tests.
exports._internals = { handle, ageOn, ageGroup, isRealDate, parseDob };
