import { useTranslation } from 'react-i18next'

import { MORE_PATH } from '../../lib/nextPath'
import type { ReturnLinkProps } from './ReturnLink'

/** «← Тағы»: the way back from the list of a detailed section. */
export function useBackToMore(): ReturnLinkProps {
  const { t } = useTranslation()
  return { to: MORE_PATH, label: t('nav.backToMore') }
}
