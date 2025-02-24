import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import * as RNLocalize from "react-native-localize";

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

// Map country codes to languages
const countryToLanguage = {
  BR: "pt",  // Brazil -> Portuguese
  PH: "fil", // Philippines -> Filipino
  VN: "vi",  // Vietnam -> Vietnamese
  ID: "id",  // Indonesia -> Indonesian
  US: "en",  // United States -> English
  MX: "es",  // Mexico -> Spanish
  FR: "fr",  // France -> French
  DE: "de",  // Germany -> German
  RU: "ru",  // Russia -> Russian
  IN: "en",  // India -> English (Default)
};

// Detect the device's language setting
const getDeviceLanguage = () => {
  const locales = RNLocalize.getLocales();
  return locales.length > 0 ? locales[0].languageCode : "en";
};

// Initialize i18next
i18n
  .use(initReactI18next)
  .init({
    compatibilityJSON: 'v3',
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
    },
    lng: getDeviceLanguage(), // Set the detected language
    fallbackLng: "en", // Default to English if translation is missing
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
