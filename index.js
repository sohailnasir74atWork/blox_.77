import { enableScreens } from 'react-native-screens';
enableScreens(); // Call this first

import { AppRegistry } from 'react-native';
import AppWrapper from './App';
import { name as appName } from './app.json';
import { GlobalStateProvider } from './Code/GlobelStats';
import { LocalStateProvider } from './Code/LocalGlobelStats';
import { MenuProvider } from 'react-native-popup-menu';
import { LanguageProvider } from './Code/Translation/LanguageProvider';
import messaging from '@react-native-firebase/messaging';
import NotificationHandler from './Code/Firebase/FrontendNotificationHandling';

messaging().setBackgroundMessageHandler(async remoteMessage => {
    //   console.log('📩 Silent notification received in background:', remoteMessage);
});



const App = () => (
<LanguageProvider>
    <LocalStateProvider>
        <GlobalStateProvider>
            <MenuProvider>
                <AppWrapper />
                <NotificationHandler />
            </MenuProvider>
        </GlobalStateProvider>
    </LocalStateProvider>                
</LanguageProvider>

);

AppRegistry.registerComponent(appName, () => App);