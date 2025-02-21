import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import * as RNLocalize from "react-native-localize";

// Import translation files
import en from './Code/Translation/en.json';
import fr from "./Code/Translation/fr.json";

// Detect user's device language
const getDeviceLanguage = () => {
  const locales = RNLocalize.getLocales();
  return locales.length > 0 ? locales[0].languageCode : "en";
};

// Set up translations
i18n
  .use(initReactI18next)
  .init({
    compatibilityJSON: 'v3', // Fix for older Android versions
    resources: {
      en: { translation: en },
      fr: { translation: fr },
    },
    lng: getDeviceLanguage(), // Set the detected language
    fallbackLng: "en", // Fallback to English if translation is missing
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
