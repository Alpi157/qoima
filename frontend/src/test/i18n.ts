import i18n from 'i18next'

/**
 * Switches to Kazakh with these texts on top of the bundled ones, to check that a screen
 * really reads the current language. test/setup.ts restores the real resources.
 */
export async function fakeKazakh(texts: object): Promise<void> {
  i18n.addResourceBundle('kk', 'translation', texts, true, true)
  await i18n.changeLanguage('kk')
}

/** Switches to Kazakh with only these texts, to check the fallback to Russian. */
export async function onlyKazakh(texts: object = {}): Promise<void> {
  i18n.removeResourceBundle('kk', 'translation')
  await fakeKazakh(texts)
}
