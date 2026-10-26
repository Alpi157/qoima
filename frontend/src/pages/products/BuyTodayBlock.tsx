import { Anchor, Button, Loader, Stack, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { api, unwrap } from '../../api/client'
import { useInvalidateBuyToday } from '../../api/invalidate'
import { ConfirmModal } from '../../components/ConfirmModal'
import { QueryError } from '../../components/QueryError'
import { RateCaptions } from '../../components/RateCaptions'
import { Card, SectionTitle } from '../../components/ui'
import { apiErrorText } from '../../i18n/errorText'
import { formatCurrency } from '../../lib/currency'
import { formatDate } from '../../lib/dates'
import { unitLabel } from '../../lib/labels'
import { formatRoundedMoney } from '../../lib/money'
import { type Product, useProductBuyToday } from './api'
import { PriceQuoteModal } from './PriceQuoteModal'

export function BuyTodayBlock({ product }: { product: Product }) {
  const { t } = useTranslation()
  const query = useProductBuyToday(product.id)
  const [quoteOpened, quoteModal] = useDisclosure()
  const [cancelOpened, cancelModal] = useDisclosure()
  const invalidate = useInvalidateBuyToday()
  const cancel = useMutation({
    meta: { handlesError: true },
    mutationFn: (id: number) =>
      unwrap(
        api.POST('/api/price-quotes/{quote_id}/cancel', { params: { path: { quote_id: id } } }),
      ),
    onSuccess: () => {
      invalidate()
      cancelModal.close()
    },
    onError: (error: unknown) => {
      invalidate()
      cancelModal.close()
      notifications.show({ color: 'red', message: apiErrorText(error, t) })
    },
  })
  const data = query.data
  const active = data?.active_quote
  return (
    <Card>
      <Stack gap="md" data-testid="buy-today-block">
        <SectionTitle>{t('buyToday.title')}</SectionTitle>
        {query.isPending ? (
          <Loader />
        ) : query.isError ? (
          <QueryError error={query.error} onRetry={() => query.refetch()} />
        ) : (
          data && (
            <>
              {data.buy_today === null ? (
                <Text>
                  {data.reason_unavailable === 'no_rate'
                    ? t('buyToday.noRate')
                    : t('buyToday.noPurchase')}
                </Text>
              ) : (
                <>
                  <Text size="xl" fw={600}>
                    {t('buyToday.amount', {
                      unit: unitLabel(product.unit),
                      amount: formatRoundedMoney(data.buy_today),
                    })}
                  </Text>
                  {data.basis_date && data.currency && data.price_minor !== null && (
                    <Text>
                      {data.basis === 'purchase' && data.basis_receipt_id ? (
                        <Anchor component={Link} to={`/receipts/${data.basis_receipt_id}`}>
                          {t('buyToday.purchaseBasis', {
                            date: formatDate(data.basis_date),
                            price: formatCurrency(data.price_minor, data.currency),
                          })}
                        </Anchor>
                      ) : (
                        t('buyToday.quoteBasis', {
                          date: formatDate(data.basis_date),
                          price: formatCurrency(data.price_minor, data.currency),
                        })
                      )}
                    </Text>
                  )}
                  <RateCaptions rates={data.rates} />
                  {!data.expenses_known && (
                    <Text size="sm" c="dimmed">
                      {t('buyToday.expensesUnknown')}
                    </Text>
                  )}
                  <Text>
                    {t('buyToday.markup', {
                      now: data.markup_now ?? '—',
                      then: data.markup_then ?? '—',
                    })}
                  </Text>
                  {data.price_to_keep_markup !== null && (
                    <Text>
                      {t('buyToday.keepMarkup', {
                        then: data.markup_then,
                        price: formatRoundedMoney(data.price_to_keep_markup),
                      })}
                    </Text>
                  )}
                  {data.difference_vs_avg !== null &&
                    data.difference_vs_avg !== 0 &&
                    data.avg_cost !== null && (
                      <Text>
                        {data.difference_vs_avg < 0
                          ? t('buyToday.cheaper', {
                              diff: formatRoundedMoney(-data.difference_vs_avg),
                              avg: formatRoundedMoney(data.avg_cost),
                            })
                          : t('buyToday.dearer', {
                              diff: formatRoundedMoney(data.difference_vs_avg),
                              avg: formatRoundedMoney(data.avg_cost),
                            })}
                      </Text>
                    )}
                </>
              )}
              {active && (
                <Stack gap="xs">
                  {(data.basis !== 'quote' || data.buy_today === null) && (
                    <Text c="dimmed">
                      {t('buyToday.quoteBasis', {
                        date: formatDate(active.quoted_on),
                        price: formatCurrency(active.price_minor, active.currency),
                      })}
                    </Text>
                  )}
                  <Button
                    variant="subtle"
                    style={{
                      alignSelf: 'flex-start',
                      whiteSpace: 'normal',
                      height: 'auto',
                      minHeight: 56,
                    }}
                    onClick={cancelModal.open}
                  >
                    {t('buyToday.removeQuote')}
                  </Button>
                </Stack>
              )}
            </>
          )
        )}
        <Button
          variant="default"
          style={{ alignSelf: 'flex-start', whiteSpace: 'normal', height: 'auto', minHeight: 56 }}
          onClick={quoteModal.open}
        >
          {t('buyToday.newQuote')}
        </Button>
      </Stack>
      <PriceQuoteModal productId={product.id} opened={quoteOpened} onClose={quoteModal.close} />
      <ConfirmModal
        opened={cancelOpened}
        onClose={cancelModal.close}
        title={t('buyToday.removeQuote')}
        confirmLabel={t('buyToday.removeQuote')}
        onConfirm={() => {
          if (active) cancel.mutate(active.id)
        }}
        loading={cancel.isPending}
      >
        {active?.cancel_fallback_basis === 'quote'
          ? t('buyToday.confirmPrevious')
          : active?.cancel_fallback_basis === 'purchase'
            ? t('buyToday.confirmPurchase')
            : t('buyToday.confirmNone')}
      </ConfirmModal>
    </Card>
  )
}
