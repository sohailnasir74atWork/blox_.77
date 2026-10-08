// Send ONE birthday email (functions/birthdayEmail.js) to a test address.
// The keys come from Secret Manager into the environment, never the command line:
//
//   BREVO_API_KEY=$(gcloud secrets versions access latest --secret=BREVO_API_KEY --project=fruiteblocks) \
//   EMAIL_UNSUB_SECRET=$(gcloud secrets versions access latest --secret=EMAIL_UNSUB_SECRET --project=fruiteblocks) \
//   node scripts/birthdays/send-test-email.js --to you@example.com [--lang ru] [--name Alice] [--no-gift] [--plain] [--uid <firebase uid>]
//
// --uid makes the footer's unsubscribe link work for that account (it really
// turns email off for it); without it the link points at a dummy account.

const path = require('path');
const { renderBirthdayEmail, sendBrevo, unsubUrl, cleanName } = require(path.join(__dirname, '..', '..', 'functions', 'birthdayEmail'));

const arg = (flag, fallback = null) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};

(async () => {
  const to = arg('--to');
  const apiKey = process.env.BREVO_API_KEY;
  const secret = process.env.EMAIL_UNSUB_SECRET;
  if (!to || !apiKey || !secret) {
    console.error('Need --to, plus BREVO_API_KEY and EMAIL_UNSUB_SECRET in the environment (see the header).');
    process.exit(1);
  }
  const lang = arg('--lang', 'en');
  const name = arg('--name', 'Sohail');
  const gift = !process.argv.includes('--no-gift');
  const uid = arg('--uid', 'TESTUSER000000000000');
  const unsubscribeUrl = unsubUrl(uid, lang, secret);
  const plain = process.argv.includes('--plain');
  const mail = renderBirthdayEmail({ name, gift, lang, unsubscribeUrl, plain });
  const id = await sendBrevo({ apiKey, to, toName: cleanName(name), unsubscribeUrl, ...mail });
  console.log(`sent "${mail.subject}" to ${to} (${lang}${gift ? ', gift' : ''}) — Brevo id ${id}`);
})().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
