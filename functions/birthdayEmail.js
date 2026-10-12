/**
 * birthdayEmail.js — the birthday email itself, shared by
 * notifyBirthdayEmails.js (the daily send), emailUnsubscribe.js (the
 * unsubscribe page) and scripts/birthdays/send-test-email.js.
 *
 * Ported from Adopt Me (adoptme-jan7/functions/birthdayEmail.js, 2026-10-08).
 * Sent through Brevo's transactional API from bloxfruitscalc.com (same Brevo
 * account as Adopt Me; the free plan's 300 emails a day are shared). English
 * only: Blox keeps no per-player language on the server. The gift is Blox's
 * 15 stars, not a card pack.
 *
 * Every email carries a one-click unsubscribe (RFC 8058 List-Unsubscribe
 * headers plus a footer link). The link is signed with EMAIL_UNSUB_SECRET so
 * nobody can unsubscribe someone else.
 */

const crypto = require('crypto');

const SENDER = { name: 'Blox Fruit Values', email: 'hello@bloxfruitscalc.com' };
const APP_URL = 'https://bloxfruitscalc.com/app?utm_source=brevo&utm_medium=email&utm_campaign=birthday';
const UNSUB_BASE = 'https://us-central1-fruiteblocks.cloudfunctions.net/emailUnsubscribe';
// Required by anti-spam law (CAN-SPAM): a real postal address in every email.
const POSTAL_ADDRESS = 'The Solana Labs · 27 E/45, POF, Wah Cantt 47040, Pakistan';
const LANGS = ['en'];

const COPY = {
  en: {
    subjectNamedGift: 'Happy birthday, {{name}}! 🎂 Your 15 ⭐ birthday gift is waiting',
    subjectGift: 'Happy birthday! 🎂 Your 15 ⭐ birthday gift is waiting',
    subjectNamed: 'Happy birthday, {{name}}! 🎂',
    subject: 'Happy birthday! 🎂',
    preheaderGift: 'Claim your 15 free stars in the app today!',
    preheader: 'Have an amazing day from all of us at Blox Fruit Values.',
    titleNamed: 'Happy birthday, {{name}}! 🎉',
    title: 'Happy birthday! 🎉',
    gift: 'Your birthday gift is waiting in the app: 15 ⭐ stars, free. Claim it today!',
    noGift: 'Have an amazing day! Players can send you birthday wishes in the app today.',
    buttonGift: 'Claim my 15 stars',
    button: 'Open the app',
    signoff: 'Have a great birthday!',
    team: 'The Blox Fruit Values team',
    why: "You got this email because it's your birthday and you have a Blox Fruit Values account. We send it once a year, on your birthday.",
    unsubscribe: 'Unsubscribe',
    disclaimer: 'Fan-made app · not affiliated with Roblox or Gamer Robot',
  },
};

// The unsubscribe page (emailUnsubscribe.js).
const PAGE = {
  en: { confirmTitle: 'Unsubscribe from Blox Fruit Values emails?', confirmBody: "We'll stop sending emails to this address.", confirm: 'Unsubscribe', doneTitle: "You're unsubscribed", doneBody: "You won't get emails from Blox Fruit Values anymore. You can turn them back on in the app: Settings → Email updates.", bad: "This link isn't valid. Please use the link in your email." },
};

const pickLang = (lang) => {
  const base = String(lang || 'en').slice(0, 2).toLowerCase();
  return LANGS.includes(base) ? base : 'en';
};

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Display names are the player's own choice: trimmed, capped, and dropped
// when empty or when they look like a link or an email address.
const cleanName = (name) => {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  if (!n || /https?:|www\.|@|\.(com|net|org|app|gg)\b/i.test(n)) return '';
  return n;
};

const fill = (tpl, name) => tpl.replace('{{name}}', name);

// ── Unsubscribe links ────────────────────────────────────────────────────
const unsubToken = (uid, secret) => crypto
  .createHmac('sha256', String(secret))
  .update(`unsub:${uid}`)
  .digest('base64url')
  .slice(0, 22);

const verifyUnsubToken = (uid, token, secret) => {
  if (!uid || !token || !secret) return false;
  const want = Buffer.from(unsubToken(uid, secret));
  const got = Buffer.from(String(token));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
};

const unsubUrl = (uid, lang, secret) =>
  `${UNSUB_BASE}?u=${encodeURIComponent(uid)}&t=${unsubToken(uid, secret)}&l=${pickLang(lang)}`;

// The unsubscribe list is by ADDRESS (owner, 2026-10-12): RTDB
// email_unsubscribes/{emailKey(email)} = { email, uid, at }. Keyed by a hash
// of the lowercased address so RTDB's key rules ('.', '#', '$', '[', ']')
// never matter. No rule opens this path: only Cloud Functions read or write it.
const emailKey = (email) => crypto
  .createHash('sha256')
  .update(String(email || '').trim().toLowerCase())
  .digest('hex');

// ── The email ────────────────────────────────────────────────────────────
// Gmail files designed mail (colour blocks, big buttons, emoji subjects) under
// Promotions. `plain` reads like a personal note instead: plain paragraphs, a
// text link, no emoji in the subject.
const stripEmoji = (s) => s.replace(/\s*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\uFE0F?/gu, '').trim();

/** { subject, html, text } for one player. */
function renderBirthdayEmail({ name, gift, lang, unsubscribeUrl, plain = false }) {
  const l = pickLang(lang);
  const c = COPY[l];
  const n = cleanName(name);
  const subject = n
    ? fill(gift ? c.subjectNamedGift : c.subjectNamed, n)
    : (gift ? c.subjectGift : c.subject);
  const title = n ? fill(c.titleNamed, n) : c.title;
  const body = gift ? c.gift : c.noGift;
  const button = gift ? c.buttonGift : c.button;
  const preheader = gift ? c.preheaderGift : c.preheader;
  const dir = l === 'ar' ? 'rtl' : 'ltr';
  const e = escapeHtml;

  if (plain) {
    const plainSubject = stripEmoji(subject);
    const html = `<!doctype html>
<html lang="${l}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(plainSubject)}</title></head>
<body style="margin:0;padding:16px;font-family:Arial,sans-serif;font-size:15px;line-height:23px;color:#222222;" dir="${dir}">
<div style="max-width:520px;">
<p style="margin:0 0 14px;">${e(stripEmoji(title))} 🎂</p>
<p style="margin:0 0 14px;">${e(body)}</p>
<p style="margin:0 0 14px;"><a href="${APP_URL}" style="color:#1A73E8;">${e(button)}</a></p>
<p style="margin:0 0 22px;">${e(c.signoff)}<br>${e(c.team)}</p>
<p style="margin:0;font-size:12px;line-height:18px;color:#777777;">${e(c.why)}<br><a href="${unsubscribeUrl}" style="color:#777777;">${e(c.unsubscribe)}</a> · ${e(POSTAL_ADDRESS)}<br>${e(c.disclaimer)}</p>
</div></body></html>`;
    const text = [stripEmoji(title), '', body, '', `${button}: ${APP_URL}`, '', c.signoff, c.team, '', '—',
      c.why, `${c.unsubscribe}: ${unsubscribeUrl}`, POSTAL_ADDRESS, c.disclaimer].join('\n');
    return { subject: plainSubject, html, text };
  }

  const html = `<!doctype html>
<html lang="${l}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${e(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#FDF2F8;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FDF2F8;">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border-radius:24px;" dir="${dir}">
      <tr><td style="background:#EC4899;border-radius:24px 24px 0 0;height:10px;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td align="center" style="padding:30px 26px 6px;font-size:64px;line-height:72px;">🎂</td></tr>
      <tr><td align="center" style="padding:6px 26px 0;font-family:Helvetica,Arial,sans-serif;font-size:26px;line-height:32px;font-weight:800;color:#1F1A2E;">${e(title)}</td></tr>
      <tr><td align="center" style="padding:14px 28px 0;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:24px;color:#4B4560;">${e(body)}</td></tr>
      <tr><td align="center" style="padding:24px 26px 6px;">
        <a href="${APP_URL}" style="display:inline-block;background:#EC4899;color:#FFFFFF;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:800;text-decoration:none;padding:14px 28px;border-radius:999px;">${gift ? '🎁 ' : ''}${e(button)}</a>
      </td></tr>
      <tr><td align="center" style="padding:20px 26px 30px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:#4B4560;">${e(c.signoff)}<br><strong style="color:#1F1A2E;">${e(c.team)}</strong></td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;" dir="${dir}">
      <tr><td align="center" style="padding:18px 20px 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#8A7FA0;">
        ${e(c.why)}<br>
        <a href="${unsubscribeUrl}" style="color:#8A7FA0;text-decoration:underline;">${e(c.unsubscribe)}</a><br>
        ${e(POSTAL_ADDRESS)}<br>
        ${e(c.disclaimer)}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    title, '', body, '', `${button}: ${APP_URL}`, '', c.signoff, c.team, '', '—',
    c.why, `${c.unsubscribe}: ${unsubscribeUrl}`, POSTAL_ADDRESS, c.disclaimer,
  ].join('\n');

  return { subject, html, text };
}

/** One email through Brevo's transactional API. Resolves Brevo's messageId. */
async function sendBrevo({ apiKey, to, toName, subject, html, text, unsubscribeUrl }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: SENDER,
      to: [toName ? { email: to, name: toName } : { email: to }],
      subject,
      htmlContent: html,
      textContent: text,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      tags: ['birthday'],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`brevo ${res.status}: ${body.code || ''} ${body.message || ''}`.trim());
  return body.messageId;
}

module.exports = {
  SENDER, APP_URL, POSTAL_ADDRESS, LANGS, COPY, PAGE,
  pickLang, escapeHtml, cleanName,
  unsubToken, verifyUnsubToken, unsubUrl, emailKey,
  renderBirthdayEmail, sendBrevo,
};
