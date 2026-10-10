import { Alert, Anchor, Button, Group, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { EmptyState } from '../../components/EmptyState'
import { ListPagination } from '../../components/ListPagination'
import { PageLoader } from '../../components/PageLoader'
import { PeriodInput } from '../../components/PeriodInput'
import { QueryError } from '../../components/QueryError'
import {
  Card,
  DataTable,
  PageContainer,
  PageHeader,
  RowLink,
  SectionTitle,
  Stat,
  useBackToMore,
} from '../../components/ui'
import { formatDate, isCalendarDate, periodDays, quickRange } from '../../lib/dates'
import { unitLabel } from '../../lib/labels'
import { formatAmount, formatInteger, formatMoney, formatRoundedMoney } from '../../lib/money'
import { PAGE_SIZE } from '../../lib/pagination'
import {
  useReportCustomers,
  useReportProducts,
  useReportSummary,
  type ReportProduct,
  type ReportSummary,
} from './api'
import { ReportChart } from './ReportChart'

const PERIODS = [
  { value: 'today', label: 'report.today' },
  { value: 'week', label: 'report.week' },
  { value: 'month', label: 'report.month' },
  { value: 'previousMonth', label: 'report.previousMonth' },
] as const

function ReportPeriod({
  from,
  to,
  onChange,
}: {
  from: string
  to: string
  onChange: (from: string, to: string) => void
}) {
  const { t } = useTranslation()
  const [custom, setCustom] = useState(false)
  const preset = PERIODS.find(({ value }) => {
    const range = quickRange(value)
    return range[0] === from && range[1] === to
  })?.value
  return (
    <Card>
      <Stack gap="md">
        <Group gap="xs" role="group" aria-label={t('common.period.label')}>
          {PERIODS.map(({ value, label }) => (
            <Button
              key={value}
              variant={!custom && preset === value ? 'light' : 'default'}
              aria-pressed={!custom && preset === value}
              onClick={() => {
                setCustom(false)
                onChange(...quickRange(value))
              }}
            >
              {t(label)}
            </Button>
          ))}
          <Button
            variant={custom || !preset ? 'light' : 'default'}
            aria-pressed={custom || !preset}
            onClick={() => setCustom(true)}
          >
            {t('report.custom')}
          </Button>
        </Group>
        {custom || !preset ? (
          <PeriodInput
            from={from}
            to={to}
            onChange={(start, end) =>
              onChange(...(start && end ? ([start, end] as [string, string]) : quickRange('month')))
            }
          />
        ) : (
          <Text c="dimmed">
            {formatDate(from)} · {formatDate(to)}
          </Text>
        )}
      </Stack>
    </Card>
  )
}

function Profit({
  amount,
  revenue,
  unknownRevenue,
}: {
  amount: number
  revenue: number
  unknownRevenue: number
}) {
  const { t } = useTranslation()
  if (unknownRevenue === revenue) return <Text c="dimmed">{t('products.card.unknown')}</Text>
  return (
    <Text c={amount < 0 ? 'var(--q-color-warning-text)' : 'var(--q-color-sale)'}>
      {formatRoundedMoney(amount)}
      {unknownRevenue > 0 && (
        <>
          {' '}
          <Tooltip
            label={t('report.partialHint')}
            multiline
            w={240}
            withArrow
            events={{ hover: true, focus: true, touch: true }}
          >
            <Text span size="sm" c="dimmed" tabIndex={0}>
              {t('report.partial')}
            </Text>
          </Tooltip>
        </>
      )}
    </Text>
  )
}

function ProductName({ row }: { row: ReportProduct }) {
  return (
    <Stack gap={0}>
      <Text fw={600} style={{ overflowWrap: 'anywhere' }}>
        {row.article}
      </Text>
      <Text c="dimmed">{row.name}</Text>
    </Stack>
  )
}

function ProductReport({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState(1)
  const query = useReportProducts(from, to, expanded ? PAGE_SIZE : 10, page)
  return (
    <Stack gap="md">
      <SectionTitle>{t('report.products')}</SectionTitle>
      {query.isPending ? (
        <PageLoader />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <>
          <DataTable
            rows={query.data.items}
            rowKey={(row) => row.product_id}
            columns={[
              {
                key: 'product',
                header: t('report.product'),
                cell: (row) => <ProductName row={row} />,
              },
              {
                key: 'qty',
                header: t('flow.qty'),
                numeric: true,
                cell: (row) => `${formatInteger(row.qty)} ${unitLabel(row.unit)}`,
              },
              {
                key: 'revenue',
                header: t('report.revenue'),
                numeric: true,
                cell: (row) => formatMoney(row.revenue),
              },
              {
                key: 'profit',
                header: t('report.profit'),
                numeric: true,
                cell: (row) => (
                  <Profit
                    amount={row.profit}
                    revenue={row.revenue}
                    unknownRevenue={row.revenue_unknown_cost}
                  />
                ),
              },
            ]}
            mobileCard={(row) => (
              <Stack gap="xs">
                <ProductName row={row} />
                <Text>
                  {t('flow.qty')}: {formatInteger(row.qty)} {unitLabel(row.unit)}
                </Text>
                <Text>
                  {t('report.revenue')}: {formatMoney(row.revenue)}
                </Text>
                <Group gap="xs">
                  <Text>{t('report.profit')}:</Text>
                  <Profit
                    amount={row.profit}
                    revenue={row.revenue}
                    unknownRevenue={row.revenue_unknown_cost}
                  />
                </Group>
              </Stack>
            )}
          />
          {!expanded && query.data.total > 10 && (
            <Anchor component="button" type="button" onClick={() => setExpanded(true)}>
              {t('report.showAll')}
            </Anchor>
          )}
          {expanded && <ListPagination total={query.data.total} page={page} onChange={setPage} />}
        </>
      )}
    </Stack>
  )
}

function CustomerReport({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation()
  const query = useReportCustomers(from, to)
  const name = (row: NonNullable<typeof query.data>['items'][number]) =>
    row.customer_id === null ? (
      <Text>{t('sell.review.retail')}</Text>
    ) : (
      <RowLink to={`/customers/${row.customer_id}`}>{row.name}</RowLink>
    )
  return (
    <Stack gap="md">
      <SectionTitle>{t('report.customers')}</SectionTitle>
      {query.isPending ? (
        <PageLoader />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <DataTable
          rows={query.data.items}
          rowKey={(row) => row.customer_id ?? 'retail'}
          columns={[
            { key: 'customer', header: t('report.customer'), cell: name },
            {
              key: 'count',
              header: t('report.salesCount'),
              numeric: true,
              cell: (row) => formatInteger(row.sales_count),
            },
            {
              key: 'revenue',
              header: t('report.revenue'),
              numeric: true,
              cell: (row) => formatMoney(row.revenue),
            },
            {
              key: 'profit',
              header: t('report.profit'),
              numeric: true,
              cell: (row) => (
                <Profit
                  amount={row.profit}
                  revenue={row.revenue}
                  unknownRevenue={row.revenue_unknown_cost}
                />
              ),
            },
          ]}
          mobileCard={(row) => (
            <Stack gap="xs">
              {name(row)}
              <Text>
                {t('report.salesCount')}: {formatInteger(row.sales_count)}
              </Text>
              <Text>
                {t('report.revenue')}: {formatMoney(row.revenue)}
              </Text>
              <Group gap="xs">
                <Text>{t('report.profit')}:</Text>
                <Profit
                  amount={row.profit}
                  revenue={row.revenue}
                  unknownRevenue={row.revenue_unknown_cost}
                />
              </Group>
            </Stack>
          )}
        />
      )}
    </Stack>
  )
}

function ReportResults({ data, from, to }: { data: ReportSummary; from: string; to: string }) {
  const { t } = useTranslation()
  return (
    <>
      <Card>
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg">
          <Stat
            size="display"
            label={t('report.revenue')}
            value={formatAmount(data.revenue)}
            unit="₸"
          />
          <Stack gap="xs">
            <Stat
              size="display"
              label={t('report.profit')}
              value={formatRoundedMoney(data.profit, false)}
              unit="₸"
              color={data.profit < 0 ? 'var(--q-color-warning-text)' : 'var(--q-color-sale)'}
              testId="report-profit"
            />
            {data.revenue_unknown_cost > 0 && (
              <Text size="sm" c="dimmed">
                {t('report.unknownCost', { amount: formatRoundedMoney(data.revenue_unknown_cost) })}
              </Text>
            )}
          </Stack>
          <Stat label={t('report.salesCount')} value={formatInteger(data.sales_count)} />
        </SimpleGrid>
        {data.returns_count > 0 && (
          <Text mt="md">
            {t('report.returns', {
              amount: formatMoney(data.returns_total),
              count: data.returns_count,
            })}
          </Text>
        )}
        {data.defect_loss > 0 && (
          <Text mt="xs">
            {t('report.defectLoss', { amount: formatRoundedMoney(data.defect_loss) })}
          </Text>
        )}
      </Card>
      <Card>
        <Stack gap="md">
          <SectionTitle>{t('report.received')}</SectionTitle>
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg">
            <Stat
              label={t('paymentMethod.cash')}
              value={formatAmount(data.received.cash)}
              unit="₸"
            />
            <Stat
              label={t('paymentMethod.card')}
              value={formatAmount(data.received.card)}
              unit="₸"
            />
            <Stat label={t('report.total')} value={formatAmount(data.received.total)} unit="₸" />
          </SimpleGrid>
          <Text>{t('report.debtGiven', { amount: formatMoney(data.debt_given) })}</Text>
        </Stack>
      </Card>
      {data.sales_count === 0 ? (
        <EmptyState text={t('report.empty')} />
      ) : (
        <>
          {periodDays(from, to) <= 62 && <ReportChart days={data.days} />}
          <ProductReport from={from} to={to} />
          <CustomerReport from={from} to={to} />
        </>
      )}
    </>
  )
}

export function ReportPage() {
  const { t } = useTranslation()
  const back = useBackToMore()
  const [params, setParams] = useSearchParams()
  const rawFrom = params.get('from') ?? ''
  const rawTo = params.get('to') ?? ''
  const validDates = isCalendarDate(rawFrom) && isCalendarDate(rawTo)
  const [from, to] = validDates ? [rawFrom, rawTo] : quickRange('month')
  useEffect(() => {
    if (!validDates) setParams({ from, to }, { replace: true })
  }, [validDates, from, to, setParams])
  const error =
    to < from
      ? t('validation.report_period_order')
      : periodDays(from, to) > 366
        ? t('validation.report_period_too_long')
        : null
  const query = useReportSummary(from, to, error === null)
  return (
    <PageContainer>
      <PageHeader back={back} title={t('report.title')} />
      <ReportPeriod
        from={from}
        to={to}
        onChange={(from, to) => setParams({ from, to }, { replace: true })}
      />
      {error ? (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      ) : query.isPending ? (
        <PageLoader />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <ReportResults key={`${from}:${to}`} data={query.data} from={from} to={to} />
      )}
    </PageContainer>
  )
}
