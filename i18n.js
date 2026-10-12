import {trackGrowthEvent} from './Code/Helper/growthAnalytics';
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import * as RNLocalize from "react-native-localize";
import { createMMKV } from "react-native-mmkv";
import dayjs from "dayjs";
import "dayjs/locale/tl-ph";
import "dayjs/locale/vi";
import "dayjs/locale/pt-br";
import "dayjs/locale/id";
import "dayjs/locale/es";
import "dayjs/locale/fr";
import "dayjs/locale/de";
import "dayjs/locale/ru";
import "dayjs/locale/ar";
import "dayjs/locale/ja";

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
import ja from "./Code/Translation/ja.json";

// Initialize MMKV storage
const storage = createMMKV();

// Map country codes to languages
// Function to get saved language from MMKV
const getStoredLanguage = () => {
  return storage.getString("appLanguage") || null;
};

// Function to get the device language
export const getDeviceLanguage = () => {
  const locales = RNLocalize.getLocales();
  if (!locales.length) return 'en';
  const { languageCode, countryCode } = locales[0];
  if (languageCode === 'tl' || languageCode === 'fil') return 'fil';
  if (languageCode === 'pt') return 'pt';
  if (languageCode === 'es') return 'es';
  if (languageCode === 'zh') return 'en';
  return SUPPORTED_LANGUAGES.includes(languageCode) ? languageCode
    : countryToLanguage[countryCode] || 'en';
};


const SUPPORTED_LANGUAGES = ['en', 'fil', 'vi', 'pt', 'id', 'es', 'fr', 'de', 'ru', 'ar', 'ja'];
const countryToLanguage = {
  BR: 'pt', PH: 'fil', VN: 'vi', ID: 'id', MX: 'es',
  FR: 'fr', DE: 'de', RU: 'ru', AR: 'es', JP: 'ja', // AR = Argentina
};

// Determine initial language
const savedLanguage = getStoredLanguage();
const deviceLanguage = getDeviceLanguage();
const initialLanguage = SUPPORTED_LANGUAGES.includes(savedLanguage) ? savedLanguage
  : SUPPORTED_LANGUAGES.includes(deviceLanguage) ? deviceLanguage : 'en';

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
      ja: { translation: ja },
    },
    lng: initialLanguage, // Set initial language
    fallbackLng: "en", // Default fallback language
    interpolation: {
      escapeValue: false,
    },
  });

// dayjs dates and "5 minutes ago" follow the app language, not English.
const DAYJS_LOCALE = { fil: "tl-ph", pt: "pt-br" };
const syncDayjsLocale = (lng) =>
  dayjs.locale(SUPPORTED_LANGUAGES.includes(lng) ? DAYJS_LOCALE[lng] || lng : "en");
syncDayjsLocale(initialLanguage);
i18n.on("languageChanged", syncDayjsLocale);

// Function to update language and store in MMKV
export const setAppLanguage = (languageCode) => {
  if (!SUPPORTED_LANGUAGES.includes(languageCode)) return Promise.resolve(i18n.language);
  const change = i18n.changeLanguage(languageCode);
  storage.set("appLanguage", languageCode);
  trackGrowthEvent("app_language_selected", { language: languageCode });
  return change;
};

export default i18n;
