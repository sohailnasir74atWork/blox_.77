# Notifier Index Setup Guide

## Overview
The notifier system now uses a reverse index (`/notifier_index/{side}/{itemKey}/{userId}`) to optimize cloud function queries. This reduces data download from ~18 MB to ~1 MB per trade (95% reduction).

## Index Structure

### Current Data Structure:
```
/notifier/buy/{userId}/{itemKey} = itemName
/notifier/sale/{userId}/{itemKey} = itemName
```

### New Reverse Index:
```
/notifier_index/buy/{itemKey}/{userId} = true
/notifier_index/sale/{itemKey}/{userId} = true
```

This allows the cloud function to query by item name instead of downloading all users' notifier data.

---

## Setup Steps

### 1. Deploy Database Rules (REQUIRED)

**Files:** `database.rules.json`, `firebase.json`

**Deploy:**
```bash
firebase deploy --only database
```

**What it does:**
- Allows authenticated users to write to `/notifier_index/{side}/{itemKey}/{userId}` for their own userId
- Allows authenticated users to read index entries (needed for cloud function)
- **This is REQUIRED** - without this, you'll get permission denied errors

**Important:** If you have existing database rules, you may need to merge them with the new rules. Check your Firebase Console → Realtime Database → Rules tab to see current rules.

---

### 2. Deploy Migration Script (One-Time)

**File:** `functions/migrateNotifierIndex.js`

**Deploy:**
```bash
firebase deploy --only functions:migrateNotifierIndex
```

**Run Migration:**
After deployment, call the HTTP function:
```bash
# Get the function URL from Firebase Console
curl https://YOUR-REGION-YOUR-PROJECT.cloudfunctions.net/migrateNotifierIndex
```

Or visit the URL in your browser.

**What it does:**
- Scans all existing `/notifier/buy` and `/notifier/sale` data
- Creates reverse index entries for all existing items
- Runs once to migrate historical data

---

### 3. Deploy Optimized Cloud Function

**File:** `functions/notifyFromTrade_optimized.js`

**Action:**
Replace your existing `functions/notifyFromTrade.js` with the optimized version, or update it with the optimized code.

**Deploy:**
```bash
firebase deploy --only functions:notifyFromTrade
```

---

### 4. Client-Side Auto-Indexing (Already Implemented)

**File:** `Code/Trades/Notifier.js`

**What it does:**
- Automatically creates index when new items are added (line 108, 117)
- Automatically removes index when items are removed (line 123, 138)
- **Backward compatibility:** Creates indexes for existing items when loaded (lines 84-115, 122-145)

**No action needed** - This is already implemented and will automatically create indexes for:
- New items (immediate)
- Existing items (when user opens notifier screen)

---

## How It Works

### When User Adds Item:
1. Stores: `/notifier/buy/{userId}/{itemKey}` = itemName
2. Creates: `/notifier_index/buy/{itemKey}/{userId}` = true

### When User Removes Item:
1. Deletes: `/notifier/buy/{userId}/{itemKey}`
2. Deletes: `/notifier_index/buy/{itemKey}/{userId}`

### When Cloud Function Runs:
1. **Old way:** Downloads entire `/notifier/buy` and `/notifier/sale` nodes (~18 MB)
2. **New way:** 
   - For each trade item, queries `/notifier_index/{side}/{itemKey}`
   - Gets list of userIds who have that item
   - Only downloads those users' notifier data (~1 MB)

---

## Verification

### Check Index Creation:
1. Open Firebase Console → Realtime Database
2. Navigate to `/notifier_index/buy/` or `/notifier_index/sale/`
3. You should see item keys with userIds as children

### Test Cloud Function:
1. Create a new trade
2. Check Cloud Function logs
3. Should see: "Finding matches using reverse index..." instead of downloading all data

---

## Backward Compatibility

✅ **Fully backward compatible:**
- Old items without index will be automatically indexed when user opens notifier
- New items automatically get indexed
- Cloud function works with or without index (has fallback)

---

## Expected Results

**Before Optimization:**
- `/notifier/buy`: 11.86 MB, 367 accesses
- `/notifier/sale`: 7 MB, 367 accesses
- **Total:** 18.86 MB per 30 minutes

**After Optimization:**
- `/notifier/buy`: ~0.5 MB, 367 accesses
- `/notifier/sale`: ~0.5 MB, 367 accesses
- **Total:** ~1 MB per 30 minutes
- **Savings:** ~17.86 MB (95% reduction)

---

## Troubleshooting

### Permission Denied Error?
**Error:** `[database/permission-denied] Client doesn't have permission to access the desired data.`

**Solution:**
1. Deploy database rules: `firebase deploy --only database`
2. Verify rules in Firebase Console → Realtime Database → Rules
3. Ensure user is authenticated (`auth.uid` must match `$userId`)

### Index not being created?
- Check Firebase Console for errors
- Verify database rules are deployed
- Verify user has write permissions
- Check network connectivity

### Cloud function still downloading all data?
- Verify migration script ran successfully
- Check that new items are creating indexes
- Verify cloud function is using optimized code

### Old items not indexed?
- Migration script will handle bulk migration
- Or wait for users to open notifier (auto-indexes on load)

