# Bunny upload key: server-side uploads and rotation (2026-10-19)

## Problem

The post-gag storage zone's full read/write password was compiled into the
app in ten files. Anyone who unpacks the APK/IPA can upload, overwrite or
delete any file in post-gag: every app's avatars, posts and chat images,
all served from `pull-gag.b-cdn.net`. The same password is also in the public
GitHub history of this repo, so treat it as already leaked. Only rotation
makes that harmless.

## What changed

- `functions/uploadImage.js`: new v1 HTTPS function. It needs a Firebase ID
  token (revocation checked, so a disabled account is refused) and takes
  `{ kind, data }`. It checks the bytes (jpeg/png/webp only) and the size
  (3 MB, avatars 1 MB). It refuses an active ban (`banned_uids/{uid}` or the
  email record), except for complaint screenshots, so a ban appeal still
  works. A mute refuses only chat and DM images. Poll images need staff (JMD+).
  Each user gets 60 uploads per hour, staff (JMD+) 300; the counter is
  `upload_quota/{uid}`, server-only, and rank is only read once a caller hits
  60. The function picks the path itself, using the same folders and file-name
  patterns as before, PUTs to post-gag with the `BUNNY_STORAGE_KEY` secret and
  returns the pull-gag URL.
- `Code/Helper/imageUpload.js`: `uploadImage(uri, kind)` for the app. It
  recompresses an image over 2 MB, or one that is not jpeg/png/webp (HEIC,
  GIF), to JPEG before sending.
- The key is removed from all ten client files. Each uploader keeps its own
  progress and error UI: `Design/componenets/UploadModal.js` (post),
  `Design/StatusFeed.js` (status), `ValuesScreen/ScammerDatabaseScreen.js`
  (scammer), `AppHelper/AdminDashboard.js` (poll),
  `SettingScreen/Setting.jsx` (avatar), `ChatScreen/GroupChat/GroupMessageInput.jsx`
  (chat), `GroupsScreen.jsx` and `CreateGroupModal.jsx` (group icon),
  `ChatScreen/PrivateChat/PrivateMessageInput.jsx` (dm), and
  `Helper/reportImageUpload.js` (report).
- The app never deleted Bunny files, so there is no delete endpoint.
- Staff evidence stays on `modEvidenceUpload`, which already used the secret.

Secret check (2026-10-19, values compared in memory, nothing printed):
`BUNNY_STORAGE_KEY` v1 on `fruiteblocks` (2026-10-06) is the post-gag key, so
it covers this zone. No new secret is needed.

## Rollout order

1. **Deploy the function by name** (the secret is already set):
   `firebase deploy --only functions:uploadImage --project fruiteblocks`
2. **Smoke-test** each kind on an internal build: feed post, DM image, avatar,
   status, group chat image, group icon (create and edit), scammer proof,
   poll image, complaint screenshot. Each returns
   `https://pull-gag.b-cdn.net/<same folder as before>/…`.
3. **Ship the app build** (Android and iOS). Step 1 must come first: a new
   build without the function deployed loses every image upload.
4. **Wait** (see below).
5. **Rotate only when every other holder of the post-gag password is off it
   too.** It is one zone with one password. The MM2 app moved on 2026-10-11.
   Adopt Me, Fisch, Steal an Egg, adoptme-web and blox-web still embed it, and
   adoptme-jan7 `functions/cleanupGroups.js` / `cleanupOldPosts.js` and MM2WEB
   (env and CI) hold it on the server side. The full list is in
   `mm2values/docs/BUNNY_UPLOAD_ROLLOUT_2026-10-11.md`. Rotating for Blox alone
   breaks all of their uploads.
6. **Rotate** (owner, at low traffic): Bunny dashboard → Storage → post-gag →
   FTP & API Access → reset password. Then, right away:
   `firebase functions:secrets:set BUNNY_STORAGE_KEY --project fruiteblocks`
   and `firebase deploy --only functions:uploadImage,functions:modEvidenceUpload --project fruiteblocks`.
   v1 functions pin the secret version at deploy, so both must be redeployed.
   Do the same for MM2 (`mm2vlaues-ed80c`, `uploadImage`) and every other
   server-side holder. Uploads fail between the reset and the redeploy.
7. **Verify**: an upload from the new build works, an old build's upload shows
   its "upload failed" alert, and mod evidence still uploads.

## How long to wait (step 4)

The app cannot force an update:

- Android (`Code/AppHelper/InAppUpdateCheck.js`, called once per cold start
  from `App.js`) starts a Play in-app update of type IMMEDIATE whenever Play
  offers one. The player can back out of it, and Play only offers it to
  players inside the staged-rollout fraction.
- iOS shows an alert with "Later" once per cold start when the App Store
  version is newer.
- There is no server-side minimum version.

Measured tail: in the 7 days to 2026-10-11, build 161 (superseded) still had
22,152 Android users against 8,930 on the newer 168. A large share of players
take weeks to update, and some never do.

Suggestion: rotate when Crashlytics shows **≥ 90 % of 7-day users on the new
build or later, on both Android and iOS**, and **no sooner than 3 weeks after
the Android build reaches 100 %**. Expect 4 to 6 weeks in total. Check weekly
in Crashlytics (users by version). Because the password is already public,
don't wait for the last 10 %. After rotation those players lose image uploads
(each screen shows its existing error, and text still sends), and nothing
else breaks.

## Impact on old builds

None until rotation: they keep PUTting to Bunny directly and their URLs keep
working. After rotation their image uploads fail with their existing alerts.
`modEvidenceUpload` and every existing CDN URL are unaffected.
