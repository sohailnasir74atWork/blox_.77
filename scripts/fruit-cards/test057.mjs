// PGlite test of supabase/057_fruit_cards.sql (Blox port of Adopt Me Pet Cards 037/043/044/048).
//   node scripts/fruit-cards/test057.mjs
import { PGlite } from '/Volumes/Sohail/cloud functions/ROBLOX/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'fs';

const SQL = fs.readFileSync('/Volumes/Sohail/AI_Projects/RunningApps/Blox_Fruit/supabase/057_fruit_cards.sql', 'utf8');
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('FAIL', msg); } };
const q = async (s, p) => (await db.query(s, p)).rows;
const one = async (s, p) => (await q(s, p))[0];
const as = async (uid) => db.query(`select set_config('test.uid', $1, false)`, [uid || '']);
const rpc = async (fn, args = [], uid = 'A') => {
  await as(uid);
  const ph = args.map((_, i) => `$${i + 1}`).join(',');
  return (await one(`select public.${fn}(${ph}) as r`, args)).r;
};
const rpcErr = async (fn, args = [], uid = 'A') => {
  try { await rpc(fn, args, uid); return null; } catch (e) { return e.message; }
};
const copies = async (uid, key, finish) =>
  (await one(`select count from card_collection where uid=$1 and card_key=$2 and finish=$3`, [uid, key, finish]))?.count ?? 0;
const give = (uid, key, finish, n) =>
  q(`insert into card_collection (uid, card_key, finish, count) values ($1,$2,$3,$4)
     on conflict (uid, card_key, finish) do update set count = excluded.count`, [uid, key, finish, n]);

// --- stubs for what Blox's live database already has (000, 003) ---
await db.exec(`
  create role anon; create role authenticated;
  create function public.firebase_uid() returns text language sql stable as $$ select nullif(current_setting('test.uid', true), '') $$;
  create table public.user_cosmetics (uid text primary key, top_badge text, is_pro boolean not null default false,
    updated_at timestamptz not null default now());
  create schema cron; create table cron.job (jobname text);
  create function cron.schedule(n text, s text, c text) returns int language sql as $$ insert into cron.job values (n); select 1 $$;
`);
await db.exec(SQL);
await db.exec(SQL); // idempotent
ok((await one(`select count(*)::int n from cron.job`)).n === 1, 'cron scheduled once');
ok((await one(`select count(*)::int n from card_sets`)).n === 13, 'all + 12 pages seeded');

// Grants: signed-in only; helpers never callable.
const can = async (role, sig) => (await one(`select has_function_privilege($1, $2, 'execute') v`, [role, sig])).v;
for (const sig of ['cards_state()', 'card_catalog_list()', 'open_card_pack(text, text)', 'craft_card(text)',
  'fuse_card(text, text)', 'get_card_collection(text)', 'set_card_showcase(jsonb)']) {
  ok(await can('authenticated', `public.${sig}`), `authenticated can ${sig}`);
  ok(!(await can('anon', `public.${sig}`)), `anon cannot ${sig}`);
}
for (const sig of ['_cards_add(text, text, text, text, text)', '_cards_fuse_target(text)', '_cards_today()',
  '_cards_weighted(jsonb)', 'delete_user_cards(text)']) {
  ok(!(await can('authenticated', `public.${sig}`)) && !(await can('anon', `public.${sig}`)), `nobody calls ${sig}`);
}

// Catalogue roughly the real shape: 7C/6U/4R/11L/15M/38 limited, plus a 2-card page and one card without art.
const R = ['common', 'uncommon', 'rare', 'legendary', 'mythical', 'limited'];
const counts = { common: 7, uncommon: 6, rare: 4, legendary: 11, mythical: 15, limited: 38 };
let no = 1;
for (const r of R) for (let i = 0; i < counts[r]; i++) {
  const sets = r === 'mythical' ? ['mythical'] : r === 'limited' ? ['limited'] : [];
  await q(`insert into card_catalog(key,name,rarity,no,sets,hd_ready,family) values ($1,$2,$3,$4,$5,true,$6)`,
    [`${r}${i}`, `${r} ${i}`, r, no++, sets, r === 'limited' ? 'skin' : 'natural']);
}
await q(`update card_catalog set sets = sets || '{skin_bomb}' where key in ('limited0','limited1')`);
await q(`insert into card_catalog(key,name,rarity,no,sets,hd_ready) values ('noart','No Art','limited',999,'{limited}',false)`);
const TOTAL = 81;

ok((await rpcErr('cards_state', [], '')) === 'sign in required', 'anon refused');

let st = await rpc('cards_state');
ok(st.wallet.freeReady === true && st.wallet.freeLeft === 2, 'two free packs ready');
ok(st.wallet.starPacksLeft === 2, 'star packs left 2');
ok(st.sets.find((s) => s.id === 'all').total === TOTAL, `all ${TOTAL} cards with art`);
ok(st.sets.find((s) => s.id === 'skin_bomb').total === 2, 'bomb page 2 cards');
ok(st.sets.find((s) => s.id === 'limited').total === 38, 'limited page excludes no-art card');
ok(st.sets.find((s) => s.id === 'all').odds.hit.limited === 25, 'odds returned');

// free packs: two a day, streak counts days
let p = await rpc('open_card_pack', ['all', 'free']);
ok(p.cards.length === 3, '3 cards');
ok(new Set(p.cards.map((c) => c.key)).size === 3, 'no repeat inside a pack');
ok(p.cards[0].family !== undefined && p.cards[0].egg === undefined, 'cards carry family');
ok(p.wallet.freeReady === true && p.wallet.freeLeft === 1 && p.wallet.streak === 1, 'one free left, streak 1');
p = await rpc('open_card_pack', ['all', 'free']);
ok(p.wallet.freeReady === false && p.wallet.freeLeft === 0 && p.wallet.streak === 1, 'second free, streak still 1');
ok((await rpcErr('open_card_pack', ['all', 'free'])) === 'free pack already opened today', 'third free refused');
await rpc('open_card_pack', ['all', 'stars']);
p = await rpc('open_card_pack', ['all', 'stars']);
ok(p.wallet.starPacksLeft === 0, 'stars used');
ok((await rpcErr('open_card_pack', ['all', 'stars'])) === 'star pack limit reached', 'third star refused');
ok((await rpcErr('open_card_pack', ['all', 'bonus'])) === 'no bonus packs', 'bonus refused');
ok((await rpcErr('open_card_pack', ['beast', 'free'], 'B')) === 'pack not available', 'page set has no pack');
ok((await rpcErr('open_card_pack', ['all', 'cash'])) === 'bad source', 'bad source');

// streak bonus on day 7, reset after a gap
await q(`update card_wallet set free_day = _cards_today() - 1, streak = 6 where uid = 'A'`);
p = await rpc('open_card_pack', ['all', 'free']);
ok(p.streakBonus === true && p.wallet.bonusPacks === 1 && p.wallet.streak === 7, 'day-7 streak bonus');
p = await rpc('open_card_pack', ['all', 'bonus']);
ok(p.wallet.bonusPacks === 0, 'bonus consumed');
await q(`update card_wallet set free_day = _cards_today() - 3, streak = 5 where uid = 'A'`);
p = await rpc('open_card_pack', ['all', 'free']);
ok(p.wallet.streak === 1, 'streak reset after gap');

// pity
await q(`update card_wallet set free_day = -1, pity_top = 7 where uid = 'A'`);
p = await rpc('open_card_pack', ['all', 'free']);
ok(p.cards.some((c) => c.rarity === 'limited'), 'top-tier pity (a Limited in the pack)');
ok(p.wallet.pityTop === 0, 'top pity reset');
await q(`update card_wallet set free_day = -1, pity_holo = 11 where uid = 'A'`);
p = await rpc('open_card_pack', ['all', 'free']);
const HOLO = ['holo', 'gilded', 'aura', 'fullart'];
ok(p.cards.some((c) => HOLO.includes(c.finish)), 'holo pity');
ok(p.wallet.pityHolo === 0, 'holo pity reset');

// serials + dupes + score
await q(`select _cards_ensure_wallet('C')`);
const s1 = (await one(`select _cards_add('C','mythical0','holo','all','test') r`)).r;
const s2 = (await one(`select _cards_add('C','mythical0','holo','all','test') r`)).r;
await q(`select _cards_ensure_wallet('D')`);
const s3 = (await one(`select _cards_add('D','mythical0','holo','all','test') r`)).r;
ok(s1.serial + 1 === s2.serial && s2.serial + 1 === s3.serial, 'global serials increase');
ok(s1.new === true && s2.dupe === true && s2.shards === 100 * 5, 'dupe gives rarity x finish shards');
const s4 = (await one(`select _cards_add('C','mythical0','classic','all','test') r`)).r;
ok(s4.newFinish === true && s4.new === false && s4.shards === 0 && s4.serial === null, 'new finish is not a dupe');
const s5 = (await one(`select _cards_add('C','mythical0','awakened','all','test') r`)).r;
ok(s5.serial === null, 'awakened has no serial');
let wc = await one(`select * from card_wallet where uid='C'`);
ok(wc.score === 16 * 5 + 16 * 1 + 16 * 3 && wc.unique_cards === 1 && wc.shards === 500, `score/unique/shards (${wc.score},${wc.unique_cards},${wc.shards})`);

// completion: skin_bomb = limited0 + limited1
await q(`select _cards_add('C','limited0','classic','all','test')`);
let set1 = (await one(`select _cards_settle('C', array['limited0']) r`)).r;
ok(set1.completed.length === 0, 'not complete with 1/2');
await q(`select _cards_add('C','limited1','foil','all','test')`);
set1 = (await one(`select _cards_settle('C', array['limited1']) r`)).r;
ok(set1.completed.includes('skin_bomb') && set1.rewardShards === 50, 'bomb skins complete + 50 shards');
set1 = (await one(`select _cards_settle('C', array['limited1']) r`)).r;
ok(set1.completed.length === 0, 'completion paid once');
const cos = await one(`select card_score, card_count from user_cosmetics where uid='C'`);
wc = await one(`select * from card_wallet where uid='C'`);
ok(cos.card_score === wc.score && cos.card_count === 3, 'cosmetics mirror');

// craft
ok((await rpcErr('craft_card', ['limited5'], 'C')) === 'not enough shards', 'craft needs shards'); // 550 < 1500
await q(`update card_wallet set shards = 1500 where uid='C'`);
let cr = await rpc('craft_card', ['limited5'], 'C');
ok(cr.card.finish === 'classic' && cr.wallet.shards === 0, 'craft limited for 1500');
ok((await rpcErr('craft_card', ['limited5'], 'C')) === 'already owned', 'craft owned refused');
ok((await rpcErr('craft_card', ['noart'], 'C')) === 'unknown card', 'craft no-art refused');

// collection + showcase
let col = await rpc('get_card_collection', [null], 'C');
ok(col.cards.mythical0 && col.cards.mythical0.length === 3, 'collection groups finishes');
ok((await rpc('get_card_collection', ['C'], 'A')).uniqueCards === col.uniqueCards, 'other player readable');
ok((await rpcErr('set_card_showcase', [JSON.stringify([1, 2, 3, 4])], 'C')) === 'up to 3 cards', 'max 3');
let sc = await rpc('set_card_showcase', [JSON.stringify([{ k: 'mythical0', f: 'holo' }, { k: 'rare0', f: 'aura' }])], 'C');
ok(sc.length === 1 && sc[0].s === s1.serial, 'showcase keeps only owned');
ok(sc[0].n === 'mythical 0' && sc[0].r === 'mythical' && sc[0].fa === 'natural' && Array.isArray(sc[0].sets), 'showcase entry carries catalog fields');
ok((await rpc('set_card_showcase', ['[]'], 'C')).length === 0, 'showcase can be cleared');

// fusion: 4 classic -> awakened -> aura
ok((await rpcErr('fuse_card', ['common0', 'holo'], 'F')) === 'cannot fuse', 'holo has no fusion');
ok((await rpcErr('fuse_card', ['common0', 'aura'], 'F')) === 'cannot fuse', 'aura has no fusion');
ok((await rpcErr('fuse_card', ['nope', 'classic'], 'F')) === 'unknown card', 'unknown card refused');
ok((await rpcErr('fuse_card', ['common0', 'classic'], 'F')) === 'not enough copies', 'no copies refused');
await q(`select _cards_ensure_wallet('F')`);
for (let i = 0; i < 5; i++) await one(`select _cards_add('F','common0','classic','all','test')`);
await one(`select _cards_settle('F', array['common0'])`);
const shardsF = (await one(`select shards from card_wallet where uid='F'`)).shards;
let r = await rpc('fuse_card', ['common0', 'classic'], 'F');
ok(r.card.finish === 'awakened' && r.card.fused === true && r.card.serial === null, 'fused into awakened, no serial');
ok(r.left === 1 && r.wallet.score === 1 + 3 && r.wallet.shards === shardsF, 'left 1, score +3, no shards');
await give('F', 'common0', 'classic', 4);
await rpc('set_card_showcase', [JSON.stringify([{ k: 'common0', f: 'classic' }])], 'F');
r = await rpc('fuse_card', ['common0', 'classic'], 'F');
ok(r.left === 0 && (await copies('F', 'common0', 'classic')) === 0 && r.wallet.score === 3, 'classic used up, its points gone');
const scF = (await one(`select card_showcase from user_cosmetics where uid='F'`)).card_showcase;
ok(scF.length === 1 && scF[0].f === 'awakened', 'showcase follows the fused card');
await give('F', 'common0', 'awakened', 4);
r = await rpc('fuse_card', ['common0', 'awakened'], 'F');
ok(r.card.finish === 'aura' && r.card.serial === null, 'awakened -> aura');

// account deletion (service role helper)
await q(`select delete_user_cards('F')`);
ok((await one(`select count(*)::int n from card_collection where uid='F'`)).n === 0, 'deleted user has no cards');
ok((await one(`select count(*)::int n from card_wallet where uid='F'`)).n === 0, 'deleted user has no wallet');
ok((await one(`select card_showcase from user_cosmetics where uid='F'`)).card_showcase === null, 'showcase cleared');
await q(`select delete_user_cards('C')`);
ok((await one(`select count(*)::int n from card_pulls where uid='C'`)).n === 0
  && (await one(`select count(*)::int n from card_pulls where uid='deleted' and serial is not null`)).n >= 2, 'serial provenance kept, uid blanked');

// volume: never pulls the no-art card, never repeats in a pack; rough odds; time to finish the album
await q(`insert into card_wallet(uid, bonus_packs) values ('E', 3000) on conflict (uid) do update set bonus_packs = 3000`);
const rar = {}; const fin = {}; let noart = 0; let total = 0; let repeats = 0; let packsToAll = null;
for (let i = 0; i < 1500; i++) {
  const res = await rpc('open_card_pack', ['all', 'bonus'], 'E');
  if (new Set(res.cards.map((c) => c.key)).size < 3) repeats++;
  res.cards.forEach((c, slot) => {
    total++;
    if (c.key === 'noart') noart++;
    if (slot < 2) rar[c.rarity] = (rar[c.rarity] || 0) + 1;
    fin[c.finish] = (fin[c.finish] || 0) + 1;
  });
  if (packsToAll === null && res.wallet.uniqueCards === TOTAL) packsToAll = i + 1;
}
ok(noart === 0, 'no-art card never pulled');
ok(repeats === 0, `no pack repeats a card (${repeats})`);
const pct = (o, k, n) => +(100 * (o[k] || 0) / n).toFixed(1);
console.log('slot1-2 rarity %', Object.fromEntries(R.map((k) => [k, pct(rar, k, 3000)])));
console.log('finish %', Object.fromEntries(Object.keys(fin).map((k) => [k, pct(fin, k, total)])));
console.log(`packs to own all ${TOTAL} (no crafting): ${packsToAll}`);
ok(Math.abs(pct(rar, 'common', 3000) - 22) < 4, 'common ~22%');
ok(Math.abs(pct(fin, 'classic', total) - 72) < 4, 'classic ~72%');
const we = await one(`select * from card_wallet where uid='E'`);
ok(we.unique_cards === TOTAL, `E collected all ${TOTAL} (${we.unique_cards})`);
ok(we.completed.includes('all'), 'all-set completion recorded');
const serialPulls = (await one(`select count(*)::int n from card_pulls where uid='E' and serial is not null`)).n;
ok(serialPulls === HOLO.reduce((n, f) => n + (fin[f] || 0), 0), 'every holo+ has a serial');

// ended pack
await q(`update card_sets set ends_at = now() - interval '1 second' where id = 'all'`);
ok((await rpcErr('open_card_pack', ['all', 'bonus'], 'E')) === 'pack not available', 'ended pack refused');
st = await rpc('cards_state', [], 'E');
ok(st.sets.find((s) => s.id === 'all').open === false, 'ended pack shows closed');
const cat = await rpc('card_catalog_list', [], 'E');
ok(cat.length === TOTAL && cat[0].length === 7 && cat[0][4] === 'natural', 'catalog list compact, art only, family at [4]');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
