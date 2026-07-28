# Value-Change Push Alerts — Setup Guide

Users get a push notification when an item **in their My Stuff (owned or
wishlist)** changes value.

---

## ⭐ MM2 QUICK START (polling mode — do this first)

MM2 needs NO Supabase migration: the app only uses Firebase (FCM topics,
already wired in the app code). Supabase here is just the robot that checks
your CDN file — use your existing Supabase account; the MM2 app never talks
to it. Your upload routine does not change at all.

1. **SQL Editor** → run `migration.sql` (creates the `value_changes` log).
2. **Storage** → New bucket → `value-snapshots` → private.
3. **Terminal:**
   ```bash
   cd /Volumes/Sohail/AI_Projects/Blox_Fruit/supabase-value-alerts
   supabase functions deploy value-alerts --project-ref YOUR_REF
   ```
4. **One secret** (MM2's Firebase project → ⚙️ Settings → Service accounts →
   Generate new private key):
   ```bash
   supabase secrets set FIREBASE_SA_MM2="$(cat ~/Downloads/your-mm2-key.json)" --project-ref YOUR_REF
   supabase secrets set WEBHOOK_SECRET="any-long-random-string" --project-ref YOUR_REF
   ```
5. **Schedule it** — Dashboard → Database → Extensions → enable `pg_cron`
   and `pg_net`, then run in SQL Editor (fill in REF + secret):
   ```sql
   select cron.schedule(
     'value-alerts-poll',
     '*/15 * * * *',
     $$
     select net.http_post(
       url := 'https://YOUR_REF.functions.supabase.co/value-alerts?poll=1',
       headers := '{"x-webhook-secret": "any-long-random-string"}'::jsonb
     );
     $$
   );
   ```
6. Done. Every 15 minutes the function fetches
   `https://mm2-api.b-cdn.net/mm2values.json`, compares with its snapshot,
   and pushes to holders of changed items. First run is silent (saves the
   snapshot). Upload your values file wherever you always do — nothing
   changes for you.

**Test:** after the first silent run, change ONE item's value in your file,
upload as usual, wait ≤15 min → the push lands on any device whose My Stuff
contains that item. Watch runs in Dashboard → Edge Functions → value-alerts
→ Logs.

---

## Webhook mode (later, for apps whose values file lives in Supabase Storage)

Your daily routine stays exactly the same:
delete the old values file in Supabase Storage, upload the new one — the
rest is automatic.

```
You upload new values file ──► storage webhook ──► value-alerts function
                                                    │  diff vs snapshot
                                                    ├─► value_changes table (log)
                                                    ├─► FCM topic pushes (only item holders)
                                                    └─► Bunny CDN purge (optional)
```

## One-time setup (~15 minutes)

### 1. Edit the config in `functions/value-alerts/index.ts`
At the top of the file, set your real file names:
```ts
const FILE_GAME_MAP = {
  "mm2values.json": "mm2",     // ← your MM2 values file basename
  "data.json": "blox",         // ← your Blox Fruits file basename
  "adoptme.json": "adoptme",   // ← your Adopt Me file basename
};
```
If a game has TWO source files (MM2 + Supreme), map **only the primary one**
— mapping both would send two alerts per item.

### 2. Create the table
Supabase Dashboard → SQL Editor → paste and run `migration.sql`.

### 3. Create the snapshot bucket
Dashboard → Storage → New bucket → name: `value-snapshots`, **private**.

### 4. Deploy the function
```bash
cd supabase-value-alerts
supabase functions deploy value-alerts --project-ref <YOUR_PROJECT_REF>
```

### 5. Set the secrets  (do this yourself — never share these keys)
For EACH app's Firebase project: Firebase Console → Project Settings →
Service accounts → Generate new private key → download the JSON, then:
```bash
# one per app (per Firebase project):
supabase secrets set FIREBASE_SA_MM2="$(cat mm2-service-account.json)" --project-ref <REF>
supabase secrets set FIREBASE_SA_BLOX="$(cat blox-service-account.json)" --project-ref <REF>
supabase secrets set FIREBASE_SA_ADOPTME="$(cat adoptme-service-account.json)" --project-ref <REF>
# (if all three apps share ONE Firebase project, set just this instead:)
# supabase secrets set FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" --project-ref <REF>

# optional, enables instant CDN refresh:
supabase secrets set BUNNY_API_KEY="<your bunny api key>" --project-ref <REF>
# optional but recommended:
supabase secrets set WEBHOOK_SECRET="<any long random string>" --project-ref <REF>
```

### 6. Create the webhook
Dashboard → Database → Webhooks → Create:
- Table: `storage.objects`
- Events: **INSERT** and **UPDATE**
- Type: HTTP request → POST → your function URL
  (`https://<REF>.functions.supabase.co/value-alerts`)
- If you set WEBHOOK_SECRET: add HTTP header `x-webhook-secret: <same string>`

## How it behaves

- **First upload after setup**: silent — it just saves the snapshot
  (nobody gets spammed with "everything changed").
- **Normal daily upload**: only items whose value actually differs
  produce a log row + one topic push each.
- **Re-upload the same file**: zero diffs, zero pushes. Fixing one wrong
  value and re-uploading alerts only that item's holders. Safe to repeat.
- Uploads of any file NOT in `FILE_GAME_MAP` (images, other JSON) are
  ignored instantly.

## Test it

1. Upload your current values file → check the function logs
   (Dashboard → Edge Functions → value-alerts → Logs): should say
   `changes: 0` (first run saves snapshot).
2. Edit ONE item's value in the file locally, upload again → logs should
   show `changes: 1, pushed: 1`.
3. On a device with the app: add that item in **My Stuff**, repeat step 2
   with another value → the push arrives.

## App side (already wired in MM2)

- `Code/Helper/valueAlerts.js` — subscribes/unsubscribes FCM topics
  (`val_<game>_<slug>`) to mirror the user's My Stuff list.
- `MyStuffScreen.jsx` — calls `syncValueAlertTopics()` whenever the
  owned/wishlist lists load or change.
- The slug function in the app and in the Edge Function MUST stay
  identical — it is the topic-name contract.
- Porting to Blox Fruit / Adopt Me = copy the helper (change `GAME`), call
  it from their portfolio screens.

## Costs / limits

- FCM topics: free, unlimited subscribers, no server-side subscriber list.
- Edge Function: runs only when you upload (once a day) — negligible.
- Per-device topic cap is 2000; the helper caps portfolio topics at 300.
