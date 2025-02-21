import { enableScreens } from 'react-native-screens';
enableScreens(); // Call this first

import { AppRegistry } from 'react-native';
import AppWrapper from './App';
import { name as appName } from './app.json';
import { GlobalStateProvider } from './Code/GlobelStats';
import { LocalStateProvider } from './Code/LocalGlobelStats';
import { MenuProvider } from 'react-native-popup-menu';
import { I18nextProvider } from 'react-i18next';
import i18n from './i18n';

const App = () => (
  <I18nextProvider i18n={i18n}>
    <LocalStateProvider>
        <GlobalStateProvider>
            <MenuProvider>
                <AppWrapper />
            </MenuProvider>
        </GlobalStateProvider>
    </LocalStateProvider>
    </I18nextProvider>
);

AppRegistry.registerComponent(appName, () => App);