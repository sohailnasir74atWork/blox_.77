import { AppRegistry } from 'react-native';
import { enableScreens } from 'react-native-screens'; // Import enableScreens
import AppWrapper from './App'; // Import your main App component
import { name as appName } from './app.json';

// Enable optimized screen handling
enableScreens();

// Register the main application component
AppRegistry.registerComponent(appName, () => AppWrapper);
