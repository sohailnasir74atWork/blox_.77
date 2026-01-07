# Cloud Function: migrateNotifierIndex

## Overview
One-time migration script that creates reverse index entries for existing notifier data. This ensures the optimized `notifyFromTrade` function works with historical data.

## Type
**HTTP Function (onRequest)**

## Trigger
- **Type:** HTTP Request
- **Manual:** Yes, must be called manually
- **One-Time Use:** Run once to migrate existing data

---

## Functionality

### 1. Migration Process
- Scans all existing `/notifier/buy` data
- Scans all existing `/notifier/sale` data
- Creates reverse index entries: `/notifier_index/{side}/{itemKey}/{userId} = true`
- Handles both old format (object) and new format (string)

### 2. Data Processing
- Processes users in batches
- Creates index entries for each item
- Handles errors gracefully
- Provides progress logging

### 3. Result
- Returns JSON with migration statistics
- Shows total items processed
- Shows total index entries created
- Shows error count

---

## Data Flow

### Step 1: Read Existing Data
```javascript
1. Read /notifier/buy (all users)
2. Read /notifier/sale (all users)
```

### Step 2: Process Each User
```javascript
For each user:
  1. Get user's items
  2. For each item:
     - Extract item name (handle old/new format)
     - Create itemKey (sanitize)
     - Create index entry: /notifier_index/{side}/{itemKey}/{userId} = true
```

### Step 3: Batch Update
```javascript
1. Collect all index updates
2. Batch update using db.ref().update()
3. Log progress
```

---

## Database Operations

### Reads:
- `/notifier/buy` - All buy notifier data
- `/notifier/sale` - All sale notifier data

### Writes:
- `/notifier_index/{side}/{itemKey}/{userId}` - Creates index entries

---

## Request/Response

### HTTP Request:
```bash
GET https://YOUR-REGION-YOUR-PROJECT.cloudfunctions.net/migrateNotifierIndex
```

Or visit URL in browser.

### Success Response:
```json
{
  "success": true,
  "message": "Migration completed",
  "stats": {
    "totalProcessed": 1234,
    "totalIndexed": 1234,
    "errors": 0
  }
}
```

### Error Response:
```json
{
  "success": false,
  "error": "Error message",
  "stats": {
    "totalProcessed": 1000,
    "totalIndexed": 950,
    "errors": 50
  }
}
```

---

## Logging

### Progress Logs:
- `🔄 Starting notifier index migration...`
- `📦 Processing {side} notifier...`
- `✅ Found {count} users with {side} notifier items`
- `  ✅ Indexed {count} items for user {userId}`

### Summary Logs:
- `✅ Migration Summary:`
- `   Total items processed: {count}`
- `   Total index entries created: {count}`
- `   Errors: {count}`

### Error Logs:
- `⚠️ No data found for /notifier/{side}`
- `  ❌ Error processing user {userId}: {error}`
- `❌ Migration failed: {error}`

---

## Deployment

```bash
firebase deploy --only functions:migrateNotifierIndex
```

---

## Usage

### Step 1: Deploy Function
```bash
firebase deploy --only functions:migrateNotifierIndex
```

### Step 2: Get Function URL
- Go to Firebase Console → Functions
- Find `migrateNotifierIndex`
- Copy the HTTP trigger URL

### Step 3: Run Migration
```bash
# Option 1: Using curl
curl https://YOUR-REGION-YOUR-PROJECT.cloudfunctions.net/migrateNotifierIndex

# Option 2: Visit in browser
# Just open the URL in your browser
```

### Step 4: Verify Results
- Check response JSON for statistics
- Verify index created in Firebase Console
- Check `/notifier_index/` path in Realtime Database

---

## Files

- **File:** `functions/migrateNotifierIndex.js`

---

## Important Notes

### ⚠️ One-Time Use
- This function is meant to be run **once** to migrate existing data
- New items automatically create indexes (no need to run again)
- Running multiple times is safe (idempotent) but unnecessary

### ⚠️ Execution Time
- May take several minutes for large datasets
- Function timeout: 540 seconds (9 minutes) by default
- For very large datasets, may need to increase timeout

### ⚠️ Cost
- Reads all notifier data (one-time cost)
- Creates index entries (one-time write cost)
- Worth it for optimization benefits

---

## Testing

### Before Migration:
1. Check `/notifier_index/` in Firebase Console
2. Should be empty or minimal

### After Migration:
1. Check `/notifier_index/` in Firebase Console
2. Should have entries for all existing notifier items
3. Structure: `/notifier_index/{side}/{itemKey}/{userId} = true`

### Verify Index Works:
1. User has item in notifier (old data)
2. Create trade with that item
3. `notifyFromTrade` should use index (check logs)
4. Notification should be sent

---

## Error Handling

### Missing Data:
- Skips users with no items
- Skips items without names
- Continues processing

### Format Handling:
- Handles old format: `{ name: "Dragon", Type: "Fruit" }`
- Handles new format: `"Dragon"` (string)
- Extracts name correctly from both

### Batch Updates:
- Uses batch updates for efficiency
- Handles update errors gracefully
- Logs errors but continues processing

---

## Performance

### Execution Time:
- **Small dataset (< 1000 items):** 10-30 seconds
- **Medium dataset (1000-10000 items):** 1-3 minutes
- **Large dataset (> 10000 items):** 3-9 minutes

### Database Operations:
- **Reads:** 2 reads (buy + sale notifier data)
- **Writes:** 1 write per item (batch updates)

---

## Notes

- Safe to run multiple times (idempotent)
- Only needed for existing data
- New items automatically indexed
- Required for `notifyFromTrade` optimization to work
- Run before deploying optimized `notifyFromTrade`

