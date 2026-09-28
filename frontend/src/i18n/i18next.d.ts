import 'i18next'

import type ru from './locales/ru.json'

// Keys passed to t() are checked against ru.json at compile time.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof ru }
  }
}
