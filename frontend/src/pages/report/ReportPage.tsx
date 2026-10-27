import { Alert, Anchor, Group, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { EmptyState } from '../../components/EmptyState'
import { ListPagination } from '../../components/ListPagination'
import { PageLoader } from '../../components/PageLoader'
import { ReportPeriod } from '../../components/ReportPeriod'
import { ProfitSteps } from './ProfitSteps'
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
import { isCalendarDate, periodDays, quickRange } from '../../lib/dates'
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
import { AdjustmentReport } from './AdjustmentReport'

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
  if (unknownRevenue !== 0 && unknownRevenue === revenue)
    return <Text c="dimmed">{t('products.card.unknown')}</Text>
  return (
    <Text c={amount < 0 ? 'var(--q-color-warning-text)' : 'var(--q-color-sale)'}>
      {formatRoundedMoney(amount)}
      {unknownRevenue !== 0 && (
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
        {(data.discount_total > 0 ||
          data.discount_unknown_count > 0 ||
          data.write_off_count > 0 ||
          data.surplus_value > 0 ||
          data.adjustment_unknown_count > 0) && (
          <Stack gap="xs" mt="md">
            {data.discount_total > 0 && (
              <Text>
                {t('report.discounts', { amount: formatRoundedMoney(data.discount_total) })}
              </Text>
            )}
            {data.discount_unknown_count > 0 && (
              <Text size="sm" c="dimmed">
                {t('report.discountUnknown')}
              </Text>
            )}
            {data.write_off_count > 0 && (
              <AdjustmentReport
                from={from}
                to={to}
                direction="minus"
                amount={data.write_off_value}
              />
            )}
            {data.surplus_value > 0 && (
              <AdjustmentReport from={from} to={to} direction="plus" amount={data.surplus_value} />
            )}
            {data.adjustment_unknown_count > 0 && (
              <Text size="sm" c="dimmed">
                {t('report.adjustmentUnknown', { count: data.adjustment_unknown_count })}
              </Text>
            )}
          </Stack>
        )}
      </Card>
      <ProfitSteps data={data} from={from} to={to} />
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
