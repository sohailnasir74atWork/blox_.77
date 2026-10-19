// Word filter core (2026-10, supabase/049_word_filter.sql).
//
// Pure text normalisation + term matching. No React Native imports, so the
// same file runs in the app, in Jest and in Node:
//   - app:             Code/Helper/ContentModeration.js (bundled + remote list)
//   - Cloud Functions: functions/wordFilterCore.js is a BYTE-IDENTICAL copy
//                      (__tests__/wordFilter.test.js fails when they drift)
//   - Postgres:        word_filter_normalize() / word_filter_pattern() in 049
//                      re-implement normalize() and termPattern() step for
//                      step; scripts/word-filter/test049.mjs fuzzes JS
//                      against SQL on PGlite. Change all three together.
//
// NORMALISE  text -> ' tok tok tok '
//   1. NFKD (folds fullwidth, "fancy font" maths letters, circled letters,
//      ligatures; splits accents off), drop combining marks and zero-width /
//      format characters, every kind of space -> ' '.
//   2. One character map: lowercase (ASCII, Cyrillic, Greek, a few Latin
//      extras) and look-alikes -> Latin (Cyrillic а е о р с у х, Greek α ο ρ,
//      small capitals ᴀ ʙ ᴄ ...).
//   3. Words split on ' ', two variants of each word:
//        A  punctuation removed      n.i.g.g.e.r -> nigger, f-a-g -> fag
//        B  punctuation is a space   big_dick -> big dick
//   4. A run of 3+ one-character tokens is joined: n i g g e r -> nigger.
//   5. Leetspeak, only in tokens that contain a letter (so "455" stays a
//      number): 0->o 1->i 3->e 4->a 5->s 7->t @->a $->s.
//   6. Pieces of each joined run ("u r a f a g" -> ... fag ...), so a short
//      whole-word term still hits next to a lone letter.
//   Result: ' A ' [| ' B ' when it differs] [| ' pieces ' when any].
//
// MATCH  a term is normalised the same way (variant A), then:
//   - a letter may repeat (fuuuuck): a run of k becomes {k,}; 'l' also
//     matches 'i' (so 1 can stand for i or l); digits match exactly.
//   - mode 'word': whole tokens only, plus an optional plural 's' (never
//     'es': "spices", French "tu retardes"). Short terms use it, so "spic"
//     never fires on "spicy", "homo" never on "homework".
//     mode 'exact': whole tokens only, no plural (retard: French "retards").
//     mode 'part': anywhere inside a token (niggas, faggots).
//     mode 'auto': 'part' for one token of 5+ characters, else 'word'.
//   - kind 'allow': phrases cut out before matching, for innocent text that
//     would otherwise hit ("en retard" is French for "late").
'use strict';

// Regex sources shared with SQL. \uXXXX inside [] means the same in JS and
// in Postgres AREs. Astral characters: JS drops surrogates, SQL drops
// \U00010000-\U0010FFFF (both after NFKD has folded the maths letters).
const SPACES_SRC = '[\\u0009-\\u000d\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const STRIP_SRC = '[\\u00ad\\u034f\\u061c\\u115f\\u1160\\u17b4\\u17b5\\u180b-\\u180f\\u200b-\\u200f\\u202a-\\u202e'
  + '\\u2060-\\u206f\\u3164\\ufe00-\\ufe0f\\ufeff\\uffa0\\u0300-\\u036f\\u0483-\\u0489\\u0591-\\u05bd\\u05bf'
  + '\\u05c1\\u05c2\\u05c4\\u05c5\\u05c7\\u0610-\\u061a\\u0640\\u064b-\\u065f\\u0670\\u06d6-\\u06dc\\u06df-\\u06e4'
  + '\\u06e7\\u06e8\\u06ea-\\u06ed\\u1ab0-\\u1aff\\u1dc0-\\u1dff\\u20d0-\\u20ff\\ufe20-\\ufe2f]';
// Punctuation and symbols: every ASCII one except @ and $ (leetspeak), Latin-1
// symbols, general punctuation, arrows / maths / shapes / dingbats, CJK
// punctuation (not the iteration marks 々 〻), fullwidth punctuation.
const PUNCT_BMP = '\\u0001-\\u0008\\u000e-\\u001f\\u0021-\\u0023\\u0025-\\u002f\\u003a-\\u003f\\u005b-\\u0060'
  + '\\u007b-\\u00bf\\u00d7\\u00f7\\u02b0-\\u02ff\\u0374\\u0375\\u037e\\u0384\\u0385\\u0387\\u055a-\\u055f'
  + '\\u0589\\u058a\\u05be\\u05c0\\u05c3\\u05c6\\u05f3\\u05f4\\u0600-\\u060f\\u061b-\\u061f\\u066a-\\u066d'
  + '\\u06d4\\u06dd\\u06de\\u06e9\\u2000-\\u2bff\\u2e00-\\u2e7f\\u3000-\\u3004\\u3008-\\u3020\\u3030'
  + '\\u303d-\\u303f\\ufe10-\\ufe1f\\ufe30-\\ufe6f\\uff00-\\uff20\\uff3b-\\uff40\\uff5b-\\uff65\\uffe0-\\uffff';
const PUNCT_SRC = '[' + PUNCT_BMP + '\\ud800-\\udfff]';

// Lowercase + look-alikes, one character to one character (SQL translate()).
const MAP_PAIRS = [
  ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'],
  // Latin letters NFKD does not split
  ['ØøŁłĐđÐðĦħŦŧÞıȷɑɡɩÆŒŊ', 'oollddddhhttþijagiæœŋ'],
  // small capitals
  ['ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘʀꜱᴛᴜᴠᴡʏᴢ', 'abcdefghijklmnoprstuvwyz'],
  // Cyrillic capitals (look-alikes straight to Latin, the rest to lowercase)
  ['АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯЀЁЂЃЄЅІЇЈЉЊЋЌЍЎЏҐ', 'aбbгдeжзииkлmhoпpctyфxцчшщъыьэюяeeђгєsiijљњћkиyџґ'],
  // Cyrillic small look-alikes (+ letters NFKD would split, for the fallback)
  ['авекмнорстухѕіјԁһӏԛԝйёѐѓїќѝў', 'abekmhopctyxsijdhlqwиeeгikиy'],
  // Greek
  ['ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩϹαβεζηικμνορσςτυχϲϳ', 'abγδezhθiklmnξoπpstyφxψωcabezhikmnopsstyxcj'],
];

// Fallback for a runtime without String.prototype.normalize: NFKD + mark
// strip of Latin, Cyrillic and Greek letters, and fullwidth ASCII. Generated.
const FOLD_FROM =
  "ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžſƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǢǣǦǧǨǩǪǫǬǭǮǯǰǴǵǸǹǺǻǼǽǾǿȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳḀḁḂḃḄḅḆḇḈḉḊḋḌḍḎḏḐḑḒḓḔḕḖḗḘḙḚḛḜḝḞḟḠḡḢḣḤḥḦḧḨḩḪḫḬḭḮḯḰḱḲḳḴḵḶḷḸḹḺḻḼḽḾḿṀṁṂṃṄṅṆṇṈṉṊṋṌṍṎṏṐṑṒṓṔṕṖṗṘṙṚṛṜṝṞṟṠṡṢṣṤṥṦṧṨṩṪṫṬṭṮṯṰṱṲṳṴṵṶṷṸṹṺṻṼṽṾṿẀẁẂẃẄẅẆẇẈẉẊẋẌẍẎẏẐẑẒẓẔẕẖẗẘẙẛẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹЀЁЃЇЌЍЎЙйѐёѓїќѝўѶѷӁӂӐӑӒӓӖӗӚӛӜӝӞӟӢӣӤӥӦӧӪӫӬӭӮӯӰӱӲӳӴӵӸӹʹΆΈΉΊΌΎΏΐΪΫάέήίΰϊϋόύώϐϑϒϓϔϕϖϰϱϲϴϵϹ！＂＃＄％＆＇（）＊＋，－．／０１２３４５６７８９：；＜＝＞？＠ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ［＼］＾＿｀ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ｛｜｝～";
const FOLD_TO =
  "AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyyAaAaAaCcCcCcCcDdEeEeEeEeEeGgGgGgGgHhIiIiIiIiIJjKkLlLlLlNnNnNnOoOoOoRrRrRrSsSsSsSsTtTtUuUuUuUuUuUuWwYyYZzZzZzsOoUuAaIiOoUuUuUuUuUuAaAaÆæGgKkOoOoƷʒjGgNnAaÆæØøAaAaEeEeIiIiOoOoRrRrUuUuSsTtHhAaEeOoOoOoOoYyAaBbBbBbCcDdDdDdDdDdEeEeEeEeEeFfGgHhHhHhHhHhIiIiKkKkKkLlLlLlLlMmMmMmNnNnNnNnOoOoOoOoPpPpRrRrRrRrSsSsSsSsSsTtTtTtTtUuUuUuUuUuVvVvWwWwWwWwWwXxXxYyZzZzZzhtwysAaAaAaAaAaAaAaAaAaAaAaAaEeEeEeEeEeEeEeEeIiIiOoOoOoOoOoOoOoOoOoOoOoOoUuUuUuUuUuUuUuYyYyYyYyЕЕГІКИУИиеегікиуѴѵЖжАаАаЕеӘәЖжЗзИиИиОоӨөЭэУуУуУуЧчЫыʹΑΕΗΙΟΥΩιΙΥαεηιυιυουωβθΥΥΥφπκρςΘεΣ!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";

const LEET_FROM = '013457@$';
const LEET_TO = 'oieastas';

const makeMap = (from, to) => {
  const m = new Map();
  for (let i = 0; i < from.length; i++) if (!m.has(from[i])) m.set(from[i], to[i]);
  return m;
};
const MAP_FROM = MAP_PAIRS.map((p) => p[0]).join('');
const MAP_TO = MAP_PAIRS.map((p) => p[1]).join('');
const CHAR_MAP = makeMap(MAP_FROM, MAP_TO);
const FOLD_MAP = makeMap(FOLD_FROM, FOLD_TO);
const LEET_MAP = makeMap(LEET_FROM, LEET_TO);

const translate = (s, m) => {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const r = m.get(s[i]);
    out += r === undefined ? s[i] : r;
  }
  return out;
};

// Hermes has String.prototype.normalize; the table keeps Latin / Cyrillic /
// Greek accents and fullwidth working if a runtime ever lacks it.
let HAS_NFKD = false;
try { HAS_NFKD = 'ﬁＡ'.normalize('NFKD') === 'fiA'; } catch (e) { HAS_NFKD = false; }
const nfkd = (s) => {
  if (HAS_NFKD) {
    try { return s.normalize('NFKD'); } catch (e) { /* fall through */ }
  }
  return translate(s, FOLD_MAP);
};

const SPLIT_RE = new RegExp(SPACES_SRC + '+');
const SPLIT_KEEP_RE = new RegExp('(' + SPACES_SRC + '+)');
const SPACES_RE = new RegExp(SPACES_SRC, 'g');
const STRIP_RE = new RegExp(STRIP_SRC, 'g');
const PUNCT_RE = new RegExp(PUNCT_SRC, 'g');
const HAS_LETTER_RE = /[^0-9@$]/;
const LEET_SYMBOL_RE = /[@$]/g;

const prep = (s) => translate(nfkd(s).replace(SPACES_RE, ' ').replace(STRIP_RE, ''), CHAR_MAP);

const leet = (t) => (HAS_LETTER_RE.test(t) ? translate(t, LEET_MAP) : t.replace(LEET_SYMBOL_RE, ''));

// Joins runs of 3+ one-character tokens, then applies leetspeak. A joined
// run keeps `run` = the source word of each of its characters.
const finish = (toks) => {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length >= 3) {
      out.push({ t: run.map((x) => x.t).join(''), w0: run[0].w0, w1: run[run.length - 1].w1, run: run.map((x) => x.w0) });
    } else {
      for (const x of run) out.push(x);
    }
    run = [];
  };
  for (const x of toks) {
    if (x.t.length === 1) run.push(x);
    else { flush(); out.push(x); }
  }
  flush();
  const res = [];
  for (const x of out) {
    const t = leet(x.t);
    if (!t) continue;
    // A run that lost @ / $ characters (no letter in it) gets no pieces.
    res.push(x.run && t.length === x.t.length ? { t, w0: x.w0, w1: x.w1, run: x.run } : { t, w0: x.w0, w1: x.w1 });
  }
  return res;
};

// Every piece (3+ characters, not the whole) of each joined run, so a short
// whole-word term still hits when a lone letter sits next to it:
// "u r a f a g" -> run "urafag" -> pieces include "fag". Bounded so a crafted
// message stays cheap (the SQL twin de-duplicates in O(n^2)): only runs of up
// to 16 characters, and only the first 6 of them (variant A, then B).
const MAX_RUN = 16;
const MAX_RUNS = 6;
const runPieces = (lists) => {
  const out = [];
  let runs = 0;
  for (const toks of lists) {
    for (const x of toks) {
      if (!x.run || x.t.length > MAX_RUN) continue;
      if (++runs > MAX_RUNS) return out;
      const L = x.t.length;
      for (let i = 0; i + 3 <= L; i++) {
        for (let j = i + 3; j <= L; j++) {
          if (i === 0 && j === L) continue;
          out.push({ t: x.t.slice(i, j), w0: x.run[i], w1: x.run[j - 1] });
        }
      }
    }
  }
  return out;
};

// Only the first 4000 characters (code points, like SQL left()) are read, so
// a huge crafted message stays cheap on the server.
const MAX_CHARS = 4000;
const capChars = (s) => {
  if (s.length <= MAX_CHARS) return s;
  let i = 0;
  for (let n = 0; n < MAX_CHARS && i < s.length; n++) {
    const c = s.charCodeAt(i);
    const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
    i += c >= 0xd800 && c <= 0xdbff && d >= 0xdc00 && d <= 0xdfff ? 2 : 1;
  }
  return s.slice(0, i);
};

// Tokens of both variants plus the run pieces; w0..w1 = index of the source
// word(s) in text.split(SPLIT_RE), so maskText can find them again.
const tokenize = (text) => {
  const words = capChars(String(text == null ? '' : text)).split(SPLIT_RE);
  const a = [];
  const b = [];
  for (let i = 0; i < words.length; i++) {
    if (!words[i]) continue;
    const pieces = prep(words[i]).split(' ');
    for (const p of pieces) {
      if (!p) continue;
      const pa = p.replace(PUNCT_RE, '');
      if (pa) a.push({ t: pa, w0: i, w1: i });
      for (const q of p.replace(PUNCT_RE, ' ').split(' ')) {
        if (q) b.push({ t: q, w0: i, w1: i });
      }
    }
  }
  const fa = finish(a);
  const fb = finish(b);
  return { a: fa, b: fb, s: runPieces([fa, fb]) };
};

const joinTokens = (toks) => ' ' + toks.map((x) => x.t).join(' ') + ' ';

// ' A ' | ' B ' (when different) | ' pieces ' (when any; de-duplicated).
const normalize = (text) => {
  const { a, b, s } = tokenize(text);
  const sa = joinTokens(a);
  const sb = joinTokens(b);
  let out = sa === sb ? sa : sa + '|' + sb;
  if (s.length) {
    const seen = new Set();
    const uniq = [];
    for (const x of s) {
      if (!seen.has(x.t)) { seen.add(x.t); uniq.push(x); }
    }
    out += '|' + joinTokens(uniq);
  }
  return out;
};

const isDigit = (c) => c >= '0' && c <= '9';

const tokenPattern = (tok) => {
  let out = '';
  let i = 0;
  while (i < tok.length) {
    const c = tok[i];
    let k = 1;
    while (i + k < tok.length && tok[i + k] === c) k++;
    if (isDigit(c)) out += k === 1 ? c : c + '{' + k + '}';
    else out += (c === 'l' ? '[li]' : c) + (k === 1 ? '+' : '{' + k + ',}');
    i += k;
  }
  return out;
};

const termTokens = (term) => tokenize(term).a.map((x) => x.t);

// 'word' | 'exact' | 'part' after resolving 'auto' (allow phrases: 'word').
const resolveMode = (toks, mode, kind) => {
  if (kind === 'allow') return 'word';
  if (mode === 'word' || mode === 'exact' || mode === 'part') return mode;
  return toks.length === 1 && toks[0].length >= 5 ? 'part' : 'word';
};

// Regex source for one term, or null when it normalises to nothing.
const termPattern = (term, mode, kind) => {
  const toks = termTokens(term);
  if (!toks.length) return null;
  const body = toks.map(tokenPattern).join(' ');
  const m = resolveMode(toks, mode, kind);
  if (m === 'part') return body;
  const last = toks[toks.length - 1];
  return ' ' + body + (m === 'exact' || isDigit(last[last.length - 1]) ? '' : 's?') + '(?= )';
};

// Canonical form of a term (for de-duplicating and the "off" list).
const termKey = (term) => termTokens(term).join(' ');

const KINDS = ['slur', 'offensive', 'spam', 'allow'];

// entries: [{ term, kind, mode }]. Returns one RegExp per kind (or null).
const buildMatcher = (entries) => {
  const by = { slur: [], offensive: [], spam: [], allow: [] };
  const seen = new Set();
  for (const e of entries || []) {
    if (!e || !by[e.kind]) continue;
    const p = termPattern(e.term, e.mode, e.kind);
    if (!p || seen.has(e.kind + ' ' + p)) continue;
    seen.add(e.kind + ' ' + p);
    by[e.kind].push({ term: e.term, p });
  }
  const re = (list, flags) => (list.length ? new RegExp('(?:' + list.map((x) => x.p).join('|') + ')', flags) : null);
  return {
    slur: re(by.slur),
    offensive: re(by.offensive),
    spam: re(by.spam),
    allow: re(by.allow, 'g'),
    terms: by,
  };
};

const cutAllowed = (norm, m) => (m.allow ? norm.replace(m.allow, ' ') : norm);

// First kind (in `kinds` order) the text hits, or null.
const firstHitKind = (text, m, kinds) => {
  if (!m || text == null || text === '') return null;
  const norm = normalize(text);
  let cut = null;
  for (const k of kinds || ['slur', 'offensive', 'spam']) {
    const re = m[k];
    if (!re || !re.test(norm)) continue;
    if (cut === null) cut = cutAllowed(norm, m);
    if (re.test(cut)) return k;
  }
  return null;
};

// The terms of `kind` the text hits (one regex per term: only call on a hit).
const matchedTerms = (text, m, kind) => {
  if (!m || !m.terms[kind]) return [];
  const cut = cutAllowed(normalize(text), m);
  return m.terms[kind].filter((x) => new RegExp(x.p).test(cut)).map((x) => x.term);
};

const maskWord = (w) => '*'.repeat(Math.min(Math.max(w.length, 3), 12));

// Replaces every source word that is part of a hit with asterisks.
// Returns null when the text is clean, else { masked, terms }.
const maskText = (text, m, kinds) => {
  const ks = kinds || ['slur'];
  if (typeof text !== 'string' || !firstHitKind(text, m, ks)) return null;
  const { a, b, s: pieces } = tokenize(text);
  const hit = new Set();
  for (const toks of [a, b, pieces]) {
    let s = ' ';
    const offs = [];
    for (const x of toks) { offs.push(s.length); s += x.t + ' '; }
    if (m.allow) s = s.replace(m.allow, (x) => ' '.repeat(x.length));
    for (const k of ks) {
      if (!m[k]) continue;
      const g = new RegExp(m[k].source, 'g');
      let mm = g.exec(s);
      while (mm) {
        const ms = mm.index;
        const me = ms + mm[0].length;
        toks.forEach((x, i) => {
          if (offs[i] < me && offs[i] + x.t.length > ms) {
            for (let w = x.w0; w <= x.w1; w++) hit.add(w);
          }
        });
        if (!mm[0].length) g.lastIndex++;
        mm = g.exec(s);
      }
    }
  }
  const parts = text.split(SPLIT_KEEP_RE);
  for (let i = 0; i < parts.length; i += 2) {
    if (hit.has(i / 2)) parts[i] = maskWord(parts[i]);
  }
  const terms = [];
  for (const k of ks) for (const t of matchedTerms(text, m, k)) terms.push(t);
  return { masked: hit.size ? parts.join('') : '***', terms };
};

// ---------------------------------------------------------------------------
// Bundled list. MUST equal the active rows seeded by supabase/049 (the test
// parses the SQL). Moderators refine it in the word_blocklist table; the app
// merges remote terms in and drops bundled ones a moderator turned off.
// [term, kind, mode, lang]. Confidence per language is in 049's comments.
// ---------------------------------------------------------------------------
const BUNDLED = [
  // en
  ['nigger', 'slur', 'part', 'en'],
  ['nigga', 'slur', 'part', 'en'],
  ['niglet', 'slur', 'part', 'en'],
  ['faggot', 'slur', 'part', 'en'],
  ['fag', 'slur', 'word', 'en'],
  ['retard', 'slur', 'exact', 'en'],
  ['retarded', 'slur', 'part', 'en'],
  ['chink', 'slur', 'word', 'en'],
  ['gook', 'slur', 'word', 'en'],
  ['spic', 'slur', 'word', 'en'],
  ['coon', 'slur', 'word', 'en'],
  ['wetback', 'slur', 'part', 'en'],
  ['beaner', 'slur', 'part', 'en'],
  ['raghead', 'slur', 'word', 'en'],
  ['towelhead', 'slur', 'part', 'en'],
  ['tranny', 'slur', 'word', 'en'],
  ['trannies', 'slur', 'word', 'en'],
  ['dyke', 'slur', 'word', 'en'],
  ['homo', 'slur', 'word', 'en'],
  ['jigaboo', 'slur', 'part', 'en'],
  ['darkie', 'slur', 'word', 'en'],
  ['zipperhead', 'slur', 'part', 'en'],
  ['golliwog', 'slur', 'part', 'en'],
  ['slanteye', 'slur', 'part', 'en'],
  ['mongoloid', 'slur', 'part', 'en'],
  ['porch monkey', 'slur', 'word', 'en'],
  ['ching chong', 'slur', 'word', 'en'],
  ['heil hitler', 'slur', 'word', 'en'],
  ['sieg heil', 'slur', 'word', 'en'],
  // 'offensive': the app blocks these everywhere (most are also in its
  // leo-profanity list); the server checks them in usernames only.
  ['kys', 'offensive', 'word', 'en'],
  ['kill yourself', 'offensive', 'word', 'en'],
  ['kill urself', 'offensive', 'word', 'en'],
  ['whore', 'offensive', 'word', 'en'],
  // Slurs that are also everyday words elsewhere: app-only (the server checks
  // them in usernames only). kike = Spanish nickname for Enrique.
  ['kike', 'offensive', 'word', 'en'],
  ['fuck', 'offensive', 'word', 'en'],
  ['fucking', 'offensive', 'word', 'en'],
  ['fucker', 'offensive', 'word', 'en'],
  ['motherfucker', 'offensive', 'word', 'en'],
  ['shit', 'offensive', 'word', 'en'],
  ['cunt', 'offensive', 'word', 'en'],
  ['bitch', 'offensive', 'word', 'en'],
  ['slut', 'offensive', 'word', 'en'],
  ['pussy', 'offensive', 'word', 'en'],
  ['dick', 'offensive', 'word', 'en'],
  ['cock', 'offensive', 'word', 'en'],
  ['penis', 'offensive', 'word', 'en'],
  ['vagina', 'offensive', 'word', 'en'],
  ['porn', 'offensive', 'word', 'en'],
  ['porno', 'offensive', 'word', 'en'],
  ['rape', 'offensive', 'word', 'en'],
  ['rapist', 'offensive', 'word', 'en'],
  ['pedophile', 'offensive', 'word', 'en'],
  ['paedophile', 'offensive', 'word', 'en'],
  // es
  ['maricon', 'slur', 'part', 'es'],
  ['joto', 'slur', 'word', 'es'],
  ['sudaca', 'slur', 'word', 'es'],
  ['negrata', 'slur', 'part', 'es'],
  ['mongolico', 'slur', 'part', 'es'],
  // pt
  ['viado', 'slur', 'word', 'pt'],
  ['baitola', 'slur', 'part', 'pt'],
  ['boiola', 'slur', 'part', 'pt'],
  ['traveco', 'slur', 'part', 'pt'],
  ['sapatao', 'slur', 'word', 'pt'],
  ['retardado', 'slur', 'part', 'pt'],
  ['mongoloide', 'slur', 'part', 'pt'],
  // fr
  ['bougnoule', 'slur', 'part', 'fr'],
  ['youpin', 'slur', 'word', 'fr'],
  ['bamboula', 'slur', 'word', 'fr'],
  ['gouine', 'slur', 'word', 'fr'],
  ['bicot', 'slur', 'word', 'fr'],
  ['chinetoque', 'slur', 'part', 'fr'],
  ['niakoue', 'slur', 'word', 'fr'],
  ['negre', 'slur', 'word', 'fr'],
  // de
  ['kanake', 'slur', 'part', 'de'],
  ['neger', 'slur', 'word', 'de'],
  ['schwuchtel', 'slur', 'part', 'de'],
  ['kummelturke', 'slur', 'part', 'de'],
  ['zigeuner', 'slur', 'part', 'de'],
  ['spast', 'slur', 'word', 'de'],
  ['judensau', 'slur', 'part', 'de'],
  ['polacke', 'slur', 'part', 'de'],
  // ru
  ['пидор', 'slur', 'part', 'ru'],
  ['педик', 'slur', 'word', 'ru'],
  ['хохол', 'slur', 'word', 'ru'],
  ['жид', 'slur', 'word', 'ru'],
  ['чурка', 'slur', 'word', 'ru'],
  ['черножопый', 'slur', 'part', 'ru'],
  ['хач', 'slur', 'word', 'ru'],
  ['ниггер', 'slur', 'part', 'ru'],
  // id
  ['bencong', 'slur', 'word', 'id'],
  ['banci', 'slur', 'word', 'id'],
  // vi
  ['tàu khựa', 'slur', 'word', 'vi'],
  // ar
  ['زنجي', 'slur', 'word', 'ar'],
  ['لوطي', 'slur', 'word', 'ar'],
  ['khawal', 'slur', 'word', 'ar'],
  // Allow phrases: French "retard" = "delay / late".
  ['en retard', 'allow', 'word', 'fr'],
  ['du retard', 'allow', 'word', 'fr'],
  ['de retard', 'allow', 'word', 'fr'],
  ['un retard', 'allow', 'word', 'fr'],
  ['le retard', 'allow', 'word', 'fr'],
  ['les retards', 'allow', 'word', 'fr'],
  ['des retards', 'allow', 'word', 'fr'],
  ['mon retard', 'allow', 'word', 'fr'],
  ['ton retard', 'allow', 'word', 'fr'],
  ['son retard', 'allow', 'word', 'fr'],
  ['sans retard', 'allow', 'word', 'fr'],
  ['retard de', 'allow', 'word', 'fr'],
  // Allow: English words that contain a part-mode slur.
  ['snigger', 'allow', 'word', 'en'],
  ['sniggering', 'allow', 'word', 'en'],
  ['sniggered', 'allow', 'word', 'en'],
  ['niggard', 'allow', 'word', 'en'],
  ['niggardly', 'allow', 'word', 'en'],
  ['niggardliness', 'allow', 'word', 'en'],
  ['niggardness', 'allow', 'word', 'en'],
  ['homo sapiens', 'allow', 'word', 'en'],
].map(([term, kind, mode, lang]) => ({ term, kind, mode, lang }));

module.exports = {
  normalize,
  tokenize,
  termPattern,
  termKey,
  buildMatcher,
  firstHitKind,
  matchedTerms,
  maskText,
  BUNDLED,
  KINDS,
  // for scripts/word-filter (SQL constants) and tests
  SQL_CONSTANTS: {
    SPACES_SRC, STRIP_SRC, PUNCT_BMP, MAP_FROM, MAP_TO, LEET_FROM, LEET_TO,
  },
  HAS_NFKD,
};
