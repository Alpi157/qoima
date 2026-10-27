import { Alert, Button, Group, Stack, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { api, unwrap } from '../../api/client'
import { CancelDocumentModal } from '../../components/CancelDocumentModal'
import { ListPagination } from '../../components/ListPagination'
import { PageLoader } from '../../components/PageLoader'
import { QueryError } from '../../components/QueryError'
import { ReportPeriod } from '../../components/ReportPeriod'
import { Card, DataTable, PageContainer, PageHeader, useBackToMore } from '../../components/ui'
import { formatDate, isCalendarDate, periodDays, quickRange } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { type Expense, useCancelExpense, useExpenses, usePreviousExpenses } from './api'
import { ExpenseModal } from './ExpenseModal'

function Cancellation({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const { t } = useTranslation()
  const cancel = useCancelExpense(expense.id)
  return (
    <CancelDocumentModal
      opened
      onClose={onClose}
      title={t('expenses.cancel.title', { number: expense.number })}
      description={t('expenses.cancel.description')}
      confirmLabel={t('expenses.cancel.confirm')}
      cancel={cancel}
      successMessage={(item) => t('expenses.cancel.done', { number: item.number })}
      quickReasons={['common.cancelDocument.quick.mistake']}
    />
  )
}

export function ExpensesPage() {
  const { t } = useTranslation()
  const back = useBackToMore()
  const [params, setParams] = useSearchParams()
  const rawFrom = params.get('from') ?? ''
  const rawTo = params.get('to') ?? ''
  const [from, to] =
    isCalendarDate(rawFrom) && isCalendarDate(rawTo) ? [rawFrom, rawTo] : quickRange('month')
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)
  const [repeating, setRepeating] = useState<Expense[] | null>(null)
  const [cancelling, setCancelling] = useState<Expense | null>(null)
  const error =
    to < from
      ? t('validation.report_period_order')
      : periodDays(from, to) > 366
        ? t('validation.report_period_too_long')
        : null
  const query = useExpenses(from, to, page, !error)
  const previous = usePreviousExpenses(...quickRange('previousMonth'))
  const focus = params.get('expenseFocus')
  const focused = useQuery({
    queryKey: ['expenses', 'document', focus],
    enabled: Boolean(focus && /^[1-9][0-9]*$/.test(focus)),
    queryFn: () =>
      unwrap(
        api.GET('/api/expenses/{expense_id}', { params: { path: { expense_id: Number(focus) } } }),
      ),
  })
  const changePeriod = (start: string, end: string) => {
    setPage(1)
    setParams({ from: start, to: end }, { replace: true })
  }
  const status = (item: Expense) =>
    item.status === 'cancelled' ? (
      <Stack gap="xs">
        <Text>{t('expenses.cancelled')}</Text>
        <Text size="sm">{item.cancel_reason}</Text>
      </Stack>
    ) : (
      <Button size="sm" variant="default" onClick={() => setCancelling(item)}>
        {t('expenses.cancel.confirm')}
      </Button>
    )
  const details = (item: Expense) => (
    <Stack gap="xs">
      <Text fw={600}>
        {t(`expenses.categories.${item.category}`)} · №{item.number}
      </Text>
      <Text>
        {formatDate(item.expense_date)} · {formatMoney(item.amount)}
      </Text>
      {item.note && <Text style={{ overflowWrap: 'anywhere' }}>{item.note}</Text>}
      {status(item)}
    </Stack>
  )
  return (
    <PageContainer>
      <PageHeader back={back} title={t('expenses.title')} />
      <ReportPeriod from={from} to={to} onChange={changePeriod} />
      <Card>
        <Stack gap="md">
          <Group justify="space-between">
            <Text size="xl" fw={600}>
              {t('expenses.total', {
                amount: query.data ? formatMoney(query.data.posted_amount) : '—',
              })}
            </Text>
            <Button size="lg" onClick={() => setAdding(true)}>
              {t('expenses.add')}
            </Button>
          </Group>
          {previous.data && previous.data.length > 0 && (
            <Button
              variant="default"
              style={{
                height: 'auto',
                minHeight: 56,
                whiteSpace: 'normal',
                alignSelf: 'flex-start',
              }}
              onClick={() => setRepeating([...previous.data])}
            >
              {t('expenses.repeat')}
            </Button>
          )}
          {previous.isError && (
            <QueryError error={previous.error} onRetry={() => previous.refetch()} />
          )}
        </Stack>
      </Card>
      {focused.data && (
        <Card data-testid="focused-expense">
          {details(focused.data)}
          <Button variant="subtle" onClick={() => setParams({ from, to }, { replace: true })}>
            {t('flow.draft.close')}
          </Button>
        </Card>
      )}
      {focused.isError && <QueryError error={focused.error} onRetry={() => focused.refetch()} />}
      {error ? (
        <Alert color="red">{error}</Alert>
      ) : query.isPending ? (
        <PageLoader />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => query.refetch()} />
      ) : query.data.total === 0 ? (
        <Card>
          <Text>{t('expenses.empty')}</Text>
        </Card>
      ) : (
        <>
          <DataTable
            rows={query.data.items}
            rowKey={(item) => item.id}
            dimmed={(item) => item.status === 'cancelled'}
            columns={[
              {
                key: 'date',
                header: t('expenses.date'),
                cell: (item) => formatDate(item.expense_date),
                nowrap: true,
              },
              {
                key: 'category',
                header: t('expenses.category'),
                cell: (item) => t(`expenses.categories.${item.category}`),
              },
              {
                key: 'amount',
                header: t('expenses.amount'),
                cell: (item) => formatMoney(item.amount),
                numeric: true,
              },
              {
                key: 'note',
                header: t('expenses.note'),
                cell: (item) => <Text style={{ overflowWrap: 'anywhere' }}>{item.note}</Text>,
              },
              { key: 'number', header: '№', cell: (item) => item.number },
              { key: 'action', header: '', cell: status },
            ]}
            mobileCard={details}
          />
          <ListPagination total={query.data.total} page={page} onChange={setPage} />
        </>
      )}
      <ExpenseModal opened={adding} onClose={() => setAdding(false)} />
      <ExpenseModal
        opened={repeating !== null}
        source={repeating ?? undefined}
        onClose={() => setRepeating(null)}
      />
      {cancelling && <Cancellation expense={cancelling} onClose={() => setCancelling(null)} />}
    </PageContainer>
  )
}
