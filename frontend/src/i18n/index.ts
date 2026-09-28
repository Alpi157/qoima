import 'dayjs/locale/kk'
import 'dayjs/locale/ru'
import 'dayjs/locale/zh-cn'

import dayjs from 'dayjs'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { dayjsLocale, initialLanguage, isLanguage, LANGUAGE_CODES } from './language'
import kk from './locales/kk.json'
import ru from './locales/ru.json'
import zh from './locales/zh.json'

/** <html lang> and the dayjs locale (Mantine date pickers) follow the interface language. */
function syncLanguage(language: string): void {
  if (!isLanguage(language)) return
  document.documentElement.lang = language
  dayjs.locale(dayjsLocale(language))
}

i18n.on('languageChanged', syncLanguage)

// Resources are bundled, so initialisation is synchronous and nothing is fetched.
void i18n.use(initReactI18next).init({
  resources: { kk: { translation: kk }, ru: { translation: ru }, zh: { translation: zh } },
  lng: initialLanguage(),
  fallbackLng: 'ru',
  supportedLngs: LANGUAGE_CODES,
  initAsync: false,
  interpolation: { escapeValue: false },
})

export default i18n
