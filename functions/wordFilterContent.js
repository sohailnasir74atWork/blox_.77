/**
 * Word filter for Firestore content (supabase/049_word_filter.sql).
 *
 * On CREATE of
 *   designPosts_upgrade/{postId}                     .desc
 *   designPosts_upgrade/{postId}/comments/{id}       .text
 *   statuses/{statusId}                              .caption, .pollOptions[]
 * every word that is part of an active SLUR or OFFENSIVE term from the
 * moderators' list (offensive since 052, 2026-10-22) is
 * replaced with asterisks in place, the doc gets
 * `wordFilter: { masked: true, fields, at }`, and the original text goes to
 * Supabase word_filter_hits (Senior Mod+ read it in the Word filter tab), so a
 * false positive can be put back by hand.
 *
 * Why mask instead of hide: no feed in any shipped build reads a hidden flag
 * (posts, comments and statuses render whatever the doc says), so rewriting
 * the text is the one change every build respects. Poll votes are keyed by
 * option index, so masking an option keeps the votes.
 *
 * Matching: functions/wordFilterCore.js, a byte-identical copy of the app's
 * Code/Helper/wordFilterCore.js. The list comes from word_filter_list() via
 * the service role (functions/_supabaseAdmin.js), refreshed every 5 minutes
 * per instance with the cached version (unchanged -> a few bytes). Without
 * Supabase (emulator, secrets missing, 049 not applied yet) the bundled list
 * is used.
 *
 * onCreate only: no shipped build edits a post, comment or status text after
 * posting, and onUpdate would run on every like, reaction and view.
 *
 * Deploy: firebase deploy --only functions:wordFilterPost,functions:wordFilterComment,functions:wordFilterStatus
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
if (!admin.apps.length) admin.initializeApp();
const core = require('./wordFilterCore');

const SECRETS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const LIST_TTL_MS = 5 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const SERVER_KINDS = new Set(['slur', 'offensive', 'allow']);
const MASK_KINDS = ['slur', 'offensive'];

const bundled = () => core.buildMatcher(core.BUNDLED.filter((b) => SERVER_KINDS.has(b.kind)));
let list = { v: null, matcher: bundled(), at: 0 };

let supabaseOverride; // tests inject a fake client (or null)
function supa() {
  if (supabaseOverride !== undefined) return supabaseOverride;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    return require('./_supabaseAdmin').getSupabaseAdmin();
  } catch (e) {
    return null;
  }
}

async function getMatcher() {
  if (Date.now() - list.at < LIST_TTL_MS) return list.matcher;
  const sb = supa();
  if (!sb) {
    list.at = Date.now();
    return list.matcher;
  }
  try {
    const { data, error } = await sb.rpc('word_filter_list', { p_version: list.v });
    if (error) throw error;
    if (data && !data.same && Array.isArray(data.terms)) {
      const entries = data.terms
        .filter((t) => Array.isArray(t) && typeof t[0] === 'string' && SERVER_KINDS.has(t[1]))
        .map(([term, kind, mode]) => ({ term, kind, mode }));
      list = { v: data.v, matcher: core.buildMatcher(entries), at: Date.now() };
    } else {
      list.at = Date.now();
    }
  } catch (e) {
    console.warn('[wordFilter] list fetch failed, keeping the current list:', e && e.message ? e.message : e);
    list.at = Date.now() - LIST_TTL_MS + RETRY_MS;
  }
  return list.matcher;
}

// Masks one field. Returns null when clean, else { value, hit }.
function maskField(field, value, m) {
  if (typeof value === 'string') {
    const r = core.maskText(value, m, MASK_KINDS);
    return r ? { value: r.masked, hit: { field, original: value, masked: r.masked, terms: r.terms } } : null;
  }
  if (Array.isArray(value)) {
    const terms = [];
    let changed = false;
    const next = value.map((x) => {
      const r = typeof x === 'string' ? core.maskText(x, m, MASK_KINDS) : null;
      if (!r) return x;
      changed = true;
      terms.push(...r.terms);
      return r.masked;
    });
    if (!changed) return null;
    return { value: next, hit: { field, original: JSON.stringify(value), masked: JSON.stringify(next), terms } };
  }
  return null;
}

async function logHits(docPath, source, uid, hits) {
  const sb = supa();
  if (!sb) return;
  try {
    const { error } = await sb.from('word_filter_hits').insert(hits.map((h) => ({
      source,
      doc_path: docPath,
      field: h.field,
      uid: typeof uid === 'string' ? uid : null,
      original: String(h.original).slice(0, 4000),
      masked: String(h.masked).slice(0, 4000),
      terms: [...new Set(h.terms)].slice(0, 20),
    })));
    if (error) throw error;
  } catch (e) {
    console.warn('[wordFilter] hit log failed:', e && e.message ? e.message : e);
  }
}

async function screen(snap, source, fields) {
  const data = snap.data() || {};
  const m = await getMatcher();
  const updates = {};
  const hits = [];
  for (const f of fields) {
    const r = maskField(f, data[f], m);
    if (r) {
      updates[f] = r.value;
      hits.push(r.hit);
    }
  }
  if (!hits.length) return null;
  updates.wordFilter = {
    masked: true,
    fields: hits.map((h) => h.field),
    at: FieldValue.serverTimestamp(),
  };
  try {
    await snap.ref.update(updates);
  } catch (e) {
    if (e && e.code === 5) return null; // deleted in the meantime (NOT_FOUND)
    throw e;
  }
  console.log(`[wordFilter] masked ${source} ${snap.ref.path} (${hits.map((h) => h.field).join(', ')})`);
  await logHits(snap.ref.path, source, data.userId, hits);
  return null;
}

const run = functions.runWith({ secrets: SECRETS, memory: '256MB', timeoutSeconds: 30 });

exports.wordFilterPost = run.firestore
  .document('designPosts_upgrade/{postId}')
  .onCreate((snap) => screen(snap, 'post', ['desc']));

exports.wordFilterComment = run.firestore
  .document('designPosts_upgrade/{postId}/comments/{commentId}')
  .onCreate((snap) => screen(snap, 'comment', ['text']));

exports.wordFilterStatus = run.firestore
  .document('statuses/{statusId}')
  .onCreate((snap) => screen(snap, 'status', ['caption', 'pollOptions']));

exports._internal = {
  screen,
  maskField,
  getMatcher,
  setSupabase: (c) => { supabaseOverride = c; list = { v: null, matcher: bundled(), at: 0 }; },
};
