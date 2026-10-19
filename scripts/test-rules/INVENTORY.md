# Firestore + RTDB access inventory (2026-10-06)

This is every read and write that the rules must keep working. It was built by grepping
`Code/`, `App.js`, `index.js`, `functions/` and blox-web (`RunningWebsites/blox-web/src`) at
these points:

| Build | Commit |
|---|---|
| Current working tree (next build) | `api53` + uncommitted |
| 4.0.14 (163, internal) | `895c15a` |
| 4.0.13 (162) | `4d6a6f3` |
| 4.0.12 (161, production) | `59bead7` … `b96b294` (all 161) |
| 4.0.10 (159) | `60bc59a` |
| Pre-Supabase chat (May 2026) | `682e16d` |
| Mar 2026 | `185c622` |
| Jan 2026 | `4caf6ca` |
| Oct 2025 | `6e55f3a` |

The app has no forced update, so every one of these may still be installed.

Cloud Functions use the Admin SDK, which bypasses rules. Only *client* access is listed here.
"Staff" means JMD and above. "Mod+" means moderator, senior mod, admin or owner. "Owner" means a
**verified** owner email; every owner-email check in both files now requires
`email_verified`.

Tests: `./test.sh` runs 460 checks against throwaway emulators. Every row below has at least one
ALLOW test, using the exact write shape, and the matching abuse DENY tests.

## How the rules are built

- `firestore.rules` is written by hand. The catch-all is gone, so any collection not listed is
  denied.
- `database.rules.json` is **generated** by `build-database-rules.js`, because RTDB rules have no
  functions and the rank expressions repeat about 100 times.
  - Edit the generator, run it, then commit both files.
  - `test.sh` fails if the JSON and the generator differ.
  - Nodes the generator doesn't list are kept exactly as they were.

---

## Firestore

All listed reads that were public stay public. The website renders trades, posts, reviews and the
scammer list signed out, and the app's feeds work for guests.

| Collection | Writers / fields (create · update · delete) | Queries the rules must satisfy | Notes |
|---|---|---|---|
| `trades_new_upgrade` | **create:** owner (`userId`). Full HomeScreen shape. Web `createTrade`.<br>**update:** owner, any field except `userId` (boost `isFeatured`/`featuredUntil`; web `updateTrade`). Anyone signed in may set `reportCount` +1 (ReportTradePopUp, all builds).<br>**delete:** owner (Trades, Settings "delete all" batch) or staff (admin Delete Profile sweep) | `userId==`; `isFeatured==`/`status`/`timestamp>`; `hasItemNames array-contains`; `featuredUntil>` | Ban check on create, owner edits and report bumps |
| `trades_new` (legacy) | Same as above | Same | Builds up to Mar 2026 |
| `designPosts_upgrade` | **create:** owner. App shape; pre-round-2 builds add `email`; web adds `commentCount: 0`.<br>**update:** owner, any field except `userId`. Others may change only: their own `reactions.{uid}`/`likes.{uid}`, `commentCount` +1 (CommentsModal, web), `reportCount` +1, `report: true`, `banned: true` (ReportModal transaction).<br>**delete:** owner or staff (PostCard delete / "delete all") | `userId==` + `createdAt`; `selectedTags array-contains` | Ban check on all non-staff writes |
| `designPosts_upgrade/*/comments` | **create:** `userId == me`. App `{userId, displayName, avatar, text, createdAt}`; web `{userId, userName, userAvatar, text, timestamp, isReported}`.<br>**delete:** author, staff or post owner | `orderBy createdAt` | Ban check |
| `designPosts` (+comments, legacy) | Same as `_upgrade` | Same | Builds up to Mar 2026; `notifyPostComment` reads it |
| `statuses` | **create:** owner (`userId`), text/image/themed/poll.<br>**update:** owner. Others may only: add themselves to `viewedBy` (allowed while banned); set/remove their own `reactions.{uid}`; add/move their own uid in `pollVotes.{0..5}`.<br>**delete:** owner or staff (AdminDashboard) | `expiresAt>` + `orderBy expiresAt`; `userId in [..]` | |
| `reviews` | Unchanged except `!isBanned()` on create/update. The "must have chatted" bar is server-side (`scoreReviewOnWrite`, noChat HARD since 2026-10-19).<br>`{to}_{from}` review by its author; `reviews/{uid}` profile doc (bio, ownedPets) by its owner.<br>**delete:** admin/owner; Senior Mod (2026-10-19) only for a review by someone strictly below them, not about themselves, not a profile doc (moderators until 2026-10-18) | `toUserId==` (+`rating==`, `orderBy updatedAt`); `fromUserId==` | |
| `user_ratings_summary` | **Server-kept since 2026-10-19** (`scoreReviewOnWrite`, from the scored reviews; no-chat, self and forged reviews left out). Builds before that (and the old website) still recount the REVIEWEE's `{count, averageRating, updatedAt}` after a review: **refused**, they swallow the error.<br>Staff may write it (old builds' review delete decrements it) but never add or change `serverValue`, the server's stamp; `guardRatingSummary` restores the server value | `orderBy count` (web) | Was: reviewer-writable with `count` +0/+1, which let a reviewer write any average. Reviews without a real chat (both 2+ private messages) are checked server-side, not in rules |
| `user_profiles` | Owner `setDoc(merge)` (`ownedFruits`, journal profile).<br>**delete:** owner or staff | Single-doc `get` by uid only | `list` is staff-only |
| `following` | **create:** `followerId == me`, `followingId != me` (StatusFeed `addDoc`, BottomDrawer `setDoc(auto-id)`).<br>**delete:** follower or staff.<br>No updates | `followerId==` (+`followingId==`); count by `followingId==` | Ban check on create |
| `notifications` | **create:** `fromUid == me` (trade ping).<br>**update:** recipient, `read` only.<br>**delete:** recipient, sender or staff | `toUid==` + `orderBy createdAt`. The admin sweep also uses `fromUid==` | Ban check on create |
| `user_activity` | **create:** `userId == me` (web, pre-May builds).<br>**read/delete:** any signed-in user (old builds list friends' items and delete the ones seen) | `userId in` | Kept loose for old builds |
| `groups` | **create:** `createdBy == me` and the creator is in `memberIds`.<br>**update:**<br>- Creator, or a member with role admin: anything (rename, avatar, description, remove member, approve request, transfer `createdBy`, leave as creator).<br>- Any member: only their own entry in `memberIds`/`members`, plus `memberCount`/`updatedAt` (accept invite, leave). Joining needs no ban; leaving is always allowed.<br>- Staff.<br>**delete:** creator/admin, staff, or the last member | `isActive==` | Group chat itself is Supabase |
| `group_invitations` | **create:** `invitedBy == me`.<br>**update:** invitee, `status` only; or inviter/staff.<br>**delete:** inviter, invitee, staff, the group creator, or anyone once the group doc is gone (delete-group sweep) | Creators check other users' pending invites: `groupId==`+`invitedUserId==`+`status==`. Also `invitedUserId==`; `groupId==` | **read:** any signed-in user, as before |
| `group_join_requests` | **create:** `requesterId == me`.<br>**update:** `creatorId`, requester, staff, or the current group creator (status fields).<br>**delete:** same people, or anyone once the group is gone | `creatorId==`/`requesterId==`/`groupId==` + `status==` | |
| `chat_reports` | **create:** `reportedBy == me`, `status 'pending'`, `chatKey` contains me (Scamwarning, all builds).<br>**update/delete:** staff (AdminDashboard, ReportsTab) | Reporter's dedupe check: `chatKey==`+`reportedBy==`+`status==`. Staff: `orderBy createdAt` | Reporter may read their own |
| `user_reports` (**new**, contract §9) | **create:** exactly `{type, targetId, targetUid?, reporterUid==me, reason≤200, text?≤1000, createdAt==request.time, status:'open'}`.<br>**update:** staff, only `status/reviewedBy/reviewedAt`.<br>**delete:** admin | Staff: `orderBy createdAt`. Two composite indexes added | Matches `Code/Helper/userReports.js` |
| `scammerSummaries` | **create:** `status:'unverified'`, `reportCount:1`.<br>**update:** anyone `reportCount` +1 and `updatedAt`; staff verify.<br>**delete:** staff | `orderBy reportCount`; `reportedUsername_lc` prefix | App + web transaction |
| `scammerDetails` | **create:** `reporterUid == me`.<br>**update/delete:** staff | `get` | |
| `userRateLimits` | Owner only; `{lastReportAt: Timestamp}`. It may only move forward and can't be deleted, so it can't be reset | own `get` in the transaction | The 24 h window is still checked by the client |
| `games` | Owner `setDoc(merge)` | Legacy leaderboard fallback lists the collection `orderBy *Best*` | **read:** public |
| `game_scores/{game}/scores/{uid}` | Owner, `{score, username, avatar, updatedAt}` | `orderBy score` | |
| `game_leaderboard_cache` | Any signed-in player rewrites the top-20 doc (`updateLeaderboardCache.js`). Shape-checked: ≤20 users, those 4 keys, matching `gameId` | `get` | **Kept loose:** client-maintained by design |
| `game_stats` | Owner (`awardGameWin` uses the winner's own uid in every build).<br>**delete:** staff | `get` | |
| `fruitGuessingGame_rooms` | **create:** `hostId == me`.<br>**update/delete:** any signed-in user (players join, scores) | `get`/listen | Same as Adopt Me |
| `fruitGuessingGame_userInvites/{invitee}/invites` | **create:** `fromUserId == me`.<br>**read/update/delete:** invitee or sender | | |
| `cosmetics_inventory` | Staff delete only (admin sweep). Nothing writes it | | Was covered by the catch-all |
| `leaderboard_cache`, `review_scores`, `staff` | Server only. Unchanged | | |
| `review_verified_summary` | Staff may toggle the hold. Unchanged | | |
| `banned_uids` (**Firestore mirror**, contract §5) | Server only. **read:** own doc or staff | | `isBanned()` reads it |

**Ban check:** `isBanned()` = `banned_uids/{me}` exists and (`permanent == true` or
`until > request.time`). It applies to create and own-edit of trades, posts, comments, statuses
(reactions and votes), reviews and the profile doc, the rating summary, user_profiles, following,
notifications, groups (create/join), invitations, join requests, chat_reports, user_reports, the
scammer DB and report counters.

Deletes, leaving a group, marking notifications read and viewing a status are never blocked.

## RTDB

| Node | Who writes / shape | Rule now (was) |
|---|---|---|
| `users/{uid}` | Owner: whole-record `set` (new user, web first sign-in), `update` of own fields, own delete. These fields can't be self-set: `isAdmin admin isSeniorMod isModerator isBabyMod isTrusted isGrinder isRaider isMod owner`. | Owner (was owner, but `$other` let **anyone** write any non-role field of anyone) |
| `users/{other}/…` (cross-user) | **Role flags:** as before, plus `email_verified`. Granter `jmd_granters/{me}` may set `isBabyMod` on ordinary users, never on self. `isTrusted/isGrinder/isRaider` mod+. `isMod` admin only; `owner` nobody.<br>`rolesUpdatedAt` (stamped next to every role change): mod+ or granter.<br>`badges/{id} = true` (influencer on follow, fiveStar on review): any signed-in user, set-to-true only.<br>`counters/{name}` (reactionCount): any signed-in user, +1 only.<br>`createdAt`: back-filled once by the profile drawer, only if missing and the record is live.<br>Whole-record delete: admin (Delete Profile), never another admin. | **M1** |
| `users/{uid}/deviceId`, `users_private`, `_serverTime`, `email_prefs`, `presence/{uid}`, `fruitCrash/cashouts/{uid}` | Owner. Admin may also delete `presence` | Unchanged + admin sweep |
| `jmd_granters/{uid}` | Admin/owner sets `true` / `null` (StaffAccessTab).<br>**read:** own entry, or staff list | New (had no rule → denied) |
| `banned_users_by_email/{key}` | Mod tools: strikes/bans `{…, userId, bannedBy:{uid,…}}` (setUserStrike/banUserwithEmail/writeEmailSanction); mutes with `bannedBy:'<uid>'` (old) or `{uid}` + `type:'mute'` (new); `update {deviceId, deviceIds}` (mirrorBanToDevice); unban `set null`. 2025 builds wrote `{strikeCount, bannedUntil, reason}` with no `bannedBy`/`userId`. | **H2**, see below |
| `banned_devices/{id}` | Mod+ mirror of strikes/bans (`userId`, `bannedBy` object), unban `null`. Guests read their own id | Mod+, same hierarchy; JMD never (was any staff) |
| `banned_users_by_email_post/{key}` | Only Oct-2025 builds' feed ban (no `bannedBy`/`userId`); nothing reads it now | Mod+ only, never your own key; own-key read (was any signed-in writer, public read) |
| `banned_uids` | Server. `.indexOn` now includes `emailKey` | Unchanged |
| `tradeReports/{push}` | Every build: `{tradeId, reportedBy, reason, timestamp}`. New build falls back to it. Staff mark reviewed `{status, reviewedBy, reviewedAt}` (ReportsTab) | Signed-in create-only, `reportedBy == me`; staff may update but not change the reporter; staff read (was open read/write) |
| `reports` | Unused | Staff read, write false |
| `withdrawals/{uid}/{id}` | Owner create-only (MyPurchases; the screen is dead in 4.0.12+) | Owner create + admin; read own/staff (was open) |
| `submissions/{task}` | SocialMedia: `{userId: me, …}` create (dead in 4.0.12+) | Create-only as yourself; admin. Read admin/own (was open) |
| `news_feedback/{push}` | News screen, guests included: `userId 'anonymous'` or own uid | Create-only, shape-checked (was open write) |
| `player_feedback/{push}` + `player_feedback_last/{uid}` | More ▸ Complaints & ideas (builds since 2026-10-07): own uid, status 'open', server time, one a minute via the stamp; category free text ≤30 (incl. `ban_appeal`); 2026-10-18 builds add `reviewId` + `reviewedUserId` on "Report review" (and retry without them, ids in the text, if the rule refuses) | Create-only as yourself; staff read, mods+ status/delete; `$other` refused |
| `like_counter/{id}` | Wallpaper likes/downloads, guests included: `{likes, dislikes, downloads}` | **Kept open** but shape-checked (numbers only, no delete) |
| `mod_votes_by_user/{me}/{mod}` | Own vote ±1 | Owner (was open) |
| `mod_votes_summary/{mod}` | `{ups, downs}` computed by the client in the same multi-path update | Only alongside a real change of your own vote; non-negative numbers. **Kept loose:** the client sends stale totals, so the values aren't bounded |
| `savedTrades/{me}`, `tradeJournal/{me}`, `tradeStats/{me}`, `reward/{me}`, `notifier/{mode}/{me}`, `notifier_index/{mode}/{item}/{me}`, `activeChats/{me}`, `activeGroupChats/{g}/{me}`, `bannedUsers/{me}` | Owner. Admin may delete for the Delete Profile sweep | Owner (all were open) |
| `tradeAcceptors/{trade}/{me}` | May-2026 builds set their own entry; the trade owner clears the whole node | Own entry; whole-node delete by any signed-in user |
| `chat_meta_data/{me}/{partner}` | Own inbox rows (InboxScreen unreadCount reset). Web fallback and pre-May builds also update `chat_meta_data/{partner}/{me}` | Own node, or your own row under a partner. Read own (was open) |
| `group_meta_data/{me}` | Own leave cleanup | Owner. Read own (was open). Pre-May fan-out to other members' rows now fails, but those builds' group message write already fails first (bodies locked 2026-10-05) |
| `private_messages/{a_b}` | Participants: `trade`, `lastRead/{me}`, `unread/{me}`. `messages` stays locked | **read/write:** participants only (was public read, open `$other` write) |
| `group_messages` | Write-locked already | Read now needs sign-in (was public) |
| `private_chat`, `private_chat_new` | Unused in every build | Locked |
| `pin_messages` | Oct-2025 builds: admins pin | Mod+ write (was open); public read |
| `ratings/{rated}/{rater}`, `averageRatings/{uid}` | 2025 builds' rating system | Own rater key / shape-checked, signed in (was open) |
| `api server news stock codes fruit_data free_translation single_offer_wall pic_numbers storeItems background hd winners ios_version` | No client writer in any build (console / Admin SDK) | Admin/owner only (was open). Reads unchanged |
| `xlsData appVersions enrole previous_enrole online_users freeTradeUsed lastChecked testing featuredCounts prize noman_app_version waqas_app_version tradeAcceptNotifications reports mod analytics reviews` | No client writer anywhere (`analytics` is written by a function) | `false` |

### Ban records (`banned_users_by_email/{key}`)

**Create / update** requires all of:

- `bannedBy.uid == me` or `bannedBy == me`.
- Never your own email key or your own `userId`.
- Writer strictly outranks the `userId` target, with staff immunity: a JMD+ target needs an
  admin/owner writer.
- A JMD writer may only write mute-shaped records: `bannedUntil` ≤ now + 2 h (+5 min clock slack),
  no strike increase, `type` absent or `'mute'`. The reason text is not required, because old
  builds send custom reasons.
- Replacing an **active** record with a softer one requires rank ≥ the original banner
  (`bannedBy` uid), or admin/owner. A JMD may only replace mutes.
- `userId` is required except for admin/owner.

**Delete** (unban/unmute) requires the writer to outrank the target, and admin/owner or rank ≥ the
original banner. A JMD may only lift mutes. Records with no `userId` (legacy) can be lifted by
mod+ only.

**Reads:** your own key (raw and lowercased spellings, which is what GlobelStats and the website
read) or staff. Listing is staff-only.

**Old-shape exception (compatibility):** Oct-2025 builds write `{strikeCount, bannedUntil, reason}`
with no `bannedBy` and no `userId`. This shape is accepted from **mod+ only**, and only when the
existing record has no `userId` either.

- The rules can't check hierarchy for this shape, because there is no uid to look up.
- `syncEmailBan` resolves the uid by email and today escalates without a hierarchy check when
  `bannedByUid` is null. See "Needs" in the report.

## Old-build flows that now fail, and why

| Flow | Builds | Effect |
|---|---|---|
| Non-staff user reads someone else's ban record (BottomDrawer `checkBanStatus(selectedUser.email)`) | 4.0.10 and older | The read fails. The helper catches it and reports not banned, so the drawer just hides the "banned" chip for non-staff. Staff still see it |
| Report-threshold auto-ban written by the **reporter's** client (ReportPopUp/ReportModal) | ≤ Mar 2026 | Already denied by the deployed 2026-10-05 rules (staff-only ban writes). That was the abuse vector |
| Pre-May builds fan out group/DM metadata to other members' RTDB rows | ≤ May 2026 | Those builds' message-body writes are already locked, so the send fails before the metadata write |
| Mod uses the new client's email-only fallback (`writeEmailSanction`, `userId: null`) | next build | Denied for non-admins (contract: `userId` required). Admins/owners still work; mods must go through `modSanction` by uid |
| Guest likes a status/post, or writes anything to Firestore | all | Every write already required a signed-in user in the UI |
