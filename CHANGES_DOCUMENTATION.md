# App Changes Documentation

This document contains all the changes made to the app. Use this to apply the same changes to similar apps.

---

## Table of Contents
1. [Interstitial Ad Manager - A/B Testing & Optimization](#1-interstitial-ad-manager)
2. [Chat Exit Ads (Private & Group)](#2-chat-exit-ads)
3. [Chat Message Frequency - 10 Messages](#3-chat-message-frequency)
4. [Last Updated UI (HomeScreen)](#4-last-updated-ui)
5. [Codes Tab (TopTabs)](#5-codes-tab)
6. [Hide Header + Padding (More Screen)](#6-hide-header--padding)

---

## 1. Interstitial Ad Manager

**File:** `Code/Ads/IntAd.js`

**Purpose:** Optimized ad manager with A/B testing between two ad units, improved retry logic, and maximum show rate.

**Dependencies:**
- `react-native-google-mobile-ads`
- Config file with `gameInterstitialIOS` and `gameInterstitialAndroid`

**Full Code:**

```javascript
// InterstitialAdManager.js - Optimized with A/B Testing & Max Show Rate
import {
  InterstitialAd,
  AdEventType,
} from 'react-native-google-mobile-ads';
import { Platform } from 'react-native';
import getAdUnitId from './ads';
import config from '../Helper/Environment';

// ✅ Two ad unit IDs for A/B testing
const interstitialAdUnitId = getAdUnitId('interstitial');
const gameInterstitialAdUnitId = Platform.OS === 'ios' 
  ? config.gameInterstitialIOS 
  : config.gameInterstitialAndroid;

class InterstitialAdManager {
  // ✅ Two ad instances for A/B testing
  static adA = InterstitialAd.createForAdRequest(interstitialAdUnitId);
  static adB = InterstitialAd.createForAdRequest(gameInterstitialAdUnitId);
  
  static isAdALoaded = false;
  static isAdBLoaded = false;
  static hasInitialized = false;
  static unsubscribeEvents = [];

  static retryCountA = 0;
  static retryCountB = 0;
  static maxRetries = 5;
  
  // ✅ A/B test tracking (50/50 split)
  static abTestCounter = 0;
  
  static init() {
    if (this.hasInitialized) return;

    // ============ AD A (Primary Interstitial) ============
    const onAdALoaded = this.adA.addAdEventListener(
      AdEventType.LOADED,
      () => {
        this.isAdALoaded = true;
        this.retryCountA = 0;
      }
    );

    const onAdAError = this.adA.addAdEventListener(
      AdEventType.ERROR,
      (error) => {
        this.isAdALoaded = false;
        this.retryLoadAdA();
      }
    );

    // ============ AD B (Game/Chat Interstitial) ============
    const onAdBLoaded = this.adB.addAdEventListener(
      AdEventType.LOADED,
      () => {
        this.isAdBLoaded = true;
        this.retryCountB = 0;
      }
    );

    const onAdBError = this.adB.addAdEventListener(
      AdEventType.ERROR,
      (error) => {
        this.isAdBLoaded = false;
        this.retryLoadAdB();
      }
    );

    this.unsubscribeEvents = [onAdALoaded, onAdAError, onAdBLoaded, onAdBError];
    
    // ✅ Load both ads immediately
    this.adA.load();
    this.adB.load();
    
    this.hasInitialized = true;
  }

  // ✅ Retry with shorter delays (1s, 2s, 4s, 8s, 16s) then continue with 30s interval
  static retryLoadAdA() {
    if (this.retryCountA < this.maxRetries) {
      const delay = Math.pow(2, this.retryCountA) * 1000; // 1s, 2s, 4s, 8s, 16s
      setTimeout(() => {
        this.retryCountA += 1;
        this.adA.load();
      }, delay);
    } else {
      // ✅ Continue retrying every 30 seconds (don't give up)
      setTimeout(() => {
        this.retryCountA = 0; // Reset and try again
        this.adA.load();
      }, 30000);
    }
  }

  static retryLoadAdB() {
    if (this.retryCountB < this.maxRetries) {
      const delay = Math.pow(2, this.retryCountB) * 1000;
      setTimeout(() => {
        this.retryCountB += 1;
        this.adB.load();
      }, delay);
    } else {
      setTimeout(() => {
        this.retryCountB = 0;
        this.adB.load();
      }, 30000);
    }
  }

  // ✅ Show ad with A/B testing and fallback
  static showAd(onAdClosedCallback, onAdUnavailableCallback) {
    if (!this.hasInitialized) {
      this.init();
    }

    // ✅ Determine which ad to try first (A/B test: 50/50 split)
    this.abTestCounter += 1;
    const tryAdAFirst = this.abTestCounter % 2 === 0;

    // ✅ Try to show an ad with fallback to the other
    if (tryAdAFirst) {
      if (this.isAdALoaded) {
        this.showAdA(onAdClosedCallback);
        return;
      } else if (this.isAdBLoaded) {
        this.showAdB(onAdClosedCallback);
        return;
      }
    } else {
      if (this.isAdBLoaded) {
        this.showAdB(onAdClosedCallback);
        return;
      } else if (this.isAdALoaded) {
        this.showAdA(onAdClosedCallback);
        return;
      }
    }

    // ✅ Neither ad is ready - call unavailable callback
    if (typeof onAdUnavailableCallback === 'function') {
      onAdUnavailableCallback();
    } else if (typeof onAdClosedCallback === 'function') {
      onAdClosedCallback();
    }

    // ✅ Trigger immediate reload for both ads
    if (!this.isAdALoaded) this.adA.load();
    if (!this.isAdBLoaded) this.adB.load();
  }

  static showAdA(onAdClosedCallback) {
    const unsubscribeClose = this.adA.addAdEventListener(
      AdEventType.CLOSED,
      () => {
        this.isAdALoaded = false;
        this.adA.load(); // Preload next immediately
        
        if (typeof onAdClosedCallback === 'function') {
          onAdClosedCallback();
        }
        unsubscribeClose();
      }
    );

    this.adA.show();
  }

  static showAdB(onAdClosedCallback) {
    const unsubscribeClose = this.adB.addAdEventListener(
      AdEventType.CLOSED,
      () => {
        this.isAdBLoaded = false;
        this.adB.load(); // Preload next immediately
        
        if (typeof onAdClosedCallback === 'function') {
          onAdClosedCallback();
        }
        unsubscribeClose();
      }
    );

    this.adB.show();
  }

  // ✅ Check if any ad is available
  static isReady() {
    return this.isAdALoaded || this.isAdBLoaded;
  }

  // ✅ Force reload both ads (useful after network recovery)
  static forceReload() {
    this.adA.load();
    this.adB.load();
  }

  static cleanup() {
    this.unsubscribeEvents.forEach((unsubscribe) => unsubscribe());
    this.unsubscribeEvents = [];
    this.hasInitialized = false;
    this.isAdALoaded = false;
    this.isAdBLoaded = false;
  }
}

export default InterstitialAdManager;
```

**Config Required:**
Add these to your config/environment file:
```javascript
gameInterstitialIOS: 'ca-app-pub-XXXXX/XXXXX',
gameInterstitialAndroid: 'ca-app-pub-XXXXX/XXXXX',
```

---

## 2. Chat Exit Ads

**Purpose:** Show interstitial ad when user leaves chat IF:
- User spent at least 10 seconds in chat
- User sent at least 1 message
- User is NOT Pro

### 2a. Private Chat

**File:** `Code/ChatScreen/PrivateChat/PrivateChat.jsx`

**Step 1: Add import**
```javascript
import InterstitialAdManager from '../../Ads/IntAd';
```

**Step 2: Add refs (in component, with other state/refs)**
```javascript
const hasSentMessageRef = useRef(false); // Track if user sent a message (for exit ad)
const chatEnterTimeRef = useRef(null); // Track when user entered chat (for exit ad)
```

**Step 3: Update useFocusEffect**
```javascript
useFocusEffect(
  useCallback(() => {
    if (!user?.id || !selectedUserId) return;

    const chatMetaRef = ref(appdatabase, `chat_meta_data/${user.id}/${selectedUserId}`);
    chatMetaRef.update({ unreadCount: 0 });
    setActiveChat(user.id, chatKey);

    // ✅ Reset refs when entering chat
    hasSentMessageRef.current = false;
    chatEnterTimeRef.current = Date.now();

    return () => {
      clearActiveChat(user.id);
      // ✅ Show ad when leaving if: 10+ seconds spent AND message sent AND not Pro
      const timeSpent = Date.now() - (chatEnterTimeRef.current || Date.now());
      if (timeSpent >= 10000 && hasSentMessageRef.current && !localState?.isPro) {
        InterstitialAdManager.showAd();
      }
    };
  }, [user?.id, selectedUserId, chatKey, localState?.isPro])
);
```

**Step 4: Track message sent (in sendMessage function, after successful send)**
```javascript
// After message sent successfully:
hasSentMessageRef.current = true; // Track that user sent a message (for exit ad)
```

### 2b. Group Chat

**File:** `Code/ChatScreen/GroupChat/GroupChatScreen.jsx`

**Same pattern as Private Chat:**

**Step 1: Add import**
```javascript
import InterstitialAdManager from '../../Ads/IntAd';
```

**Step 2: Add refs**
```javascript
const hasSentMessageRef = useRef(false);
const chatEnterTimeRef = useRef(null);
```

**Step 3: Update useFocusEffect**
```javascript
useFocusEffect(
  useCallback(() => {
    if (!user?.id || !groupId) return;

    setActiveChat(user.id, groupId);
    setActiveGroupChat(user.id, groupId);

    // Reset refs when entering chat (for exit ad logic)
    hasSentMessageRef.current = false;
    chatEnterTimeRef.current = Date.now();

    // Reset unreadCount when entering chat
    const groupMetaRef = ref(appdatabase, `group_meta_data/${user.id}/${groupId}`);
    update(groupMetaRef, { unreadCount: 0 }).catch((error) => {
      console.error('Error resetting unread count:', error);
    });

    return () => {
      clearActiveChat(user.id);
      clearActiveGroupChat(user.id, groupId);
      
      // Show ad when leaving if: 10+ seconds spent AND message sent AND not Pro
      const timeSpent = Date.now() - (chatEnterTimeRef.current || Date.now());
      if (timeSpent >= 10000 && hasSentMessageRef.current && !localState?.isPro) {
        InterstitialAdManager.showAd();
      }
    };
  }, [user?.id, groupId, appdatabase, localState?.isPro])
);
```

**Step 4: Track message sent (in sendMessage, after successful send)**
```javascript
hasSentMessageRef.current = true;
```

---

## 3. Chat Message Frequency

**Purpose:** Show ad every 10 messages in chat (not 5 or 30)

**Files to update:**
- `Code/ChatScreen/GroupChat/MessageInput.jsx`
- `Code/ChatScreen/GroupChat/GroupMessageInput.jsx`
- `Code/ChatScreen/PrivateChat/PrivateMessageInput.jsx`

**Change this pattern:**
```javascript
// OLD (every 5 messages):
if (!localState?.isPro && newCount % 5 === 0) {

// NEW (every 10 messages):
if (!localState?.isPro && newCount % 10 === 0) {
```

---

## 4. Last Updated UI

**File:** `Code/Homescreen/HomeScreen.jsx`

**Purpose:** Replace refresh button with modern "Last Updated" display that shows relative time and allows tap to refresh.

**Step 1: Add state**
```javascript
const [lastUpdatedTime, setLastUpdatedTime] = useState(new Date());
```

**Step 2: Add helper function**
```javascript
// Format last updated time as relative string
const getLastUpdatedText = useCallback(() => {
  const now = new Date();
  const diffMs = now - lastUpdatedTime;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins === 1) return '1 min ago';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours === 1) return '1 hour ago';
  if (diffHours < 24) return `${diffHours} hours ago`;
  return lastUpdatedTime.toLocaleDateString();
}, [lastUpdatedTime]);
```

**Step 3: Update handleRefresh to set time on success**
```javascript
const handleRefresh = useCallback(async () => {
  if (refreshing) return;
  setRefreshing(true);
  try {
    await reload();
    setLastUpdatedTime(new Date()); // ✅ Update time on success
  } catch (error) {
    console.error('Refresh error:', error);
  } finally {
    setRefreshing(false);
  }
}, [refreshing, reload]);
```

**Step 4: Add UI component (replace old refresh button)**
```jsx
{/* Last Updated Section */}
<TouchableOpacity 
  style={styles.lastUpdatedContainer}
  onPress={handleRefresh}
  disabled={refreshing}
  activeOpacity={0.7}
>
  <View style={styles.lastUpdatedContent}>
    {refreshing ? (
      <ActivityIndicator size="small" color={config.colors.primary} style={{ marginRight: 6 }} />
    ) : (
      <Icon name="time-outline" size={14} color={isDarkMode ? '#aaa' : '#888'} style={{ marginRight: 6 }} />
    )}
    <Text style={[styles.lastUpdatedText, { color: isDarkMode ? '#aaa' : '#666' }]}>
      {refreshing ? 'Updating...' : `Updated ${getLastUpdatedText()}`}
    </Text>
    {!refreshing && (
      <Icon name="refresh-outline" size={14} color={config.colors.primary} style={{ marginLeft: 6 }} />
    )}
  </View>
</TouchableOpacity>
```

**Step 5: Add styles**
```javascript
lastUpdatedContainer: {
  alignSelf: 'center',
  paddingVertical: 8,
  paddingHorizontal: 16,
  marginVertical: 4,
},
lastUpdatedContent: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
},
lastUpdatedText: {
  fontSize: 12,
  fontFamily: 'Lato-Regular',
},
```

---

## 5. Codes Tab

**Purpose:** Move Codes from a modal/drawer to its own tab in TopTabs.

### 5a. Create CodesScreen.jsx

**File:** `Code/ValuesScreen/CodesScreen.jsx`

```jsx
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import Clipboard from '@react-native-clipboard/clipboard';
import { useHaptic } from '../Helper/HepticFeedBack';
import { t } from 'i18next';
import { showSuccessMessage } from '../Helper/MessageHelper';
import { mixpanel } from '../AppHelper/MixPenel';
import config from '../Helper/Environment';

const CodesScreen = () => {
  const { theme } = useGlobalState();
  const { localState } = useLocalState();
  const isDarkMode = theme === 'dark';
  const { triggerHapticFeedback } = useHaptic();
  const [codesData, setCodesData] = useState([]);

  useEffect(() => {
    if (localState.codes) {
      try {
        const parsedCodes = typeof localState.codes === 'string' 
          ? JSON.parse(localState.codes) 
          : localState.codes;

        if (typeof parsedCodes !== 'object' || parsedCodes === null) {
          throw new Error('Parsed codes is not a valid object');
        }

        const extractedCodes = Object.values(parsedCodes);
        setCodesData(extractedCodes.length > 0 ? extractedCodes : []);
      } catch (error) {
        console.error("Error parsing codes:", error);
        setCodesData([]);
      }
    }
  }, [localState.codes]);

  const normalizedCodes =
    Array.isArray(codesData) && codesData.length === 1 && Array.isArray(codesData[0])
      ? codesData[0]
      : codesData;

  const copyToClipboard = (code) => {
    triggerHapticFeedback('impactLight');
    Clipboard.setString(code);
    showSuccessMessage(t("value.copy"), t("value.copy_success"));
    mixpanel.track("Code Copy", { Code: code });
  };

  const renderCodeItem = ({ item }) => (
    <View style={[styles.codeItem, { backgroundColor: isDarkMode ? '#1e1e1e' : '#fff' }]}>
      <View style={styles.codeHeader}>
        <Icon name="gift-outline" size={20} color={config.colors.primary} />
        <Text style={[styles.codeText, { color: isDarkMode ? '#fff' : '#000' }]}>
          {item.code}
        </Text>
      </View>
      <Text style={[styles.rewardText, { color: isDarkMode ? '#aaa' : '#666' }]}>
        {item.reward}
      </Text>
      <TouchableOpacity
        onPress={() => copyToClipboard(item.code)}
        style={styles.copyButton}
        activeOpacity={0.7}
      >
        <Icon name="copy-outline" size={16} color="#fff" />
        <Text style={styles.copyButtonText}>{t("value.copy") || "Copy"}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Icon name="code-slash-outline" size={60} color={isDarkMode ? '#555' : '#ccc'} />
      <Text style={[styles.emptyText, { color: isDarkMode ? '#888' : '#666' }]}>
        No codes available
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: isDarkMode ? '#121212' : '#f5f5f5' }]}>
      <FlatList
        data={normalizedCodes}
        keyExtractor={(item, index) => index.toString()}
        renderItem={renderCodeItem}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={renderEmptyState}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContainer: {
    padding: 12,
    paddingBottom: 40,
    flexGrow: 1,
  },
  codeItem: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  codeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  codeText: {
    fontSize: 16,
    fontFamily: 'Lato-Bold',
    marginLeft: 10,
  },
  rewardText: {
    fontSize: 14,
    fontFamily: 'Lato-Regular',
    marginBottom: 12,
    marginLeft: 30,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: config.colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginLeft: 30,
  },
  copyButtonText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'Lato-Bold',
    marginLeft: 6,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 16,
    fontFamily: 'Lato-Regular',
    marginTop: 12,
  },
});

export default CodesScreen;
```

### 5b. Update TopTabs.js

**File:** `Code/ValuesScreen/TopTabs.js`

**Step 1: Add import**
```javascript
import CodesScreen from "./CodesScreen";
```

**Step 2: Add Codes to tabs array**
```javascript
const tabs = useMemo(() => {
  const base = [
    {
      label: "Items",
      key: "values",
      icon: "pricetags-outline",
      iconActive: "pricetags",
    },
    {
      label: "Codes",  // ✅ NEW TAB
      key: "codes",
      icon: "code-slash-outline",
      iconActive: "code-slash",
    },
    {
      label: "HD Wallpaper",
      key: "wallpaper",
      icon: "image-outline",
      iconActive: "image",
    },
    // ... other tabs
  ];
  return base;
}, [isAdmin]);
```

**Step 3: Add screen content**
```jsx
{mountedTabs.codes && (
  <View
    style={[
      styles.screen,
      activeKey !== "codes" && styles.hiddenScreen,
    ]}
  >
    <CodesScreen />
  </View>
)}
```

### 5c. Remove from ValueScreen.jsx

**File:** `Code/ValuesScreen/ValueScreen.jsx`

Remove these:
- `import CodesDrawer from './Code';`
- `const [codesData, setCodesData] = useState([]);`
- `const [isDrawerVisible, setIsDrawerVisible] = useState(false);`
- `const [hasAdBeenShown, setHasAdBeenShown] = useState(false);`
- The `toggleDrawer` function
- The codes useEffect that parses `localState.codes`
- The Codes button: `<TouchableOpacity onPress={toggleDrawer}>...`
- The CodesDrawer component: `<CodesDrawer isVisible={isDrawerVisible} ... />`

---

## 6. Hide Header + Padding

**Purpose:** Hide the navigation header for the More screen and add top padding to TopTabs.

### 6a. Hide Header

**File:** `Code/AppHelper/MainTabs.js`

Find the Values/More tab screen and add `headerShown: false`:
```jsx
<Tab.Screen
  name="Values"
  options={{
    title: 'More',
    headerShown: false,  // ✅ ADD THIS
  }}
>
  {renderCustomTopTabs}
</Tab.Screen>
```

### 6b. Add Top Padding

**File:** `Code/ValuesScreen/TopTabs.js`

Update the wrapper style:
```javascript
wrapper: {
  flex: 1,
  padding: 8,
  paddingTop: 40,  // ✅ ADD THIS
},
```

---

## Summary Checklist

- [ ] Replace IntAd.js with A/B testing version
- [ ] Add config for second ad unit ID
- [ ] Add exit ad to PrivateChat.jsx
- [ ] Add exit ad to GroupChatScreen.jsx
- [ ] Change chat message frequency to 10 in all MessageInput files
- [ ] Add Last Updated UI to HomeScreen
- [ ] Create CodesScreen.jsx
- [ ] Add Codes tab to TopTabs.js
- [ ] Remove Codes modal/drawer from ValueScreen.jsx
- [ ] Hide header for More screen in MainTabs.js
- [ ] Add paddingTop: 40 to TopTabs wrapper

---

*Generated from blox_.77 app changes*
