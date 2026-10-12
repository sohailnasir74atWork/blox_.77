import React, { createContext, useContext, useState } from "react";
import i18n from "../../i18n";
import { setAppLanguage } from "../../i18n";

const LanguageContext = createContext();

export const LanguageProvider = ({ children }) => {
  const [language, setLanguage] = useState(i18n.language);

  const changeLanguage = async (lng) => {
    await setAppLanguage(lng);
    setLanguage(i18n.language);
  };

  return (
    <LanguageContext.Provider value={{ language, changeLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
