import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import * as RNLocalize from "react-native-localize";
import { MMKV } from "react-native-mmkv";

// Import translation files
import en from "./Code/Translation/en.json";
import fil from "./Code/Translation/fil.json";
import vi from "./Code/Translation/vi.json";
import pt from "./Code/Translation/pt.json";
import id from "./Code/Translation/id.json";
import es from "./Code/Translation/es.json";
import fr from "./Code/Translation/fr.json";
import de from "./Code/Translation/de.json";
import ru from "./Code/Translation/ru.json";
import ar from "./Code/Translation/ar.json";

// Initialize MMKV storage
const storage = new MMKV();

// Map country codes to languages
const countryToLanguage = {
  BR: "pt",
  PH: "fil",
  VN: "vi",
  ID: "id",
  US: "en",
  MX: "es",
  FR: "fr",
  DE: "de",
  RU: "ru",
  IN: "en",
  AR: "ar",
};

// Function to get saved language from MMKV
const getStoredLanguage = () => {
  return storage.getString("appLanguage") || null;
};

// Function to get the device language
export const getDeviceLanguage = () => {
  const locales = RNLocalize.getLocales();
  return locales.length > 0 ? locales[0].languageCode : 'en';
};


// Determine initial language
const initialLanguage = getStoredLanguage() || 'en';

// Initialize i18next
i18n
  .use(initReactI18next)
  .init({
    compatibilityJSON: "v3",
    resources: {
      en: { translation: en },
      fil: { translation: fil },
      vi: { translation: vi },
      pt: { translation: pt },
      id: { translation: id },
      es: { translation: es },
      fr: { translation: fr },
      de: { translation: de },
      ru: { translation: ru },
      ar: { translation: ar },
    },
    lng: initialLanguage, // Set initial language
    fallbackLng: "en", // Default fallback language
    interpolation: {
      escapeValue: false,
    },
  });

// Function to update language and store in MMKV
export const setAppLanguage = (languageCode) => {
  i18n.changeLanguage(languageCode);
  storage.set("appLanguage", languageCode);
};

export default i18n;
