# Cloud Functions Documentation

This directory contains documentation for all Firebase Cloud Functions used in the application.

---

## Functions Overview

### 1. **checkFruitsAndNotify**
- **Type:** Scheduled (Pub/Sub)
- **Purpose:** Sends stock update notifications
- **Files:**
  - `checkFruitsAndNotify.js` (original)
  - `checkFruitsAndNotify_optimized.js` (optimized - **USE THIS**)
- **Documentation:** [checkFruitsAndNotify.md](./checkFruitsAndNotify.md)

### 2. **notifyFromTrade**
- **Type:** Firestore Trigger
- **Purpose:** Sends notifications when trades match notifier items
- **Files:**
  - `notifyFromTrade_optimized.js` (optimized - **USE THIS**)
- **Documentation:** [notifyFromTrade.md](./notifyFromTrade.md)

### 3. **notifyPostComment**
- **Type:** Firestore Trigger
- **Purpose:** Sends notifications when someone comments on a post
- **Files:**
  - `notifyPostComment.js`
- **Documentation:** [notifyPostComment.md](./notifyPostComment.md)

### 4. **migrateNotifierIndex**
- **Type:** HTTP Function
- **Purpose:** One-time migration to create reverse index for existing notifier data
- **Files:**
  - `migrateNotifierIndex.js`
- **Documentation:** [migrateNotifierIndex.md](./migrateNotifierIndex.md)

---

## Quick Reference

### Deployment Commands

```bash
# Deploy all functions
firebase deploy --only functions

# Deploy specific function
firebase deploy --only functions:checkFruitsAndNotify
firebase deploy --only functions:notifyFromTrade
firebase deploy --only functions:notifyPostComment
firebase deploy --only functions:migrateNotifierIndex
```

### Function URLs

After deployment, function URLs are available in:
- Firebase Console → Functions
- Or via: `firebase functions:list`

---

## Optimization Summary

### Data Reduction Achieved:

1. **checkFruitsAndNotify:**
   - **Before:** 2.72 MB per run
   - **After:** ~0.14 MB per run
   - **Savings:** ~95% reduction

2. **notifyFromTrade:**
   - **Before:** ~18.86 MB per trade
   - **After:** ~1 MB per trade
   - **Savings:** ~95% reduction

3. **notifyPostComment:**
   - Already optimized with limits and batch fetching
   - Max 50 users, last 100 comments checked

---

## Setup Checklist

### Before Deploying:

- [ ] Deploy database rules (`database.rules.json`)
- [ ] Run migration script (`migrateNotifierIndex`)
- [ ] Verify index structure in Firebase Console
- [ ] Deploy optimized cloud functions
- [ ] Test notifications manually
- [ ] Monitor Firebase Console for data usage

---

## Testing

See [TESTING_CHECKLIST.md](../TESTING_CHECKLIST.md) for comprehensive testing guide.

### Quick Tests:

1. **checkFruitsAndNotify:**
   - Enable stock reminder
   - Wait for scheduled run
   - Verify notification received

2. **notifyFromTrade:**
   - Add item to notifier
   - Create matching trade
   - Verify notification received

3. **notifyPostComment:**
   - Comment on a post
   - Verify post creator and commenters notified

---

## Monitoring

### Firebase Console:
- Functions → Logs: View execution logs
- Functions → Usage: Monitor invocations and costs
- Realtime Database → Usage: Monitor data downloads
- Firestore → Usage: Monitor read/write operations

### Key Metrics to Watch:
- Function execution time
- Data download size
- Error rates
- Notification delivery rates

---

## Troubleshooting

### Common Issues:

1. **Function not triggering:**
   - Check function is deployed
   - Check trigger conditions (schedule, Firestore path)
   - Check function logs for errors

2. **Notifications not sending:**
   - Check FCM tokens are valid
   - Check user notification preferences
   - Check function logs for errors

3. **High data usage:**
   - Verify optimized versions are deployed
   - Check if index is being used (notifyFromTrade)
   - Monitor function logs for data download sizes

---

## Support

For issues or questions:
1. Check function logs in Firebase Console
2. Review function documentation
3. Check TESTING_CHECKLIST.md for testing steps

---

## Version History

### Optimizations Applied:
- **2024:** Implemented reverse index system for notifyFromTrade
- **2024:** Optimized checkFruitsAndNotify to fetch only required fields
- **2024:** Added selected fruits reminder feature

---

## Notes

- Always use optimized versions in production
- Monitor costs regularly
- Keep functions updated
- Test after any changes

