import i18n from 'i18next'
import type { components } from '../../api/schema'
import { type Currency, parseRate } from '../../lib/currency'
import { localInputToIso } from '../../lib/dates'
import { parseMoney, tiynToInput, validateMoneyText } from '../../lib/money'
import { qtyError } from '../../lib/validation'
import type { Product } from '../products/api'
import type { ReceiptCreate } from '../receipts/api'

export type ExpenseKind = components['schemas']['ExpenseIn']['kind']
export type AllocationMethod = NonNullable<components['schemas']['ExpenseIn']['allocation_method']>
export interface DraftRate {
  value: string
  source: 'nbk' | 'manual'
  date: string | null
  requestedDate: string | null
  exact: boolean
  edited: boolean
}
export function emptyRate(): DraftRate {
  return { value: '', source: 'nbk', date: null, requestedDate: null, exact: true, edited: false }
}
export interface ReceiptDraftLine {
  productId: number
  article?: string
  name?: string
  qty: number | string
  cost: string
  priceCurrency: Currency
}
export interface ReceiptDraftExpense {
  id: string
  kind: ExpenseKind
  amount: string
  currency: Currency
  rate: DraftRate
  method: AllocationMethod
  productIds: number[]
  manual: Record<number, string>
  moreOpen: boolean
  seedMethod?: Exclude<AllocationMethod, 'manual'>
  seedPending?: boolean
}
export interface ReceiptDraft {
  version: 3
  requestId: string
  unknown?: boolean
  lastBody?: ReceiptCreate
  editedSinceSubmit?: boolean
  lines: ReceiptDraftLine[]
  supplier: string
  note: string
  receivedAt: string | null
  extrasOpen: boolean
  currency: Currency
  currencyChosen: boolean
  rate: DraftRate
  expenses: ReceiptDraftExpense[]
  expensesOpen: boolean
}
export function createReceiptDraft(): ReceiptDraft {
  return {
    version: 3,
    requestId: crypto.randomUUID(),
    unknown: false,
    lines: [],
    supplier: '',
    note: '',
    receivedAt: null,
    extrasOpen: false,
    currency: 'KZT',
    currencyChosen: false,
    rate: emptyRate(),
    expenses: [],
    expensesOpen: false,
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
function currency(value: unknown): Currency {
  return value === 'CNY' || value === 'USD' ? value : 'KZT'
}
function readRate(value: unknown): DraftRate {
  if (!isRecord(value)) return emptyRate()
  return {
    value: text(value.value),
    source: value.source === 'manual' ? 'manual' : 'nbk',
    date: typeof value.date === 'string' ? value.date : null,
    requestedDate: typeof value.requestedDate === 'string' ? value.requestedDate : null,
    exact: value.exact !== false,
    edited: value.edited === true,
  }
}
const KINDS: ExpenseKind[] = [
  'delivery',
  'customs_duty',
  'antidumping_duty',
  'import_vat',
  'broker',
  'bank',
  'other',
]
export function parseReceiptDraft(raw: unknown): ReceiptDraft | null {
  if (!isRecord(raw) || ![1, 2, 3].includes(raw.version as number) || !Array.isArray(raw.lines))
    return null
  if (raw.version !== 1 && typeof raw.requestId !== 'string') return null
  const current = raw.version === 3
  return {
    version: 3,
    requestId: typeof raw.requestId === 'string' ? raw.requestId : crypto.randomUUID(),
    unknown: raw.unknown === true,
    ...(isRecord(raw.lastBody) ? { lastBody: raw.lastBody as unknown as ReceiptCreate } : {}),
    editedSinceSubmit: raw.editedSinceSubmit === true,
    lines: raw.lines.flatMap((line) =>
      !isRecord(line) || typeof line.productId !== 'number'
        ? []
        : [
            {
              productId: line.productId,
              qty: typeof line.qty === 'number' || typeof line.qty === 'string' ? line.qty : 1,
              cost: text(line.cost),
              priceCurrency: current ? currency(line.priceCurrency) : 'KZT',
              ...(typeof line.article === 'string' ? { article: line.article } : {}),
              ...(typeof line.name === 'string' ? { name: line.name } : {}),
            },
          ],
    ),
    supplier: text(raw.supplier),
    note: text(raw.note),
    receivedAt: typeof raw.receivedAt === 'string' ? raw.receivedAt : null,
    extrasOpen: raw.extrasOpen === true,
    currency: current ? currency(raw.currency) : 'KZT',
    currencyChosen: current && raw.currencyChosen === true,
    rate: current ? readRate(raw.rate) : emptyRate(),
    expensesOpen: current && raw.expensesOpen === true,
    expenses:
      current && Array.isArray(raw.expenses)
        ? raw.expenses.flatMap((expense) => {
            if (
              !isRecord(expense) ||
              typeof expense.id !== 'string' ||
              !KINDS.includes(expense.kind as ExpenseKind)
            )
              return []
            const method: AllocationMethod = ['quantity', 'selected', 'manual'].includes(
              expense.method as string,
            )
              ? (expense.method as AllocationMethod)
              : 'amount'
            return [
              {
                id: expense.id,
                kind: expense.kind as ExpenseKind,
                amount: text(expense.amount),
                currency: currency(expense.currency),
                rate: readRate(expense.rate),
                method,
                productIds: Array.isArray(expense.productIds)
                  ? expense.productIds.filter((id): id is number => typeof id === 'number')
                  : [],
                manual: isRecord(expense.manual)
                  ? (Object.fromEntries(
                      Object.entries(expense.manual).filter(
                        ([, amount]) => typeof amount === 'string',
                      ),
                    ) as Record<number, string>)
                  : {},
                moreOpen: expense.moreOpen === true,
                seedPending: expense.seedPending === true,
                seedMethod:
                  expense.seedMethod === 'quantity' || expense.seedMethod === 'selected'
                    ? expense.seedMethod
                    : 'amount',
              },
            ]
          })
        : [],
  }
}
export function isReceiptDraftEmpty(draft: ReceiptDraft): boolean {
  return draft.lines.length === 0 && draft.expenses.length === 0
}
export function addReceiptLine(
  lines: ReceiptDraftLine[],
  productId: number,
  lastCost: number | null = null,
  identity?: { article: string; name: string },
  priceCurrency: Currency = 'KZT',
): ReceiptDraftLine[] {
  const existing = lines.find((line) => line.productId === productId)
  return existing
    ? lines.map((line) =>
        line === existing
          ? { ...line, qty: typeof line.qty === 'number' ? line.qty + 1 : 1 }
          : line,
      )
    : [
        ...lines,
        {
          productId,
          qty: 1,
          cost: lastCost === null ? '' : tiynToInput(lastCost),
          priceCurrency,
          ...identity,
        },
      ]
}
export function purchasePrice(product: Product, selectedCurrency: Currency): number | null {
  return product.last_purchase_currency === selectedCurrency
    ? product.last_purchase_price_minor
    : null
}
export function receiptLineWarning(line: ReceiptDraftLine): string | null {
  if (qtyError(line.qty) !== null) return i18n.t('flow.warn.qty')
  if (validateMoneyText(line.cost) !== null) return i18n.t('receive.warn.cost')
  return null
}
export function rateBody(selectedCurrency: Currency, rate: DraftRate) {
  if (selectedCurrency === 'KZT') return { currency: selectedCurrency }
  const parsed = parseRate(rate.value)
  if (parsed === null || (rate.source === 'nbk' && !rate.date))
    throw new Error(i18n.t('validation.rate_required'))
  return {
    currency: selectedCurrency,
    exchange_rate: parsed,
    rate_source: rate.source,
    ...(rate.source === 'nbk' ? { rate_date: rate.date! } : {}),
  }
}
export function receiptBody(draft: ReceiptDraft): ReceiptCreate {
  const receivedAt = draft.receivedAt === null ? null : localInputToIso(draft.receivedAt)
  return {
    request_id: draft.requestId,
    ...rateBody(draft.currency, draft.rate),
    confirmed_warnings: [],
    supplier: draft.supplier.trim() || null,
    note: draft.note.trim() || null,
    ...(receivedAt !== null ? { received_at: receivedAt } : {}),
    lines: draft.lines.map((line) => {
      const cost = parseMoney(line.cost)
      if (cost === null) throw new Error(i18n.t('receive.warn.costRequired'))
      return { product_id: line.productId, qty: line.qty as number, unit_price_minor: cost }
    }),
    ...(draft.expenses.length
      ? {
          expenses: draft.expenses.map((expense) => {
            const amount = parseMoney(expense.amount)
            if (amount === null || amount <= 0) throw new Error(i18n.t('receive.expenses.required'))
            return {
              kind: expense.kind,
              amount_minor: amount,
              ...rateBody(expense.currency, expense.rate),
              allocation_method: expense.method,
              ...(expense.method === 'selected'
                ? {
                    product_ids: expense.productIds.filter((id) =>
                      draft.lines.some((line) => line.productId === id),
                    ),
                  }
                : {}),
              ...(expense.method === 'manual'
                ? {
                    manual: draft.lines.map((line) => {
                      const amount = parseMoney(expense.manual[line.productId] ?? '')
                      if (amount === null)
                        throw new Error(i18n.t('validation.expense_targets_required'))
                      return { product_id: line.productId, amount_tiyn: amount }
                    }),
                  }
                : {}),
            }
          }),
        }
      : {}),
  }
}
export function previewBody(draft: ReceiptDraft) {
  const { confirmed_warnings: _confirmed, ...body } = receiptBody(draft)
  void _confirmed
  return body
}
