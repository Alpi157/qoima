import { Anchor } from '@mantine/core'
import { Link } from 'react-router-dom'

export interface ReturnLinkProps {
  to: string
  /** With the arrow, from the translations: «← Тағы», «← Тауарлар». */
  label: string
}

/** The one way back on a page: a tertiary action, text only, body-strong. */
export function ReturnLink({ to, label }: ReturnLinkProps) {
  return (
    <Anchor component={Link} to={to} fz="md" fw={600} lh="md" w="fit-content">
      {label}
    </Anchor>
  )
}
