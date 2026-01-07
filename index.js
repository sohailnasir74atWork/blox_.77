// 🏆 Optimize performance by enabling screens before any imports
import { enableScreens } from 'react-native-screens';
enableScreens(); 

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
// ✅ Background Notification Handler
messaging().setBackgroundMessageHandler(async remoteMessage => {
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
