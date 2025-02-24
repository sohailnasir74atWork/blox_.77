import { enableScreens } from 'react-native-screens';
enableScreens(); // Call this first

import { AppRegistry } from 'react-native';
import AppWrapper from './App';
import { name as appName } from './app.json';
import { GlobalStateProvider } from './Code/GlobelStats';
import { LocalStateProvider } from './Code/LocalGlobelStats';
import { MenuProvider } from 'react-native-popup-menu';
import { LanguageProvider } from './Code/Translation/LanguageProvider';

const App = () => (
    <LocalStateProvider>
        <GlobalStateProvider>
            <MenuProvider>
              <LanguageProvider>
                <AppWrapper />
                </LanguageProvider>
            </MenuProvider>
        </GlobalStateProvider>
    </LocalStateProvider>
);

AppRegistry.registerComponent(appName, () => App);