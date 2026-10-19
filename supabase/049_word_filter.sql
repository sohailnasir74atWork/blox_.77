-- =====================================================================
-- 049_word_filter.sql (2026-10-19) — NOT APPLIED YET
--
-- Global word filter: an editable blocklist of slurs / offensive / spam
-- terms (plus "allow" phrases for innocent text that would otherwise hit),
-- a cheap versioned public read for the app, Senior Mod+ editing rpcs, and
-- server checks:
--   * chat: public.messages, group_messages and private_messages reject an
--     end-user INSERT, or UPDATE of text, that contains an active SLUR
--     ('WORDS_NOT_ALLOWED', check_violation 23514). Staff with the link
--     bypass (admin, senior mod, moderator who is not JMD) are exempt, like
--     034's link rule. Service role / cron / SQL editor pass through.
--   * names: public.usernames (claim_username, 021/022) rejects a name with
--     an active slur or offensive term ('USERNAME_NOT_ALLOWED'). Nobody is
--     exempt: a name is a permanent public identity.
--   * Firestore posts / comments / statuses are screened by the Cloud
--     Functions in functions/wordFilterContent.js, which read this list
--     through word_filter_list() with the service role and log every hit in
--     word_filter_hits.
-- Requires 034 (_chat_end_user_uid, _chat_caller_link_tier, _chat_jwt_claims)
-- and 021 (usernames). Safe to run more than once: seed rows are
-- `on conflict do nothing`, so a re-run never re-enables a term a moderator
-- turned off.
--
-- MATCHING — mirrors Code/Helper/wordFilterCore.js step for step
-- (scripts/word-filter/test049.mjs fuzzes the two against each other):
--   word_filter_normalize(text) -> ' tok tok ' : NFKD, marks / zero-width
--     dropped, lowercase + Cyrillic / Greek / small-capital look-alikes ->
--     Latin, words split on spaces with punctuation removed (A) and with
--     punctuation as a space (B, appended after '|' when different), runs of
--     3+ single letters joined (n i g g e r), leetspeak 0 1 3 4 5 7 @ $ in
--     tokens that contain a letter, then the pieces of each joined run
--     ("u r a f a g" -> ... fag ...).
--   word_filter_pattern(term, mode, kind) -> regex: each letter may repeat,
--     'l' also matches 'i'; mode 'word' = whole tokens (+ plural s/es),
--     'part' = inside a token, 'auto' = part for one token of 5+ chars.
--   The patterns of each kind are OR-ed into ONE regex, cached in the
--   single row of word_filter_state and rebuilt by a statement trigger on
--   every list change. A chat insert costs: one pk read, one normalise, one
--   regex test (Postgres caches the compiled regex per connection); the role
--   lookup only happens on a hit. No per-row scan of the list.
--
-- TRIGGER ORDER on the chat tables (BEFORE triggers fire alphabetically):
--   trg_aa_chat_ban (034) -> trg_ab_chat_links (034) -> trg_ac_chat_update_guard
--   (034) -> trg_ad_chat_slowmode (046, messages only) -> trg_ae_chat_words (049)
--   -> trg_reject_unavailable_chat (025, private_messages)
-- so a banned, muted, link-sending, non-sender or slow-moded write gets its
-- own error first, and the regex only runs on writes that would land.
-- 034's functions are not modified.
--
-- OLD BUILDS (4.0.15+, i.e. every production build): chatErrorCode() finds
-- 'NOT_ALLOWED' inside 'WORDS_NOT_ALLOWED' -> "Message not sent / This
-- message isn't allowed here."; the public-chat retry queue drops it (a
-- 23514 is permanent). Settings shows a refused name's error message as is,
-- so USERNAME_NOT_ALLOWED carries a readable English sentence.
--
-- Apply after 034, any order relative to 044-048/050. Steps 1-5 are one run;
-- each STEP arms one table.
-- =====================================================================


-- =====================================================================
-- STEP 1 — Matching functions (immutable, no table access).
-- Constants are generated from wordFilterCore.js SQL_CONSTANTS by
-- `node scripts/word-filter/sql-constants.js`; the PGlite test compares them.
-- =====================================================================

create or replace function public._wf_spaces_re() returns text
language sql immutable parallel safe as
$$ select E'[\\u0009-\\u000d\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]'::text $$;

create or replace function public._wf_strip_re() returns text
language sql immutable parallel safe as
$$ select E'[\\u00ad\\u034f\\u061c\\u115f\\u1160\\u17b4\\u17b5\\u180b-\\u180f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u206f\\u3164\\ufe00-\\ufe0f\\ufeff\\uffa0\\u0300-\\u036f\\u0483-\\u0489\\u0591-\\u05bd\\u05bf\\u05c1\\u05c2\\u05c4\\u05c5\\u05c7\\u0610-\\u061a\\u0640\\u064b-\\u065f\\u0670\\u06d6-\\u06dc\\u06df-\\u06e4\\u06e7\\u06e8\\u06ea-\\u06ed\\u1ab0-\\u1aff\\u1dc0-\\u1dff\\u20d0-\\u20ff\\ufe20-\\ufe2f]'::text $$;

create or replace function public._wf_punct_re() returns text
language sql immutable parallel safe as
$$ select E'[\\u0001-\\u0008\\u000e-\\u001f\\u0021-\\u0023\\u0025-\\u002f\\u003a-\\u003f\\u005b-\\u0060\\u007b-\\u00bf\\u00d7\\u00f7\\u02b0-\\u02ff\\u0374\\u0375\\u037e\\u0384\\u0385\\u0387\\u055a-\\u055f\\u0589\\u058a\\u05be\\u05c0\\u05c3\\u05c6\\u05f3\\u05f4\\u0600-\\u060f\\u061b-\\u061f\\u066a-\\u066d\\u06d4\\u06dd\\u06de\\u06e9\\u2000-\\u2bff\\u2e00-\\u2e7f\\u3000-\\u3004\\u3008-\\u3020\\u3030\\u303d-\\u303f\\ufe10-\\ufe1f\\ufe30-\\ufe6f\\uff00-\\uff20\\uff3b-\\uff40\\uff5b-\\uff65\\uffe0-\\uffff\\U00010000-\\U0010ffff]'::text $$;

create or replace function public._wf_map_from() returns text
language sql immutable parallel safe as
$$ select E'ABCDEFGHIJKLMNOPQRSTUVWXYZØøŁłĐđÐðĦħŦŧÞıȷɑɡɩÆŒŊᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘʀꜱᴛᴜᴠᴡʏᴢАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯЀЁЂЃЄЅІЇЈЉЊЋЌЍЎЏҐавекмнорстухѕіјԁһӏԛԝйёѐѓїќѝўΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩϹαβεζηικμνορσςτυχϲϳ'::text $$;

create or replace function public._wf_map_to() returns text
language sql immutable parallel safe as
$$ select E'abcdefghijklmnopqrstuvwxyzoollddddhhttþijagiæœŋabcdefghijklmnoprstuvwyzaбbгдeжзииkлmhoпpctyфxцчшщъыьэюяeeђгєsiijљњћkиyџґabekmhopctyxsijdhlqwиeeгikиyabγδezhθiklmnξoπpstyφxψωcabezhikmnopsstyxcj'::text $$;

-- Joins runs of 3+ one-character tokens, then applies leetspeak
-- (wordFilterCore finish()). runs = the joined runs that kept their length
-- (they contain a letter), for the run pieces below.
create or replace function public._wf_finish(p_toks text[], out toks text[], out runs text[])
language plpgsql
immutable
parallel safe
as $$
declare
  v_out   text[] := '{}';
  v_isrun boolean[] := '{}';
  v_run   text[] := '{}';
  v_t     text;
  v_l     text;
  v_i     integer;
begin
  toks := '{}';
  runs := '{}';
  foreach v_t in array coalesce(p_toks, '{}'::text[]) loop
    if char_length(v_t) = 1 then
      v_run := v_run || v_t;
    else
      if coalesce(array_length(v_run, 1), 0) >= 3 then
        v_out := v_out || array_to_string(v_run, '');
        v_isrun := v_isrun || true;
      else
        v_out := v_out || v_run;
        v_isrun := v_isrun || array_fill(false, array[coalesce(array_length(v_run, 1), 0)]);
      end if;
      v_run := '{}';
      v_out := v_out || v_t;
      v_isrun := v_isrun || false;
    end if;
  end loop;
  if coalesce(array_length(v_run, 1), 0) >= 3 then
    v_out := v_out || array_to_string(v_run, '');
    v_isrun := v_isrun || true;
  else
    v_out := v_out || v_run;
    v_isrun := v_isrun || array_fill(false, array[coalesce(array_length(v_run, 1), 0)]);
  end if;

  for v_i in 1 .. coalesce(array_length(v_out, 1), 0) loop
    v_t := v_out[v_i];
    if v_t ~ '[^0-9@$]' then
      v_l := translate(v_t, '013457@$', 'oieastas');
    else
      v_l := translate(v_t, '@$', '');
    end if;
    continue when v_l = '';
    toks := toks || v_l;
    if v_isrun[v_i] and char_length(v_l) = char_length(v_t) then
      runs := runs || v_l;
    end if;
  end loop;
end;
$$;

-- wordFilterCore normalize(). NULL in, NULL out.
create or replace function public.word_filter_normalize(p_text text)
returns text
language plpgsql
immutable
strict
parallel safe
as $$
declare
  v_s     text;
  v_w     text;
  v_p     text;
  v_a     text[] := '{}';
  v_b     text[] := '{}';
  v_fa    text[];
  v_fb    text[];
  v_ra    text[];
  v_rb    text[];
  v_pcs   text[] := '{}';
  v_sa    text;
  v_sb    text;
  v_out   text;
  v_len   integer;
  v_runs  integer := 0;
  v_i     integer;
  v_j     integer;
  v_punct text := public._wf_punct_re();
begin
  v_s := normalize(p_text, NFKD);
  v_s := regexp_replace(v_s, public._wf_spaces_re(), ' ', 'g');
  v_s := regexp_replace(v_s, public._wf_strip_re(), '', 'g');
  v_s := translate(v_s, public._wf_map_from(), public._wf_map_to());

  foreach v_w in array string_to_array(v_s, ' ') loop
    continue when v_w = '';
    v_p := regexp_replace(v_w, v_punct, '', 'g');
    if v_p <> '' then
      v_a := v_a || v_p;
    end if;
    foreach v_p in array string_to_array(regexp_replace(v_w, v_punct, ' ', 'g'), ' ') loop
      if v_p <> '' then
        v_b := v_b || v_p;
      end if;
    end loop;
  end loop;

  select f.toks, f.runs into v_fa, v_ra from public._wf_finish(v_a) f;
  select f.toks, f.runs into v_fb, v_rb from public._wf_finish(v_b) f;
  v_sa := ' ' || array_to_string(v_fa, ' ') || ' ';
  v_sb := ' ' || array_to_string(v_fb, ' ') || ' ';
  v_out := case when v_sa = v_sb then v_sa else v_sa || '|' || v_sb end;

  -- Run pieces (wordFilterCore runPieces()): every 3+ character slice of a
  -- joined run except the whole run, de-duplicated; only runs of up to 16
  -- characters and only the first 6 of them, so the O(n^2) de-dup below
  -- stays cheap on a crafted message.
  foreach v_p in array v_ra || v_rb loop
    v_len := char_length(v_p);
    continue when v_len > 16;
    v_runs := v_runs + 1;
    exit when v_runs > 6;
    for v_i in 0 .. v_len - 3 loop
      for v_j in v_i + 3 .. v_len loop
        continue when v_i = 0 and v_j = v_len;
        v_w := substr(v_p, v_i + 1, v_j - v_i);
        if not (v_w = any(v_pcs)) then
          v_pcs := v_pcs || v_w;
        end if;
      end loop;
    end loop;
  end loop;
  if coalesce(array_length(v_pcs, 1), 0) > 0 then
    v_out := v_out || '| ' || array_to_string(v_pcs, ' ') || ' ';
  end if;
  return v_out;
end;
$$;

-- Canonical key of a term (wordFilterCore termKey()): variant A, trimmed.
create or replace function public.word_filter_term_key(p_term text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select btrim(split_part(public.word_filter_normalize(p_term), '|', 1), ' ');
$$;

-- Regex for one term (wordFilterCore termPattern()), NULL when it normalises
-- to nothing. Tokens only hold a-z, 0-9 and non-ASCII letters, so nothing
-- needs escaping.
create or replace function public.word_filter_pattern(p_term text, p_mode text, p_kind text)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  v_key   text := public.word_filter_term_key(p_term);
  v_toks  text[];
  v_tok   text;
  v_body  text := '';
  v_piece text;
  v_c     text;
  v_prev  text;
  v_k     integer;
  v_i     integer;
  v_mode  text := coalesce(p_mode, 'auto');
  v_last  text;
begin
  if v_key is null or v_key = '' then
    return null;
  end if;
  v_toks := string_to_array(v_key, ' ');

  foreach v_tok in array v_toks loop
    v_piece := '';
    v_prev := null;
    v_k := 0;
    for v_i in 1 .. char_length(v_tok) + 1 loop
      v_c := case when v_i <= char_length(v_tok) then substr(v_tok, v_i, 1) end;
      if v_prev is not null and v_c is not distinct from v_prev then
        v_k := v_k + 1;
        continue;
      end if;
      if v_prev is not null then
        if v_prev ~ '^[0-9]$' then
          v_piece := v_piece || v_prev || case when v_k = 1 then '' else '{' || v_k || '}' end;
        else
          v_piece := v_piece || case when v_prev = 'l' then '[li]' else v_prev end
                             || case when v_k = 1 then '+' else '{' || v_k || ',}' end;
        end if;
      end if;
      v_prev := v_c;
      v_k := 1;
    end loop;
    v_body := v_body || case when v_body = '' then '' else ' ' end || v_piece;
  end loop;

  if p_kind = 'allow' then
    v_mode := 'word';
  elsif v_mode not in ('word', 'part') then
    v_mode := case when array_length(v_toks, 1) = 1 and char_length(v_toks[1]) >= 5 then 'part' else 'word' end;
  end if;
  if v_mode = 'part' then
    return v_body;
  end if;
  v_last := right(v_toks[array_length(v_toks, 1)], 1);
  return ' ' || v_body || case when v_last ~ '^[0-9]$' then '' else '(?:e?s)?' end || '(?= )';
end;
$$;

revoke all on function public._wf_finish(text[]) from public;
grant execute on function public.word_filter_normalize(text) to anon, authenticated, service_role;
grant execute on function public.word_filter_term_key(text) to anon, authenticated, service_role;
grant execute on function public.word_filter_pattern(text, text, text) to anon, authenticated, service_role;


-- =====================================================================
-- STEP 2 — Tables, cache, list rpcs.
-- =====================================================================

create table if not exists public.word_blocklist (
  id            bigint generated by default as identity primary key,
  term          text not null check (char_length(term) between 1 and 100),
  term_key      text not null,                     -- word_filter_term_key(term), set by trigger
  kind          text not null check (kind in ('slur', 'offensive', 'spam', 'allow')),
  match_mode    text not null default 'auto' check (match_mode in ('auto', 'word', 'part')),
  lang          text check (lang is null or lang ~ '^[a-z]{2,3}$'),
  note          text check (note is null or char_length(note) <= 300),
  active        boolean not null default true,
  added_by      text,                              -- Firebase uid; null = seed / SQL editor
  added_by_name text,
  created_at    timestamptz not null default now(),
  updated_by    text,
  updated_at    timestamptz not null default now()
);

create unique index if not exists word_blocklist_term_key_uidx
  on public.word_blocklist (term_key);

alter table public.word_blocklist enable row level security;
revoke all on public.word_blocklist from anon, authenticated;
-- No policies: reads go through word_filter_list / word_filter_admin_list,
-- writes through word_filter_add / word_filter_remove (or the SQL editor).

-- One row: the compiled list. version bumps on every change.
create table if not exists public.word_filter_state (
  id           smallint primary key default 1 check (id = 1),
  version      bigint not null default 0,
  slur_re      text,
  offensive_re text,
  spam_re      text,
  allow_re     text,
  updated_at   timestamptz not null default now()
);
insert into public.word_filter_state (id) values (1) on conflict (id) do nothing;
alter table public.word_filter_state enable row level security;
revoke all on public.word_filter_state from anon, authenticated;

-- Hits found by the Firestore screening functions (service role writes;
-- Senior Mod+ reads via word_filter_hits_list). Holds the original text so a
-- false positive can be put back by hand.
create table if not exists public.word_filter_hits (
  id         bigint generated by default as identity primary key,
  source     text not null,                       -- 'post' | 'comment' | 'status'
  doc_path   text not null,
  field      text not null,
  uid        text,
  original   text,
  masked     text,
  terms      text[],
  created_at timestamptz not null default now()
);
create index if not exists idx_word_filter_hits_created
  on public.word_filter_hits (created_at desc);
alter table public.word_filter_hits enable row level security;
revoke all on public.word_filter_hits from anon, authenticated;

-- term_key + updated_at on every write; rejects a term that normalises to
-- nothing (only punctuation / emoji).
create or replace function public._word_blocklist_before()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.term := btrim(new.term);
  new.term_key := public.word_filter_term_key(new.term);
  if new.term_key is null or new.term_key = '' then
    raise exception 'TERM_EMPTY'
      using errcode = 'check_violation',
            hint = 'The term has no letters or digits once normalised.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_word_blocklist_before on public.word_blocklist;
create trigger trg_word_blocklist_before
  before insert or update on public.word_blocklist
  for each row execute function public._word_blocklist_before();

-- Recompiles the cached regexes and bumps the version. Locks the state row
-- first so two concurrent edits serialise and the second one's aggregate
-- (a fresh statement snapshot) sees the first one's row.
create or replace function public._word_filter_rebuild()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slur  text;
  v_off   text;
  v_spam  text;
  v_allow text;
begin
  perform 1 from public.word_filter_state where id = 1 for update;

  select '(?:' || string_agg(p, '|' order by p) || ')' into v_slur
    from (select distinct public.word_filter_pattern(term, match_mode, kind) as p
            from public.word_blocklist where active and kind = 'slur') s
   where p is not null;
  select '(?:' || string_agg(p, '|' order by p) || ')' into v_off
    from (select distinct public.word_filter_pattern(term, match_mode, kind) as p
            from public.word_blocklist where active and kind = 'offensive') s
   where p is not null;
  select '(?:' || string_agg(p, '|' order by p) || ')' into v_spam
    from (select distinct public.word_filter_pattern(term, match_mode, kind) as p
            from public.word_blocklist where active and kind = 'spam') s
   where p is not null;
  select '(?:' || string_agg(p, '|' order by p) || ')' into v_allow
    from (select distinct public.word_filter_pattern(term, match_mode, kind) as p
            from public.word_blocklist where active and kind = 'allow') s
   where p is not null;

  -- Compile once here, so a bad list fails the edit, never a chat insert.
  perform '' ~ coalesce(v_slur, 'x');
  perform '' ~ coalesce(v_off, 'x');
  perform '' ~ coalesce(v_spam, 'x');
  perform '' ~ coalesce(v_allow, 'x');

  update public.word_filter_state
     set version      = version + 1,
         slur_re      = v_slur,
         offensive_re = v_off,
         spam_re      = v_spam,
         allow_re     = v_allow,
         updated_at   = now()
   where id = 1;
end;
$$;
revoke all on function public._word_filter_rebuild() from public;

create or replace function public._word_blocklist_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._word_filter_rebuild();
  return null;
end;
$$;

drop trigger if exists trg_word_blocklist_after on public.word_blocklist;
create trigger trg_word_blocklist_after
  after insert or update or delete on public.word_blocklist
  for each statement execute function public._word_blocklist_after();

-- Public read for the app (anon too: the list ships inside the app anyway).
-- Pass the version you have cached: same version -> {v, same: true}, a few
-- bytes; otherwise {v, terms: [[term, kind, mode], ...], off: [term, ...]}.
-- `off` = turned-off terms, which the app also drops from its bundled list.
create or replace function public.word_filter_list(p_version bigint default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
           when p_version is not null and p_version = s.version
             then jsonb_build_object('v', s.version, 'same', true)
           else jsonb_build_object(
             'v', s.version,
             'terms', coalesce((select jsonb_agg(jsonb_build_array(b.term, b.kind, b.match_mode) order by b.id)
                                  from public.word_blocklist b where b.active), '[]'::jsonb),
             'off', coalesce((select jsonb_agg(b.term order by b.id)
                                from public.word_blocklist b where not b.active), '[]'::jsonb))
         end
    from public.word_filter_state s
   where s.id = 1;
$$;
revoke all on function public.word_filter_list(bigint) from public;
grant execute on function public.word_filter_list(bigint) to anon, authenticated, service_role;

-- Senior Mod+ (owner email, user_roles.is_admin, user_roles.is_cmsr) — the
-- same role source as 031 is_mod_staff / 034 _chat_caller_link_tier. Returns
-- the caller's uid; raises NOT_ALLOWED for anyone else (incl. no JWT: the SQL
-- editor writes the table directly instead).
create or replace function public._word_filter_editor()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   text := public._chat_end_user_uid();
  v_email text;
begin
  if v_uid is null then
    raise exception 'NOT_ALLOWED' using errcode = '42501', hint = 'Sign in as a Senior Mod or above.';
  end if;
  v_email := lower(public._chat_jwt_claims() ->> 'email');
  if v_email in ('thesolanalabs@gmail.com', 'sohailnasir74business@gmail.com', 'sohailnasir74@gmail.com') then
    return v_uid;
  end if;
  if exists (select 1 from public.user_roles ur
              where ur.uid = v_uid and (coalesce(ur.is_admin, false) or coalesce(ur.is_cmsr, false))) then
    return v_uid;
  end if;
  raise exception 'NOT_ALLOWED' using errcode = '42501', hint = 'Only Senior Mods and above can edit the word filter.';
end;
$$;
revoke all on function public._word_filter_editor() from public;

create or replace function public.word_filter_admin_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._word_filter_editor();
  return jsonb_build_object(
    'v', (select version from public.word_filter_state where id = 1),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'term', b.term, 'key', b.term_key, 'kind', b.kind, 'mode', b.match_mode,
               'lang', b.lang, 'note', b.note, 'active', b.active,
               'addedBy', b.added_by, 'addedByName', b.added_by_name,
               'createdAt', b.created_at, 'updatedBy', b.updated_by, 'updatedAt', b.updated_at)
             order by b.updated_at desc, b.id desc)
        from public.word_blocklist b), '[]'::jsonb));
end;
$$;

-- Adds a term, or re-enables / re-classifies an existing one (same key).
create or replace function public.word_filter_add(
  p_term text,
  p_kind text,
  p_mode text default 'auto',
  p_lang text default null,
  p_note text default null,
  p_name text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid text := public._word_filter_editor();
  r     public.word_blocklist;
begin
  if p_kind is null or p_kind not in ('slur', 'offensive', 'spam', 'allow') then
    raise exception 'BAD_KIND' using errcode = '22023';
  end if;
  insert into public.word_blocklist (term, term_key, kind, match_mode, lang, note, active,
                                     added_by, added_by_name, updated_by)
  values (p_term, '', p_kind, coalesce(nullif(p_mode, ''), 'auto'), nullif(lower(btrim(p_lang)), ''),
          nullif(btrim(p_note), ''), true, v_uid, left(nullif(btrim(p_name), ''), 60), v_uid)
  on conflict (term_key) do update
     set term       = excluded.term,
         kind       = excluded.kind,
         match_mode = excluded.match_mode,
         lang       = coalesce(excluded.lang, public.word_blocklist.lang),
         note       = coalesce(excluded.note, public.word_blocklist.note),
         active     = true,
         updated_by = v_uid
  returning * into r;
  return to_jsonb(r);
end;
$$;

-- Turns a term off. A term that is not in the table (e.g. a word bundled in
-- the app's old English list) is inserted switched off, so the app drops it.
create or replace function public.word_filter_remove(p_term text, p_name text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid text := public._word_filter_editor();
  r     public.word_blocklist;
begin
  insert into public.word_blocklist (term, term_key, kind, active, note, added_by, added_by_name, updated_by)
  values (p_term, '', 'offensive', false, 'turned off (bundled in the app)', v_uid,
          left(nullif(btrim(p_name), ''), 60), v_uid)
  on conflict (term_key) do update
     set active = false,
         updated_by = v_uid
  returning * into r;
  return to_jsonb(r);
end;
$$;

create or replace function public.word_filter_hits_list(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._word_filter_editor();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id, 'source', h.source, 'docPath', h.doc_path, 'field', h.field, 'uid', h.uid,
             'original', h.original, 'masked', h.masked, 'terms', h.terms, 'createdAt', h.created_at)
           order by h.id desc)
      from (select * from public.word_filter_hits
             order by id desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) h), '[]'::jsonb);
end;
$$;

revoke all on function public.word_filter_admin_list() from public;
revoke all on function public.word_filter_add(text, text, text, text, text, text) from public;
revoke all on function public.word_filter_remove(text, text) from public;
revoke all on function public.word_filter_hits_list(integer) from public;
grant execute on function public.word_filter_admin_list() to authenticated;
grant execute on function public.word_filter_add(text, text, text, text, text, text) to authenticated;
grant execute on function public.word_filter_remove(text, text) to authenticated;
grant execute on function public.word_filter_hits_list(integer) to authenticated;


-- =====================================================================
-- STEP 3 — Seed. Short, widely recognised lists; moderators refine them in
-- the table (Admin Dashboard -> Content -> Word filter). Active rows MUST
-- equal wordFilterCore.js BUNDLED (the PGlite test checks). Terms marked
-- active = false are suggestions a moderator can switch on: each collides
-- with an everyday word somewhere in the app's 11 languages.
--
-- Confidence (how sure we are a term is a slur AND has no common innocent
-- use in the app's languages):
--   en  high.   "fag" (UK: cigarette), "homo", "dyke" medium; "retard" is
--               whole-word only and French "en retard" etc. are allow phrases.
--               English profanity lives in the app's bundled leo-profanity
--               list; the 'offensive' rows here are what the server also
--               checks in usernames.
--   es  high: maricon, joto (MX), sudaca, negrata, mongolico.
--       medium (off): marica ("dude" in Colombia), puto (also a general
--       intensifier in Spain).
--   pt  high: viado (whole word: "enviado" is safe), baitola, boiola,
--       traveco, retardado, mongoloide; sapatao medium-high.
--       medium (off): bicha (pt-PT "queue"), crioulo (also "creole").
--   fr  high: bougnoule, youpin, bamboula, gouine, bicot, chinetoque,
--       niakoue, negre (nègre).
--       medium (off): pede (pédé; pt "pede" = "asks"), tapette (also "fly
--       swatter").
--   de  high: kanake, neger, schwuchtel, kummelturke (Kümmeltürke), spast,
--       judensau, polacke; zigeuner medium-high.
--       medium (off): mongo, fidschi (also "Fiji").
--   ru  high: пидор, педик (whole word: "педикюр" is safe), хохол, жид
--       (whole word: "жидкий" is safe), чурка, черножопый, хач, ниггер.
--       medium (off): даун, москаль. Not "нигер" (= Niger in Russian).
--   id  medium-high: bencong, banci. medium (off): maho (also Japanese
--       romaji "mahō").
--   fil LOW — Tagalog/Cebuano terms double as self-identification; all off:
--       bakla, bayot, bading, intsik.
--   vi  medium: tàu khựa. LOW (off): khựa, bê đê. Accents are stripped
--       before matching, so many Vietnamese words collide ("mọi" = every,
--       "chệt" = chết) and are deliberately not listed.
--   ar  medium: زنجي, لوطي, khawal (Arabizi). medium (off): شاذ (also
--       "irregular"), خول (also "to authorise"), zamel. Not عبد ("slave",
--       but part of names like Abdullah).
--   Not listed anywhere: "negro" (Spanish/Portuguese for black; the app's
--   leo-profanity list still blocks it in the app — a moderator can turn it
--   off from the staff screen), "kkk" (Brazilian laughter), digit codes.
-- =====================================================================

insert into public.word_blocklist (term, term_key, kind, match_mode, lang, active, note) values
  -- en
  ('nigger', '', 'slur', 'part', 'en', true, 'seed: high'),
  ('nigga', '', 'slur', 'part', 'en', true, 'seed: high'),
  ('niglet', '', 'slur', 'part', 'en', true, 'seed: high'),
  ('faggot', '', 'slur', 'part', 'en', true, 'seed: high'),
  ('fag', '', 'slur', 'word', 'en', true, 'seed: medium: UK "cigarette"'),
  ('retard', '', 'slur', 'word', 'en', true, 'seed: high; whole word, French "en retard" is an allow phrase'),
  ('retarded', '', 'slur', 'part', 'en', true, 'seed: high'),
  ('chink', '', 'slur', 'part', 'en', true, 'seed: high'),
  ('gook', '', 'slur', 'word', 'en', true, 'seed: high'),
  ('spic', '', 'slur', 'word', 'en', true, 'seed: high'),
  ('kike', '', 'slur', 'word', 'en', true, 'seed: high'),
  ('coon', '', 'slur', 'word', 'en', true, 'seed: high'),
  ('paki', '', 'slur', 'word', 'en', true, 'seed: high'),
  ('wetback', '', 'slur', 'part', 'en', true, 'seed: high'),
  ('beaner', '', 'slur', 'part', 'en', true, 'seed: high'),
  ('raghead', '', 'slur', 'part', 'en', true, 'seed: high'),
  ('towelhead', '', 'slur', 'part', 'en', true, 'seed: high'),
  ('tranny', '', 'slur', 'part', 'en', true, 'seed: high'),
  ('dyke', '', 'slur', 'word', 'en', true, 'seed: medium'),
  ('homo', '', 'slur', 'word', 'en', true, 'seed: medium'),
  ('jigaboo', '', 'slur', 'part', 'en', true, 'seed: high'),
  ('darkie', '', 'slur', 'word', 'en', true, 'seed: high'),
  ('zipperhead', '', 'slur', 'part', 'en', true, 'seed: high'),
  ('golliwog', '', 'slur', 'part', 'en', true, 'seed: high'),
  ('slanteye', '', 'slur', 'part', 'en', true, 'seed: high'),
  ('mongoloid', '', 'slur', 'part', 'en', true, 'seed: high'),
  ('porch monkey', '', 'slur', 'word', 'en', true, 'seed: high'),
  ('ching chong', '', 'slur', 'word', 'en', true, 'seed: high'),
  ('heil hitler', '', 'slur', 'word', 'en', true, 'seed: high'),
  ('sieg heil', '', 'slur', 'word', 'en', true, 'seed: high'),
  ('kys', '', 'offensive', 'word', 'en', true, 'seed: high'),
  ('kill yourself', '', 'offensive', 'word', 'en', true, 'seed: high'),
  ('kill urself', '', 'offensive', 'word', 'en', true, 'seed: high'),
  ('whore', '', 'offensive', 'word', 'en', true, 'seed: high'),
  ('fuck', '', 'offensive', 'word', 'en', true, 'seed: high'),
  ('fucking', '', 'offensive', 'word', 'en', true, 'seed: high'),
  ('fucker', '', 'offensive', 'word', 'en', true, 'seed: high'),
  ('motherfucker', '', 'offensive', 'word', 'en', true, 'seed: high'),
  ('shit', '', 'offensive', 'word', 'en', true, 'seed: high'),
  ('cunt', '', 'offensive', 'word', 'en', true, 'seed: high'),
  ('bitch', '', 'offensive', 'word', 'en', true, 'seed: high'),
  ('slut', '', 'offensive', 'word', 'en', true, 'seed: high'),
  ('pussy', '', 'offensive', 'word', 'en', true, 'seed: high'),
  ('dick', '', 'offensive', 'word', 'en', true, 'seed: high'),
  ('cock', '', 'offensive', 'word', 'en', true, 'seed: high'),
  ('penis', '', 'offensive', 'word', 'en', true, 'seed: high'),
  ('vagina', '', 'offensive', 'word', 'en', true, 'seed: high'),
  ('porn', '', 'offensive', 'word', 'en', true, 'seed: high'),
  ('porno', '', 'offensive', 'word', 'en', true, 'seed: high'),
  ('rape', '', 'offensive', 'word', 'en', true, 'seed: high'),
  ('rapist', '', 'offensive', 'word', 'en', true, 'seed: high'),
  ('pedophile', '', 'offensive', 'word', 'en', true, 'seed: high'),
  ('paedophile', '', 'offensive', 'word', 'en', true, 'seed: high'),
  -- es
  ('maricon', '', 'slur', 'part', 'es', true, 'seed: high'),
  ('joto', '', 'slur', 'word', 'es', true, 'seed: high'),
  ('sudaca', '', 'slur', 'word', 'es', true, 'seed: high'),
  ('negrata', '', 'slur', 'part', 'es', true, 'seed: high'),
  ('mongolico', '', 'slur', 'part', 'es', true, 'seed: high'),
  -- pt
  ('viado', '', 'slur', 'word', 'pt', true, 'seed: high'),
  ('baitola', '', 'slur', 'part', 'pt', true, 'seed: high'),
  ('boiola', '', 'slur', 'part', 'pt', true, 'seed: high'),
  ('traveco', '', 'slur', 'part', 'pt', true, 'seed: high'),
  ('sapatao', '', 'slur', 'word', 'pt', true, 'seed: medium-high'),
  ('retardado', '', 'slur', 'part', 'pt', true, 'seed: high'),
  ('mongoloide', '', 'slur', 'part', 'pt', true, 'seed: high'),
  -- fr
  ('bougnoule', '', 'slur', 'part', 'fr', true, 'seed: high'),
  ('youpin', '', 'slur', 'word', 'fr', true, 'seed: high'),
  ('bamboula', '', 'slur', 'word', 'fr', true, 'seed: high'),
  ('gouine', '', 'slur', 'word', 'fr', true, 'seed: high'),
  ('bicot', '', 'slur', 'word', 'fr', true, 'seed: high'),
  ('chinetoque', '', 'slur', 'part', 'fr', true, 'seed: high'),
  ('niakoue', '', 'slur', 'word', 'fr', true, 'seed: high'),
  ('negre', '', 'slur', 'word', 'fr', true, 'seed: high'),
  -- de
  ('kanake', '', 'slur', 'part', 'de', true, 'seed: high'),
  ('neger', '', 'slur', 'word', 'de', true, 'seed: high'),
  ('schwuchtel', '', 'slur', 'part', 'de', true, 'seed: high'),
  ('kummelturke', '', 'slur', 'part', 'de', true, 'seed: high'),
  ('zigeuner', '', 'slur', 'part', 'de', true, 'seed: medium-high'),
  ('spast', '', 'slur', 'word', 'de', true, 'seed: high'),
  ('judensau', '', 'slur', 'part', 'de', true, 'seed: high'),
  ('polacke', '', 'slur', 'part', 'de', true, 'seed: high'),
  -- ru
  ('пидор', '', 'slur', 'part', 'ru', true, 'seed: high'),
  ('педик', '', 'slur', 'word', 'ru', true, 'seed: high'),
  ('хохол', '', 'slur', 'word', 'ru', true, 'seed: high'),
  ('жид', '', 'slur', 'word', 'ru', true, 'seed: high'),
  ('чурка', '', 'slur', 'word', 'ru', true, 'seed: high'),
  ('черножопый', '', 'slur', 'part', 'ru', true, 'seed: high'),
  ('хач', '', 'slur', 'word', 'ru', true, 'seed: high'),
  ('ниггер', '', 'slur', 'part', 'ru', true, 'seed: high'),
  -- id
  ('bencong', '', 'slur', 'word', 'id', true, 'seed: medium-high'),
  ('banci', '', 'slur', 'word', 'id', true, 'seed: medium-high'),
  -- vi
  ('tàu khựa', '', 'slur', 'word', 'vi', true, 'seed: medium'),
  -- ar
  ('زنجي', '', 'slur', 'word', 'ar', true, 'seed: medium'),
  ('لوطي', '', 'slur', 'word', 'ar', true, 'seed: medium'),
  ('khawal', '', 'slur', 'word', 'ar', true, 'seed: medium (Arabizi)'),
  -- allow phrases: French "retard" = delay / late; English words that contain a part-mode slur
  ('en retard', '', 'allow', 'word', 'fr', true, 'seed: allow'),
  ('du retard', '', 'allow', 'word', 'fr', true, 'seed: allow'),
  ('de retard', '', 'allow', 'word', 'fr', true, 'seed: allow'),
  ('un retard', '', 'allow', 'word', 'fr', true, 'seed: allow'),
  ('le retard', '', 'allow', 'word', 'fr', true, 'seed: allow'),
  ('les retards', '', 'allow', 'word', 'fr', true, 'seed: allow'),
  ('des retards', '', 'allow', 'word', 'fr', true, 'seed: allow'),
  ('mon retard', '', 'allow', 'word', 'fr', true, 'seed: allow'),
  ('ton retard', '', 'allow', 'word', 'fr', true, 'seed: allow'),
  ('son retard', '', 'allow', 'word', 'fr', true, 'seed: allow'),
  ('sans retard', '', 'allow', 'word', 'fr', true, 'seed: allow'),
  ('retard de', '', 'allow', 'word', 'fr', true, 'seed: allow'),
  ('snigger', '', 'allow', 'word', 'en', true, 'seed: allow'),
  ('sniggering', '', 'allow', 'word', 'en', true, 'seed: allow'),
  ('sniggered', '', 'allow', 'word', 'en', true, 'seed: allow'),
  ('niggard', '', 'allow', 'word', 'en', true, 'seed: allow'),
  ('niggardly', '', 'allow', 'word', 'en', true, 'seed: allow'),
  -- suggestions, switched off (see confidence notes above)
  ('marica', '', 'slur', 'word', 'es', false, 'seed (off): medium: also "dude" in Colombia'),
  ('puto', '', 'slur', 'word', 'es', false, 'seed (off): medium: also a general intensifier in Spain'),
  ('bicha', '', 'slur', 'word', 'pt', false, 'seed (off): medium: pt-PT "queue"'),
  ('crioulo', '', 'slur', 'word', 'pt', false, 'seed (off): medium: also "creole"'),
  ('pédé', '', 'slur', 'word', 'fr', false, 'seed (off): medium: Portuguese "pede" = "asks"'),
  ('tapette', '', 'slur', 'word', 'fr', false, 'seed (off): medium: also "fly swatter"'),
  ('mongo', '', 'slur', 'word', 'de', false, 'seed (off): medium'),
  ('fidschi', '', 'slur', 'word', 'de', false, 'seed (off): medium: also "Fiji"'),
  ('даун', '', 'slur', 'word', 'ru', false, 'seed (off): medium'),
  ('москаль', '', 'slur', 'word', 'ru', false, 'seed (off): medium'),
  ('maho', '', 'slur', 'word', 'id', false, 'seed (off): medium: also Japanese romaji "maho"'),
  ('bakla', '', 'slur', 'word', 'fil', false, 'seed (off): low: also self-identification'),
  ('bayot', '', 'slur', 'word', 'fil', false, 'seed (off): low: also self-identification'),
  ('bading', '', 'slur', 'word', 'fil', false, 'seed (off): low: also self-identification'),
  ('intsik', '', 'slur', 'word', 'fil', false, 'seed (off): low: also neutral'),
  ('khựa', '', 'slur', 'word', 'vi', false, 'seed (off): low: collides with "khua"'),
  ('bê đê', '', 'slur', 'word', 'vi', false, 'seed (off): low: "be de" once accents go'),
  ('شاذ', '', 'slur', 'word', 'ar', false, 'seed (off): medium: also "irregular"'),
  ('خول', '', 'slur', 'word', 'ar', false, 'seed (off): medium: also "to authorise"'),
  ('zamel', '', 'slur', 'word', 'ar', false, 'seed (off): medium')
on conflict (term_key) do nothing;


-- =====================================================================
-- STEP 4 — Server checks (trigger functions).
-- =====================================================================

-- TRUE when p_text hits the cached regex p_re, after allow phrases.
create or replace function public._word_filter_hits(p_text text, p_re text, p_allow text)
returns boolean
language plpgsql
immutable
parallel safe
as $$
declare
  v_norm text;
begin
  if p_re is null or p_text is null or p_text = '' then
    return false;
  end if;
  v_norm := public.word_filter_normalize(p_text);
  if v_norm !~ p_re then
    return false;                                    -- normal path: one regex test
  end if;
  if p_allow is null then
    return true;
  end if;
  return regexp_replace(v_norm, p_allow, ' ', 'g') ~ p_re;
end;
$$;
revoke all on function public._word_filter_hits(text, text, text) from public;

-- Is p_text OK for kind 'slur' (+ 'offensive' when p_names)? For the app's
-- own diagnostics and the staff tester; anyone may ask about any text.
create or replace function public.word_filter_check(p_text text, p_names boolean default false)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.word_filter_state;
begin
  select * into s from public.word_filter_state where id = 1;
  if public._word_filter_hits(p_text, s.slur_re, s.allow_re) then
    return 'slur';
  end if;
  if p_names and public._word_filter_hits(p_text, s.offensive_re, s.allow_re) then
    return 'offensive';
  end if;
  return null;
end;
$$;
revoke all on function public.word_filter_check(text, boolean) from public;
grant execute on function public.word_filter_check(text, boolean) to anon, authenticated, service_role;

create or replace function public.enforce_chat_words()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slur  text;
  v_allow text;
begin
  -- Nested, not AND-ed: OLD is NULL on INSERT.
  if tg_op = 'UPDATE' then
    if new.text is not distinct from old.text then
      return new;
    end if;
  end if;
  if new.text is null or new.text = '' then
    return new;
  end if;
  if public._chat_end_user_uid() is null then
    return new;                                      -- service role / cron / editor
  end if;
  select s.slur_re, s.allow_re into v_slur, v_allow
    from public.word_filter_state s where s.id = 1;
  if not public._word_filter_hits(new.text, v_slur, v_allow) then
    return new;
  end if;
  -- Role lookup only on a hit. Exempt = 034's link bypass.
  if public._chat_caller_link_tier() in ('admin', 'bypass') then
    return new;
  end if;
  raise exception 'WORDS_NOT_ALLOWED'
    using errcode = 'check_violation',
          hint = 'This message contains a word that is not allowed.';
end;
$$;

create or replace function public.enforce_username_words()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.word_filter_state;
begin
  if tg_op = 'UPDATE' then
    if new.display_name is not distinct from old.display_name then
      return new;
    end if;
  end if;
  if public._chat_end_user_uid() is null then
    return new;                                      -- service role / backfills
  end if;
  select * into s from public.word_filter_state where id = 1;
  if public._word_filter_hits(new.display_name, s.slur_re, s.allow_re)
     or public._word_filter_hits(new.display_name, s.offensive_re, s.allow_re) then
    -- Old builds show this message as is (Settings: err.message).
    raise exception 'This name contains a word that is not allowed. Please choose another one. (USERNAME_NOT_ALLOWED)'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;


-- =====================================================================
-- STEP 5 — Arm the tables (each block is quick: CREATE TRIGGER only).
-- =====================================================================
set lock_timeout = '5s';

drop trigger if exists trg_ae_chat_words on public.messages;
create trigger trg_ae_chat_words
  before insert or update of text on public.messages
  for each row execute function public.enforce_chat_words();

drop trigger if exists trg_ae_chat_words on public.group_messages;
create trigger trg_ae_chat_words
  before insert or update of text on public.group_messages
  for each row execute function public.enforce_chat_words();

drop trigger if exists trg_ae_chat_words on public.private_messages;
create trigger trg_ae_chat_words
  before insert or update of text on public.private_messages
  for each row execute function public.enforce_chat_words();

drop trigger if exists trg_ae_username_words on public.usernames;
create trigger trg_ae_username_words
  before insert or update of display_name on public.usernames
  for each row execute function public.enforce_username_words();

reset lock_timeout;

notify pgrst, 'reload schema';


-- =====================================================================
-- SMOKE TEST (supabase-js, as an ordinary signed-in user):
--   await supabase.rpc('word_filter_list', { p_version: null })   // {v, terms: [...], off: [...]}
--   await supabase.rpc('word_filter_check', { p_text: 'n1gg3r' }) // 'slur'
--   await supabase.rpc('word_filter_check', { p_text: 'je suis en retard' }) // null
--   await supabase.from('messages').insert({ ..., text: 'f a g' })  // error WORDS_NOT_ALLOWED
--   await supabase.rpc('word_filter_add', { p_term: 'x', p_kind: 'slur' })  // NOT_ALLOWED unless Sr Mod+
-- SQL editor:
--   select version, length(slur_re) from public.word_filter_state;
--   select public.word_filter_normalize('Ｎ 1 g g 3 r');           -- ' nigger '
-- =====================================================================


-- =====================================================================
-- ROLLBACK — triggers first so enforcement stops immediately.
--   set lock_timeout = '5s';
--   drop trigger if exists trg_ae_chat_words     on public.messages;
--   drop trigger if exists trg_ae_chat_words     on public.group_messages;
--   drop trigger if exists trg_ae_chat_words     on public.private_messages;
--   drop trigger if exists trg_ae_username_words on public.usernames;
--   reset lock_timeout;
--   -- Optional full removal (the app falls back to its bundled list):
--   drop function if exists public.enforce_chat_words();
--   drop function if exists public.enforce_username_words();
--   drop function if exists public.word_filter_check(text, boolean);
--   drop function if exists public._word_filter_hits(text, text, text);
--   drop function if exists public.word_filter_hits_list(integer);
--   drop function if exists public.word_filter_remove(text, text);
--   drop function if exists public.word_filter_add(text, text, text, text, text, text);
--   drop function if exists public.word_filter_admin_list();
--   drop function if exists public._word_filter_editor();
--   drop function if exists public.word_filter_list(bigint);
--   drop table if exists public.word_blocklist;      -- its triggers go with it
--   drop function if exists public._word_blocklist_after();
--   drop function if exists public._word_blocklist_before();
--   drop function if exists public._word_filter_rebuild();
--   drop table if exists public.word_filter_state;
--   drop table if exists public.word_filter_hits;
--   drop function if exists public.word_filter_pattern(text, text, text);
--   drop function if exists public.word_filter_term_key(text);
--   drop function if exists public.word_filter_normalize(text);
--   drop function if exists public._wf_finish(text[]);
--   drop function if exists public._wf_spaces_re(), public._wf_strip_re(), public._wf_punct_re(),
--     public._wf_map_from(), public._wf_map_to();
-- =====================================================================
