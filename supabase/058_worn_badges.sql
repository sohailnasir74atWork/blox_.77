-- 058_worn_badges.sql — mod badge colours + custom badges on the roles row (2026-10-31)
--
-- RTDB stays the source of truth:
--   worn_badges/{uid} = { styles: { trusted|cmsr_house|cmsr_art|helper: '#hex' },
--                         custom: { <badgeId>: { color, at, by } }, customCount, updatedAt }
-- functions/mirrorWornBadges.js copies `styles` → badge_styles and `custom` →
-- custom_badges so chat rows (profileCache.getRolesBatch) get them with the
-- role flags, no extra read. NULL = nothing granted. Definitions of custom
-- badges live only in RTDB custom_badges/{id} (tens of rows, one listener).
--
-- Apply:  npx supabase@2.120.0 db query --linked -f supabase/058_worn_badges.sql
begin;

alter table public.user_roles
  add column if not exists badge_styles jsonb,
  add column if not exists custom_badges jsonb;

comment on column public.user_roles.badge_styles is 'RTDB worn_badges/{uid}/styles — MOD colour override per role badge';
comment on column public.user_roles.custom_badges is 'RTDB worn_badges/{uid}/custom — custom badges granted by MODs';

-- Sparse: only players wearing a custom badge (the leaderboard reads RTDB,
-- this is for ad-hoc queries and reconciliation).
create index if not exists idx_user_roles_custom_badges
  on public.user_roles (uid) where custom_badges is not null;

notify pgrst, 'reload schema';

commit;
