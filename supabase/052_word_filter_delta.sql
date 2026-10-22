-- =====================================================================
-- 052_word_filter_delta.sql (2026-10-22) — NOT APPLIED YET
--
-- Two fixes to the 049 word filter after the 4.0.31 Senior Mod test
-- (2026-10-20: "the filter did not block inappropriate words"; words a Sr
-- Mod adds must be blocked in every chat):
--
-- 1. CHAT BLOCKS 'offensive' TOO. 049's chat trigger only rejected 'slur'
--    terms; 'offensive' terms were blocked by the 4.0.31+ app alone, so a
--    word a moderator added reached every older build (Play production) and
--    every modified client. The trigger now tests one combined regex
--    (slur + offensive, word_filter_state.chat_re), compiled once per list
--    change — still one pk read + one regex test per chat insert, never a
--    read of the list. Staff with the link bypass stay exempt (034).
--    Old builds show the same "Message not sent" texts as for a slur
--    (see 049 OLD BUILDS).
--
-- 2. DELTA LIST FOR THE APP. word_filter_list (049) sends the WHOLE list to
--    every phone after any edit. word_filter_changes(p_version) sends only
--    the rows changed since the phone's cached version:
--       same version          -> {v, same: true}               (a few bytes)
--       known older version   -> {v, delta: true, terms, off}  (changed rows)
--       no / unknown version  -> {v, full: true, terms, off}   (whole list)
--    Every row carries `rev` = the list version that last changed it (set
--    under the state-row lock, so concurrent edits never share a rev). A
--    hard DELETE (SQL editor only) cannot be sent as a delta: it raises
--    full_since, and phones older than that get the full list once.
--    word_filter_list stays as it is for 4.0.31 and the Cloud Functions.
--
-- Requires 049. Additive and safe to run more than once. Apply in one run.
-- =====================================================================

alter table public.word_blocklist add column if not exists rev bigint not null default 0;
alter table public.word_filter_state add column if not exists chat_re text;
alter table public.word_filter_state add column if not exists full_since bigint not null default 0;

-- Rows changed before 052 all have rev 0, so a phone cached at any 049
-- version gets the full list once, then deltas. First run only.
update public.word_filter_state
   set full_since = version + 1
 where id = 1 and full_since = 0;

-- 049's row trigger + rev. Locks the state row first, so the version read
-- here is the one _word_filter_rebuild bumps at the end of this statement.
create or replace function public._word_blocklist_before()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_version bigint;
begin
  select version into v_version from public.word_filter_state where id = 1 for update;
  if tg_op = 'DELETE' then
    update public.word_filter_state
       set full_since = coalesce(v_version, 0) + 1
     where id = 1;
    return old;
  end if;
  new.term := btrim(new.term);
  new.term_key := public.word_filter_term_key(new.term);
  if new.term_key is null or new.term_key = '' then
    raise exception 'TERM_EMPTY'
      using errcode = 'check_violation',
            hint = 'The term has no letters or digits once normalised.';
  end if;
  new.updated_at := now();
  new.rev := coalesce(v_version, 0) + 1;
  return new;
end;
$$;

drop trigger if exists trg_word_blocklist_before on public.word_blocklist;
create trigger trg_word_blocklist_before
  before insert or update or delete on public.word_blocklist
  for each row execute function public._word_blocklist_before();

-- 049's rebuild + chat_re (slur and offensive in one regex).
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
  v_chat  text;
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
  v_chat := case
              when v_slur is null then v_off
              when v_off is null then v_slur
              else '(?:' || v_slur || '|' || v_off || ')'
            end;

  -- Compile once here, so a bad list fails the edit, never a chat insert.
  perform '' ~ coalesce(v_slur, 'x');
  perform '' ~ coalesce(v_off, 'x');
  perform '' ~ coalesce(v_spam, 'x');
  perform '' ~ coalesce(v_allow, 'x');
  perform '' ~ coalesce(v_chat, 'x');

  update public.word_filter_state
     set version      = version + 1,
         slur_re      = v_slur,
         offensive_re = v_off,
         spam_re      = v_spam,
         allow_re     = v_allow,
         chat_re      = v_chat,
         updated_at   = now()
   where id = 1;
end;
$$;
revoke all on function public._word_filter_rebuild() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public._word_filter_rebuild() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public._word_filter_rebuild() from authenticated;
  end if;
end $$;

-- Fill chat_re now (bumps the version once; phones then fetch the list once).
select public._word_filter_rebuild();

-- 049's chat trigger, testing chat_re instead of slur_re.
create or replace function public.enforce_chat_words()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_re    text;
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
  select coalesce(s.chat_re, s.slur_re), s.allow_re into v_re, v_allow
    from public.word_filter_state s where s.id = 1;
  if not public._word_filter_hits(new.text, v_re, v_allow) then
    return new;
  end if;
  -- Role lookup only on a hit. Exempt = 034's link bypass.
  if public._chat_caller_link_tier() in ('admin', 'bypass') then
    return new;
  end if;
  -- Builds 4.0.12-4.0.14 show the group-chat error text as is; newer ones
  -- find NOT_ALLOWED in it.
  raise exception 'WORDS_NOT_ALLOWED: this message contains a word that is not allowed.'
    using errcode = 'check_violation',
          hint = 'This message contains a word that is not allowed.';
end;
$$;

-- Delta read for the app (4.0.33+). Same access as word_filter_list.
create or replace function public.word_filter_changes(p_version bigint default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
           when p_version is not null and p_version = s.version
             then jsonb_build_object('v', s.version, 'same', true)
           when p_version is null or p_version < s.full_since or p_version > s.version
             then jsonb_build_object(
               'v', s.version,
               'full', true,
               'terms', coalesce((select jsonb_agg(jsonb_build_array(b.term, b.kind, b.match_mode) order by b.id)
                                    from public.word_blocklist b where b.active), '[]'::jsonb),
               'off', coalesce((select jsonb_agg(b.term order by b.id)
                                  from public.word_blocklist b where not b.active), '[]'::jsonb))
           else jsonb_build_object(
             'v', s.version,
             'delta', true,
             'terms', coalesce((select jsonb_agg(jsonb_build_array(b.term, b.kind, b.match_mode) order by b.id)
                                  from public.word_blocklist b where b.active and b.rev > p_version), '[]'::jsonb),
             'off', coalesce((select jsonb_agg(b.term order by b.id)
                                from public.word_blocklist b where not b.active and b.rev > p_version), '[]'::jsonb))
         end
    from public.word_filter_state s
   where s.id = 1;
$$;
revoke all on function public.word_filter_changes(bigint) from public;
grant execute on function public.word_filter_changes(bigint) to anon, authenticated, service_role;

notify pgrst, 'reload schema';


-- =====================================================================
-- SMOKE TEST (supabase-js, as an ordinary signed-in user):
--   await supabase.rpc('word_filter_changes', { p_version: null })  // {v, full: true, terms, off}
--   await supabase.rpc('word_filter_changes', { p_version: v })     // {v, same: true}
--   await supabase.from('messages').insert({ ..., text: 'f u c k' })  // error WORDS_NOT_ALLOWED
-- SQL editor:
--   select version, full_since, length(chat_re) from public.word_filter_state;
-- =====================================================================


-- =====================================================================
-- ROLLBACK — back to 049's slur-only chat check (the columns can stay):
--   create or replace function public.enforce_chat_words() ... (049 body);
--   drop function if exists public.word_filter_changes(bigint);
-- The app falls back to word_filter_list when word_filter_changes is gone.
-- =====================================================================
