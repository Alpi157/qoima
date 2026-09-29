import { Button } from '@mantine/core'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { DoneScreen } from '../../components/flow'
import { PrintIcon } from '../../components/icons'
import { NotFoundState } from '../../components/NotFoundState'
import { PageLoader } from '../../components/PageLoader'
import { QueryError } from '../../components/QueryError'
import { PageContainer } from '../../components/ui'
import { formatMoney } from '../../lib/money'
import { parseId } from '../../lib/routeParams'
import { isApiError } from '../../api/errors'
import { useSale } from '../sales/api'

function SaleDone({ id }: { id: number }) {
  const { t } = useTranslation()
  const sale = useSale(id)

  if (sale.isPending) return <PageLoader />
  if (sale.isError) {
    if (isApiError(sale.error) && sale.error.status === 404) {
      return (
        <NotFoundState
          title={t('sales.notFound')}
          back={{ to: '/sell', label: t('sell.done.newSale') }}
        />
      )
    }
    return <QueryError error={sale.error} onRetry={() => sale.refetch()} />
  }

  const { number, customer, total } = sale.data
  return (
    <PageContainer>
      <DoneScreen
        color="green"
        title={t('sell.done.title')}
        lines={[
          t('sell.done.number', { number }),
          <Trans
            key="customer"
            i18nKey="sell.done.customer"
            values={{ name: customer?.name ?? t('sell.review.retail') }}
            components={{ b: <b /> }}
          />,
          <Trans
            key="amount"
            i18nKey="sell.done.amount"
            values={{ amount: formatMoney(total) }}
            components={{ b: <b /> }}
          />,
        ]}
      >
        <Button
          component={Link}
          to={`/sales/${id}/print?auto=1`}
          size="lg"
          leftSection={<PrintIcon />}
        >
          {t('sell.done.print')}
        </Button>
        <Button component={Link} to="/sell" color="green" variant="light">
          {t('sell.done.newSale')}
        </Button>
        <Button component={Link} to="/" variant="default">
          {t('nav.home')}
        </Button>
      </DoneScreen>
    </PageContainer>
  )
}

/** /sell/done/:id: the sale is saved; print it or start the next one. */
export function SellDonePage() {
  const { t } = useTranslation()
  const id = parseId(useParams().id)
  if (id === null) {
    return (
      <NotFoundState
        title={t('sales.notFound')}
        back={{ to: '/sell', label: t('sell.done.newSale') }}
      />
    )
  }
  return <SaleDone id={id} />
}
