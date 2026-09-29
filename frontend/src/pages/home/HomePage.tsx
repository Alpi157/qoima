import './HomePage.css'

import { Button, Group, Loader, SimpleGrid, Stack, Text } from '@mantine/core'
import type { ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useMe } from '../../auth/useMe'
import { BoxIcon, CartIcon, WarehouseIcon } from '../../components/icons'
import { QueryError } from '../../components/QueryError'
import { Card, PageContainer, PageHeader } from '../../components/ui'
import { todayLocal } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { MORE_PATH } from '../../lib/nextPath'
import { useSales } from '../sales/api'

interface TileProps {
  to: string
  kind: 'sell' | 'receive' | 'stock'
  icon: ReactNode
  title: string
  hint: string
}

function Tile({ to, kind, icon, title, hint }: TileProps) {
  return (
    <Link to={to} className="home-tile" data-kind={kind}>
      {icon}
      <Stack gap="xs" component="span">
        <span className="home-tile-title">{title}</span>
        <span className="home-tile-hint">{hint}</span>
      </Stack>
    </Link>
  )
}

/** «Бүгін: 2 сатылым, барлығы 38 400 ₸»: posted sales of today in Almaty. */
function TodaySales() {
  const today = todayLocal()
  const sales = useSales({ from: today, to: today, status: 'posted', page: 1 })

  if (sales.isPending) return <Loader size="sm" />
  if (sales.isError) return <QueryError error={sales.error} onRetry={() => sales.refetch()} />
  return (
    <Text fz="lg" lh="lg" data-testid="today-sales">
      <Trans
        i18nKey="home.today"
        count={sales.data.total}
        values={{ amount: formatMoney(sales.data.sum_posted) }}
        components={{ b: <b /> }}
      />
    </Text>
  )
}

export function HomePage() {
  const { data: me } = useMe()
  const { t } = useTranslation()

  return (
    <PageContainer>
      <PageHeader
        title={t('home.greeting', { name: me?.full_name ?? '' })}
        subtitle={t('home.question')}
      />

      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg">
        <Tile
          to="/sell"
          kind="sell"
          icon={<CartIcon size={48} strokeWidth={1.7} />}
          title={t('home.sell.title')}
          hint={t('home.sell.hint')}
        />
        <Tile
          to="/receive"
          kind="receive"
          icon={<BoxIcon size={48} strokeWidth={1.7} />}
          title={t('home.receive.title')}
          hint={t('home.receive.hint')}
        />
        <Tile
          to="/stock"
          kind="stock"
          icon={<WarehouseIcon size={48} strokeWidth={1.7} />}
          title={t('home.stock.title')}
          hint={t('home.stock.hint')}
        />
      </SimpleGrid>

      <Card>
        <Group justify="space-between" gap="md">
          <TodaySales />
          <Group gap="sm">
            <Button component={Link} to="/sales" variant="default">
              {t('home.salesHistory')}
            </Button>
            <Button component={Link} to={MORE_PATH} variant="default">
              {t('home.more')}
            </Button>
          </Group>
        </Group>
      </Card>
    </PageContainer>
  )
}
