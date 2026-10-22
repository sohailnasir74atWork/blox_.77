// PGlite test of supabase/052_word_filter_delta.sql, on top of 049.
//   node scripts/word-filter/test052.mjs
// Checks: idempotent apply; chat now rejects 'offensive' terms too (users,
// staff tiers, allow phrases, a word a Senior Mod adds); word_filter_changes
// returns same / delta / full, and a phone that applies the deltas ends up
// with exactly the full list; a hard delete forces one full list.
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
const as = async (claims) => {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims ? JSON.stringify(claims) : '']);
};
const user = (uid, extra = {}) => ({ role: 'authenticated', sub: uid, ...extra });

// Same stand-ins as test049.mjs.
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
  create table public.private_messages (id bigserial primary key, sender_id text, text text, chat_id text, created_at timestamptz default now());
  create table public.reported_chats (chat_id text primary key);
  create table public.banned_senders (uid text primary key, banned_until timestamptz, reason text, type text);
`);
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
await db.exec(read('040_owner_email_verified.sql'));
await db.exec(read('021_username_uniqueness.sql'));
await db.exec(read('022_username_charset_relax.sql'));
await db.exec(`alter default privileges in schema public grant execute on functions to anon, authenticated, service_role`);
await db.exec(read('049_word_filter.sql'));
await db.exec(`insert into user_roles (uid, is_admin, is_moderator, is_baby_mod, is_cmsr) values
  ('ADM', true, false, false, false), ('MOD', false, true, false, false), ('JMD', false, true, true, false),
  ('SR', false, false, false, true)`);

// A phone on 049 (4.0.31) caches the list before 052 lands.
await as(user('U'));
const v049 = Number((await one(`select word_filter_list(null) as r`)).r.v);

const SQL = read('052_word_filter_delta.sql');
await as(null);
await db.exec(SQL);
const s1 = await one(`select version, full_since, chat_re from word_filter_state`);
await db.exec(SQL); // idempotent
const s2 = await one(`select version, full_since from word_filter_state`);
ok(Number(s1.full_since) === v049 + 1, `full_since = 049 version + 1 (${s1.full_since} vs ${v049})`);
ok(Number(s2.full_since) === Number(s1.full_since), 're-run keeps full_since');
ok(Number(s2.version) >= Number(s1.version), 'version never goes back');
ok(typeof s1.chat_re === 'string' && s1.chat_re.length > 0, 'chat_re compiled');
ok((await one(`select count(*)::int as n from word_blocklist where rev <> 0`)).n === 0, 're-run touches no rows');

// --- chat now blocks offensive terms ---------------------------------------------
const send = async (table, claims, text) => {
  await as(claims);
  const e = await err(`insert into ${table} (sender_id, text) values ($1, $2)`, [claims?.sub || null, text]);
  return e && e.startsWith('WORDS_NOT_ALLOWED') ? 'WORDS_NOT_ALLOWED' : e;
};
for (const t of ['messages', 'group_messages', 'private_messages']) {
  ok((await send(t, user('U'), 'fuck this')) === 'WORDS_NOT_ALLOWED', `${t}: offensive rejected`);
  ok((await send(t, user('U'), 'k y s')) === 'WORDS_NOT_ALLOWED', `${t}: spaced offensive rejected`);
  ok((await send(t, user('U'), 'you are a f a g')) === 'WORDS_NOT_ALLOWED', `${t}: slur still rejected`);
  ok((await send(t, user('U'), 'hello there, spicy trade? peacock for grape')) === null, `${t}: clean text passes`);
  ok((await send(t, user('U'), 'désolé je suis en retard')) === null, `${t}: allow phrase passes`);
  ok((await send(t, user('JMD'), 'fuck this')) === 'WORDS_NOT_ALLOWED', `${t}: JMD not exempt`);
  ok((await send(t, user('MOD'), 'fuck this')) === null, `${t}: moderator exempt (link bypass)`);
  ok((await send(t, user('SR'), 'fuck this')) === null, `${t}: senior mod exempt`);
  ok((await send(t, { role: 'service_role' }, 'fuck this')) === null, `${t}: service role passes`);
}
// Server chat check == the app's matcher on the same table (slur + offensive).
const rows = await q(`select term, kind, match_mode as mode from word_blocklist where active`);
const m = core.buildMatcher(rows);
const probes = ['fuck', 'FuckYou', 'Dick_Grayson', 'Dickson', 'peacock', 'grape', 'Kike', 'kill yourself',
  'k i l l   y o u r s e l f', 'shitty', 'Scunthorpe', 'cocktail', 'n1gg3r', 'homo sapiens', 'hello', 'a$$hole'];
await as(user('U'));
for (const p of probes) {
  const js = core.firstHitKind(p, m, ['slur', 'offensive']) !== null;
  const e = await err(`insert into messages (sender_id, text) values ('U', $1)`, [p]);
  const sql = !!(e && e.startsWith('WORDS_NOT_ALLOWED'));
  ok(js === sql, `chat == app matcher: ${JSON.stringify(p)} (app ${js}, server ${sql})`);
}

// --- delta read ----------------------------------------------------------------
const changes = async (v) => (await one(`select word_filter_changes($1) as r`, [v])).r;
const fullList = async () => (await one(`select word_filter_list(null) as r`)).r;
const keyOf = (t) => core.termKey(t);
// What the app does (Code/Helper/wordBlocklistCache.js applyChanges).
const apply = (cached, d) => {
  if (d.same) return { ...cached, v: d.v };
  if (!d.delta || !cached) return { v: d.v, terms: d.terms, off: d.off };
  const touched = new Set([...d.terms.map((t) => keyOf(t[0])), ...d.off.map(keyOf)]);
  return {
    v: d.v,
    terms: cached.terms.filter((t) => !touched.has(keyOf(t[0]))).concat(d.terms),
    off: cached.off.filter((t) => !touched.has(keyOf(t))).concat(d.off),
  };
};
const norm = (l) => JSON.stringify({
  terms: l.terms.map((t) => [keyOf(t[0]), t[1], t[2]]).sort(),
  off: l.off.map(keyOf).sort(),
});

await as(user('U'));
let phone = await changes(null);
ok(phone.full === true && phone.terms.length === rows.length, 'no version -> full list');
ok((await changes(v049)).full === true, 'a 049-era version -> full list once');
ok((await changes(phone.v)).same === true, 'same version -> same');
ok((await changes(phone.v + 50)).full === true, 'unknown future version -> full list');
ok(await (async () => { await as(null); await as(user('U')); return (await changes(phone.v)).same; })(), 'any user can read');

await as(user('SR'));
await db.query(`select word_filter_add('Xyzzy', 'offensive', 'auto', 'en', 'test', 'Sr')`);
await as(user('U'));
let d = await changes(phone.v);
ok(d.delta === true && d.terms.length === 1 && d.terms[0][0] === 'Xyzzy' && d.off.length === 0, 'add -> one-row delta');
ok(JSON.stringify(d).length < 120, `delta is small (${JSON.stringify(d).length} bytes)`);
phone = apply(phone, d);
ok((await send('messages', user('U'), 'you xyzzy')) === 'WORDS_NOT_ALLOWED', 'a word the Sr Mod added is blocked in chat at once');
ok((await send('private_messages', user('U'), 'X y z z y')) === 'WORDS_NOT_ALLOWED', '... spaced, in private chat too');

await as(user('SR'));
await db.query(`select word_filter_add('xyzzy', 'slur', 'word')`);   // re-classify, same key
await db.query(`select word_filter_remove('kys')`);                  // turn a seed off
await db.query(`select word_filter_remove('plugh')`);                // not in the table: stored off
await db.query(`select word_filter_add('frobozz', 'spam')`);
await as(user('U'));
d = await changes(phone.v);
ok(d.delta === true && d.terms.length === 2 && d.off.length === 2, `edits -> delta of the changed rows (${d.terms.length} + ${d.off.length})`);
phone = apply(phone, d);
ok(norm(phone) === norm(await fullList()), 'phone after deltas == full list');
ok((await send('messages', user('U'), 'kys')) === null, 'a term turned off stops blocking chat');

// Two edits while the phone was away arrive in one delta.
await as(user('SR'));
await db.query(`select word_filter_add('kys', 'offensive', 'word')`);
await db.query(`select word_filter_remove('frobozz')`);
await as(user('U'));
phone = apply(phone, await changes(phone.v));
ok(norm(phone) === norm(await fullList()), 'two more edits applied in one delta == full list');

// Hard delete (SQL editor) -> older phones get the full list.
await as(null);
const vBeforeDel = Number((await one(`select version from word_filter_state`)).version);
await db.exec(`delete from word_blocklist where term = 'Xyzzy' or term = 'xyzzy'`);
await as(user('U'));
d = await changes(vBeforeDel);
ok(d.full === true, 'after a hard delete an older phone gets the full list');
phone = apply(phone, d);
ok(norm(phone) === norm(await fullList()), 'phone after the full list == full list');
ok((await changes(phone.v)).same === true, 'then same again');

// Grants.
const can = async (role, fn) => (await one(`select has_function_privilege($1, $2, 'execute') as r`, [role, fn])).r;
ok(await can('anon', 'public.word_filter_changes(bigint)') && await can('authenticated', 'public.word_filter_changes(bigint)'),
  'word_filter_changes public like word_filter_list');
ok(!(await can('anon', 'public._word_filter_rebuild()')) && !(await can('authenticated', 'public._word_filter_rebuild()')),
  '_word_filter_rebuild still internal');
ok((await one(`select word_filter_list(null) as r`)).r.terms.length > 0, 'word_filter_list (4.0.31, functions) still works');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
