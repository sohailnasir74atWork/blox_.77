// themes.js
import { DefaultTheme, DarkTheme } from '@react-navigation/native';
import InAppReview from 'react-native-in-app-review';


export const MyLightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#f2f2f7',
    text: 'black',
    primary: '#3E8BFC',
  },
};

export const MyDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#0f172a',
    text: 'white',
    primary: '#BB86FC',
  },
};



// reviewHelper.js

export const requestReview = () => {
  if (InAppReview.isAvailable()) {
    InAppReview.RequestInAppReview()
      .then(() => {/* console.log('In-App review flow completed') */ })
      .catch((error) => {/* console.error('In-App review error:', error) */ });
  }
};
