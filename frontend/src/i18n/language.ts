import i18n from 'i18next'

export const LANGUAGES = [
  { code: 'kk', label: 'Қазақша' },
  { code: 'ru', label: 'Русский' },
  { code: 'zh', label: '中文' },
] as const

export type Language = (typeof LANGUAGES)[number]['code']

export const LANGUAGE_CODES: readonly Language[] = LANGUAGES.map((language) => language.code)

export const DEFAULT_LANGUAGE: Language = 'kk'

/** The language chosen on this device before login; the server keeps it after login. */
export const LANGUAGE_STORAGE_KEY = 'qoima.language'

const INTL_LOCALES: Record<Language, string> = { kk: 'kk-KZ', ru: 'ru-RU', zh: 'zh-CN' }

const DAYJS_LOCALES: Record<Language, string> = { kk: 'kk', ru: 'ru', zh: 'zh-cn' }

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGE_CODES as readonly string[]).includes(value)
}

/** The current interface language; anything unexpected counts as the default. */
export function currentLanguage(): Language {
  return isLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE
}

/** Locale for Intl formatters: "kk" -> "kk-KZ". */
export function intlLocale(language: Language = currentLanguage()): string {
  return INTL_LOCALES[language]
}

/** Locale name for dayjs and Mantine dates: "zh" -> "zh-cn". */
export function dayjsLocale(language: Language = currentLanguage()): string {
  return DAYJS_LOCALES[language]
}

function storedLanguage(): Language | null {
  try {
    const value = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    return isLanguage(value) ? value : null
  } catch {
    return null
  }
}

/** "kk-KZ", "zh-Hans-CN", "ru" -> a supported language, or null. */
function browserLanguage(languages: readonly string[]): Language | null {
  for (const tag of languages) {
    const primary = tag.toLowerCase().split('-')[0]
    if (isLanguage(primary)) return primary
  }
  return null
}

/** Before login: the saved choice, else the browser's language, else Kazakh. */
export function initialLanguage(
  languages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages,
): Language {
  return storedLanguage() ?? browserLanguage(languages) ?? DEFAULT_LANGUAGE
}

/** Switches the interface and remembers the choice on this device. */
export async function applyLanguage(language: Language): Promise<void> {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // Private mode or blocked storage: the language still changes for this visit.
  }
  if (i18n.language !== language) await i18n.changeLanguage(language)
}
