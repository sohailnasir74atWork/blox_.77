// PGlite test of supabase/044_group_privacy.sql on top of the real chain
// 000–043 (026 and 038 need pg_cron / pg_net and are skipped; 040 is skipped
// too because it is not applied live — a second run applies it first).
// Requests run as the `authenticated` / `anon` / `service_role` roles with a
// request.jwt.claims GUC, so RLS, grants and triggers are the real ones.
//   node scripts/groups/test044.mjs
import { PGlite } from '/Volumes/Sohail/cloud functions/ROBLOX/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'fs';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../supabase/', import.meta.url));
const read = (f) => fs.readFileSync(ROOT + f, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('FAIL', msg); } };

const C = 'creatorUid001', U1 = 'memberUid0001', X = 'outsiderUid01', N = 'newGroupUid01';
const A = 'adminUid00001', S = 'seniorUid0001', M = 'modUid0000001', J = 'jmdUid0000001';
const O = 'ownerUid00001', OU = 'ownerUnverif1';
const EMAIL = { [O]: ['thesolanalabs@gmail.com', true], [OU]: ['sohailnasir74@gmail.com', false] };

async function boot({ with040 = false } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create publication supabase_realtime;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `);
  const skip = new Set(['026_private_message_retention.sql', '038_birthday_emails.sql', '044_group_privacy.sql']);
  if (!with040) skip.add('040_owner_email_verified.sql');
  for (const f of fs.readdirSync(ROOT).filter((x) => /^0\d\d_.*\.sql$/.test(x) && x < '044' && !skip.has(x)).sort()) {
    await db.exec(read(f));
  }
  return db;
}

try {
const db = await boot();
const q = async (s, p) => (await db.query(s, p)).rows;
const one = async (s, p) => (await q(s, p))[0];
// Act as someone. 'service' = service role, null = anon, otherwise a Firebase uid.
async function as(uid) {
  await db.exec('reset role');
  let claims = {};
  if (uid === 'service') claims = { role: 'service_role' };
  else if (uid) {
    claims = { sub: uid, role: 'authenticated' };
    if (EMAIL[uid]) { claims.email = EMAIL[uid][0]; claims.email_verified = EMAIL[uid][1]; }
  }
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
  await db.exec(uid === 'service' ? 'set role service_role' : uid ? 'set role authenticated' : 'set role anon');
}
const root = () => as('service').then(() => db.exec('reset role'));
const err = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const visible = async (uid, groupId) => {
  await as(uid);
  return (await one(`select count(*)::int as n from public.group_messages where group_id = $1`, [groupId])).n;
};
const send = async (uid, groupId, text) => {
  await as(uid);
  return one(`select (public.send_group_message($1, gen_random_uuid(), $2)).id as id`, [groupId, text]);
};

// ── seed (as superuser, no claims) ──
await root();
await db.exec(`
  insert into public.user_roles (uid, is_admin, is_cmsr, is_moderator, is_baby_mod) values
    ('${A}', true, false, false, false), ('${S}', false, true, false, false),
    ('${M}', false, false, true, false), ('${J}', false, false, false, true);
  insert into public.group_meta_data (user_id, group_id, group_name, created_by, last_message) values
    ('${C}', 'g1', 'G1', '${C}', 'secret preview'), ('${U1}', 'g1', 'G1', '${C}', 'secret preview'),
    ('${N}', 'g2', 'G2', '${N}', null);
  insert into public.group_messages (group_id, sender_id, text) values
    ('g1', '${C}', 'hello from C'), ('g1', '${U1}', 'hello from U1'), ('g1', '${U1}', 'second from U1');
`);

// ── step files are exactly the sections of 044 ──
const main = read('044_group_privacy.sql');
for (const f of ['0_check.sql', '1_functions.sql', '2_group_messages.sql', '3_switch.sql', '4_cleanup.sql']) {
  const body = read(`044_steps/${f}`).split('\n').slice(3).join('\n').trimEnd();
  ok(main.includes(body), `044_steps/${f} matches its section of 044_group_privacy.sql`);
}

// ── the hole, before 044 ──
await as(X);
await db.query(`insert into public.group_meta_data (user_id, group_id) values ($1, 'g1')`, [X]);
ok((await visible(X, 'g1')) === 3, 'before 044: an outsider reads every group message');
await as(X);
ok((await q(`select * from public.group_meta_data where group_id = 'g1'`)).length === 3,
  'before 044: an outsider with a self-made inbox row reads members\' previews');

// ── STEP 0 → 1 → 2 ──
await root();
const s0 = await one(read('044_steps/0_check.sql'));
ok(s0.step1_table === false && Number(s0.step1_functions) === 0, `step 0 before anything (${JSON.stringify(s0)})`);
await db.exec(read('044_steps/1_functions.sql'));
await db.exec(read('044_steps/2_group_messages.sql'));
ok((await visible(X, 'g1')) === 3, 'steps 1+2 change nobody\'s reads');

// STEP 2 already: a moderator who is in the group can no longer delete others' messages.
await root();
const u1Msg = (await one(`select id from public.group_messages where sender_id = '${U1}' order by created_at limit 1`)).id;
await as(M);
await db.query(`insert into public.group_meta_data (user_id, group_id) values ($1, 'g1')`, [M]); // old-style "membership"
ok(/NOT_ALLOWED/.test(await err(() => db.query(`update public.group_messages set deleted = true where id = $1`, [u1Msg])) || ''),
  'step 2: a Mod cannot soft-delete someone else\'s group message');
await as(J);
await db.query(`insert into public.group_meta_data (user_id, group_id) values ($1, 'g1')`, [J]);
ok(/NOT_ALLOWED/.test(await err(() => db.query(`update public.group_messages set deleted = true where id = $1`, [u1Msg])) || ''),
  'step 2: a JMD cannot soft-delete someone else\'s group message');
await as(M);
ok((await q(`delete from public.group_messages where id = $1 returning id`, [u1Msg])).length === 0,
  'step 2: a Mod cannot hard-delete someone else\'s group message');

// ── backfill (what scripts/groups/backfill-group-members.js does) ──
await as('service');
await db.exec(`insert into public.group_members (group_id, user_id, role) values
  ('g1', '${C}', 'creator'), ('g1', '${U1}', 'member')`);

// ── STEP 3 ──
await root();
await db.exec(read('044_steps/3_switch.sql'));
await db.exec(read('044_steps/4_cleanup.sql'));
const s3 = await one(read('044_steps/0_check.sql'));
ok(s3.step1_table === true && Number(s3.step1_functions) === 8 && Number(s3.step2_group_messages) === 2
  && Number(s3.step3_switch) === 4 && Number(s3.step4_cleanup) === 1, `step 0 after all steps (${JSON.stringify(s3)})`);

// Reads.
ok((await visible(X, 'g1')) === 0, 'outsider with a self-made inbox row reads nothing');
ok((await visible(M, 'g1')) === 0, 'Moderator who is not a verified member reads nothing');
ok((await visible(J, 'g1')) === 0, 'JMD reads nothing');
ok((await visible(null, 'g1')) === 0, 'anon reads nothing');
ok((await visible(OU, 'g1')) === 0, 'unverified owner email reads nothing');
ok((await visible(U1, 'g1')) === 3, 'member reads the group');
ok((await visible(C, 'g1')) === 3, 'creator reads the group');
ok((await visible(S, 'g1')) === 3, 'Senior Mod reads any group');
ok((await visible(A, 'g1')) === 3, 'Admin reads any group');
ok((await visible(O, 'g1')) === 3, 'verified owner email reads any group');
await root();
await db.exec(`insert into public.group_messages (group_id, sender_id, text) values ('g1', '${X}', 'old msg by X')`);
ok((await visible(X, 'g1')) === 1, 'anyone still reads their own messages');
await as(X);
ok((await q(`select * from public.group_meta_data where group_id = 'g1'`)).length === 1,
  'outsider reads only their own inbox row');
await as(M);
ok((await q(`select * from public.group_meta_data where group_id = 'g1' and user_id <> '${M}'`)).length === 0,
  'Moderator no longer reads other people\'s group inbox rows');
await as(S);
ok((await q(`select * from public.group_meta_data where group_id = 'g1'`)).length >= 3, 'Senior Mod reads group inbox rows');

// Sends.
ok(!!(await send(U1, 'g1', 'hi')).id, 'member sends');
ok(/NOT_ALLOWED/.test(await err(() => send(X, 'g1', 'spam')) || ''), 'outsider cannot send');
ok(/NOT_ALLOWED/.test(await err(() => send(M, 'g1', 'mod')) || ''), 'Moderator who is not a member cannot send');
ok(!!(await send(S, 'g1', 'senior')).id, 'Senior Mod sends in any group');
ok(!!(await send(N, 'g2', 'first!')).id, 'brand-new group (no rows yet): its creator sends');
ok(/NOT_ALLOWED/.test(await err(() => send(U1, 'g2', 'x')) || ''), 'brand-new group: someone else cannot');
await as('service');
await db.exec(`insert into public.group_members (group_id, user_id, role) values ('g2', '${N}', 'creator')`);
await as(X);
await db.query(`insert into public.group_meta_data (user_id, group_id, created_by) values ($1, 'g2', $1)`, [X]);
ok(/NOT_ALLOWED/.test(await err(() => send(X, 'g2', 'x')) || ''), 'synced group: a forged created_by inbox row grants nothing');

// Fan-out: only verified members get a preview.
await as(U1);
await db.query(`select public.fanout_group_message_meta('g1', $1, $2, 'u1', 'new preview', null, 'G1')`, [[C, U1, X, 'strangerUid01'], U1]);
await root();
const metaG1 = await q(`select user_id, last_message, unread_count from public.group_meta_data where group_id = 'g1'`);
ok(metaG1.find((r) => r.user_id === C)?.last_message === 'new preview', 'fan-out reaches a member');
ok(metaG1.find((r) => r.user_id === X)?.last_message !== 'new preview', 'fan-out skips the self-added outsider');
ok(!metaG1.some((r) => r.user_id === 'strangerUid01'), 'fan-out does not create rows for strangers');
ok(/NOT_ALLOWED/.test(await err(async () => { await as(X); await db.query(`select public.fanout_group_message_meta('g1', $1, $2, 'x', 'spam')`, [[C, X], X]); }) || ''),
  'outsider cannot fan out');
ok(/NOT_ALLOWED/.test(await err(async () => { await as(X); await db.query(`select public.upsert_group_meta_members('g1', $1, 'pwned')`, [[C]]); }) || ''),
  'outsider cannot rename the group in members\' lists');
await as(C);
ok((await one(`select public.upsert_group_meta_members('g1', $1, 'G1 renamed') as n`, [[C, U1]])).n === 2, 'creator renames in members\' lists');

// Fan-out writes each member's row once, with the same unread counts as 034.
await root();
await db.exec(`insert into public.group_members (group_id, user_id, role) values
  ('g3', '${C}', 'creator'), ('g3', '${U1}', 'member'), ('g3', '${J}', 'member');
  insert into public.group_meta_data (user_id, group_id, unread_count) values ('${C}', 'g3', 5), ('${U1}', 'g3', 7);`);
for (let i = 0; i < 2; i++) {
  await as(U1);
  await db.query(`select public.fanout_group_message_meta('g3', $1, $2, 'u1', $3, null, 'G3')`, [[C, U1, J], U1, `msg ${i}`]);
}
await root();
const un = Object.fromEntries((await q(`select user_id, unread_count, last_message from public.group_meta_data where group_id = 'g3'`)).map((r) => [r.user_id, r]));
ok(un[C].unread_count === 7 && un[U1].unread_count === 7 && un[J].unread_count === 2,
  `fan-out unread: existing +1 per message, sender unchanged, new row starts at 1 (got ${un[C].unread_count}/${un[U1].unread_count}/${un[J].unread_count})`);
ok(un[J].last_message === 'msg 1' && un[C].last_message === 'msg 1', 'fan-out preview is the newest message');

// Deleting messages.
const msgOf = async (sender, text) => (await (async () => { await root(); return one(`select id from public.group_messages where sender_id = $1 and text = $2`, [sender, text]); })()).id;
const cMsg = await msgOf(C, 'hello from C');
const u1Second = await msgOf(U1, 'second from U1');
ok(/NOT_ALLOWED/.test(await err(async () => { await as(U1); await db.query(`select public.delete_group_message($1)`, [cMsg]); }) || ''),
  'member cannot delete another member\'s message');
await as(C);
ok((await one(`select public.delete_group_message($1) as r`, [u1Second])).r === true, 'creator deletes a member\'s message (new)');
await root();
const del = await one(`select deleted, deleted_by from public.group_messages where id = $1`, [u1Second]);
ok(del.deleted === true && del.deleted_by === C, 'deletion is stamped with the creator');
await as(C);
ok((await one(`select public.delete_group_message($1) as r`, [u1Second])).r === false, 'deleting twice is a no-op');
ok(/NOT_ALLOWED/.test(await err(async () => { await as(M); await db.query(`select public.delete_group_message($1)`, [cMsg]); }) || ''),
  'Moderator cannot delete through the rpc');
await as(S);
ok((await one(`select public.delete_group_message($1) as r`, [cMsg])).r === true, 'Senior Mod deletes any group message');
ok(/NOT_ALLOWED/.test(await err(async () => { await as(C); await db.query(`update public.group_messages set deleted = true where id = $1`, [u1Msg]); }) || ''),
  'creator\'s direct UPDATE still goes through the 034 guard (use the rpc)');
await as(U1);
await db.query(`update public.group_messages set deleted = true where id = $1`, [u1Msg]);
await root();
ok((await one(`select deleted from public.group_messages where id = $1`, [u1Msg])).deleted === true, 'sender soft-deletes own message directly');

// Report paths still work for members; staff still see reports.
await root();
const sMsg = await msgOf(S, 'senior');
await as(U1);
await db.query(`update public.group_messages set report_count = 999 where id = $1`, [sMsg]); // shipped builds' legacy report
await root();
ok((await one(`select report_count from public.group_messages where id = $1`, [sMsg])).report_count === 1, 'legacy report shim still counts +1');
const hiMsg = await msgOf(U1, 'hi');
await as(C);
ok((await one(`select public.report_message('group_messages', $1, 'spam') as n`, [hiMsg])).n === 1, 'report_message on a group message');
await as(M);
const reps = await q(`select * from public.list_message_reports(50, null) where table_name = 'group_messages'`);
ok(reps.length === 2 && reps.some((r) => r.message_text === 'hi'), 'Moderator still sees reported group messages (with text) in the reports list');

// Delete All from one sender.
await root();
await db.exec(`insert into public.group_messages (group_id, sender_id, text) select 'g1', '${U1}', 'bulk ' || g from generate_series(1, 5) g`);
ok(/NOT_ALLOWED/.test(await err(async () => { await as(U1); await db.query(`select public.delete_group_messages_by_sender('g1', $1, 60)`, [C]); }) || ''),
  'member cannot Delete All');
await as(C);
ok((await one(`select public.delete_group_messages_by_sender('g1', $1, 3) as n`, [U1])).n === 3, 'creator deletes the newest 3 from one sender');
await as(S);
ok((await one(`select public.delete_group_messages_by_sender('g1', $1, 60) as n`, [U1])).n >= 2, 'Senior Mod Delete All');

// Hard delete.
await root();
const xMsg = await msgOf(X, 'old msg by X');
await as(S);
ok((await q(`delete from public.group_messages where id = $1 returning id`, [xMsg])).length === 1, 'Senior Mod hard-deletes');

// purge_group_chat: service role only.
ok(/permission denied/.test(await err(async () => { await as(C); await db.query(`select public.purge_group_chat('g1')`); }) || ''),
  'a signed-in user (even the creator) cannot call purge_group_chat');
await root();
for (let i = 0; i < 1500; i++) await db.query(`insert into public.group_messages (group_id, sender_id, text) values ('g1', $1, 'm')`, [C]);
await as('service');
const purged = (await one(`select public.purge_group_chat('g1') as r`)).r;
await root();
ok(purged.messages >= 1500 && (await one(`select count(*)::int as n from public.group_messages where group_id = 'g1' and not deleted`)).n === 0,
  `purge soft-deletes every message in one go (${purged.messages})`);
ok((await one(`select count(*)::int as n from public.group_meta_data where group_id = 'g1'`)).n === 0, 'purge removes every member\'s inbox row');
ok((await one(`select count(*)::int as n from public.group_members where group_id = 'g1'`)).n === 0, 'purge removes membership rows');
ok((await one(`select count(*)::int as n from public.group_meta_data where group_id = 'g2'`)).n > 0, 'purge leaves other groups alone');

// STEP 4: last activity per group (service role only).
await as('service');
const act = await q(`select * from public.group_last_activity($1)`, [['g2', 'g3', 'gNone']]);
const actBy = Object.fromEntries(act.map((r) => [r.group_id, r.last_at]));
ok(act.length === 3 && actBy.g2 !== null && actBy.gNone === null, 'group_last_activity: newest message per group, null when none');
ok(/permission denied/.test(await err(async () => { await as(C); await db.query(`select * from public.group_last_activity($1)`, [['g3']]); }) || ''),
  'clients cannot call group_last_activity');

// Grants.
await root();
const can = async (role, fn) => (await one(`select has_function_privilege($1, $2, 'execute') as r`, [role, fn])).r;
ok(!(await can('authenticated', 'public.purge_group_chat(text)')), 'authenticated has no purge_group_chat');
ok(!(await can('anon', 'public.delete_group_message(uuid)')), 'anon has no delete_group_message');
ok(await can('authenticated', 'public.delete_group_message(uuid)'), 'authenticated has delete_group_message');
ok(!(await can('authenticated', 'public._group_can_post(text, text)')), 'internal helper not callable');
ok(!(await one(`select has_table_privilege('authenticated', 'public.group_members', 'select') as r`)).r, 'clients cannot read group_members');
ok(!(await one(`select has_table_privilege('authenticated', 'public.group_members', 'insert') as r`)).r, 'clients cannot write group_members');

// Idempotent: the whole file again, twice.
await db.exec(main);
await db.exec(main);
ok((await visible(X, 'g2')) === 0 && (await visible(N, 'g2')) === 1, 'still private after re-running 044 twice');

// 040 applied first (it is not live yet): 044 still applies cleanly.
const db2 = await boot({ with040: true });
await db2.exec(main);
await db2.exec(read('040_owner_email_verified.sql')); // and 040 after 044
ok(true, '040 before and after 044 both apply');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
} catch (e) {
  console.log('CRASH', e.message, e.where || '');
  process.exit(1);
}
