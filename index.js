import React, { lazy, Suspense } from 'react';
import { AppRegistry, Platform, StatusBar, Text } from 'react-native';
import { getCrashlytics, recordError, log as crashlyticsLog } from '@react-native-firebase/crashlytics';
import AppWrapper from './App';
import { name as appName } from './app.json';
import { GlobalStateProvider } from './Code/GlobelStats';
import { LocalStateProvider } from './Code/LocalGlobelStats';
import { MenuProvider } from 'react-native-popup-menu';
import { LanguageProvider } from './Code/Translation/LanguageProvider';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import { createMMKV } from 'react-native-mmkv';
import FlashMessage from 'react-native-flash-message';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// 🚀 Lazy load Notification Handler for better startup performance
const NotificationHandler = lazy(() => import('./Code/Firebase/FrontendNotificationHandling'));

// 👥 Lazy load Global Group Invite Toast for group invitations
const GlobalGroupInviteToast = lazy(() => import('./Code/ValuesScreen/GlobalGroupInviteToast'));

// ✅ Create a messaging instance (default Firebase app)
const messaging = getMessaging();

// ✅ Create MMKV storage instance for background access
const storage = createMMKV();

// ✅ Helper function to safely parse JSON from storage
const safeParseJSON = (key, defaultValue) => {
  try {
    const value = storage.getString(key);
    return value ? JSON.parse(value) : defaultValue;
  } catch (error) {
    return defaultValue;
  }
};

const STATUS_BAR_HEIGHT = Platform.OS === 'android' ? StatusBar.currentHeight || 18 : 44;

// ✅ Background Notification Handler (modular API)
setBackgroundMessageHandler(messaging, async remoteMessage => {
  try {
    if (!remoteMessage) return;

    const { data } = remoteMessage || {};
    const senderId = data?.senderId || data?.sender_id || null;

    if (senderId && typeof senderId === 'string' && senderId.trim() !== '') {
      const bannedUsers = safeParseJSON('bannedUsers', []);
      if (Array.isArray(bannedUsers) && bannedUsers.includes(senderId.trim())) {
        return;
      }
    }
  } catch (error) {
    // Fail open to ensure users receive important notifications
  }
});

// 🔥 Global JS error handler → Crashlytics (modular API)
const crashlyticsInstance = getCrashlytics();
const originalHandler = ErrorUtils.getGlobalHandler();
ErrorUtils.setGlobalHandler((error, isFatal) => {
  try {
    recordError(crashlyticsInstance, error);
    crashlyticsLog(crashlyticsInstance, `Global error | Fatal: ${isFatal} | ${error?.message || error}`);
  } catch (_) {}
  originalHandler(error, isFatal);
});

class ErrorBoundary extends React.Component {
  state = { hasError: false };
  static getDerivedStateFromError(error) {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.error('Caught in ErrorBoundary:', error, info);
    try {
      recordError(crashlyticsInstance, error);
      crashlyticsLog(crashlyticsInstance, `ErrorBoundary: ${info?.componentStack || 'no stack'}`);
    } catch (_) {}
  }
  render() {
    return this.state.hasError ? <Text>Something went wrong.</Text> : this.props.children;
  }
}

// ✅ Memoized App component to prevent unnecessary re-renders
const App = React.memo(() => (
  <SafeAreaProvider>
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
              <GlobalGroupInviteToast />
            </Suspense>
          </GlobalStateProvider>
        </LocalStateProvider>
      </LanguageProvider>
    </MenuProvider>
  </SafeAreaProvider>
));

AppRegistry.registerComponent(appName, () => App);
