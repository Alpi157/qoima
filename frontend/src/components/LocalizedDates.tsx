import { DatesProvider } from '@mantine/dates'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { dayjsLocale } from '../i18n/language'

/** Mantine date pickers follow the interface language (month and weekday names). */
export function LocalizedDates({ children }: { children: ReactNode }) {
  // Re-renders on a language switch; the locale itself is read from i18n.
  useTranslation()
  return <DatesProvider settings={{ locale: dayjsLocale() }}>{children}</DatesProvider>
}
