import { Stack, UnstyledButton } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import {
  ChevronRightIcon,
  ReceiptIcon,
  SettingsIcon,
  TagIcon,
  TruckIcon,
  UsersIcon,
} from '../../components/icons'
import { PageContainer, PageHeader } from '../../components/ui'
import './MorePage.css'

const SECTIONS = [
  { to: '/products', label: 'more.products', icon: <TagIcon size={28} /> },
  { to: '/customers', label: 'more.customers', icon: <UsersIcon size={28} /> },
  { to: '/sales', label: 'more.sales', icon: <ReceiptIcon size={28} /> },
  { to: '/receipts', label: 'more.receipts', icon: <TruckIcon size={28} /> },
  { to: '/settings', label: 'more.settings', icon: <SettingsIcon size={28} /> },
] as const

/** «Тағы»: the detailed sections the owner needs rarely, as big labelled rows. */
export function MorePage() {
  const { t } = useTranslation()

  return (
    <PageContainer>
      <PageHeader title={t('more.title')} />
      <Stack gap="md" component="nav" aria-label={t('more.title')} maw={720}>
        {SECTIONS.map((section) => (
          <UnstyledButton key={section.to} component={Link} to={section.to} className="q-more-row">
            {section.icon}
            <span className="q-more-row-label">{t(section.label)}</span>
            <ChevronRightIcon />
          </UnstyledButton>
        ))}
      </Stack>
    </PageContainer>
  )
}
