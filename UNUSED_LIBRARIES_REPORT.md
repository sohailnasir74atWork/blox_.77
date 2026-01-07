# Unused Libraries Report

## Analysis of package.json Dependencies

### ✅ USED Libraries (Confirmed)

1. **@invertase/react-native-apple-authentication** - Used (authentication)
2. **@notifee/react-native** - ✅ Used (3 files: Setting.jsx, FrontendNotificationHandling.js, PermissionCheck.js)
3. **@react-native-camera-roll/camera-roll** - Used (image picking)
4. **@react-native-clipboard/clipboard** - Used (clipboard operations)
5. **@react-native-firebase/app** - ✅ Used (Firebase core)
6. **@react-native-firebase/auth** - ✅ Used (authentication)
7. **@react-native-firebase/crashlytics** - Used (crash reporting)
8. **@react-native-firebase/database** - ✅ Used (Realtime Database)
9. **@react-native-firebase/firestore** - ✅ Used (Firestore)
10. **@react-native-firebase/messaging** - ✅ Used (push notifications)
11. **@react-native-google-signin/google-signin** - Used (Google sign-in)
12. **@react-navigation/bottom-tabs** - ✅ Used (navigation)
13. **@react-navigation/native** - ✅ Used (navigation)
14. **@react-navigation/native-stack** - ✅ Used (navigation)
15. **axios** - ✅ Used (2 files: MessagesList.jsx, PrivateMessageList.jsx)
16. **dayjs** - ✅ Used (4 files: Trades.jsx, CommentsModal.js, PostCard.js, Store.js)
17. **i18next** - ✅ Used (internationalization)
18. **leo-profanity** - ✅ Used (Trader.jsx - profanity filter)
19. **mixpanel-react-native** - ✅ Used (MixPenel.js - analytics)
20. **react** - ✅ Used (core)
21. **react-i18next** - ✅ Used (i18n)
22. **react-native** - ✅ Used (core)
23. **react-native-bootsplash** - Used (splash screen)
24. **react-native-compressor** - ✅ Used (2 files: Setting.jsx, UploadModal.js)
25. **react-native-device-info** - ✅ Used (2 files: settinghelper.js, InAppUpdateCheck.js)
26. **react-native-flash-message** - ✅ Used (notifications)
27. **react-native-fs** - Used (file system)
28. **react-native-gesture-handler** - ✅ Used (gestures)
29. **react-native-google-mobile-ads** - ✅ Used (ads)
30. **react-native-haptic-feedback** - Used (haptics)
31. **react-native-image-picker** - Used (image picking)
32. **react-native-in-app-review** - ✅ Used (AppHelperFunction.js)
33. **react-native-localize** - ✅ Used (CountryCheck.js)
34. **react-native-mmkv** - Used (storage)
35. **react-native-permissions** - Used (permissions)
36. **react-native-popup-menu** - Used (menus)
37. **react-native-purchases** - Used (RevenueCat)
38. **react-native-purchases-ui** - Used (RevenueCat UI)
39. **react-native-reanimated** - Used (animations)
40. **react-native-safe-area-context** - ✅ Used (safe areas)
41. **react-native-screens** - ✅ Used (navigation screens)
42. **react-native-share** - ✅ Used (2 files: SharetradeModel.js, settinghelper.js)
43. **react-native-sound** - ✅ Used (useBackgroundMusic.js)
44. **react-native-svg** - Used (SVG icons)
45. **react-native-view-shot** - ✅ Used (2 files: HomeScreen.jsx, SharetradeModel.js)
46. **sp-react-native-in-app-updates** - ✅ Used (2 files: InAppUpdateChecker.js, InAppUpdateCheck.js)

---

### ❌ POTENTIALLY UNUSED Libraries

#### 1. **react-native-system-navigation-bar** ✅ USED
- **Status:** ✅ Used in App.js
- **Location:** `App.js` line 32
- **Recommendation:** ✅ **KEEP** - Used for system navigation bar styling

#### 2. **react-native-tracking-transparency** ❌ NOT FOUND
- **Status:** No imports found in codebase
- **Search:** No matches for `react-native-tracking-transparency`, `TrackingTransparency`
- **Recommendation:** ⚠️ **LIKELY UNUSED** - Can be removed if not needed

#### 3. **react-native-webview** ❌ NOT FOUND
- **Status:** No imports found in codebase
- **Search:** No matches for `react-native-webview`, `WebView`
- **Recommendation:** ⚠️ **LIKELY UNUSED** - Can be removed if not needed

---

## Summary

### Unused Libraries Found: 2

1. **react-native-tracking-transparency** - No usage found (but may be used in native code)
2. **react-native-webview** - No usage found

### Total Dependencies: 46
### Used: 44
### Potentially Unused: 2

---

## Recommendations

### Safe to Remove (if confirmed unused):

```bash
npm uninstall react-native-tracking-transparency
npm uninstall react-native-webview
```

**Note:** `react-native-system-navigation-bar` is used in `App.js` - **DO NOT REMOVE**

### Before Removing:

1. **Double-check native linking:**
   - Check `android/app/build.gradle` for native dependencies
   - Check `ios/Podfile` for CocoaPods dependencies
   - Check `react-native.config.js` for auto-linking config

2. **Check for indirect usage:**
   - Some libraries might be used in native code
   - Some might be required by other dependencies

3. **Test after removal:**
   - Build Android app
   - Build iOS app
   - Test all features

---

## Notes

- All other 43 dependencies are actively used in the codebase
- The 3 potentially unused libraries are relatively small, but removing them can:
  - Reduce bundle size
  - Reduce build time
  - Reduce dependency conflicts
  - Simplify maintenance

---

## Next Steps

1. ✅ Verify these libraries are not used in native code (Android/iOS)
2. ✅ Check if they're required by other dependencies
3. ✅ Remove if confirmed unused
4. ✅ Test builds after removal

