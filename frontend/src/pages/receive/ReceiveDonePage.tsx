import { Button } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { isApiError } from '../../api/errors'
import { DoneScreen } from '../../components/flow'
import { NotFoundState } from '../../components/NotFoundState'
import { PageLoader } from '../../components/PageLoader'
import { QueryError } from '../../components/QueryError'
import { PageContainer } from '../../components/ui'
import { formatInteger } from '../../lib/money'
import { parseId } from '../../lib/routeParams'
import { useReceipt } from '../receipts/api'

function ReceiptDone({ id }: { id: number }) {
  const { t } = useTranslation()
  const receipt = useReceipt(id)

  if (receipt.isPending) return <PageLoader />
  if (receipt.isError) {
    if (isApiError(receipt.error) && receipt.error.status === 404) {
      return (
        <NotFoundState
          title={t('receipts.notFound')}
          back={{ to: '/receive', label: t('receive.done.more') }}
        />
      )
    }
    return <QueryError error={receipt.error} onRetry={() => receipt.refetch()} />
  }

  return (
    <PageContainer>
      <DoneScreen
        color="blue"
        title={t('receive.done.title')}
        lines={[
          t('receive.done.summary', {
            kinds: receipt.data.lines.length,
            qty: formatInteger(receipt.data.total_qty),
          }),
        ]}
      >
        <Button component={Link} to="/receive" size="lg">
          {t('receive.done.more')}
        </Button>
        <Button component={Link} to="/stock" variant="default">
          {t('receive.done.stock')}
        </Button>
        <Button component={Link} to="/" variant="default">
          {t('nav.home')}
        </Button>
      </DoneScreen>
    </PageContainer>
  )
}

/** /receive/done/:id: the goods are in stock. */
export function ReceiveDonePage() {
  const { t } = useTranslation()
  const id = parseId(useParams().id)
  if (id === null) {
    return (
      <NotFoundState
        title={t('receipts.notFound')}
        back={{ to: '/receive', label: t('receive.done.more') }}
      />
    )
  }
  return <ReceiptDone id={id} />
}
