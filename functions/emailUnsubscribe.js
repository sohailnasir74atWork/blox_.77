/**
 * emailUnsubscribe — the unsubscribe link in every Blox Fruit Values email.
 * Ported from Adopt Me (adoptme-jan7/functions/emailUnsubscribe.js).
 *
 *   GET  ?u=<uid>&t=<token>&l=<lang>  a page with one "Unsubscribe" button
 *        (a GET never changes anything: mail scanners open every link);
 *   POST the button, or a mail app's one-click unsubscribe (RFC 8058,
 *        "List-Unsubscribe=One-Click"): turns email off and says so.
 *
 * Turning email off writes RTDB email_prefs/{uid} = { optIn: false, ... },
 * the same switch as Settings → Email updates, so the app shows it off, and
 * puts the player's ADDRESS (from Firebase Auth) on the unsubscribe list,
 * email_unsubscribes/{emailKey} (owner, 2026-10-12): notifyBirthdayEmails
 * never emails that address again, on any account. The token is an HMAC of the uid
 * (EMAIL_UNSUB_SECRET, functions/birthdayEmail.js), so a link only ever
 * works for its own player.
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { PAGE, pickLang, escapeHtml, verifyUnsubToken, emailKey } = require('./birthdayEmail');

// The player's address for the unsubscribe list, or null (deleted account,
// no email). A failure here never fails the unsubscribe itself.
async function authEmail(uid) {
  try {
    const u = await admin.auth().getUser(uid);
    return u.email || null;
  } catch (_) {
    return null;
  }
}

const page = (lang, title, body, form) => {
  const l = pickLang(lang);
  const dir = l === 'ar' ? 'rtl' : 'ltr';
  const e = escapeHtml;
  return `<!doctype html>
<html lang="${l}" dir="${dir}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${e(title)}</title>
<style>
  body{margin:0;background:#FDF2F8;font-family:Helvetica,Arial,sans-serif;color:#1F1A2E}
  .card{max-width:420px;margin:48px auto;background:#fff;border-radius:22px;padding:30px 24px;text-align:center}
  h1{font-size:22px;margin:10px 0 8px} p{color:#4B4560;font-size:15px;line-height:22px;margin:0 0 18px}
  button{background:#EC4899;color:#fff;border:0;border-radius:999px;font-size:16px;font-weight:800;padding:13px 26px;cursor:pointer}
</style></head>
<body><div class="card"><div style="font-size:44px">🎂</div>
<h1>${e(title)}</h1><p>${e(body)}</p>${form || ''}</div></body></html>`;
};

exports.emailUnsubscribe = functions
  .runWith({ secrets: ['EMAIL_UNSUB_SECRET'], memory: '128MB', timeoutSeconds: 30 })
  .https.onRequest(async (req, res) => {
    const uid = String(req.query.u || '');
    const token = String(req.query.t || '');
    const lang = pickLang(req.query.l);
    const copy = PAGE[lang];
    res.set('Cache-Control', 'no-store');

    if (!/^[A-Za-z0-9]{10,128}$/.test(uid) || !verifyUnsubToken(uid, token, process.env.EMAIL_UNSUB_SECRET)) {
      res.status(400).send(page(lang, copy.bad, '', ''));
      return;
    }

    if (req.method === 'GET') {
      const action = `?u=${encodeURIComponent(uid)}&t=${encodeURIComponent(token)}&l=${lang}`;
      res.status(200).send(page(lang, copy.confirmTitle, copy.confirmBody,
        `<form method="post" action="${action}"><button type="submit">${escapeHtml(copy.confirm)}</button></form>`));
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).send('');
      return;
    }

    try {
      // update() keeps the stored dob; the shape matches what the app writes.
      await admin.database().ref(`email_prefs/${uid}`).update({
        optIn: false,
        source: 'settings',
        updatedAt: admin.database.ServerValue.TIMESTAMP,
      });
      const email = await authEmail(uid);
      if (email) {
        await admin.database().ref(`email_unsubscribes/${emailKey(email)}`).set({
          email: email.trim().toLowerCase(),
          uid,
          at: admin.database.ServerValue.TIMESTAMP,
        });
      }
      console.log('[emailUnsubscribe] unsubscribed', uid, email ? '(address listed)' : '(no address)');
      res.status(200).send(page(lang, copy.doneTitle, copy.doneBody, ''));
    } catch (e) {
      console.error('[emailUnsubscribe] write failed:', e.message);
      res.status(500).send(page(lang, copy.bad, '', ''));
    }
  });
