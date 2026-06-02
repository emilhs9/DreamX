import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en/translation.json";
import az from "./locales/az/translation.json";
import ru from "./locales/ru/translation.json";
import tr from "./locales/tr/translation.json";
import de from "./locales/de/translation.json";
import fr from "./locales/fr/translation.json";
import es from "./locales/es/translation.json";
import ar from "./locales/ar/translation.json";
import zh from "./locales/zh/translation.json";
import ja from "./locales/ja/translation.json";

export const languages = [
  { code: "en", name: "English", label: "EN" },
  { code: "az", name: "Azərbaycan", label: "AZ" },
  { code: "ru", name: "Русский", label: "RU" },
  { code: "tr", name: "Türkçe", label: "TR" },
  { code: "de", name: "Deutsch", label: "DE" },
  { code: "fr", name: "Français", label: "FR" },
  { code: "es", name: "Español", label: "ES" },
  { code: "ar", name: "العربية", label: "AR" },
  { code: "zh", name: "中文", label: "ZH" },
  { code: "ja", name: "日本語", label: "JA" }
] as const;

export const rtlLanguages = new Set(["ar"]);

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    az: { translation: az },
    ru: { translation: ru },
    tr: { translation: tr },
    de: { translation: de },
    fr: { translation: fr },
    es: { translation: es },
    ar: { translation: ar },
    zh: { translation: zh },
    ja: { translation: ja }
  },
  lng: localStorage.getItem("dreamx_lang") || "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false }
});

export default i18n;
