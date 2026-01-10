// 🏆 Note: With Fabric (new architecture) enabled, enableScreens() is not needed
// and can cause crashes. Screens are automatically enabled with Fabric.
// import { enableScreens } from 'react-native-screens';
// enableScreens(); 

import React, { useEffect, lazy, Suspense } from 'react';
import { AppRegistry, Platform, StatusBar, Text } from 'react-native';
import AppWrapper from './App';
import { name as appName } from './app.json';
import { GlobalStateProvider } from './Code/GlobelStats';
import { LocalStateProvider } from './Code/LocalGlobelStats';
import { MenuProvider } from 'react-native-popup-menu';
import { LanguageProvider } from './Code/Translation/LanguageProvider';
import messaging from '@react-native-firebase/messaging';
import FlashMessage from 'react-native-flash-message';

// 🚀 Lazy load Notification Handler for better startup performance
const NotificationHandler = lazy(() => import('./Code/Firebase/FrontendNotificationHandling'));

// 👥 Lazy load Global Group Invite Toast for group invitations
const GlobalGroupInviteToast = lazy(() => import('./Code/ValuesScreen/GlobalGroupInviteToast'));
const STATUS_BAR_HEIGHT = Platform.OS === 'android' ? StatusBar.currentHeight || 18 : 44;
// ✅ Background Notification Handler - Filter blocked users
// Note: Background notifications are handled by OS when app is closed
// This handler is for when app is in background (minimized) but not closed
messaging().setBackgroundMessageHandler(async remoteMessage => {
  try {
    // ✅ Import MMKV storage to check blocked users in background
    const { MMKV } = require('react-native-mmkv');
    const storage = new MMKV();
    
    // ✅ Read bannedUsers from MMKV (same pattern as LocalGlobelStats.js)
    const bannedUsersStr = storage.getString('bannedUsers');
    
    let bannedUsersList = [];
    if (bannedUsersStr) {
      try {
        bannedUsersList = JSON.parse(bannedUsersStr);
        if (!Array.isArray(bannedUsersList)) {
          bannedUsersList = [];
        }
      } catch (parseError) {
        bannedUsersList = [];
      }
    }
    
    // ✅ Extract senderId from notification data
    const senderId = remoteMessage?.data?.senderId || remoteMessage?.data?.sender_id || null;
    
    // ✅ Check if sender is blocked
    if (senderId && typeof senderId === 'string' && senderId.trim() !== '') {
      const normalizedSenderId = senderId.trim();
      if (bannedUsersList.includes(normalizedSenderId) || bannedUsersList.includes(senderId)) {
        // ✅ Sender is blocked, don't show notification
        // Return early to prevent notification display
        return;
      }
    }
    
    // ✅ Notification is allowed (not from blocked user), let OS handle it
    // Background notifications are automatically displayed by the OS/FCM
  } catch (error) {
    // ✅ On error, allow notification (fail open) to ensure users receive important notifications
    // This prevents blocking legitimate notifications if there's a storage/parsing error
    console.error('[Background Notification] Error checking blocked users:', error);
  }
});
class ErrorBoundary extends React.Component {
  state = { hasError: false };
  static getDerivedStateFromError(error) {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.error('Caught in ErrorBoundary:', error, info);
  }
  render() {
    return this.state.hasError ? <Text>Something went wrong.</Text> : this.props.children;
  }
}

// ✅ Memoized App component to prevent unnecessary re-renders
const App = React.memo(() => (
  <MenuProvider skipInstanceCheck>
  <LanguageProvider>
    <LocalStateProvider>
      <GlobalStateProvider>
        <ErrorBoundary>
          <AppWrapper />
        </ErrorBoundary>
        <FlashMessage
            position="top"
            floating
            statusBarHeight={STATUS_BAR_HEIGHT}
          />
        <Suspense fallback={null}>
          <NotificationHandler />
        </Suspense>
        {/* 👥 Global Group Invite Toast - Shows on any screen when user receives a group invitation */}
        <Suspense fallback={null}>
          <GlobalGroupInviteToast />
        </Suspense>
      </GlobalStateProvider>
    </LocalStateProvider>                
  </LanguageProvider>
</MenuProvider>

));

AppRegistry.registerComponent(appName, () => App);
