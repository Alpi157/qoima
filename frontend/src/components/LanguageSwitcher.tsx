import { Button } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { currentLanguage, type Language, LANGUAGES } from '../i18n/language'

export interface LanguageSwitcherProps {
  /** Called with the chosen language; the caller switches and, after login, saves it. */
  onChange: (language: Language) => void
  disabled?: boolean
}

/** Three buttons, each language named in itself: «Қазақша», «Русский», «中文». */
export function LanguageSwitcher({ onChange, disabled = false }: LanguageSwitcherProps) {
  // useTranslation re-renders the buttons when the language changes.
  const { t } = useTranslation()
  const active = currentLanguage()

  return (
    <Button.Group aria-label={t('common.language')}>
      {LANGUAGES.map(({ code, label }) => (
        <Button
          key={code}
          size="xs"
          lang={code}
          variant={code === active ? 'filled' : 'default'}
          aria-pressed={code === active}
          disabled={disabled}
          onClick={() => {
            if (code !== active) onChange(code)
          }}
        >
          {label}
        </Button>
      ))}
    </Button.Group>
  )
}
