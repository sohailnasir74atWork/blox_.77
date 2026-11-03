-- 060_scan_reports_bucket.sql — Trade Scanner "Send picture" reports (2026-11-03).
--
-- Private bucket the apps upload a scanned picture + its scan JSON to, only
-- when the user taps Send picture (Code/Helper/scanReportUpload.js). Clients
-- (anon or signed in) may INSERT under blox/ only; there is no select,
-- update or delete policy, so nothing can be listed, read, replaced or
-- removed from an app. The scanner team reads with the service role
-- (Supabase dashboard / CLI). Size and type are capped on the bucket.
--
-- Apply: npx supabase@2.120.0 db query --linked -f supabase/060_scan_reports_bucket.sql

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scan-reports', 'scan-reports', false, 3145728, array['image/jpeg', 'application/json'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "scan reports: clients upload" on storage.objects;
create policy "scan reports: clients upload"
  on storage.objects for insert
  to anon, authenticated
  with check (
    bucket_id = 'scan-reports'
    and (storage.foldername(name))[1] = 'blox'
    and name ~ '^blox/[0-9a-f-]{36}\.(jpg|json)$'
  );

commit;
