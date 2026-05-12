-- =====================================================================
-- 015_polls.sql — polls migrated off Firestore
-- =====================================================================
-- Replaces the Firestore `polls/{pollId}` document model. The Firestore
-- write path was a client-side read-modify-write of the entire `options`
-- array — under concurrency this lost votes (textbook last-writer-wins:
-- two clients read 500 votes, both write back 501, server ends at 501
-- when it should be 502). Production saw counts visibly drop from ~500
-- to ~400 as bursts of concurrent writers stomped each other.
--
-- Same fix shape as 011 (chat_meta) and 014 (group_meta fan-out): pull
-- the mutation server-side into a SECURITY DEFINER RPC that does the
-- whole vote transition atomically. Per-option counters are kept on
-- the polls row as parallel arrays (option_texts / option_counts) so a
-- single UPDATE flips one element — no array rebuild from the client.
--
-- Schema notes:
--   • option_texts / option_counts are parallel int[]/text[]; PG arrays
--     are 1-indexed so the RPC adds 1 to the client's 0-based option
--     index. Length match enforced via CHECK.
--   • total_votes is denormalised but mutated in the same statement as
--     option_counts inside the RPC, so it can never drift.
--   • poll_votes (poll_id, user_id) is the source of truth for "did
--     this user vote, and on what" — drives PollCard's prefill and
--     prevents double-count on re-submit/change-vote.
--   • All client writes go through cast_poll_vote(); RLS on poll_votes
--     blocks direct INSERT/UPDATE/DELETE from `authenticated`.
--   • Admin-only mutations on polls themselves use user_roles.is_admin
--     (mirrored from RTDB by the existing role sync).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. polls
-- ---------------------------------------------------------------------
create table if not exists public.polls (
  id              uuid primary key default gen_random_uuid(),
  question        text not null,
  image_url       text,
  option_texts    text[] not null,
  option_counts   integer[] not null default '{}',
  total_votes     integer not null default 0,
  active          boolean not null default true,
  created_by      text,                         -- Firebase uid of admin
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint polls_options_nonempty check (array_length(option_texts, 1) >= 2),
  constraint polls_arrays_aligned   check (array_length(option_texts, 1) = array_length(option_counts, 1)),
  constraint polls_total_nonneg     check (total_votes >= 0)
);

create index if not exists idx_polls_active_created
  on public.polls (created_at desc) where active = true;

-- ---------------------------------------------------------------------
-- 2. poll_votes
-- ---------------------------------------------------------------------
create table if not exists public.poll_votes (
  poll_id       uuid not null references public.polls(id) on delete cascade,
  user_id       text not null,
  option_index  integer not null check (option_index >= 0),
  voted_at      timestamptz not null default now(),
  primary key (poll_id, user_id)
);

create index if not exists idx_poll_votes_user
  on public.poll_votes (user_id);

-- ---------------------------------------------------------------------
-- 3. poll_comments
-- ---------------------------------------------------------------------
create table if not exists public.poll_comments (
  id           uuid primary key default gen_random_uuid(),
  poll_id      uuid not null references public.polls(id) on delete cascade,
  user_id      text not null,
  user_name    text,
  user_avatar  text,
  text         text not null,
  reply_to     uuid references public.poll_comments(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_poll_comments_poll_created
  on public.poll_comments (poll_id, created_at asc);

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.polls         enable row level security;
alter table public.poll_votes    enable row level security;
alter table public.poll_comments enable row level security;

-- polls: anyone authenticated can SELECT (active filter handled client-
-- side; admin dashboard needs to see inactive too). All mutations are
-- admin-only — clients must never write directly; they go through
-- cast_poll_vote.
drop policy if exists polls_select on public.polls;
create policy polls_select on public.polls
  for select to authenticated
  using (true);

drop policy if exists polls_admin_write on public.polls;
create policy polls_admin_write on public.polls
  for all to authenticated
  using (
    exists (
      select 1 from public.user_roles r
      where r.uid = public.firebase_uid() and r.is_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.user_roles r
      where r.uid = public.firebase_uid() and r.is_admin = true
    )
  );

-- poll_votes: SELECT only the caller's own row (so PollCard can prefill
-- the previously-chosen option). All writes blocked — must use the RPC.
drop policy if exists poll_votes_select_own on public.poll_votes;
create policy poll_votes_select_own on public.poll_votes
  for select to authenticated
  using (user_id = public.firebase_uid());

-- poll_comments: anyone authenticated reads; only the author can post,
-- only the author or an admin can update/delete.
drop policy if exists poll_comments_select on public.poll_comments;
create policy poll_comments_select on public.poll_comments
  for select to authenticated
  using (true);

drop policy if exists poll_comments_insert_self on public.poll_comments;
create policy poll_comments_insert_self on public.poll_comments
  for insert to authenticated
  with check (user_id = public.firebase_uid());

drop policy if exists poll_comments_modify_owner on public.poll_comments;
create policy poll_comments_modify_owner on public.poll_comments
  for update to authenticated
  using (user_id = public.firebase_uid())
  with check (user_id = public.firebase_uid());

drop policy if exists poll_comments_delete_owner_or_admin on public.poll_comments;
create policy poll_comments_delete_owner_or_admin on public.poll_comments
  for delete to authenticated
  using (
    user_id = public.firebase_uid()
    or exists (
      select 1 from public.user_roles r
      where r.uid = public.firebase_uid() and r.is_admin = true
    )
  );

-- =====================================================================
-- cast_poll_vote — atomic vote/change-vote/idempotent-resubmit
-- =====================================================================
-- Returns updated counters so the client can sync local state without a
-- separate refetch. Three transitions handled in one transaction:
--   • first vote: insert poll_votes row, bump option_counts[idx]+=1,
--     total_votes+=1
--   • same option resubmit: no-op (idempotent — covers retry storms)
--   • change vote: update poll_votes row, option_counts[old]-=1,
--     option_counts[new]+=1, total_votes unchanged
-- =====================================================================
create or replace function public.cast_poll_vote(
  p_poll_id      uuid,
  p_option_index integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller        text := public.firebase_uid();
  v_active      boolean;
  v_n_options   integer;
  v_prev_index  integer;
begin
  if caller is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_poll_id is null then
    raise exception 'poll_id required' using errcode = '22023';
  end if;
  if p_option_index is null or p_option_index < 0 then
    raise exception 'invalid option_index' using errcode = '22023';
  end if;

  -- Lock the poll row for the duration of the txn so the
  -- option_counts array update is serialised against other voters.
  select active, array_length(option_texts, 1)
    into v_active, v_n_options
    from public.polls
   where id = p_poll_id
   for update;

  if not found then
    raise exception 'poll not found' using errcode = 'P0002';
  end if;
  if not v_active then
    raise exception 'poll not active' using errcode = '22023';
  end if;
  if p_option_index >= v_n_options then
    raise exception 'option_index out of range' using errcode = '22023';
  end if;

  -- Existing vote (if any). PK on (poll_id, user_id) gives us O(1).
  select option_index into v_prev_index
    from public.poll_votes
   where poll_id = p_poll_id and user_id = caller;

  if v_prev_index is null then
    -- First vote.
    insert into public.poll_votes (poll_id, user_id, option_index)
      values (p_poll_id, caller, p_option_index);

    -- option_counts is 1-indexed in PG; client sends 0-based.
    update public.polls
       set option_counts[p_option_index + 1] = coalesce(option_counts[p_option_index + 1], 0) + 1,
           total_votes                       = total_votes + 1,
           updated_at                        = now()
     where id = p_poll_id;

  elsif v_prev_index = p_option_index then
    -- Idempotent: same vote already recorded. No-op.
    null;

  else
    -- Change vote: shift one count from old to new slot.
    update public.poll_votes
       set option_index = p_option_index,
           voted_at     = now()
     where poll_id = p_poll_id and user_id = caller;

    update public.polls
       set option_counts[v_prev_index + 1]   = greatest(coalesce(option_counts[v_prev_index + 1], 0) - 1, 0),
           option_counts[p_option_index + 1] = coalesce(option_counts[p_option_index + 1], 0) + 1,
           updated_at                        = now()
     where id = p_poll_id;
  end if;

  return (
    select jsonb_build_object(
      'option_counts', option_counts,
      'total_votes',   total_votes,
      'my_vote',       p_option_index
    )
    from public.polls where id = p_poll_id
  );
end $$;

grant execute on function public.cast_poll_vote(uuid, integer) to authenticated;
