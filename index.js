// 🏆 Optimize performance by enabling screens before any imports
import { enableScreens } from 'react-native-screens';
enableScreens(); 

import React, { useEffect, lazy, Suspense } from 'react';
import { AppRegistry } from 'react-native';
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

// ✅ Background Notification Handler
messaging().setBackgroundMessageHandler(async remoteMessage => {
  // console.log('📩 Silent notification received in background:', remoteMessage);
});

// ✅ Memoized App component to prevent unnecessary re-renders
const App = React.memo(() => (
  <LanguageProvider>
    <LocalStateProvider>
      <GlobalStateProvider>
        <MenuProvider>
          <AppWrapper />
          <Suspense fallback={null}>
          <FlashMessage position="top" />
            <NotificationHandler />
          </Suspense>
        </MenuProvider>
      </GlobalStateProvider>
    </LocalStateProvider>                
  </LanguageProvider>
));

AppRegistry.registerComponent(appName, () => App);
