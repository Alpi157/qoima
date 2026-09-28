import '../i18n'

import { cleanup } from '@testing-library/react'
import i18n from 'i18next'
import { afterEach, beforeEach } from 'vitest'

import kk from '../i18n/locales/kk.json'

// jsdom lacks these browser APIs; Mantine uses them for media queries, autosize and comboboxes.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// Combobox scrolls the highlighted option into view.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// Autosize textareas listen for web fonts loading.
if (!document.fonts) {
  Object.defineProperty(document, 'fonts', {
    value: { addEventListener: () => {}, removeEventListener: () => {} },
  })
}

// Tests read the Russian texts; a test that switches the language or fakes Kazakh
// texts (test/i18n.ts) gets the real resources and Russian back.
beforeEach(async () => {
  window.localStorage.clear()
  i18n.removeResourceBundle('kk', 'translation')
  i18n.addResourceBundle('kk', 'translation', kk)
  await i18n.changeLanguage('ru')
})

afterEach(() => {
  cleanup()
})
