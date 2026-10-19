// PGlite test of supabase/049_word_filter.sql (word filter), in the style of
// scripts/birthdays/test041.mjs.
//   node scripts/word-filter/test049.mjs
// Checks: idempotent apply; SQL constants == wordFilterCore.js; seed == the
// app's bundled list; word_filter_normalize / word_filter_pattern == the JS
// core on a fuzzed corpus; the chat + username triggers (users, staff tiers,
// service role, updates, allow phrases); the editing rpcs and the versioned
// public read.
import { PGlite } from '/Volumes/Sohail/cloud functions/ROBLOX/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const require = createRequire(import.meta.url);
const core = require(path.join(REPO, 'Code/Helper/wordFilterCore.js'));
const read = (f) => fs.readFileSync(path.join(REPO, 'supabase', f), 'utf8');

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('FAIL', msg); } };
const q = async (s, p) => (await db.query(s, p)).rows;
const one = async (s, p) => (await q(s, p))[0];
const err = async (s, p) => { try { await db.query(s, p); return null; } catch (e) { return e.message; } };

// Callers. claims: null = no JWT (SQL editor), otherwise request.jwt.claims.
const as = async (claims) => {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims ? JSON.stringify(claims) : '']);
};
const user = (uid, extra = {}) => ({ role: 'authenticated', sub: uid, ...extra });

await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create function public.firebase_uid() returns text language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'firebase_uid',
                    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub') $$;
  create table public.user_roles (uid text primary key, is_admin boolean not null default false,
    is_moderator boolean not null default false, is_baby_mod boolean not null default false,
    is_trusted boolean not null default false, is_cmsr boolean not null default false);
  create table public.user_identity (uid text primary key, display_name text);
  create table public.messages (id bigserial primary key, sender_id text, text text, gif text);
  create table public.group_messages (id bigserial primary key, sender_id text, text text);
  create table public.private_messages (id bigserial primary key, sender_id text, text text);
`);
// 034's caller helpers, verbatim bodies.
const s034 = read('034_chat_moderation_enforcement.sql');
const fnOf = (name) => {
  const start = s034.indexOf(`create or replace function public.${name}(`);
  const open = s034.indexOf('$$', start);
  const end = s034.indexOf('$$;', open + 2) + 3;
  if (start < 0 || end < 3) throw new Error('034 function not found: ' + name);
  return s034.slice(start, end);
};
await db.exec(fnOf('_chat_jwt_claims'));
await db.exec(fnOf('_chat_end_user_uid'));
await db.exec(fnOf('_chat_caller_link_tier'));
await db.exec(read('021_username_uniqueness.sql'));
await db.exec(read('022_username_charset_relax.sql'));

const SQL = read('049_word_filter.sql');
await db.exec(SQL);
const v1 = (await one(`select version from word_filter_state`)).version;
await db.exec(SQL); // idempotent
ok((await one(`select count(*)::int as n from word_blocklist`)).n === core.BUNDLED.length + 20, 're-run adds no rows');
ok(Number((await one(`select version from word_filter_state`)).version) >= Number(v1), 'version never goes back');

// --- constants ---------------------------------------------------------------
const C = core.SQL_CONSTANTS;
const k = await one(`select _wf_spaces_re() sp, _wf_strip_re() st, _wf_punct_re() pu, _wf_map_from() mf, _wf_map_to() mt`);
ok(k.sp === C.SPACES_SRC, 'spaces class == JS');
ok(k.st === C.STRIP_SRC, 'strip class == JS');
ok(k.pu === '[' + C.PUNCT_BMP + '\\U00010000-\\U0010ffff]', 'punct class == JS');
ok(k.mf === C.MAP_FROM && k.mt === C.MAP_TO, 'character map == JS');
ok(SQL.includes(`translate(v_t, '${C.LEET_FROM}', '${C.LEET_TO}')`), 'leetspeak map == JS');

// --- seed == bundled ---------------------------------------------------------
const seed = await q(`select term, kind, match_mode, lang, active from word_blocklist where added_by is null order by id`);
const active = seed.filter((r) => r.active).map((r) => [r.term, r.kind, r.match_mode, r.lang].join('|'));
const bundled = core.BUNDLED.map((b) => [b.term, b.kind, b.mode, b.lang].join('|'));
ok(JSON.stringify(active) === JSON.stringify(bundled), 'active seed rows == wordFilterCore BUNDLED');
ok(seed.filter((r) => !r.active).length === 20, '20 switched-off suggestions');

// --- normalise: SQL == JS on a fuzzed corpus ----------------------------------
const PALETTE = [
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  ...'013457@$!?.,-_*~#%&()[]{}<>/\\|\'"`^+=:;',
  ' ', '  ', '\t', '\n', ' ', ' ', '　', ' ', ' ',
  '​', '‌', '‍', '⁠', '﻿', '­', '͏', '᠎', 'ㅤ', 'ᅟ',
  '́', '̈', '̃', '̧', '⃣',
  ...'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÉÎÕÜßØøŁłĐđÆæŒœıİ',
  ...'ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđĐ',
  ...'абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯіїєґЇЄҐѕјԁһӏ',
  ...'αβγδεζηθικλμνξοπρσςτυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩάέήίόύώϲ',
  ...'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘʀꜱᴛᴜᴠᴡʏᴢ',
  ...'ＡＢＣａｂｃｎｉｇ０１３＠＄！．＿',
  ...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي', 'َ', 'ِ', 'ّ', 'ـ', '،', '؟', 'ﻻ', 'ﺍ',
  ...'あいうアイウ漢字々〻、。「」・',
  '☆', '♥', '★', '✓', '→', '©', '®', '™', '°', '·', '•', '…', '–', '—', '‘', '’', '“', '”', '«', '»', '¡', '¿', '¨', '´', '¸',
  'ⓝ', 'ⓘ', 'Ⓖ', '⒩', '①', '²', '½', 'ﬁ', 'ℓ', 'ℕ',
  '😀', '🔥', '👍🏽', '🇺🇸', '𝓷', '𝓲', '𝓰', '𝓮', '𝓻', '𝐧', '𝐢', '𝐠', '𝔫', '🅽', '🄽',
];
let seedN = 49;
const rnd = (n) => { seedN = (seedN * 1103515245 + 12345) % 2147483648; return seedN % n; };
const corpus = [
  '', ' ', 'hello', 'Hello World', 'n.i.g.g.e.r', 'N1GG3R', 'ｎｉｇｇｅｒ', '𝓷𝓲𝓰𝓰𝓮𝓻', 'n i g g e r', 'nіggеr',
  'n​i​g​g​e​r', 'n¨igger', '455k for leopard', 'I am a fag!', 'spicy food', 'homework',
  'je suis en retard', 'big_dick', 'a$$', 'fuuuuuck', 'Ｎ 1 g g 3 r', 'ПИДОРАС', 'пидор', 'ПиДоР', 'педикюр',
  'жидкий', 'tàu khựa', 'TÀU KHỰA', 'زنجي', 'زِنْجِي', 'زنـــجي', 'ﺯﻧﺠﻲ', 'k i l l   y o u r s e l f',
  'kill.yourself', 'enviado', 'viado', 'VIADO!!!', 'Pakistan', 'paki', 'raccoon', 'coon', 'Scunthorpe',
  'ching chong', 'ching-chong', 'heil   hitler', '1v1 me 50k', '$100 @user', '@@@ $$$', '1 2 3 4 5', 'a b',
  'x y z w', 'ab c d e', 'ç', 'ß', 'İstanbul', 'ǅ', 'ﬁne', 'ⓝⓘⓖⓖⓔⓡ', '⒩⒤⒢⒢⒠⒭', 'n😀igger', 'trade 4 5 6 7',
];
for (let i = 0; i < 3000; i++) {
  const len = 1 + rnd(24);
  let s = '';
  for (let j = 0; j < len; j++) s += PALETTE[rnd(PALETTE.length)];
  corpus.push(s);
}
// Run-heavy strings: the piece cap (runs <= 16 chars, first 6 runs) must agree.
const spaced = (n, k) => Array.from({ length: n }, (_, j) => 'abcdefghijklmnopqrstuvwxyz'[(k * 7 + j * j * 3 + k * j) % 26]).join(' ');
for (let k = 0; k < 12; k++) corpus.push(Array.from({ length: k + 2 }, (_, i) => spaced(3 + ((i + k) % 16), i + k)).join(' zz '));
corpus.push(Array.from({ length: 8 }, (_, i) => spaced(4, i)).join(' . '), 'u r a f a g ' + spaced(17, 1) + ' f a g');
// Plus every bundled term, upper-cased, leetified, spaced and accented.
for (const b of core.BUNDLED) {
  corpus.push(b.term, b.term.toUpperCase(), b.term.split('').join(' '), b.term.split('').join('.'),
    b.term.replace(/o/g, '0').replace(/i/g, '1').replace(/e/g, '3'), b.term + 's', 'x' + b.term + 'x',
    b.term.replace(/a/g, 'а').replace(/o/g, 'о'), b.term.replace(/(.)/, '$1$1$1'));
}
const sqlNorm = (await one(`select jsonb_agg(word_filter_normalize(x) order by i) as r
                              from unnest($1::text[]) with ordinality as t(x, i)`, [corpus])).r;
let normDiff = 0;
corpus.forEach((x, i) => {
  const js = core.normalize(x);
  if (js !== sqlNorm[i]) {
    normDiff++;
    if (normDiff <= 8) console.log('  normalise differs:', JSON.stringify(x), 'js', JSON.stringify(js), 'sql', JSON.stringify(sqlNorm[i]));
  }
});
ok(normDiff === 0, `word_filter_normalize == JS on ${corpus.length} strings (${normDiff} differ)`);
ok(core.HAS_NFKD, 'Node has String.prototype.normalize (fuzz compared the NFKD path)');

// --- patterns: SQL == JS -----------------------------------------------------
const pats = [];
for (const b of core.BUNDLED) for (const m of ['auto', 'word', 'part']) pats.push([b.term, m, b.kind]);
for (let i = 0; i < 400; i++) pats.push([corpus[100 + i], ['auto', 'word', 'part'][i % 3], ['slur', 'allow'][i % 2]]);
pats.push(['lll000', 'auto', 'slur'], ['a1b22c333', 'word', 'slur'], ['88', 'auto', 'slur'], ['$$$', 'auto', 'slur']);
const sqlPat = (await one(`select jsonb_agg(word_filter_pattern(t[1], t[2], t[3]) order by i) as r
                             from unnest($1::text[]) with ordinality as u(x, i),
                                  lateral (select string_to_array(x, chr(1)) as t) s`,
  [pats.map((p) => p.join('\u0001'))])).r;
let patDiff = 0;
pats.forEach((p, i) => {
  const js = core.termPattern(p[0], p[1], p[2]);
  if (js !== sqlPat[i]) {
    patDiff++;
    if (patDiff <= 8) console.log('  pattern differs:', JSON.stringify(p), 'js', js, 'sql', sqlPat[i]);
  }
});
ok(patDiff === 0, `word_filter_pattern == JS on ${pats.length} terms (${patDiff} differ)`);

// --- matching: SQL check == JS matcher built from the same table -------------
const rows = await q(`select term, kind, match_mode as mode from word_blocklist where active`);
const m = core.buildMatcher(rows);
const probes = [...corpus,
  'you are a n1gg3r', 'f a g', 'retard', 'you retard', 'je suis en retard', 'il est en retard, désolé',
  'retardant', 'retarded', 'spic', 'spicy', 'homo sapiens', 'homework', 'kys', 'kill yourself',
  'FuckYou', 'fuck_you', 'Dick_Grayson', 'Dickson', 'peacock', 'grape', 'enviado', 'chinks', 'Pakistan',
  'Niger', 'nigeria', 'cabello negro', 'kkkkk', 'negre', 'neger', 'tàu khựa', 'tau khua', 'TAU KHUA lol'];
const sqlChk = (await one(`select jsonb_agg(coalesce(word_filter_check(x, true), '-') order by i) as r
                             from unnest($1::text[]) with ordinality as t(x, i)`, [probes])).r;
let chkDiff = 0;
probes.forEach((x, i) => {
  const js = core.firstHitKind(x, m, ['slur', 'offensive']) || '-';
  if (js !== sqlChk[i]) {
    chkDiff++;
    if (chkDiff <= 8) console.log('  check differs:', JSON.stringify(x), 'js', js, 'sql', sqlChk[i]);
  }
});
ok(chkDiff === 0, `word_filter_check == JS matcher on ${probes.length} probes (${chkDiff} differ)`);
const chk = async (t, names = false) => (await one(`select word_filter_check($1, $2) as r`, [t, names])).r;
ok(await chk('you are a n1gg3r') === 'slur', 'leetspeak slur');
ok(await chk('Ｎ 1 g g 3 r') === 'slur', 'fullwidth + spaced + leet');
ok(await chk('𝓷𝓲𝓰𝓰𝓮𝓻') === 'slur', 'maths "fancy font" letters');
ok(await chk('n​i​g​g​e​r') === 'slur', 'zero-width characters');
ok(await chk('nіggеr') === 'slur', 'Cyrillic homoglyphs');
ok(await chk('ПИДОРАС') === 'slur' && await chk('педик') === 'slur', 'Russian');
ok(await chk('педикюр') === null && await chk('жидкий') === null, 'Russian innocent words');
ok(await chk('زِنْجِي') === 'slur' && await chk('زنـــجي') === 'slur', 'Arabic with harakat / tatweel');
ok(await chk('je suis en retard') === null && await chk('you retard') === 'slur', 'allow phrase vs slur');
ok(await chk('spicy food') === null && await chk('homework') === null && await chk('Pakistan') === null, 'Scunthorpe');
ok(await chk('raccoon') === null && await chk('enviado') === null && await chk('Niger') === null, 'more innocent words');
ok(await chk('cabello negro') === null && await chk('kkkkk') === null, 'negro / kkk are not server-blocked');
ok(await chk('Dick_Grayson') === null && await chk('Dick_Grayson', true) === 'offensive', 'offensive: names only');
ok(await chk('you are a f a g') === 'slur' && await chk('u r a f a g') === 'slur', 'lone letters next to a spaced word');
ok(await chk('i am a b c') === null && await chk('a b c d e f g') === null, 'spaced alphabet is clean');

// --- chat triggers ------------------------------------------------------------
await db.exec(`insert into user_roles (uid, is_admin, is_moderator, is_baby_mod, is_cmsr) values
  ('ADM', true, false, false, false), ('MOD', false, true, false, false), ('JMD', false, true, true, false),
  ('SR', false, false, false, true)`);
const send = async (table, claims, text) => { await as(claims); return err(`insert into ${table} (sender_id, text) values ($1, $2)`, [claims?.sub || null, text]); };
for (const t of ['messages', 'group_messages', 'private_messages']) {
  ok((await send(t, user('U'), 'you are a f a g')) === 'WORDS_NOT_ALLOWED', `${t}: user slur rejected`);
  ok((await send(t, user('U'), 'hello there, spicy trade?')) === null, `${t}: clean text passes`);
  ok((await send(t, user('U'), 'désolé je suis en retard')) === null, `${t}: allow phrase passes`);
  ok((await send(t, user('U'), 'fuck this')) === null, `${t}: offensive (not slur) is the app's job`);
  ok((await send(t, user('JMD'), 'n1gga')) === 'WORDS_NOT_ALLOWED', `${t}: JMD not exempt`);
  ok((await send(t, user('MOD'), 'n1gga')) === null, `${t}: moderator exempt (link bypass)`);
  ok((await send(t, user('SR'), 'n1gga')) === null, `${t}: senior mod exempt`);
  ok((await send(t, user('ADM'), 'n1gga')) === null, `${t}: admin exempt`);
  ok((await send(t, user('OWN', { email: 'thesolanalabs@gmail.com' }), 'n1gga')) === null, `${t}: owner email exempt`);
  ok((await send(t, { role: 'service_role' }, 'n1gga')) === null, `${t}: service role passes`);
  ok((await send(t, null, 'n1gga')) === null, `${t}: no JWT (editor) passes`);
}
await as(user('U'));
const mid = (await one(`insert into messages (sender_id, text) values ('U', 'clean') returning id`)).id;
ok((await err(`update messages set text = 'retard' where id = $1`, [mid])) === 'WORDS_NOT_ALLOWED', 'update to a slur rejected');
await as(null);
await db.query(`update messages set text = 'retard' where id = $1`, [mid]);
await as(user('U'));
ok((await err(`update messages set gif = 'x' where id = $1`, [mid])) === null, 'update of another column passes');
ok((await err(`update messages set text = text where id = $1`, [mid])) === null, 'unchanged text passes');

// --- usernames ----------------------------------------------------------------
const claim = async (uid, name) => { await as(user(uid)); return err(`select claim_username($1)`, [name]); };
ok(/USERNAME_NOT_ALLOWED/.test(await claim('U1', 'xXn1gg3rXx') || ''), 'name with a slur refused');
ok(/USERNAME_NOT_ALLOWED/.test(await claim('U1', 'Fuck_You') || ''), 'name with an offensive word refused');
ok(/not allowed/.test(await claim('U1', 'kys') || ''), 'old builds get a readable sentence');
ok((await claim('U1', 'SpicyTrader')) === null, 'innocent name passes');
ok((await claim('ADM', 'retard')) !== null, 'nobody is exempt for names');
await as(null);
ok((await err(`insert into usernames (lower_name, uid, display_name) values ('nigger', 'X', 'nigger')`)) === null, 'service writes pass');

// --- editing rpcs + versioned read -----------------------------------------------
await as(null);
ok(/NOT_ALLOWED/.test(await err(`select word_filter_add('xyzzy', 'slur')`) || ''), 'no JWT cannot use the rpc');
await as(user('U'));
ok(/NOT_ALLOWED/.test(await err(`select word_filter_add('xyzzy', 'slur')`) || ''), 'user cannot add');
await as(user('MOD'));
ok(/NOT_ALLOWED/.test(await err(`select word_filter_admin_list()`) || ''), 'moderator cannot list for editing');
await as(user('SR'));
const before = await one(`select word_filter_list(null) as r`);
const vBefore = before.r.v;
ok(Array.isArray(before.r.terms) && before.r.terms.length === core.BUNDLED.length, 'public read lists active terms');
ok((await one(`select word_filter_list($1) as r`, [vBefore])).r.same === true, 'same version -> {same: true}');
const added = (await one(`select word_filter_add('Xyzzy', 'slur', 'word', 'EN', 'test', 'Sr') as r`)).r;
ok(added.term_key === 'xyzzy' && added.added_by === 'SR' && added.lang === 'en', 'Sr Mod adds a term');
const after = (await one(`select word_filter_list($1) as r`, [vBefore])).r;
ok(after.v > vBefore && after.terms.some((t) => t[0] === 'Xyzzy'), 'version bumps, new term listed');
await as(user('U'));
ok((await send('messages', user('U'), 'you xyzzy')) === 'WORDS_NOT_ALLOWED', 'new term enforced at once');
await as(user('ADM'));
await db.query(`select word_filter_remove('XYZZY')`);
ok((await send('messages', user('U'), 'you xyzzy')) === null, 'removed term no longer enforced');
await as(user('ADM'));
const offList = (await one(`select word_filter_list(null) as r`)).r.off;
ok(offList.includes('Xyzzy') && offList.includes('marica'), 'off list has removed + switched-off terms');
const leo = (await one(`select word_filter_remove('negro', 'Admin') as r`)).r;
ok(leo.active === false && leo.kind === 'offensive', 'removing a word not in the table stores it switched off');
await as(user('SR'));
const re = (await one(`select word_filter_add('x.y.z.z.y', 'slur') as r`)).r;
ok(re.active === true && re.term === 'x.y.z.z.y', 'adding the same key again re-enables it');
ok(/TERM_EMPTY/.test(await err(`select word_filter_add('!!!', 'slur')`) || ''), 'punctuation-only term refused');
ok(/BAD_KIND/.test(await err(`select word_filter_add('abc', 'nope')`) || ''), 'bad kind refused');
const admin = (await one(`select word_filter_admin_list() as r`)).r;
ok(admin.rows.length === core.BUNDLED.length + 20 + 2 && admin.rows[0].term === 'x.y.z.z.y', 'admin list, newest first');
ok(Array.isArray((await one(`select word_filter_hits_list(10) as r`)).r), 'hits list for Sr Mod+');
await as(user('U'));
ok(/NOT_ALLOWED/.test(await err(`select word_filter_hits_list(10)`) || ''), 'hits list refused for users');
ok((await one(`select word_filter_list(null) as r`)).r.v > 0, 'any user can read the list');

// --- speed (PGlite in WASM is far slower than the server; indicative only) -------
await as(user('U'));
const t0 = Date.now();
const n = (await one(`select count(word_filter_check('hey bro wanna trade my leopard for your dough? ' || g)) as n,
                              sum(length(word_filter_normalize('hey bro wanna trade my leopard for your dough? ' || g))) as l
                         from generate_series(1, 500) g`));
ok(Number(n.l) > 500 * 40, 'speed probe really ran');
const per = (Date.now() - t0) / 500;
console.log(`  normalise + check: ${per.toFixed(2)} ms per message on PGlite`);
ok(per < 20, 'check stays cheap');
// A crafted 5 KB message of 100 different spaced-letter runs (the pieces are
// O(n^2) to de-duplicate in SQL; the cap keeps it bounded).
const crafted = Array.from({ length: 100 }, (_, i) => spaced(16, i)).join(' zz ');
const t1 = Date.now();
await db.query(`select word_filter_check($1)`, [crafted]);
const craftedMs = Date.now() - t1;
console.log(`  crafted ${crafted.length}-char message: ${craftedMs} ms on PGlite`);
ok(craftedMs < 300, 'crafted spaced-letter message stays cheap');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
