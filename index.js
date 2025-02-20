import { AppRegistry } from 'react-native';
import { enableScreens } from 'react-native-screens'; // Import enableScreens
import AppWrapper from './App'; // Import your main App component
import { name as appName } from './app.json';
import { GlobalStateProvider } from './Code/GlobelStats';
import { LocalStateProvider } from './Code/LocalGlobelStats';
import { MenuProvider } from 'react-native-popup-menu';

// Enable optimized screen handling
enableScreens();

const App = () => (
    <LocalStateProvider>
    <GlobalStateProvider>

        <MenuProvider>
      <AppWrapper />
      </MenuProvider>
    </GlobalStateProvider>
    </LocalStateProvider>
  );

// Register the main application component
AppRegistry.registerComponent(appName, () => App);
