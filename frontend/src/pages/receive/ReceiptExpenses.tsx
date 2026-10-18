import { Alert, Button, Checkbox, Group, Select, Stack, Text, Title } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MoneyInput } from '../../components/MoneyInput'
import { Card } from '../../components/ui'
import { apiErrorText } from '../../i18n/errorText'
import { todayLocal } from '../../lib/dates'
import { formatMoney, parseMoney, tiynToInput } from '../../lib/money'
import { fetchReceiptPreview } from '../receipts/api'
import { CurrencyFields } from './CurrencyFields'
import {
  type AllocationMethod,
  type ReceiptDraft,
  type ReceiptDraftExpense,
  emptyRate,
  previewBody,
} from './receiptDraft'

import { EXPENSE_KINDS, METHOD_KEYS } from './receiptLabels'

function expenseProbe(draft: ReceiptDraft, expense: ReceiptDraftExpense, method: AllocationMethod) {
  try {
    return previewBody({ ...draft, expenses: [{ ...expense, method }] })
  } catch {
    return null
  }
}
function ExpenseCard({
  draft,
  expense,
  onChange,
  onRemove,
  onValidity,
  focus,
}: {
  draft: ReceiptDraft
  expense: ReceiptDraftExpense
  onChange: (expense: ReceiptDraftExpense) => void
  onRemove: () => void
  onValidity: (id: string, valid: boolean) => void
  focus: boolean
}) {
  const { t } = useTranslation()
  const [seedError, setSeedError] = useState<unknown>(null)
  const [seeding, setSeeding] = useState(false)
  const amountInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focus) {
      amountInput.current?.focus({ preventScroll: true })
      amountInput.current?.scrollIntoView?.({ block: 'center' })
    }
  }, [focus])
  const latest = useRef({ draft, expense, onChange })
  useEffect(() => {
    latest.current = { draft, expense, onChange }
  })
  const body = expenseProbe(draft, expense, 'quantity')
  const target = useQuery({
    queryKey: ['receipt-expense-target', body],
    queryFn: () => fetchReceiptPreview(body!),
    enabled: expense.method === 'manual' && body !== null,
    meta: { handlesError: true },
    retry: false,
  })
  const amounts = draft.lines.map((line) => parseMoney(expense.manual[line.productId] ?? ''))
  const done = amounts.reduce<bigint>((sum, amount) => sum + BigInt(amount ?? 0), 0n)
  const total = body !== null && target.data ? target.data.expenses[0]?.amount_tiyn : undefined
  const valid =
    expense.method !== 'manual' ||
    (amounts.every((amount) => amount !== null) && total !== undefined && done === BigInt(total))
  useEffect(() => {
    onValidity(expense.id, valid)
  }, [expense.id, valid, onValidity])

  const seed = async (method: Exclude<AllocationMethod, 'manual'>, initial = false) => {
    const current = latest.current
    const snapshot = {
      ...current.expense,
      method: 'manual' as const,
      seedMethod: method,
      seedPending: true,
      manual: Object.fromEntries(current.draft.lines.map((line) => [line.productId, ''])),
    }
    if (initial) onChange(snapshot)
    if (initial) latest.current = { ...current, expense: snapshot }
    const input = expenseProbe(current.draft, current.expense, method)
    if (!input) {
      setSeedError(new Error())
      return
    }
    const signature = JSON.stringify({
      lines: current.draft.lines,
      amount: current.expense.amount,
      currency: current.expense.currency,
      rate: current.expense.rate,
      productIds: current.expense.productIds,
    })
    setSeeding(true)
    setSeedError(null)
    try {
      const result = await fetchReceiptPreview(input)
      const now = latest.current
      if (
        now.expense.method !== 'manual' ||
        now.expense.seedMethod !== method ||
        !now.expense.seedPending ||
        JSON.stringify({
          lines: now.draft.lines,
          amount: now.expense.amount,
          currency: now.expense.currency,
          rate: now.expense.rate,
          productIds: now.expense.productIds,
        }) !== signature
      )
        return
      const allocations = new Map(
        result.expenses[0].allocations.map((part) => [part.product_id, part.amount_tiyn]),
      )
      now.onChange({
        ...now.expense,
        seedPending: false,
        manual: Object.fromEntries(
          now.draft.lines.map((line) => [
            line.productId,
            now.expense.manual[line.productId] || tiynToInput(allocations.get(line.productId) ?? 0),
          ]),
        ),
      })
    } catch (error) {
      setSeedError(error)
    } finally {
      setSeeding(false)
    }
  }
  const amount = parseMoney(expense.amount)
  const hint = expense.kind !== 'other' ? t(`receive.expenses.${expense.kind}Hint`) : null
  return (
    <Card
      id={`expense-${expense.id}`}
      data-testid="receipt-expense"
      style={{ scrollMarginTop: 96 }}
    >
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <Title order={3}>{t(`receive.expenses.${expense.kind}`)}</Title>
          <Button variant="default" size="sm" onClick={onRemove}>
            {t('flow.remove')}
          </Button>
        </Group>
        {hint && <Text c="dimmed">{hint}</Text>}
        <MoneyInput
          ref={amountInput}
          label={t('receive.expenses.amount')}
          value={expense.amount}
          onChange={(amount) => onChange({ ...expense, amount })}
          showHint={false}
          w={180}
          maw="100%"
          error={amount === null || amount <= 0 ? t('receive.expenses.required') : undefined}
        />
        <CurrencyFields
          currency={expense.currency}
          rate={expense.rate}
          date={draft.receivedAt?.slice(0, 10) ?? todayLocal()}
          unknown={draft.unknown === true}
          id={`expense-rate-${expense.id}`}
          onCurrency={(currency) =>
            onChange({
              ...expense,
              currency,
              rate: currency === expense.currency ? expense.rate : emptyRate(),
            })
          }
          onRate={(rate) => onChange({ ...expense, rate })}
        />
        <Button
          variant="subtle"
          onClick={() => onChange({ ...expense, moreOpen: !expense.moreOpen })}
          aria-expanded={expense.moreOpen}
          style={{ alignSelf: 'flex-start' }}
        >
          {t('receive.expenses.more')}
        </Button>
        {expense.moreOpen && (
          <Stack gap="md">
            <Select
              label={t('receive.expenses.allocation')}
              value={expense.method}
              allowDeselect={false}
              data={(Object.keys(METHOD_KEYS) as AllocationMethod[]).map((value) => ({
                value,
                label: t(METHOD_KEYS[value]),
              }))}
              onChange={(value) => {
                const method = value as AllocationMethod
                if (method === 'manual' && expense.method !== 'manual')
                  void seed(expense.method, true)
                else onChange({ ...expense, method, seedPending: false })
              }}
            />
            {expense.method === 'amount' && (
              <Text c="dimmed">{t('receive.expenses.amountHint')}</Text>
            )}
            {expense.method === 'selected' && (
              <Stack gap="md">
                {draft.lines.map((line) => (
                  <Checkbox
                    key={line.productId}
                    label={`${line.article ?? line.productId} · ${line.name ?? ''}`}
                    checked={expense.productIds.includes(line.productId)}
                    onChange={(event) =>
                      onChange({
                        ...expense,
                        productIds: event.currentTarget.checked
                          ? [...expense.productIds, line.productId]
                          : expense.productIds.filter((id) => id !== line.productId),
                      })
                    }
                  />
                ))}
                {expense.productIds.length === 0 && (
                  <Text c="red">{t('validation.expense_targets_required')}</Text>
                )}
              </Stack>
            )}
            {expense.method === 'manual' && (
              <Stack gap="md">
                {draft.lines.map((line) => (
                  <MoneyInput
                    key={line.productId}
                    label={`${line.article ?? line.productId}, ₸`}
                    value={expense.manual[line.productId] ?? ''}
                    showHint={false}
                    onChange={(value) =>
                      onChange({
                        ...expense,
                        seedPending: false,
                        manual: { ...expense.manual, [line.productId]: value },
                      })
                    }
                    error={
                      parseMoney(expense.manual[line.productId] ?? '') === null
                        ? t('validation.missing')
                        : undefined
                    }
                  />
                ))}
                <Text
                  fw={600}
                  c={valid ? undefined : 'var(--q-color-warning-text)'}
                  data-testid="expense-allocation-total"
                >
                  {t('receive.expenses.allocated', {
                    done: formatMoney(done),
                    total: total === undefined ? '—' : formatMoney(total),
                  })}
                </Text>
                {(expense.seedPending || Boolean(seedError)) && (
                  <Button
                    variant="default"
                    loading={seeding}
                    onClick={() => void seed(expense.seedMethod ?? 'amount')}
                  >
                    {t('receive.review.reload')}
                  </Button>
                )}
                {target.isError && (
                  <Alert color="red">
                    <Text>{apiErrorText(target.error, t)}</Text>
                    <Button variant="default" onClick={() => void target.refetch()}>
                      {t('receive.review.reload')}
                    </Button>
                  </Alert>
                )}
              </Stack>
            )}
          </Stack>
        )}
        {!expense.moreOpen && <Text c="dimmed">{t(METHOD_KEYS[expense.method])}</Text>}
      </Stack>
    </Card>
  )
}
export function ReceiptExpenses({
  draft,
  onChange,
  onValidity,
}: {
  draft: ReceiptDraft
  onChange: (
    changes: Partial<ReceiptDraft> | ((current: ReceiptDraft) => Partial<ReceiptDraft>),
  ) => void
  onValidity: (id: string, valid: boolean) => void
}) {
  const { t } = useTranslation()
  const [moreKinds, setMoreKinds] = useState(false)
  const [focusExpenseId, setFocusExpenseId] = useState<string | null>(null)
  const addExpense = (kind: (typeof EXPENSE_KINDS)[number]) => {
    const id = crypto.randomUUID()
    setFocusExpenseId(id)
    onChange((current) => ({
      expenses: [
        ...current.expenses,
        {
          id,
          kind,
          amount: '',
          currency: 'KZT',
          rate: emptyRate(),
          method: 'amount',
          productIds: [],
          manual: {},
          moreOpen: false,
        },
      ],
    }))
  }
  return (
    <Stack gap="md">
      <Button
        variant="default"
        onClick={() => {
          setFocusExpenseId(null)
          onChange({ expensesOpen: !draft.expensesOpen })
        }}
        aria-expanded={draft.expensesOpen}
        style={{ alignSelf: 'flex-start' }}
      >
        {draft.expensesOpen ? t('receive.expenses.title') : t('receive.expenses.add')}
      </Button>
      {draft.expensesOpen && (
        <>
          <Group gap="md" align="flex-start">
            {EXPENSE_KINDS.filter((kind) => kind !== 'antidumping_duty' || moreKinds).map(
              (kind) => (
                <Stack key={kind} gap="xs" style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <Button
                    variant="default"
                    styles={{
                      root: { minHeight: 56, height: 'auto' },
                      label: { whiteSpace: 'normal', paddingBlock: 8 },
                    }}
                    onClick={() => addExpense(kind)}
                  >
                    {t(`receive.expenses.${kind}`)}
                  </Button>
                  {kind !== 'other' && <Text c="dimmed">{t(`receive.expenses.${kind}Hint`)}</Text>}
                </Stack>
              ),
            )}
            <Button
              variant="subtle"
              onClick={() => setMoreKinds(!moreKinds)}
              aria-expanded={moreKinds}
            >
              {t('receive.expenses.more')}
            </Button>
          </Group>
          {draft.expenses.map((expense) => (
            <ExpenseCard
              key={expense.id}
              draft={draft}
              expense={expense}
              focus={focusExpenseId === expense.id}
              onValidity={onValidity}
              onChange={(next) =>
                onChange((current) => ({
                  expenses: current.expenses.map((item) => (item.id === next.id ? next : item)),
                }))
              }
              onRemove={() =>
                onChange((current) => ({
                  expenses: current.expenses.filter((item) => item.id !== expense.id),
                }))
              }
            />
          ))}
        </>
      )}
    </Stack>
  )
}
