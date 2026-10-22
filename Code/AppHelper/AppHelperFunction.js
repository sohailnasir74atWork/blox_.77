// themes.js
import { DefaultTheme, DarkTheme } from '@react-navigation/native';


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



// The store review prompt lives in reviewPrompt.js.
