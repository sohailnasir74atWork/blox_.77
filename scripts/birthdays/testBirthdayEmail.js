// Fake-backed test (Blox) of functions/notifyBirthdayEmails.js + birthdayEmail.js.
// No network: Brevo is a stubbed fetch, Supabase/RTDB/Auth are in memory.
//   node scripts/birthdays/testBirthdayEmail.js
// Also writes an HTML preview per language to $PREVIEW_DIR when set.

const path = require('path');
const fs = require('fs');

const FN = path.join(__dirname, '..', '..', 'functions');
const be = require(path.join(FN, 'birthdayEmail'));
const { _internals: { run, MAX_SENDS } } = require(path.join(FN, 'notifyBirthdayEmails'));

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('FAIL', msg); } };

// ── Rendering ────────────────────────────────────────────────────────────
const SECRET = 'test-secret';
for (const lang of be.LANGS) {
  const url = be.unsubUrl('uid123abcdef', lang, SECRET);
  const g = be.renderBirthdayEmail({ name: 'Alice', gift: true, lang, unsubscribeUrl: url });
  const n = be.renderBirthdayEmail({ name: '', gift: false, lang, unsubscribeUrl: url });
  ok(g.subject.includes('Alice') && !n.subject.includes('{{'), `${lang}: name in subject only when given`);
  ok(g.html.includes(be.POSTAL_ADDRESS) && g.text.includes(be.POSTAL_ADDRESS), `${lang}: postal address`);
  ok(g.html.includes(url) && g.text.includes(url), `${lang}: unsubscribe link`);
  ok(g.html.includes(be.escapeHtml(be.COPY[lang].buttonGift)) && n.html.includes(be.escapeHtml(be.COPY[lang].button)), `${lang}: gift vs plain button`);
  ok(!g.html.includes('{{') && !n.html.includes('{{'), `${lang}: no unfilled placeholders`);
  ok((lang === 'ar') === g.html.includes('dir="rtl"'), `${lang}: direction`);
  if (process.env.PREVIEW_DIR) {
    fs.mkdirSync(process.env.PREVIEW_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.PREVIEW_DIR, `birthday-${lang}.html`), g.html);
  }
}
const evil = be.renderBirthdayEmail({ name: '<script>x</script>', gift: true, lang: 'en', unsubscribeUrl: 'u' });
ok(!evil.html.includes('<script>x') && evil.html.includes('&lt;script&gt;'), 'names are HTML-escaped');
ok(be.cleanName('visit www.scam.com') === '' && be.cleanName('a@b.co') === '', 'link-like names dropped');
ok(be.cleanName('  Bunny   Queen ') === 'Bunny Queen', 'names trimmed');
ok(be.pickLang('pt-BR') === 'en' && be.pickLang('ru') === 'en', 'always English');

// ── Unsubscribe tokens ──────────────────────────────────────────────────
const tok = be.unsubToken('uidA', SECRET);
ok(be.verifyUnsubToken('uidA', tok, SECRET), 'token verifies');
ok(!be.verifyUnsubToken('uidB', tok, SECRET), 'token is per player');
ok(!be.verifyUnsubToken('uidA', tok, 'other-secret'), 'token needs the secret');
ok(!be.verifyUnsubToken('uidA', '', SECRET) && !be.verifyUnsubToken('uidA', 'x', SECRET), 'junk rejected');

// ── The daily run ───────────────────────────────────────────────────────
function makeWorld({ rows, emails, prefs = {}, langs = {} }) {
  let queue = [...rows];
  const sent = [];
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.to[0].email === 'fail@x.com') return { ok: false, status: 400, json: async () => ({ code: 'invalid_parameter', message: 'bad' }) };
    sent.push({ url, headers: opts.headers, body });
    return { ok: true, status: 201, json: async () => ({ messageId: `<m${sent.length}>` }) };
  };
  const supabase = {
    rpc: async (fn, { p_limit }) => {
      if (fn !== 'birthday_email_batch') throw new Error(fn);
      const out = queue.slice(0, p_limit);
      queue = queue.slice(p_limit);
      return { data: out, error: null };
    },
    from: () => ({ select: () => ({ in: async (_c, uids) => ({ data: uids.filter((u) => langs[u]).map((u) => ({ uid: u, lang: langs[u] })), error: null }) }) }),
  };
  const auth = { getUsers: async (ids) => ({ users: ids.filter(({ uid }) => emails[uid]).map(({ uid }) => ({ uid, email: emails[uid], disabled: false })) }) };
  const db = { ref: (p) => ({ once: async () => ({ val: () => prefs[p.split('/')[1]] ?? null }) }) };
  return { sent, args: { db, auth, supabase, apiKey: 'k', unsubSecret: SECRET } };
}

(async () => {
  const w = makeWorld({
    rows: [
      { r_uid: 'A', r_name: 'Alice', r_gift: true },
      { r_uid: 'B', r_name: 'Bob', r_gift: false },
      { r_uid: 'C', r_name: 'NoEmail', r_gift: true },
      { r_uid: 'D', r_name: 'OptedOut', r_gift: true },
      { r_uid: 'E', r_name: 'Apple', r_gift: true },
      { r_uid: 'F', r_name: 'Fails', r_gift: true },
    ],
    emails: { A: 'a@x.com', B: 'b@x.com', D: 'd@x.com', E: 'e@privaterelay.appleid.com', F: 'fail@x.com' },
    prefs: { D: false, B: true },
    langs: { A: 'ru', B: 'xx' },
  });
  const s = await run(w.args);
  ok(s.claimed === 6, `claimed 6 (got ${s.claimed})`);
  ok(s.sent === 2 && w.sent.length === 2, `sent to A and B only (got ${s.sent})`);
  ok(s.noEmail === 1 && s.optedOut === 1 && s.appleRelay === 1 && s.failed === 1, `skip counts ${JSON.stringify(s)}`);
  const a = w.sent.find((m) => m.body.to[0].email === 'a@x.com');
  ok(a.body.subject.startsWith('Happy birthday, Alice!') && a.body.subject.includes('15'), 'A in English, stars gift subject');
  ok(a.body.sender.email === 'hello@bloxfruitscalc.com', 'sender');
  ok(a.headers['api-key'] === 'k', 'api key header');
  ok(/^<https:\/\/us-central1-fruiteblocks\.cloudfunctions\.net\/emailUnsubscribe\?u=A&t=/.test(a.body.headers['List-Unsubscribe']), 'List-Unsubscribe header');
  ok(a.body.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', 'one-click header');
  const b = w.sent.find((m) => m.body.to[0].email === 'b@x.com');
  ok(b.body.subject === 'Happy birthday, Bob! 🎂', 'B: no gift');

  // Daily cap: never more than MAX_SENDS in one run.
  const many = Array.from({ length: MAX_SENDS + 40 }, (_, i) => ({ r_uid: `U${i}`, r_name: '', r_gift: true }));
  const emails = Object.fromEntries(many.map((r) => [r.r_uid, `${r.r_uid}@x.com`]));
  const w2 = makeWorld({ rows: many, emails });
  const s2 = await run(w2.args);
  ok(s2.sent === MAX_SENDS && s2.claimed === MAX_SENDS, `capped at ${MAX_SENDS} (sent ${s2.sent}, claimed ${s2.claimed})`);

  // Nobody today: one empty claim, nothing sent.
  const w3 = makeWorld({ rows: [], emails: {} });
  const s3 = await run(w3.args);
  ok(s3.claimed === 0 && w3.sent.length === 0, 'empty day');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
