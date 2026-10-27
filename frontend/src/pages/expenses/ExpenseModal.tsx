import { Alert, Button, Checkbox, Group, SimpleGrid, Stack, Text, Textarea } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useInvalidateExpenses } from '../../api/invalidate'
import { MoneyInput } from '../../components/MoneyInput'
import { DocumentModal } from '../../components/flow/DocumentModal'
import { useDocumentModalStatus } from '../../components/flow/documentModalState'
import { RequestConflictAlert, UnknownResult } from '../../components/flow/DocumentResult'
import { useDocumentResult } from '../../components/flow/documentResultState'
import { formatMoney, parseMoney, validateMoneyText } from '../../lib/money'
import { todayLocal } from '../../lib/dates'
import { FIELD_WIDTH } from '../../lib/fieldWidths'
import { serverFormErrors } from '../../lib/formErrors'
import { useBusinessSettings } from '../settings/api'
import {
  CATEGORIES,
  type Expense,
  type ExpenseCategory,
  type ExpenseCreate,
  usePostExpenses,
} from './api'

function ExpenseForm({ source, onClose }: { source?: Expense[]; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const settings = useBusinessSettings()
  const post = usePostExpenses()
  const [requestId] = useState(() => crypto.randomUUID())
  const [date, setDate] = useState<string | null>(todayLocal)
  const [category, setCategory] = useState<ExpenseCategory | null>(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [rows, setRows] = useState(() =>
    (source ?? []).map((item) => ({ item, selected: true, date: todayLocal() as string | null })),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const submitted = useRef<ExpenseCreate | null>(null)
  const result = useDocumentResult()
  const modal = useDocumentModalStatus(result.unknown, post.isPending)
  const selected = rows.filter((row) => row.selected)
  const locked = result.unknown || post.isPending || Boolean(result.conflict)
  const submit = () => {
    if (post.isPending || result.conflict) return
    if (result.unknown && submitted.current) {
      send(submitted.current)
      return
    }
    const nextErrors: Record<string, string> = {}
    let items: ExpenseCreate['items'] = []
    if (source) {
      if (selected.length < 1 || selected.length > 20) return
      items = selected.map((row, index) => {
        if (!row.date || row.date > todayLocal())
          nextErrors[`date.${index}`] = t('validation.expense_date_in_future')
        return {
          expense_date: row.date ?? '',
          category: row.item.category,
          amount: row.item.amount,
          note: row.item.note,
        }
      })
    } else {
      const value = parseMoney(amount)
      if (!category) nextErrors.category = t('expenses.categoryRequired')
      if (!date || date > todayLocal()) nextErrors.date = t('validation.expense_date_in_future')
      if (value === null || value <= 0 || value > 1_000_000_000_000_000)
        nextErrors.amount = validateMoneyText(amount) || t('payments.positiveAmount')
      if (note.trim().length > 500)
        nextErrors.note = t('validation.string_too_long', { max_length: 500 })
      if (category && value !== null)
        items = [{ expense_date: date ?? '', category, amount: value, note: note.trim() || null }]
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    submitted.current = { request_id: requestId, items }
    send(submitted.current)
  }
  const send = (body: ExpenseCreate) => {
    setMessage(null)
    post.mutate(body, {
      onSuccess: (saved) => {
        for (const item of saved.items)
          notifications.show({
            color: 'green',
            message: t('expenses.saved', { number: item.number }),
          })
        onClose()
      },
      onError: (error) => {
        if (result.acceptError(error)) return
        const fieldMap: Record<string, string> = {}
        body.items.forEach((_, index) => {
          for (const field of ['expense_date', 'category', 'amount', 'note'])
            fieldMap[`items.${index}.${field}`] = source
              ? `date.${index}`
              : field === 'expense_date'
                ? 'date'
                : field
        })
        const mapped = serverFormErrors(error, { fieldMap })
        setErrors(mapped.fields)
        setMessage(mapped.message)
      },
    })
  }
  const dateProps = {
    valueFormat: i18n.language === 'zh' ? 'YYYY/MM/DD' : 'DD.MM.YYYY',
    maxDate: todayLocal(),
    required: true,
    w: FIELD_WIDTH.date,
    maw: '100%',
  } as const
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <Stack gap="lg">
        <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <Stack gap="lg">
            {source ? (
              <>
                <Text>{t('expenses.repeatHint')}</Text>
                {rows.map((row, index) => (
                  <Stack
                    key={row.item.id}
                    gap="xs"
                    style={{ borderBottom: '1px solid var(--q-color-border)', paddingBottom: 16 }}
                  >
                    <Checkbox
                      label={`${t(`expenses.categories.${row.item.category}`)} · ${formatMoney(row.item.amount)} · №${row.item.number}`}
                      checked={row.selected}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked
                        setRows((previous) =>
                          previous.map((value, at) =>
                            at === index ? { ...value, selected: checked } : value,
                          ),
                        )
                      }}
                    />
                    {row.item.note && <Text c="dimmed">{row.item.note}</Text>}
                    <DatePickerInput
                      {...dateProps}
                      label={t('expenses.date')}
                      value={row.date}
                      error={row.selected ? errors[`date.${selected.indexOf(row)}`] : undefined}
                      onChange={(value) =>
                        setRows((previous) =>
                          previous.map((item, at) =>
                            at === index ? { ...item, date: value } : item,
                          ),
                        )
                      }
                    />
                  </Stack>
                ))}
              </>
            ) : (
              <>
                <DatePickerInput
                  {...dateProps}
                  label={t('expenses.date')}
                  value={date}
                  onChange={setDate}
                  error={errors.date}
                />
                <Stack gap="xs">
                  <Text fw={600}>{t('expenses.category')}</Text>
                  {errors.category && (
                    <Text c="red" role="alert" id="expense-category-error">
                      {errors.category}
                    </Text>
                  )}
                  <SimpleGrid
                    cols={2}
                    spacing="xs"
                    role="group"
                    aria-label={t('expenses.category')}
                    aria-invalid={Boolean(errors.category)}
                    aria-describedby={errors.category ? 'expense-category-error' : undefined}
                  >
                    {CATEGORIES.map((value) => (
                      <Button
                        key={value}
                        variant={category === value ? 'filled' : 'default'}
                        color={errors.category ? 'red' : undefined}
                        style={{
                          whiteSpace: 'normal',
                          height: 'auto',
                          minHeight: 56,
                          borderColor: errors.category ? 'var(--mantine-color-red-6)' : undefined,
                        }}
                        aria-pressed={category === value}
                        onClick={() => {
                          setCategory(value)
                          setErrors((previous) => ({ ...previous, category: '' }))
                        }}
                      >
                        {t(`expenses.categories.${value}`)}
                      </Button>
                    ))}
                  </SimpleGrid>
                  <Text c="dimmed" size="sm">
                    {t('expenses.purchaseHint')}
                  </Text>
                  {category === 'taxes' && settings.data && settings.data.tax_percent !== '0' && (
                    <Text c="dimmed" size="sm">
                      {t('expenses.taxHint', { percent: settings.data.tax_percent })}
                    </Text>
                  )}
                  {category === 'bank' &&
                    settings.data &&
                    settings.data.card_commission_percent !== '0' && (
                      <Text c="dimmed" size="sm">
                        {t('expenses.bankHint', { percent: settings.data.card_commission_percent })}
                      </Text>
                    )}
                </Stack>
                <MoneyInput
                  label={t('expenses.amount')}
                  required
                  value={amount}
                  onChange={setAmount}
                  error={errors.amount}
                  w={FIELD_WIDTH.price}
                  maw="100%"
                />
                <Textarea
                  label={t('expenses.note')}
                  value={note}
                  onChange={(event) => setNote(event.currentTarget.value)}
                  error={errors.note}
                  autosize
                  minRows={2}
                />
              </>
            )}
          </Stack>
        </fieldset>
        {message && (
          <Alert color="red" role="alert">
            {message}
          </Alert>
        )}
        {result.conflict && (
          <RequestConflictAlert
            error={result.conflict}
            onClear={() => modal?.clear()}
            onOpen={() => modal?.openSaved()}
          />
        )}
        {result.unknown && <UnknownResult onRetry={submit} busy={post.isPending} />}
        <Stack gap="xs" className="q-modal-actions-sticky" data-testid="expense-actions">
          {source && selected.length > 20 && (
            <Text role="alert" c="red">
              {t('expenses.repeatLimit')}
            </Text>
          )}
          <Group justify="flex-end" className="q-modal-actions">
            <Button variant="default" disabled={post.isPending} onClick={() => modal?.close()}>
              {t('common.cancel')}
            </Button>
            {!result.unknown && (
              <Button
                type="submit"
                loading={post.isPending}
                disabled={
                  Boolean(result.conflict) ||
                  Boolean(source && (selected.length < 1 || selected.length > 20))
                }
              >
                {t('common.save')}
              </Button>
            )}
          </Group>
        </Stack>
      </Stack>
    </form>
  )
}

export function ExpenseModal({
  opened,
  onClose,
  source,
}: {
  opened: boolean
  onClose: () => void
  source?: Expense[]
}) {
  const { t } = useTranslation()
  const invalidate = useInvalidateExpenses()
  return (
    <DocumentModal
      opened={opened}
      onClose={onClose}
      invalidate={invalidate}
      title={t(source ? 'expenses.review' : 'expenses.add')}
      size="lg"
    >
      {opened && <ExpenseForm source={source} onClose={onClose} />}
    </DocumentModal>
  )
}
