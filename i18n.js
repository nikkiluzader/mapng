import { createI18n } from 'vue-i18n';
import fr from './locales/fr.json';
import it from './locales/it.json';
import pl from './locales/pl.json';
import en from './locales/en.json';
import de from './locales/de.json';
import es from './locales/es.json';
import ru from './locales/ru.json';

const STORAGE_KEY = 'mapng_locale';
const FALLBACK_LOCALE = 'en';

const messages = {
  fr,
  it,
  pl,
  en,
  de,
  es,
  ru,
};

const supportedLocales = Object.keys(messages);

function resolveInitialLocale() {
  const persisted = localStorage.getItem(STORAGE_KEY);
  if (persisted && supportedLocales.includes(persisted)) {
    return persisted;
  }

  const browserLocale = (navigator.language || FALLBACK_LOCALE).toLowerCase();
  const exactMatch = supportedLocales.find((locale) => locale.toLowerCase() === browserLocale);
  if (exactMatch) return exactMatch;

  const shortLocale = browserLocale.split('-')[0];
  const shortMatch = supportedLocales.find((locale) => locale.toLowerCase() === shortLocale);
  if (shortMatch) return shortMatch;

  return FALLBACK_LOCALE;
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: resolveInitialLocale(),
  fallbackLocale: FALLBACK_LOCALE,
  messages,
});

export function setI18nLanguage(locale) {
  const resolved = supportedLocales.includes(locale) ? locale : FALLBACK_LOCALE;
  i18n.global.locale.value = resolved;
  localStorage.setItem(STORAGE_KEY, resolved);
  document.documentElement.setAttribute('lang', resolved);
  // (the desktop app's own menu follows the window's language: desktop/menuText.js)
  try { globalThis.window?.mapngDesktop?.setLanguage?.(resolved); } catch { /* the website: no menu */ }
}

export function getSupportedLocales() {
  return [...supportedLocales];
}
