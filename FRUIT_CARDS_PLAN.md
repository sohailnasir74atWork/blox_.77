# Fruit Cards — feature plan

A port of Adopt Me's **Pet Cards** (`../adoptme-jan7/PET_CARDS_PLAN.md`, code in
`../adoptme-jan7/Code/PetCards/`, SQL 037 / 043 / 044 / 048) to Blox Fruits.
The player opens a free daily pack, collects fruits as trading cards, fills sets,
and shows them off with a profile showcase, share cards and wallpapers.

Written 2026-10-25. Status: **built and tested locally 2026-10-25, nothing deployed** (§5).

---

## 1. What carries over unchanged

All the rules from Pet Cards §1 and §9 stay:
- Packs are **never sold** and never a Pro perk (daily free pack, stars, streak only).
- The **server rolls every pack** (Supabase RPCs, `security definer`, keyed on `firebase_uid()`).
- No card trading, no free text, odds one tap away, at most one reminder a day.
- Frames, text and effects are drawn in code; only the fruit art is an image.
- Fan-made disclaimer: "not affiliated with Gamer Robot".

Same mechanics: 3-card packs with a hit slot, finish ladder, new-card bias,
Legendary pity (8 packs) and Holo pity (12), serial numbers + 1st Edition on
Holo and better, shards from duplicates, crafting missing Classic cards,
4-into-1 fusion, collector score, profile showcase, share sheet, Wallpaper
Studio, Home card.

All libraries are already in the Blox app (RN 0.87.1, mmkv, view-shot,
react-native-share, haptic-feedback, notifee).

## 2. What is different in Blox

| Topic | Adopt Me | Blox Fruits |
|---|---|---|
| Catalogue | 787 pets | **92 items** in `blox-api.b-cdn.net/data.json`: 52 fruits/gamepasses + 40 Limited (skins: Ember West Dragon, Galaxy Empyrean Kitsune, Ruby Diamond…) |
| Cards | 785 | **81** (drop the 9 gamepasses and the 2 Dragon Tokens) |
| Art | 128 px app images → 206-pet HD redraw pipeline | `bloxfruitscalc.com/.../<Name>_Icon.webp` (the Values screen's icons). **Measured 2026-10-25: only 11 of 81 are ≥512 px** (Kitsune, Dragons, Gas, Gravity, Tiger, Creation, 3 skins…); 31 are 400 px, 39 are 150–385 px (most skins 200 px). Fine on album thumbs, soft on a full-size card. Open decision (§5). |
| Rarity | Common → Legendary (5) | Common · Uncommon · Rare · Legendary · Mythical, plus **Limited** skins as their own top tier |
| Finish names | Classic, Foil, Neon, Holo, Gilded, Mega, Full Art | Classic, Foil, **Awakened**, Holo, Gilded, **Mythic Aura**, Full Art (same ladder, Blox words) |
| Fusion | 4 Classic → Neon, 4 Neon → Mega | 4 Classic → **Awakened**, 4 Awakened → **Mythic Aura** |
| Sets | Eggs, Halloween years | Fruit **type** (Natural / Beast / Logia), **rarity** (Mythical Hoard), **skin families** (Dragon, Kitsune, Pain, Lightning, Diamond, Eagle, Bomb skins) |
| Card back info | Value / Neon / Mega | Value / Permanent value / Demand / Robux / Beli / best used for |

### Small catalogue = shorter album
81 cards fill fast, so depth comes from the finishes: 81 × 7 = 567 (card, finish)
pairs for the collector score, and serial-number hunting. PGlite volume test: ~100–120
packs to own all 81 without crafting, so ~4 weeks at 4 packs a day, ~8 at 2 (crafting
shortens it). Pity and new-card bias (45%) are the same as Pet Cards.

## 3. Launch sets (proposal)

| Set | Kind | Cards |
|---|---|---|
| **All Fruits** | Pack | 83, always |
| **Beast Den** | Page | 11 Beast fruits (Dragons, Kitsune, T-Rex, Mammoth, Yeti…) |
| **Elementals** | Page | 11 Logia |
| **Natural** | Page | 21 |
| **Skin pages** | Pages | Dragon, Kitsune, Pain, Lightning, Diamond, Eagle, Bomb families |
| **Seasonal pack** | Pack + page | First one: Winter (December), like Adopt Me's `haunted26` |

## 4. Build order

| Step | What | Where |
|---|---|---|
| 1 | SQL `supabase/057_fruit_cards.sql` = 037 + 043 + 044 + 048 merged, renamed `card_*` → same names (Blox Supabase is its own project), Blox rarities and finishes; `user_cosmetics` gets `card_score` + `card_showcase`. Test on PGlite like `test037.mjs`. | Blox repo |
| 2 | Art script: download the 83 icons, resize to 1024/512/2048 webp, upload to a Bunny zone, write `index.json`; palette file for "Match my fruit". | `scripts/fruit-cards/` |
| 3 | Catalogue sync: `data.json` → `card_catalog` (stable collector numbers, sets from §3). Dry run by default. | `scripts/fruit-cards/sync-card-catalog.js` |
| 4 | Client: copy `Code/PetCards/` → `Code/FruitCards/`, swap pet words/data for fruits, Blox themes (sea / Grand Line palette instead of Adoption Island), tests copied from `__tests__/petCards.test.js`. | Blox repo |
| 5 | Wiring: App.js stack screens, Home card, profile showcase, Values "you own this card" tick, i18n keys in all Blox languages. | Blox repo |
| 6 | Device pass on the emulator with mock data (`cardsMock.js` path), then with the real server. | — |
| 7 | Deploy (owner says go): run 057, run catalogue sync `--apply`, upload art; ships in the next Blox build. Home card hides itself until the server answers. | — |

Also fix in the port the Pet Cards audit items (Pet Cards §10 "Not done"): collector
number shown as no/HD-count, repeat card inside one pack, card tables missing from the
account-delete job, stale streak display, star button ignoring the balance.

## 5. Where it stands (2026-10-25) and how to resume

Built in the working tree of `ads-v17-nextgen`, **not committed, nothing deployed.**

| Piece | Where | Checked |
|---|---|---|
| SQL | `supabase/057_fruit_cards.sql` (= Adopt Me 037+043+044+048 merged; Blox rarities `common…mythical, limited`, finishes `classic, foil, awakened, holo, gilded, aura, fullart`; fusion 4→1; 2 free packs/day; no repeat card inside a pack; `delete_user_cards` for account deletion; every function revoked from anon) | `node scripts/fruit-cards/test057.mjs` 88/88 (×3 runs) |
| Art | `scripts/fruit-cards/art.py` (download → square → 1024/512/2048 webp → Bunny, dry run unless `--apply`; `--min-source N` holds soft art out of `index.json`; `--palette` writes `Code/FruitCards/fruitColors.json`), `cards.py`, `palette.py`, `sets.json` | dry run: 81/81 built, 245 files / 28.8 MB |
| Catalogue | `scripts/fruit-cards/sync-card-catalog.js` (`--offline` needs no secrets) | offline: 81 cards; 7 C / 6 U / 4 R / 11 L / 15 M / 38 Limited |
| Client | `Code/FruitCards/*` (port of `Code/PetCards`), `Code/Helper/useDarkSystemBars.js` (status bar only: Blox has no system-navigation-bar lib), `Code/Engagement/useStarBalance.js` | `__tests__/fruitCards.test.js` 20/20, `__tests__/fruitCardsRenders.test.js` 47/47 (every rarity × finish) |
| Wiring | App.js 4 stack screens; HomeTab `FruitCardsHomeCard` (hides itself until a pack exists); profile drawer `ProfileShowcase`; `userBackend` cosmetics read `card_score`/`card_showcase` with a 42703 fallback, so a build that ships before 057 still loads profiles | full jest: only `App.test.tsx` (known baseline) fails; the two load timeouts pass alone |
| i18n | `fruit_cards` in all 11 `Code/Translation/*.json` (sources in `scripts/fruit-cards/i18n/`, merged by `merge-i18n.py`) | every key the code uses resolves in every language; no gambling words |
| Account delete | `functions/mirrorUsersToSupabase.js` `deleteAllForUser` calls `delete_user_cards` | not deployed |

Pet Cards audit items fixed in the port: number printed as `no/HD-count` (now `#no`), repeat card in one
pack (SQL + mock), card rows not deleted with the account. Values on the card back: Value / Permanent /
Demand (data.json); wallpaper trends from `diff.json` via `fetchAnalyticsData`.

### Decided (owner, 2026-10-25): launch with 400 px+ art only
`art.py --min-source` now defaults to 400, so only cards whose source icon is 400 px or more go in
`index.json` (and so get `hd_ready` from the catalogue sync). Dry run 2026-10-25: **42 of 81 cards**,
128 files / 12.8 MB to upload.
- By rarity: 6 Common, 5 Uncommon, 4 Rare, 10 Legendary, 13 Mythical, 4 Limited.
- Held out: 34 Limited skins (150–385 px) and 5 fruits: Spike (150), Yeti (151), Eagle (200),
  Lightning (200), Magnet (385).
- Skins in at launch: Crimson Kitsune, Galaxy Empyrean Kitsune, Ember West Dragon, Divine Portal.
- Album pages with cards: Natural 20, Mythical 13, Logia 10, Beast 8, Limited 4, Kitsune Skins 2,
  Dragon Skins 1. The other skin pages have no cards and stay hidden (the album lists only pages with total > 0).
- Watch: with only 4 Limited cards, the 25% Limited hit chance and the 8-pack Limited pity mean many
  duplicate skins (they pay 150 shards each). If that feels off, lower `hit.limited` for the `all`
  pack through `card_sets.odds` (no app change).
- Skins join later: when bigger art exists, re-run `art.py --apply` and the catalogue sync; new
  `hd_ready` cards enter packs with no app release.

### Open decision (owner)
1. **Bunny zone** for card art (`CARDS_CDN = https://bloxcards.b-cdn.net/v1` in `cardConfig.js` and the
   sync script is a placeholder name until the zone exists).

### Resume / deploy checklist (only when the owner says go)
1. Create the Bunny storage + pull zone; set `CARDS_CDN` if the name differs.
2. `BUNNY_STORAGE_ZONE=… BUNNY_STORAGE_KEY=… python3 scripts/fruit-cards/art.py --apply` (400 px rule is the default), purge the two index.json URLs.
3. Apply 057: `npx supabase@2.120.0 db query --linked -f supabase/057_fruit_cards.sql` (begin/commit), revert `supabase/.temp/cli-latest`.
4. `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/fruit-cards/sync-card-catalog.js` (dry) then `--apply`.
5. Deploy `mirrorUsersToSupabase` (account deletion).
6. Device pass on an emulator with a **debug** build (`python3 scripts/fruit-cards/dev-cdn.py` + `adb reverse tcp:8765 tcp:8765` for local art; the mock runs while 057 is missing).
7. Ship in the next Blox build; the Home card appears by itself once step 4 holds.
