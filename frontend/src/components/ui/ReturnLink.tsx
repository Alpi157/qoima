import { Anchor } from '@mantine/core'
import { Link } from 'react-router-dom'

import { ArrowLeftIcon } from '../icons'

export interface ReturnLinkProps {
  to: string
  /** Where the link leads, from the translations: «Тағы», «Тауарлар». */
  label: string
}

/** The one way back on a page: a tertiary action, text only, body-strong, with a 20px arrow. */
export function ReturnLink({ to, label }: ReturnLinkProps) {
  return (
    <Anchor
      component={Link}
      to={to}
      fz="md"
      fw={600}
      lh="md"
      w="fit-content"
      display="inline-flex"
      style={{ alignItems: 'center', gap: 'var(--mantine-spacing-xs)' }}
      className="q-return-link"
    >
      <ArrowLeftIcon size={20} />
      {label}
    </Anchor>
  )
}
