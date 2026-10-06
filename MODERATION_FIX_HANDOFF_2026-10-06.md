# Moderation fix — handoff (2026-10-06)

**Status:** fixed and tested locally. **Nothing deployed, nothing committed.** Every backend change is
built to keep old app builds (4.0.12 production, 4.0.14 internal, older) working; only abuse fails.

Builds on `BAN_ENFORCEMENT_HANDOFF.md` (2026-10-05). An audit that day found the holes below; all are
fixed here.

## What was wrong (worst first)

1. **Firestore was open to anyone, signed in or not**, until 2027-03-05 (`firestore.rules` catch-all):
   trades, posts, comments, statuses, groups, reports. A banned user could skip every app ban check.
2. **A JMD could permanently ban an admin.** `syncEmailBan` took the banner from the record body and
   applied with no rank check when `bannedBy` was missing (Auth disable, devices, Supabase).
3. **Owner-email role grants didn't need a verified email** (RTDB role rules).
4. **Unban skipped the hierarchy** and the UI said "Unbanned" even when the server refused; 112
   backfilled records couldn't be unbanned server-side at all.
5. **Any signed-in user could edit/delete any public chat message and pin/unpin**; banned users could
   edit old messages (Supabase trigger was INSERT-only).
6. **~30 RTDB nodes had `.write: true` with no auth** (`api` key, `server` link, news, stock, codes…).
7. **Device-ID spoofing** could get innocent devices banned; unbans didn't stick across alt chains.
8. Inbox previews/unread counts had no ban check and could be spoofed; anyone could add themselves to
   a group's Supabase membership.
9. Banned users could still use polls, profile edits, review edits, several report paths, reactions;
   bans placed while a screen was open were missed until it was reopened.
10. Mutes acted as full bans; strike ladders disagreed (24h vs 3h); JMD limits were UI-only; mod
    actions missing from the audit log; reports unreadable by mods; sign-out kept the old ban card.

## What changed

| Area | Files | Tests |
|---|---|---|
| Firestore + RTDB rules | `firestore.rules`, `database.rules.json` (**generated** — edit `scripts/test-rules/build-database-rules.js`), `firestore.indexes.json`, `scripts/test-rules/` (`INVENTORY.md` lists every app/old-build/blox-web flow) | 462/462 — `scripts/test-rules/test.sh` (needs JDK 21+; picks Homebrew openjdk) |
| Cloud Functions | `functions/banEnforcement.js` (rewritten), `functions/index.js` (+`reconcileBanMirrors`), `scripts/backfill-ban-enforcement.js` (`--mirrors`) | 41/41 — `JAVA_HOME=/opt/homebrew/opt/openjdk@24 firebase emulators:exec --config functions/firebase.test.json --only auth,database,firestore,functions --project demo-fruiteblocks 'node functions/test/moderation.test.js'` |
| Supabase | `supabase/033_mod_actions_evidence.sql`, `supabase/034_chat_moderation_enforcement.sql` (+ `supabase/034_steps/` one file per step), `Code/Supabase/*` (report RPC, `chatErrorCode`, group-meta RPC) | 187/187 on PGlite (session scratchpad `sqltest/test.mjs`, incl. old-build replays) |
| Mod tools | `BottomDrawer.jsx`, `AdminDashboard.js`, `Code/AppHelper/{ModActionModal,ModHistoryList,EvidenceViewer,ReportsTab,StaffAccessTab}`, `ChatScreen/utils.js`, `Helper/modSanction.js`, `MessagesList.jsx`, `AdminHeader.jsx` | lint |
| App enforcement | `GlobelStats.js` (ban/mute split, `getModGate`, sign-out reset, last-known state), `ChatScreen/ChatRestrictedBar.jsx`, `Helper/{banKeys,userReports,serverTime}.js`, every content surface | lint |
| Translations | `moderation.*`, `home_tab.mute_*`, `chat.delete_*` in all 11 languages | — |

Key behaviour:
- **Server decides who acted** (`context.auth`), not the record. Unverified or out-ranked writes are
  reverted. Staff immunity: only admin/owner sanction staff. JMD: mute ≤ 2h / unmute only. Lifting or
  softening needs rank ≥ the original banner.
- **Mutes are chat-only** (no devices, no Auth disable, strike count kept). `type: 'ban'|'mute'` on
  records; one legacy-detection rule shared by app (`Helper/banKeys.js`) and server (`recordType`).
- **Firestore ban mirror** `banned_uids/{uid}` (bans only) — rules use it on every create/update.
- **Devices:** bans spread only to devices seen before the ban; cap 5; shared/emulator ids ignored;
  per-device `banners` set so one unban can't free another account's device. Clients can't touch
  server-managed device records.
- **Reconcile** every 6h fixes Supabase `banned_senders` and the Firestore mirror.
- **Reports:** reasons are kept; trade/post/status/scam reports go to Firestore `user_reports`; chat
  reports via `report_message` RPC (one per reporter); dashboard Reports tab reads all sources.
- New: reason prompt on every action, per-user moderation timeline, Staff Access tab, Mute filter,
  restricted chat bar with time left, clear banned/muted/links errors.

## Deploy order (needs the owner's go-ahead)

1. **Supabase** (SQL editor, one query each): `033`, then `034` STEP 0 (check) and STEPs 1–8
   (`supabase/034_steps/`). Rollback blocks are at the end of both files.
   `035_message_reactions.sql` belongs to another session's work — not part of this.
2. **Evidence-upload secret** (once): `firebase functions:secrets:set BUNNY_STORAGE_KEY --project fruiteblocks`
   and paste the storage key of Bunny zone `post-gag` (the one the app already uses for post images).
3. **Functions:**
   `firebase deploy --only functions:modSanction,functions:modEvidenceUpload,functions:syncEmailBan,functions:indexDeviceAccount,functions:indexLegacyDeviceAccount,functions:banCheckOnSignup,functions:tombstoneDeletedAccount,functions:reconcileBanMirrors --project fruiteblocks`
4. **RTDB rules:** `firebase deploy --only database --project fruiteblocks`
5. **Backfill:** `node scripts/backfill-ban-enforcement.js --mirrors` (dry run, read output), then
   add `--write` (with `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` set).
6. **Firestore rules + indexes:** `firebase deploy --only firestore --project fruiteblocks`
   (no `--force` on indexes — the file may not list every live index).
7. **App build** with the new client code.

Until step 5 the Firestore `isBanned()` check is simply false (harmless).

**Evidence screenshots** (`functions/modEvidenceUpload.js`): staff-only HTTPS function; the app sends
a compressed image, the server checks staff rank, image type (magic bytes) and size (≤ 1.5 MB), limits
30 uploads/hour per mod, and stores it at `mod-evidence/{uid}/…` in Bunny zone `post-gag` with the key
from Secret Manager. Uploads run on Confirm, before the sanction; a failed upload applies nothing.
Tested in the emulator suite (42/42). The app's post/chat uploaders still embed the same Bunny key —
moving those to the server too and rotating the key is a worthwhile follow-up.

## Old-build flows that change (by policy)

- Senior mod sanctioning a mod / mod sanctioning a JMD (staff immunity) → reverted.
- A mod unbanning a higher rank's ban → record restored, though the old app still says "Unbanned".
- JMD muting over an active strike → reverted.
- Old perm-ban-all silently skips staff alts.
- 4.0.10 non-staff can no longer read others' ban records → the "banned" chip on profiles disappears.
- Group creator (non-staff) deleting a group: the bulk soft-delete of others' messages is refused;
  the group itself is still deleted, so nobody sees a difference.

## Risks / open items

- **External writers:** `news`, `stock`, `codes`, `api`, `server`… are now admin/Admin-SDK only. If
  any script outside this repo writes them **without auth**, it will stop working. Console and
  Admin-SDK writes are unaffected.
- **Evidence screenshot upload not built.** The viewer and storage are done; the upload helper was
  blocked because it would copy the Bunny write key into a new client file. Needs an owner decision
  (reuse the existing uploader, or a server-signed upload).
- Supabase staff checks read `user_roles`, which can lag role changes by up to 6h.
- Group self-membership in Supabase is reduced but not closed: membership lives in Firestore; a
  function mirroring `groups/{id}.memberIds` into Supabase would close it.
- Nothing was tested on a device with real accounts. Smoke test: ban, mute, expiry, unban by a lower
  rank, sign-out → sign-in as another account, offline start, report from each surface, Staff Access.
