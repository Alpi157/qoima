import i18n from 'i18next'
import { describe, expect, it } from 'vitest'

import {
  applyLanguage,
  dayjsLocale,
  initialLanguage,
  intlLocale,
  LANGUAGE_STORAGE_KEY,
} from './language'
import { onlyKazakh } from '../test/i18n'

describe('initialLanguage', () => {
  it('takes the saved choice first', () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'zh')
    expect(initialLanguage(['ru-RU'])).toBe('zh')
  })

  it('ignores a saved value that is not a supported language', () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en')
    expect(initialLanguage(['ru'])).toBe('ru')
  })

  it.each([
    [['kk-KZ', 'ru'], 'kk'],
    [['ru-RU'], 'ru'],
    [['zh-Hans-CN'], 'zh'],
    [['en-US', 'zh-CN'], 'zh'],
  ])('takes the browser language %j', (languages, expected) => {
    expect(initialLanguage(languages)).toBe(expected)
  })

  it('defaults to Kazakh', () => {
    expect(initialLanguage(['en-US', 'de'])).toBe('kk')
    expect(initialLanguage([])).toBe('kk')
  })
})

describe('applyLanguage', () => {
  it('switches i18n, <html lang> and remembers the choice', async () => {
    await applyLanguage('zh')
    expect(i18n.language).toBe('zh')
    expect(document.documentElement.lang).toBe('zh')
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('zh')
    expect(dayjsLocale()).toBe('zh-cn')
    expect(intlLocale()).toBe('zh-CN')
  })

  it('falls back to Russian texts for an empty language', async () => {
    await onlyKazakh()
    await applyLanguage('kk')
    expect(i18n.t('more.sales')).toBe('История продаж')
  })
})
